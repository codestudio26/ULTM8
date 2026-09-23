import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

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
  ) {}

  async createLesson(callerId: string, schoolId: string, dto: CreateLessonDto) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    if (dto.instructorId) {
      // Lesson has no Branch of its own — null targetBranchId means "any of this
      // Instructor's grants at the School count," same as a School-wide Class.
      await this.tenantAuth.assertValidInstructor(callerId, dto.instructorId, schoolId, null);
    }
    await this.assertSkillsBelongToSchool(callerId, dto.skillIds, schoolId);

    const lessonId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.lesson.create({
        data: {
          id: lessonId,
          schoolId,
          instructorId: dto.instructorId,
          title: dto.title,
          category: dto.category,
          durationSeconds: dto.durationSeconds,
          description: dto.description,
          format: dto.format,
        },
      });
      await tx.lessonSkill.createMany({
        data: dto.skillIds.map((skillId) => ({ lessonId, skillId })),
      });
      const full = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { skills: true } });
      return this.shapeLessonResponse(full);
    });
  }

  async findLessonsForSchool(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId);
    const lessons = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.findMany({ where: { schoolId }, orderBy: { title: 'asc' }, include: { skills: true } }),
    );
    return lessons.map((l) => this.shapeLessonResponse(l));
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
        orderBy: { title: 'asc' },
        include: { skills: true },
      }),
    );
    return lessons.map((l) => this.shapeLessonResponse(l));
  }

  async findOneLesson(callerId: string, lessonId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.lesson.findUnique({ where: { id: lessonId }, include: { skills: true } }),
    );
    if (!found) {
      throw new NotFoundException('Lesson not found');
    }
    return this.shapeLessonResponse(found);
  }

  async updateLesson(callerId: string, lessonId: string, dto: UpdateLessonDto) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.lesson.findUnique({ where: { id: lessonId } }));
    if (!existing) {
      throw new NotFoundException('Lesson not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, existing.schoolId);
    if (dto.instructorId) {
      await this.tenantAuth.assertValidInstructor(callerId, dto.instructorId, existing.schoolId, null);
    }
    if (dto.skillIds) {
      await this.assertSkillsBelongToSchool(callerId, dto.skillIds, existing.schoolId);
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.lesson.update({
        where: { id: lessonId },
        data: {
          title: dto.title,
          category: dto.category,
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
      const full = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { skills: true } });
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

  private shapeLessonResponse(lesson: Prisma.LessonGetPayload<{ include: { skills: true } }>) {
    const { skills, ...rest } = lesson;
    return { ...rest, skillIds: skills.map((s) => s.skillId) };
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
