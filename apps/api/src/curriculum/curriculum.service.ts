import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { GuardiansService } from '../guardians/guardians.service';
import { isMembershipLive } from '../memberships/memberships.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { OrderCategoryLessonsDto, OrderLessonCategoriesDto } from './dto/lesson-category.dto';

const LESSON_INCLUDE = { skills: { include: { skill: { select: { disciplineId: true } } } }, category: { select: { name: true } } } as const;

/** What a caller may watch (Decisions 154, 190, 195): staff everything; a
 * student, or a guardian on their behalf, free lessons and those of the styles
 * their live memberships cover on plans that include lessons. */
type LessonAccess = 'all' | Set<string>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Categorised lessons in category order, each in its own order; then the rest. */
const LESSON_ORDER: Prisma.LessonOrderByWithRelationInput[] = [{ category: { order: 'asc' } }, { categoryId: 'asc' }, { order: 'asc' }, { title: 'asc' }];

/**
 * Phase 44 — CurriculumModule (Lesson CRUD only; see Lesson's own schema.prisma
 * comment for the full scoping rationale, the Decision 58/§7 spec contradiction
 * this resolves, and what's deliberately out of scope this phase: the actual
 * video-upload/captioning-pipeline integration against Cloudflare Stream/AWS
 * Transcribe — Decision 101 picked those vendors but explicitly does not build
 * the integration, and no credentials for either are provisioned in this working
 * environment, same precedent as every other unprovisioned vendor in this
 * codebase (Stripe/Cognito/R2/Twilio). videoRef/captionStatus/captionTrackRef
 * exist on the model and response shape, but nothing here ever writes them beyond
 * the schema default (captionStatus PENDING, everything else null) — that's a
 * later phase's work, once real credentials exist to build and verify against.
 *
 * Writes (create/update) require Staff/Instructor (assertStaffAtSchool — Decision
 * 58's own "an instructor uploads", resolved as Decision 104 to mean ordinary
 * tenant Staff, not Platform Admin). Reads have no additional check beyond RLS
 * itself (lesson_tenant_isolation admits any active RoleGrant at the School,
 * Student included — Decision 58's own "surfacing automatically... a student's
 * profile"), same "School/Branch RLS admits any role, business-layer narrows
 * writes" split already established for Discipline/Rank/Skill.
 */
@Injectable()
export class CurriculumService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly guardiansService: GuardiansService,
  ) {}

  async createLesson(callerId: string, schoolId: string, dto: CreateLessonDto) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    if (dto.instructorId) {
      // Lesson has no Branch of its own — null targetBranchId means "any of this
      // Instructor's grants at the School count," same as a School-wide Class.
      await this.tenantAuth.assertValidInstructor(callerId, dto.instructorId, schoolId, null);
    }
    await this.assertSkillsBelongToSchool(callerId, dto.skillIds, schoolId);
    // Only the owner makes a lesson free (Decision 190).
    if (dto.free) await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const lessonId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const categoryId = dto.categoryId ?? null;
      if (categoryId) await this.assertCategoryOfSchool(tx, categoryId, schoolId);
      await tx.lesson.create({
        data: {
          id: lessonId,
          schoolId,
          instructorId: dto.instructorId,
          title: dto.title,
          categoryId,
          order: await this.nextOrderIn(tx, schoolId, categoryId),
          free: dto.free ?? false,
          durationSeconds: dto.durationSeconds,
          description: dto.description,
          format: dto.format,
        },
      });
      await tx.lessonSkill.createMany({
        data: dto.skillIds.map((skillId) => ({ lessonId, skillId })),
      });
      const full = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: LESSON_INCLUDE });
      return this.shapeLessonResponse(full);
    });
  }

  async findLessonsForSchool(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId);
    const access = await this.accessFor(callerId, schoolId);
    const lessons = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.findMany({ where: { schoolId }, orderBy: LESSON_ORDER, include: LESSON_INCLUDE }),
    );
    return lessons.map((l) => this.shapeLessonResponse(l, access));
  }

  /** GET /skills/{id}/lessons — Spec 55 §7's literal confirmed route. */
  async findLessonsForSkill(callerId: string, skillId: string) {
    const skill = await this.prismaApp.withTenantContext(callerId, (tx) => tx.skill.findUnique({ where: { id: skillId } }));
    if (!skill) {
      throw new NotFoundException('Skill not found');
    }
    const lessons = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.findMany({
        where: { skills: { some: { skillId } } },
        orderBy: LESSON_ORDER,
        include: LESSON_INCLUDE,
      }),
    );
    const access = await this.accessFor(callerId, skill.schoolId);
    return lessons.map((l) => this.shapeLessonResponse(l, access));
  }

  async findOneLesson(callerId: string, lessonId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.findUnique({ where: { id: lessonId }, include: LESSON_INCLUDE }),
    );
    if (!found) {
      throw new NotFoundException('Lesson not found');
    }
    return this.shapeLessonResponse(found, await this.accessFor(callerId, found.schoolId));
  }

  /** The lessons a student may watch, for the student or their guardian
   * (Decisions 154, 190, 195): every lesson of the School, the ones they may
   * not watch marked locked. Read under the student's context, since a
   * guardian holds no role at the School. */
  async findLessonsForStudent(callerId: string, studentId: string, schoolId: string) {
    if (!schoolId) throw new BadRequestException('schoolId query parameter is required');
    if (!UUID_PATTERN.test(studentId) || !UUID_PATTERN.test(schoolId)) {
      throw new BadRequestException('id and schoolId must be valid UUIDs');
    }
    if (callerId !== studentId) await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    const enrolled = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } }),
    );
    if (!enrolled) throw new NotFoundException('This person isn\'t a student at this School.');
    const access = await this.studentStyles(studentId, schoolId);
    const lessons = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.lesson.findMany({ where: { schoolId }, orderBy: LESSON_ORDER, include: LESSON_INCLUDE }),
    );
    return lessons.map((l) => this.shapeLessonResponse(l, access));
  }

  /** Staff see every lesson; anyone else is treated as a student. */
  private async accessFor(callerId: string, schoolId: string): Promise<LessonAccess> {
    try {
      await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
      return 'all';
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      return this.studentStyles(callerId, schoolId);
    }
  }

  /** The styles a student's live memberships cover, on plans that include
   * lessons (Decision 195). */
  private async studentStyles(studentId: string, schoolId: string): Promise<Set<string>> {
    const memberships = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.membership.findMany({
        where: { studentId, schoolId },
        select: { status: true, expiryDate: true, classesRemaining: true, membershipPlan: { select: { includesLessons: true, disciplineIds: true } } },
      }),
    );
    const now = new Date();
    return new Set(memberships.filter((m) => m.membershipPlan.includesLessons && isMembershipLive(m, now)).flatMap((m) => m.membershipPlan.disciplineIds));
  }

  /** Deleting a lesson (Decision 198): nothing in a student's record points to
   * a lesson, so the owner can always delete one. */
  async deleteLesson(callerId: string, lessonId: string): Promise<void> {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lesson.findUnique({ where: { id: lessonId } }));
    if (!existing) throw new NotFoundException('Lesson not found');
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.lessonSkill.deleteMany({ where: { lessonId } });
      await tx.lesson.delete({ where: { id: lessonId } });
    });
  }

  async updateLesson(callerId: string, lessonId: string, dto: UpdateLessonDto) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lesson.findUnique({ where: { id: lessonId } }));
    if (!existing) {
      throw new NotFoundException('Lesson not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (dto.instructorId) {
      await this.tenantAuth.assertValidInstructor(callerId, dto.instructorId, existing.schoolId, null);
    }
    if (dto.skillIds) {
      await this.assertSkillsBelongToSchool(callerId, dto.skillIds, existing.schoolId);
    }
    // Only the owner makes a lesson free, or not (Decision 190).
    if (dto.free !== undefined && dto.free !== existing.free) await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      // A new category puts the lesson at its end (null: no category).
      const moving = dto.categoryId !== undefined && dto.categoryId !== existing.categoryId;
      if (moving && dto.categoryId) await this.assertCategoryOfSchool(tx, dto.categoryId, existing.schoolId);
      await tx.lesson.update({
        where: { id: lessonId },
        data: {
          title: dto.title,
          free: dto.free,
          ...(moving ? { categoryId: dto.categoryId, order: await this.nextOrderIn(tx, existing.schoolId, dto.categoryId ?? null) } : {}),
          durationSeconds: dto.durationSeconds,
          description: dto.description,
          format: dto.format,
          instructorId: dto.instructorId,
        },
      });
      // REPLACE semantics for the full skillIds set, same convention as
      // UpdateRankDto's own requiredSkillIds (RanksService.updateRank).
      if (dto.skillIds) {
        await tx.lessonSkill.deleteMany({ where: { lessonId } });
        await tx.lessonSkill.createMany({ data: dto.skillIds.map((skillId) => ({ lessonId, skillId })) });
      }
      const full = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: LESSON_INCLUDE });
      return this.shapeLessonResponse(full);
    });
  }

  // No delete method — same reasoning as Discipline/Rank above (general tenant
  // content offboarding is [UNRESOLVED]); doubly so here, since a Lesson may
  // already be linked from a Student's profile or the grading flow by the time
  // any real UI calls this.

  // ---------------------------------------------------------------------------
  // Shared response shaping
  // ---------------------------------------------------------------------------

  private shapeLessonResponse(lesson: Prisma.LessonGetPayload<{ include: typeof LESSON_INCLUDE }>, access: LessonAccess = 'all') {
    const { skills, category, ...rest } = lesson;
    // A lesson's styles are its skills' styles (Decision 195).
    const locked = access !== 'all' && !lesson.free && !skills.some((s) => access.has(s.skill.disciplineId));
    return {
      ...rest,
      category: category?.name ?? null,
      skillIds: skills.map((s) => s.skillId),
      locked,
      // A locked lesson shows what it is, not its content.
      ...(locked ? { description: null, videoRef: null, captionTrackRef: null } : {}),
    };
  }

  /** The next free place at the end of a category (or of the uncategorised). */
  private async nextOrderIn(tx: Prisma.TransactionClient, schoolId: string, categoryId: string | null): Promise<number> {
    const last = await tx.lesson.aggregate({ where: { schoolId, categoryId }, _max: { order: true } });
    return (last._max.order ?? -1) + 1;
  }

  // ---------------------------------------------------------------------------
  // Lesson categories (Decisions 128.15, 191): a list per School with its own
  // order; lessons ordered within their category. Read by anyone at the
  // School (RLS); written by its staff, like lessons.
  // ---------------------------------------------------------------------------

  async findCategories(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId);
    const items = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lessonCategory.findMany({ where: { schoolId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    );
    return { items: items.map(shapeCategory) };
  }

  async createCategory(callerId: string, schoolId: string, name: string) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      await this.assertNameFree(tx, schoolId, name);
      const last = await tx.lessonCategory.aggregate({ where: { schoolId }, _max: { order: true } });
      const row = await tx.lessonCategory.create({ data: { id: randomUUID(), schoolId, name, order: (last._max.order ?? -1) + 1 } });
      return shapeCategory(row);
    });
  }

  async renameCategory(callerId: string, categoryId: string, name: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lessonCategory.findUnique({ where: { id: categoryId } }));
    if (!existing) throw new NotFoundException('Category not found');
    await this.tenantAuth.assertStaffAtSchool(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      await this.assertNameFree(tx, existing.schoolId, name, categoryId);
      return shapeCategory(await tx.lessonCategory.update({ where: { id: categoryId }, data: { name } }));
    });
  }

  /** Every category of the School, in the new order. */
  async orderCategories(callerId: string, schoolId: string, dto: OrderLessonCategoriesDto) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const all = await tx.lessonCategory.findMany({ where: { schoolId }, select: { id: true } });
      const sent = new Set(dto.categoryIds);
      if (sent.size !== dto.categoryIds.length || sent.size !== all.length || all.some((c) => !sent.has(c.id))) {
        throw new BadRequestException('Send every category of this School once, in the new order.');
      }
      for (const [order, id] of dto.categoryIds.entries()) await tx.lessonCategory.update({ where: { id }, data: { order } });
      return { items: (await tx.lessonCategory.findMany({ where: { schoolId }, orderBy: { order: 'asc' } })).map(shapeCategory) };
    });
  }

  /** The lessons of one category, in order. Lessons sent from another
   * category (or none) move into it, as dropping them there in the prototype
   * does; every lesson already in it must be sent, so none is lost. */
  async orderCategoryLessons(callerId: string, categoryId: string, dto: OrderCategoryLessonsDto) {
    const category = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lessonCategory.findUnique({ where: { id: categoryId } }));
    if (!category) throw new NotFoundException('Category not found');
    await this.tenantAuth.assertStaffAtSchool(callerId, category.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, category.schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const sent = new Set(dto.lessonIds);
      if (sent.size !== dto.lessonIds.length) throw new BadRequestException('Each lesson can appear only once.');
      const lessons = await tx.lesson.findMany({ where: { id: { in: dto.lessonIds }, schoolId: category.schoolId }, select: { id: true } });
      if (lessons.length !== dto.lessonIds.length) throw new BadRequestException('lessonIds must all be lessons of this School.');
      const current = await tx.lesson.findMany({ where: { categoryId }, select: { id: true } });
      if (current.some((l) => !sent.has(l.id))) {
        throw new ConflictException('Send every lesson already in this category; the list may have changed — please reload.');
      }
      for (const [order, id] of dto.lessonIds.entries()) await tx.lesson.update({ where: { id }, data: { categoryId, order } });
      const full = await tx.lesson.findMany({ where: { categoryId }, orderBy: { order: 'asc' }, include: LESSON_INCLUDE });
      return { items: full.map((l) => this.shapeLessonResponse(l)) };
    });
  }

  private async assertCategoryOfSchool(tx: Prisma.TransactionClient, categoryId: string, schoolId: string) {
    const category = await tx.lessonCategory.findUnique({ where: { id: categoryId }, select: { schoolId: true } });
    if (!category || category.schoolId !== schoolId) throw new BadRequestException('categoryId must be one of this School\'s lesson categories.');
  }

  private async assertNameFree(tx: Prisma.TransactionClient, schoolId: string, name: string, exceptId?: string) {
    const same = await tx.lessonCategory.findFirst({
      where: { schoolId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (same) throw new ConflictException(`There is already a category called "${name}".`);
  }

  // ---------------------------------------------------------------------------
  // Shared validation helpers
  // ---------------------------------------------------------------------------

  private async assertSkillsBelongToSchool(callerId: string, skillIds: string[], schoolId: string): Promise<void> {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.skill.findMany({ where: { id: { in: skillIds }, schoolId }, select: { id: true } }),
    );
    if (found.length !== skillIds.length) {
      throw new BadRequestException('skillIds must all reference Skills belonging to this School');
    }
  }
}

function shapeCategory(c: { id: string; schoolId: string; name: string; order: number }) {
  return { id: c.id, schoolId: c.schoolId, name: c.name, order: c.order };
}
