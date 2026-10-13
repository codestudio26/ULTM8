import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { resolveUserNames, ResolvedUserName } from '../common/prisma/resolve-user-names';
import { resolveLimit, encodeDescCursor, decodeDescCursor } from '../common/pagination/cursor-paginate';
import { CloudflareStreamService } from '../common/video/cloudflare-stream.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { GuardiansService } from '../guardians/guardians.service';
import { isMembershipLive } from '../memberships/memberships.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { OrderCategoryLessonsDto, OrderLessonCategoriesDto } from './dto/lesson-category.dto';
import { UpsertWatchProgressDto } from './dto/watch-history.dto';
import {
  AddPlaylistItemDto,
  CreatePlaylistDto,
  RenamePlaylistDto,
  ReorderPlaylistItemsDto,
} from './dto/playlist.dto';
import { CreateCommentDto } from './dto/comment.dto';

/** `content` is null when the database doesn't let the caller read it (Decision 208). */
const LESSON_INCLUDE = { skills: { include: { skill: { select: { disciplineId: true } } } }, category: { select: { name: true } }, content: true } as const;

const RETENTION_WINDOW_DAYS = 90;

/** Shared select shape for a PlaylistItem joined with just enough of its own
 * Lesson to compute `locked`/`lessonTitle` (CurriculumService.
 * shapePlaylistItem). */
const PLAYLIST_ITEM_SELECT = {
  id: true,
  playlistId: true,
  order: true,
  createdAt: true,
  lessonId: true,
  lesson: {
    select: {
      title: true,
      free: true,
      schoolId: true,
      skills: { select: { skill: { select: { disciplineId: true } } } },
    },
  },
} satisfies Prisma.PlaylistItemSelect;

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
 * exist on the response shape (stored in LessonContent, Decision 208), but nothing here ever writes them beyond
 * the schema default (captionStatus PENDING, everything else null) — that's a
 * later phase's work, once real credentials exist to build and verify against.
 *
 * Writes (create/update) require Staff/Instructor (assertStaffAtSchool — Decision
 * 58's own "an instructor uploads", resolved as Decision 104 to mean ordinary
 * tenant Staff, not Platform Admin). Reads: lesson_tenant_isolation admits any
 * active RoleGrant at the School to the lesson itself; its content
 * (LessonContent) only to those who may watch it (Decisions 154, 190, 195,
 * 208), checked here and by the database.
 */
@Injectable()
export class CurriculumService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly guardiansService: GuardiansService,
    private readonly cloudflareStream: CloudflareStreamService,
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
          format: dto.format,
        },
      });
      await tx.lessonContent.create({ data: { lessonId, description: dto.description } });
      await tx.lessonSkill.createMany({
        data: dto.skillIds.map((skillId) => ({ lessonId, skillId })),
      });
      const full = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: LESSON_INCLUDE });
      return this.shapeLessonResponse(full);
    });
  }

  /** Decision 226 — `includeArchived` (default false) excludes archived
   * Lessons from the default view. Staff-facing only in practice (a Student/
   * Guardian reaches Lesson through findLessonsForStudent below, which is
   * unaffected — a Student should never see an archived Lesson regardless of
   * this flag, so that method always filters it out, unconditionally). */
  async findLessonsForSchool(callerId: string, schoolId: string, includeArchived?: boolean) {
    await this.schoolsService.findOne(callerId, schoolId);
    const access = await this.accessFor(callerId, schoolId);
    const lessons = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.findMany({ where: { schoolId, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: LESSON_ORDER, include: LESSON_INCLUDE }),
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
    // Decision 226 — a Student/Guardian never sees an archived Lesson,
    // unconditionally (no includeArchived escape hatch here, unlike the
    // Staff-facing findLessonsForSchool above).
    const lessons = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.lesson.findMany({ where: { schoolId, archivedAt: null }, orderBy: LESSON_ORDER, include: LESSON_INCLUDE }),
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
      await tx.lessonContent.deleteMany({ where: { lessonId } });
      await tx.lesson.delete({ where: { id: lessonId } });
    });
  }

  // ---------------------------------------------------------------------------
  // Decision 226 — entity-level tenant offboarding, REVERSIBLE alternative to
  // Decision 198's deleteLesson() above (coexists with it, same reasoning as
  // Rank's own identical archive/delete coexistence). No dependents to check
  // — verified directly: nothing in this schema FKs to Lesson except its own
  // owned LessonSkill/LessonContent children (both cascade away with it, not
  // a "dependent" in the sense this build's other 6 entities check). Stated
  // explicitly rather than silently skipping a check, since the learner-
  // facing Curriculum redesign (Decision 227) that would eventually add real
  // Lesson-referencing entities (WatchHistory, Playlist, ...) is still only
  // scoped, not built.
  // ---------------------------------------------------------------------------

  async archiveLesson(callerId: string, lessonId: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lesson.findUnique({ where: { id: lessonId } }));
    if (!existing) throw new NotFoundException('Lesson not found');
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (existing.archivedAt) {
      return this.findOneLesson(callerId, lessonId);
    }
    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.updateMany({ where: { id: lessonId, archivedAt: null }, data: { archivedAt: now, purgeAt } }),
    );
    return this.findOneLesson(callerId, lessonId);
  }

  async unarchiveLesson(callerId: string, lessonId: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lesson.findUnique({ where: { id: lessonId } }));
    if (!existing) throw new NotFoundException('Lesson not found');
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (!existing.archivedAt) {
      return this.findOneLesson(callerId, lessonId);
    }
    if (existing.purgedAt) {
      throw new ConflictException('This Lesson has already been purged and cannot be unarchived.');
    }
    const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.updateMany({
        where: { id: lessonId, archivedAt: { not: null }, purgedAt: null },
        data: { archivedAt: null, purgeAt: null },
      }),
    );
    if (count === 0) {
      const current = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lesson.findUniqueOrThrow({ where: { id: lessonId } }));
      if (current.purgedAt) {
        throw new ConflictException('This Lesson has already been purged and cannot be unarchived.');
      }
    }
    return this.findOneLesson(callerId, lessonId);
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
          format: dto.format,
          instructorId: dto.instructorId,
        },
      });
      if (dto.description !== undefined) {
        await tx.lessonContent.upsert({
          where: { lessonId },
          create: { lessonId, description: dto.description },
          update: { description: dto.description },
        });
      }
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

  // ---------------------------------------------------------------------------
  // Shared response shaping
  // ---------------------------------------------------------------------------

  private shapeLessonResponse(lesson: Prisma.LessonGetPayload<{ include: typeof LESSON_INCLUDE }>, access: LessonAccess = 'all') {
    const { skills, category, content, ...rest } = lesson;
    const locked = this.isLocked(lesson, access);
    // A locked lesson shows what it is, not its content. The database applies
    // the same rule (Decision 208): content it won't give is null either way.
    const shown = locked ? null : content;
    // Only once captionStatus is READY — Cloudflare Stream's own readiness
    // (isVideoReady) and caption readiness are polled together by
    // VideoProcessingPollScheduler and READY only once both are done (that
    // scheduler's own header comment), so this never hands out a URL for a
    // video still mid-transcode. getPublicPlaybackUrl itself never throws
    // (plain string build, no network call) even when CloudflareStreamService
    // isn't configured — it returns an obviously-placeholder "unconfigured"
    // URL rather than a real one in that case.
    const playbackUrl = shown?.videoRef && lesson.captionStatus === 'READY' ? this.cloudflareStream.getPublicPlaybackUrl(shown.videoRef) : null;
    return {
      ...rest,
      category: category?.name ?? null,
      skillIds: skills.map((s) => s.skillId),
      locked,
      description: shown?.description ?? null,
      videoRef: shown?.videoRef ?? null,
      captionTrackRef: shown?.captionTrackRef ?? null,
      playbackUrl,
    };
  }

  /** A lesson's styles are its skills' styles (Decision 195). Extracted from
   * shapeLessonResponse above (Decision 227/254) so the learner-facing
   * Favorite/WatchHistory/Playlist/Comment endpoints below can reject acting
   * on a Lesson the caller may not watch, using the exact same rule. */
  private isLocked(lesson: { free: boolean; skills: { skill: { disciplineId: string } }[] }, access: LessonAccess): boolean {
    return access !== 'all' && !lesson.free && !lesson.skills.some((s) => access.has(s.skill.disciplineId));
  }

  /**
   * Curriculum learner-facing redesign (Decision 227/254) — the shared gate
   * for every new endpoint below that acts on a specific Lesson on a
   * Student's behalf (favorite, watch-progress, comment): 404 if the Lesson
   * doesn't exist OR has been archived (Decision 226 — an archived Lesson
   * can't be newly favorited/commented/watched; an existing Favorite on a
   * since-archived Lesson is left alone, no retroactive cleanup), 404 if
   * `expectedSchoolId` (the caller's own `:schoolId` route param) doesn't
   * match the Lesson's real School — same "cross-tenant mismatch is a 404,
   * not a 403" convention Decision 252's own 7-entity build already
   * established, and the same "thread the path schoolId through and verify
   * it, don't just bind-and-ignore it" shape WaiversController.
   * findSignatures already uses (found on review: these routes originally
   * bound only `:id`, silently ignoring `:schoolId` even though it's part of
   * the URL — fixed here, not left as a cosmetic client-typing gap). 403 if
   * `isLocked` says the caller may not watch it (Decisions 154, 190, 195).
   *
   * `expectedSchoolId` is optional — addPlaylistItem's own call site has none
   * to check against (a Playlist deliberately has no School of its own, see
   * its schema.prisma comment, so there is no path `:schoolId` to verify a
   * added Lesson against); every other call site passes its own route's
   * `:schoolId` and gets the cross-tenant-mismatch check.
   */
  private async assertCanWatchLesson(callerId: string, expectedSchoolId: string | undefined, lessonId: string): Promise<{ schoolId: string }> {
    const lesson = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.findUnique({
        where: { id: lessonId },
        select: {
          schoolId: true,
          free: true,
          skills: { select: { skill: { select: { disciplineId: true } } } },
          archivedAt: true,
        },
      }),
    );
    if (!lesson || lesson.archivedAt || (expectedSchoolId !== undefined && lesson.schoolId !== expectedSchoolId)) {
      throw new NotFoundException('Lesson not found');
    }
    const access = await this.accessFor(callerId, lesson.schoolId);
    if (this.isLocked(lesson, access)) {
      throw new ForbiddenException('You may not watch this Lesson (Decisions 154, 190, 195).');
    }
    return { schoolId: lesson.schoolId };
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
  // Curriculum learner-facing redesign (Decision 227/254) — Favorite,
  // WatchHistory, Playlist/PlaylistItem, Comment, and the actual Cloudflare
  // Stream/AWS Transcribe video-upload wiring (Decision 101's picked vendors,
  // left unbuilt by Phase 44 — see this class's own header comment). Every
  // method below runs under the caller's own tenant context
  // (PrismaAppService.withTenantContext); Favorite/WatchHistory/Playlist/
  // PlaylistItem are all self-only RLS (the database would already refuse a
  // cross-Student read/write regardless of what id is passed), so the
  // explicit own-row checks below follow this file's own established "load,
  // check, 404 on mismatch" convention for a clean error rather than relying
  // on RLS alone to produce one.
  // ---------------------------------------------------------------------------

  // --- Favorite ---------------------------------------------------------

  /** Idempotent — favoriting an already-favorited Lesson is a no-op success,
   * not a 409. */
  async addFavorite(callerId: string, schoolId: string, lessonId: string) {
    await this.assertCanWatchLesson(callerId, schoolId, lessonId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const row = await tx.favorite.upsert({
        where: { studentId_lessonId: { studentId: callerId, lessonId } },
        create: { id: randomUUID(), studentId: callerId, lessonId, schoolId },
        update: {},
      });
      return shapeFavorite(row);
    });
  }

  /** Idempotent — unfavoriting a Lesson that isn't favorited (or isn't this
   * School's) is a no-op success, not a 404. `schoolId` filters the delete
   * directly (Favorite already stores its own denormalized schoolId) rather
   * than needing a separate Lesson lookup just to check it. */
  async removeFavorite(callerId: string, schoolId: string, lessonId: string): Promise<void> {
    await this.prismaApp.withTenantContext(callerId, (tx) => tx.favorite.deleteMany({ where: { studentId: callerId, lessonId, schoolId } }));
  }

  async findFavorites(callerId: string, schoolId: string, cursor?: string, limit?: number) {
    const take = resolveLimit(limit);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const decoded = cursor ? decodeDescCursor(cursor) : null;
      const where: Prisma.FavoriteWhereInput = {
        studentId: callerId,
        schoolId,
        ...(decoded
          ? { OR: [{ createdAt: { lt: decoded.sortValue } }, { createdAt: decoded.sortValue, id: { lt: decoded.id } }] }
          : {}),
      };
      const rows = await tx.favorite.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1 });
      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      const last = items[items.length - 1];
      return { items: items.map(shapeFavorite), nextCursor: hasMore ? encodeDescCursor(last.createdAt, last.id) : null };
    });
  }

  // --- WatchHistory -------------------------------------------------------

  /**
   * `completed` is one-directional — only ever SETS completedAt when
   * `dto.completed` is explicitly true; omitting it (or sending false) never
   * clears an already-set completedAt. There is no "mark incomplete" feature.
   */
  async upsertWatchProgress(callerId: string, schoolId: string, lessonId: string, dto: UpsertWatchProgressDto) {
    await this.assertCanWatchLesson(callerId, schoolId, lessonId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const row = await tx.watchHistory.upsert({
        where: { studentId_lessonId: { studentId: callerId, lessonId } },
        create: {
          id: randomUUID(),
          studentId: callerId,
          lessonId,
          schoolId,
          lastPositionSeconds: dto.lastPositionSeconds,
          completedAt: dto.completed ? new Date() : undefined,
        },
        update: {
          lastPositionSeconds: dto.lastPositionSeconds,
          ...(dto.completed ? { completedAt: new Date() } : {}),
        },
      });
      return shapeWatchHistory(row);
    });
  }

  async findWatchHistory(callerId: string, schoolId: string, cursor?: string, limit?: number) {
    const take = resolveLimit(limit);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const decoded = cursor ? decodeDescCursor(cursor) : null;
      const where: Prisma.WatchHistoryWhereInput = {
        studentId: callerId,
        schoolId,
        ...(decoded
          ? { OR: [{ updatedAt: { lt: decoded.sortValue } }, { updatedAt: decoded.sortValue, id: { lt: decoded.id } }] }
          : {}),
      };
      const rows = await tx.watchHistory.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: take + 1 });
      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      const last = items[items.length - 1];
      return { items: items.map(shapeWatchHistory), nextCursor: hasMore ? encodeDescCursor(last.updatedAt, last.id) : null };
    });
  }

  // --- Playlist / PlaylistItem ---------------------------------------------

  async createPlaylist(callerId: string, dto: CreatePlaylistDto) {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const row = await tx.playlist.create({ data: { id: randomUUID(), studentId: callerId, name: dto.name } });
      return shapePlaylist(row);
    });
  }

  async renamePlaylist(callerId: string, playlistId: string, dto: RenamePlaylistDto) {
    await this.loadOwnPlaylist(callerId, playlistId);
    return this.prismaApp.withTenantContext(callerId, async (tx) =>
      shapePlaylist(await tx.playlist.update({ where: { id: playlistId }, data: { name: dto.name } })),
    );
  }

  async deletePlaylist(callerId: string, playlistId: string): Promise<void> {
    await this.loadOwnPlaylist(callerId, playlistId);
    // PlaylistItem rows cascade away with it (ON DELETE CASCADE).
    await this.prismaApp.withTenantContext(callerId, (tx) => tx.playlist.delete({ where: { id: playlistId } }));
  }

  async findPlaylists(callerId: string, cursor?: string, limit?: number) {
    const take = resolveLimit(limit);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const decoded = cursor ? decodeDescCursor(cursor) : null;
      // No schoolId filter — Playlist has none (deliberate, see its own
      // schema.prisma comment).
      const where: Prisma.PlaylistWhereInput = {
        studentId: callerId,
        ...(decoded
          ? { OR: [{ createdAt: { lt: decoded.sortValue } }, { createdAt: decoded.sortValue, id: { lt: decoded.id } }] }
          : {}),
      };
      const rows = await tx.playlist.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1 });
      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      const last = items[items.length - 1];
      return { items: items.map(shapePlaylist), nextCursor: hasMore ? encodeDescCursor(last.createdAt, last.id) : null };
    });
  }

  async addPlaylistItem(callerId: string, playlistId: string, dto: AddPlaylistItemDto) {
    const playlist = await this.loadOwnPlaylist(callerId, playlistId);
    // No expectedSchoolId — a Playlist has none of its own (see
    // assertCanWatchLesson's own header comment).
    await this.assertCanWatchLesson(callerId, undefined, dto.lessonId);
    const itemId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const last = await tx.playlistItem.aggregate({ where: { playlistId }, _max: { order: true } });
      // studentId denormalized from the playlist we already loaded above, not
      // a second lookup (PlaylistItem's own self-only RLS needs this column
      // set correctly — see its schema.prisma comment).
      await tx.playlistItem.create({
        data: { id: itemId, playlistId, lessonId: dto.lessonId, studentId: playlist.studentId, order: (last._max.order ?? -1) + 1 },
      });
      const full = await tx.playlistItem.findUniqueOrThrow({ where: { id: itemId }, select: PLAYLIST_ITEM_SELECT });
      const access = await this.accessFor(callerId, full.lesson.schoolId);
      return this.shapePlaylistItem(full, access);
    });
  }

  /** `where: { id: itemId, playlistId }` so a caller can't delete another
   * Playlist's item by sending the wrong playlistId in the path. Idempotent
   * — deleting an item that's already gone is a no-op success. */
  async removePlaylistItem(callerId: string, playlistId: string, itemId: string): Promise<void> {
    await this.loadOwnPlaylist(callerId, playlistId);
    await this.prismaApp.withTenantContext(callerId, (tx) => tx.playlistItem.deleteMany({ where: { id: itemId, playlistId } }));
  }

  /** Every PlaylistItem of this Playlist, in the new order — reorders by the
   * item's OWN id (not lessonId), same "send the full current set exactly
   * once" validation shape as orderCategoryLessons above. */
  async reorderPlaylistItems(callerId: string, playlistId: string, dto: ReorderPlaylistItemsDto) {
    await this.loadOwnPlaylist(callerId, playlistId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const sent = new Set(dto.itemIds);
      if (sent.size !== dto.itemIds.length) throw new BadRequestException('Each item can appear only once.');
      const current = await tx.playlistItem.findMany({ where: { playlistId }, select: { id: true } });
      if (current.length !== dto.itemIds.length || current.some((i) => !sent.has(i.id))) {
        throw new ConflictException('Send every item currently in this Playlist; the list may have changed — please reload.');
      }
      for (const [order, id] of dto.itemIds.entries()) await tx.playlistItem.update({ where: { id }, data: { order } });
      const full = await tx.playlistItem.findMany({ where: { playlistId }, orderBy: { order: 'asc' }, select: PLAYLIST_ITEM_SELECT });
      const accessCache = await this.buildAccessCache(callerId, full.map((i) => i.lesson.schoolId));
      return { items: full.map((i) => this.shapePlaylistItem(i, accessCache.get(i.lesson.schoolId)!)) };
    });
  }

  /**
   * NOT paginated (PlaylistItemListResponseDto, flat array) — a Playlist's
   * own item count is bounded by how many Lessons a School even has.
   *
   * A Playlist can mix Lessons from several Schools, so `locked` can't be
   * computed from one `accessFor` call for the whole list — this calls it
   * once per DISTINCT schoolId among the items (buildAccessCache below),
   * never once per item.
   */
  async findPlaylistItems(callerId: string, playlistId: string) {
    await this.loadOwnPlaylist(callerId, playlistId);
    const items = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.playlistItem.findMany({ where: { playlistId }, orderBy: { order: 'asc' }, select: PLAYLIST_ITEM_SELECT }),
    );
    const accessCache = await this.buildAccessCache(callerId, items.map((i) => i.lesson.schoolId));
    return { items: items.map((i) => this.shapePlaylistItem(i, accessCache.get(i.lesson.schoolId)!)) };
  }

  /** Explicit own-row check for a clean 404, same convention as every other
   * load-then-mutate method in this file — RLS would also block a
   * cross-Student read/write, but a plain `null` isn't a confirmed-shaped
   * error on its own. */
  private async loadOwnPlaylist(callerId: string, playlistId: string) {
    const playlist = await this.prismaApp.withTenantContext(callerId, (tx) => tx.playlist.findUnique({ where: { id: playlistId } }));
    if (!playlist || playlist.studentId !== callerId) {
      throw new NotFoundException('Playlist not found');
    }
    return playlist;
  }

  /** One `accessFor` call per DISTINCT schoolId, not per item — see
   * findPlaylistItems's own header comment. */
  private async buildAccessCache(callerId: string, schoolIds: string[]): Promise<Map<string, LessonAccess>> {
    const cache = new Map<string, LessonAccess>();
    for (const schoolId of new Set(schoolIds)) {
      cache.set(schoolId, await this.accessFor(callerId, schoolId));
    }
    return cache;
  }

  private shapePlaylistItem(item: Prisma.PlaylistItemGetPayload<{ select: typeof PLAYLIST_ITEM_SELECT }>, access: LessonAccess) {
    return {
      id: item.id,
      playlistId: item.playlistId,
      lessonId: item.lessonId,
      order: item.order,
      createdAt: item.createdAt.toISOString(),
      lessonTitle: item.lesson.title,
      locked: this.isLocked(item.lesson, access),
    };
  }

  // --- Comment --------------------------------------------------------------

  /** Comments require the same watch-access as the Lesson's own content — a
   * locked Lesson can't be commented on. */
  async createComment(callerId: string, schoolId: string, lessonId: string, dto: CreateCommentDto) {
    await this.assertCanWatchLesson(callerId, schoolId, lessonId);
    const row = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.comment.create({ data: { id: randomUUID(), lessonId, authorId: callerId, schoolId, body: dto.body } }),
    );
    const names = await resolveUserNames(this.prismaAuth, [callerId]);
    return this.shapeComment(row, names);
  }

  /** Same locked-content gate as createComment above — a Comment thread on a
   * Lesson the caller may not watch stays hidden. Ordered `(createdAt, id)`
   * ASCENDING (oldest first) — a comment thread reads chronologically,
   * unlike every other list here, which is newest-first — so `lt`/`gt` are
   * flipped relative to the DESC lists above, written out explicitly rather
   * than reusing their shape unchanged. */
  async findComments(callerId: string, schoolId: string, lessonId: string, cursor?: string, limit?: number) {
    await this.assertCanWatchLesson(callerId, schoolId, lessonId);
    const take = resolveLimit(limit);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const decoded = cursor ? decodeDescCursor(cursor) : null;
      const where: Prisma.CommentWhereInput = {
        lessonId,
        ...(decoded
          ? { OR: [{ createdAt: { gt: decoded.sortValue } }, { createdAt: decoded.sortValue, id: { gt: decoded.id } }] }
          : {}),
      };
      const rows = await tx.comment.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: take + 1 });
      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      const names = await resolveUserNames(this.prismaAuth, items.map((c) => c.authorId));
      const last = items[items.length - 1];
      return {
        items: items.map((c) => this.shapeComment(c, names)),
        nextCursor: hasMore ? encodeDescCursor(last.createdAt, last.id) : null,
      };
    });
  }

  /** Author or Staff at the School may delete (Comment's own schema.prisma/
   * migration comment) — RLS only enforces the tenant boundary for DELETE,
   * this is the specific-action gate, same "RLS is the tenant boundary, the
   * service layer is the specific-action gate" split this codebase already
   * uses for every other write-authorization check. */
  async deleteComment(callerId: string, commentId: string): Promise<void> {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.comment.findUnique({ where: { id: commentId } }));
    if (!existing) {
      throw new NotFoundException('Comment not found');
    }
    if (existing.authorId !== callerId) {
      try {
        await this.tenantAuth.assertStaffAtSchool(callerId, existing.schoolId);
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
        throw new ForbiddenException('Only the Comment\'s own author, or School staff, may delete it.');
      }
    }
    await this.prismaApp.withTenantContext(callerId, (tx) => tx.comment.deleteMany({ where: { id: commentId } }));
  }

  /** `authorName` is resolved via PrismaAuthService/resolveUserNames (the
   * same pattern InstructorsService.findAllForSchool already established),
   * not an RLS-scoped join — see resolveUserNames's own header comment for
   * why a plain tenant-context `include` on User is the wrong tool here. */
  private shapeComment(
    c: { id: string; lessonId: string; authorId: string; schoolId: string; body: string; createdAt: Date },
    names: Map<string, ResolvedUserName>,
  ) {
    const name = names.get(c.authorId);
    return {
      id: c.id,
      lessonId: c.lessonId,
      authorId: c.authorId,
      authorName: name ? `${name.firstName} ${name.surname}` : '',
      schoolId: c.schoolId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    };
  }

  // --- Video upload (Decision 101's picked vendors, wired here) --------------

  /**
   * `Lesson.captionStatus` predates this pipeline (Phase 44's own header
   * comment) and wasn't designed with this exact mapping in mind — stated
   * explicitly here rather than assumed: this method deliberately reuses the
   * existing 4-state enum for the WHOLE upload+caption pipeline, not just
   * captions — PENDING = no video uploaded yet; PROCESSING = video upload
   * started OR the video/its captions are still being processed by the
   * vendors; READY = both playable and captioned (set by
   * VideoProcessingPollScheduler once AWS Transcribe completes); FAILED =
   * either stage failed (also set by that scheduler).
   *
   * Staff-gated the same way every other Lesson write in this file is
   * (assertStaffAtSchool + assertSchoolNotArchived, updateLesson's own
   * gate) — the controller does not duplicate this check.
   */
  async requestVideoUploadUrl(callerId: string, schoolId: string, lessonId: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lesson.findUnique({ where: { id: lessonId } }));
    if (!existing || existing.schoolId !== schoolId) {
      throw new NotFoundException('Lesson not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);

    const { uploadUrl, videoRef } = await this.cloudflareStream.createDirectUploadUrl();
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.lessonContent.upsert({
        where: { lessonId },
        create: { lessonId, videoRef },
        update: { videoRef },
      });
      await tx.lesson.update({ where: { id: lessonId }, data: { captionStatus: 'PROCESSING' } });
    });
    return { uploadUrl, videoRef };
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

function shapeFavorite(f: { id: string; studentId: string; lessonId: string; schoolId: string; createdAt: Date }) {
  return { id: f.id, studentId: f.studentId, lessonId: f.lessonId, schoolId: f.schoolId, createdAt: f.createdAt.toISOString() };
}

function shapeWatchHistory(w: {
  id: string;
  studentId: string;
  lessonId: string;
  schoolId: string;
  lastPositionSeconds: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: w.id,
    studentId: w.studentId,
    lessonId: w.lessonId,
    schoolId: w.schoolId,
    lastPositionSeconds: w.lastPositionSeconds,
    completedAt: w.completedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function shapePlaylist(p: { id: string; studentId: string; name: string; createdAt: Date; updatedAt: Date }) {
  return { id: p.id, studentId: p.studentId, name: p.name, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}
