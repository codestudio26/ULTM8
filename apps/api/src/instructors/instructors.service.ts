import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { resolveInstructorSpecializations } from './instructor-specializations';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { cursorPaginate } from '../common/pagination/cursor-paginate';
import { CreateInstructorDto } from './dto/create-instructor.dto';
import { UpdateInstructorDto } from './dto/update-instructor.dto';

@Injectable()
export class InstructorsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
  ) {}

  /**
   * School Owner/Manager only (Spec §8.2) — same gate as Class/TimetableSlot CRUD;
   * Instructor's own confirmed permissions explicitly exclude "instructor management".
   *
   * This module does NOT grant the RoleGrant itself — that's RoleGrantsService's
   * existing job (POST /schools/{id}/role-grants, Phase 2). Creating a profile here
   * requires the grant to already exist, matching the confirmed "provisioned by School
   * invite" flow (invite/grant first, profile second, two distinct concerns).
   */
  async create(callerId: string, schoolId: string, dto: CreateInstructorDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
    }
    // Validates dto.userId holds an active INSTRUCTOR RoleGrant matching this profile's
    // own scope — this table is never itself the source of truth for role-holding, see
    // schema.prisma's Instructor model comment.
    await this.tenantAuth.assertValidInstructor(callerId, dto.userId, schoolId, dto.branchId ?? null);

    // Pre-check the schoolId+userId uniqueness explicitly (same convention
    // RoleGrantsService.create() uses) rather than relying on the generic P2002
    // catch-all in HttpExceptionFilter, so the caller gets a specific message.
    const duplicate = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.findUnique({
        where: { schoolId_userId: { schoolId, userId: dto.userId } },
        select: { id: true },
      }),
    );
    if (duplicate) {
      throw new ConflictException('This user already has an Instructor profile at this School.');
    }

    const instructorId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const specs = await resolveInstructorSpecializations(tx, schoolId, dto.specializationStyleIds, dto.specializations);
      return tx.instructor.create({
        data: {
          id: instructorId,
          userId: dto.userId,
          schoolId,
          branchId: dto.branchId,
          photoUrl: dto.photoUrl,
          specializations: specs?.specializations ?? [],
          specializationStyleIds: specs?.specializationStyleIds ?? [],
          phone: dto.phone,
          yearsOfExperience: dto.yearsOfExperience,
          bio: dto.bio,
        },
      });
    });
  }

  /** Profiles visible to the caller under one School — RLS restricts this to a School-
   * level grant (sees every profile, any Branch) or a Branch-scoped grant (their own
   * Branch's profiles plus School-wide ones — instructor_tenant_isolation, this
   * phase's migration; same three-way structure as class_tenant_isolation).
   *
   * Names are resolved via PrismaAuthService/resolveUserNames (Decision 117's
   * pattern), not a Prisma `include` on `user` — closes the same real, verified gap
   * Decision 117 found for Bookings/Waitlist/RoleGrant/Transactions: this endpoint's
   * own list of profiles is exactly where InstructorsPage's Name column and every
   * other page reusing this same hook (Classes, Timetable) look up an Instructor's
   * display name, and none of them had one to show before this. */
  async findAllForSchool(callerId: string, schoolId: string, cursor?: string, limit?: number) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.instructor.findMany({ ...args, where: { schoolId } }), cursor, limit),
    );
    const userIds = page.items.map((i) => i.userId);
    const names = await resolveUserNames(this.prismaAuth, userIds);
    const statuses = await this.resolveInstructorStatuses(callerId, schoolId, userIds);
    return {
      ...page,
      items: page.items.map((i) => ({
        ...i,
        firstName: names.get(i.userId)?.firstName ?? '',
        surname: names.get(i.userId)?.surname ?? '',
        email: names.get(i.userId)?.email ?? '',
        status: statuses.get(i.userId) ?? 'REVOKED',
      })),
    };
  }

  /** Active/Revoked pill (v1.2 backlog, Instructors page) — whether the linked User
   * still holds a non-revoked INSTRUCTOR RoleGrant at this School, same "active"
   * definition assertValidInstructor already uses (revokedAt: null), just without its
   * Branch-matching concern since this is a display status, not an authorization
   * check. Batched in one query, same shape as resolveUserNames, not per-row. */
  private async resolveInstructorStatuses(
    callerId: string,
    schoolId: string,
    userIds: string[],
  ): Promise<Map<string, 'ACTIVE' | 'REVOKED'>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Map();
    const activeGrants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: { userId: { in: uniqueIds }, schoolId, role: 'INSTRUCTOR', revokedAt: null },
        select: { userId: true },
        distinct: ['userId'],
      }),
    );
    const activeIds = new Set(activeGrants.map((g) => g.userId));
    return new Map(uniqueIds.map((id) => [id, activeIds.has(id) ? 'ACTIVE' : 'REVOKED']));
  }

  /** Candidate pool for InstructorFormModal's picker (Decision 115) — Users holding an
   * active INSTRUCTOR RoleGrant at this School, i.e. exactly who assertValidInstructor
   * would accept for a create() call here. School Owner/Manager only, same gate as
   * create(). Deliberately unpaginated (bounded by realistic Instructor headcount) and
   * hardcoded to INSTRUCTOR — no generic role param, since this is the only consumer. */
  async findEligibleInstructorUsers(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: { schoolId, role: 'INSTRUCTOR', revokedAt: null },
        distinct: ['userId'],
        select: { user: { select: { id: true, firstName: true, surname: true, email: true } } },
      }),
    );
    return { items: grants.map((g) => g.user) };
  }

  async findOne(callerId: string, instructorId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.findUnique({ where: { id: instructorId } }),
    );
    // RLS returns null (not another tenant's row) for a profile outside the caller's
    // scope — a genuine 404 and a cross-tenant-blocked read are indistinguishable at
    // this layer by design (ultm8-tenant-isolation §2).
    if (!found) {
      throw new NotFoundException('Instructor profile not found');
    }
    // Resolved the same way findAllForSchool() does (v1.2 backlog) — findOne() never
    // actually resolved firstName/surname either, despite InstructorResponseDto
    // declaring them required; Instructor Detail was silently relying on
    // InstructorsPage's list fetch for names until now.
    const names = await resolveUserNames(this.prismaAuth, [found.userId]);
    const statuses = await this.resolveInstructorStatuses(callerId, found.schoolId, [found.userId]);
    return {
      ...found,
      firstName: names.get(found.userId)?.firstName ?? '',
      surname: names.get(found.userId)?.surname ?? '',
      email: names.get(found.userId)?.email ?? '',
      status: statuses.get(found.userId) ?? 'REVOKED',
    };
  }

  /** School Owner/Manager only — resolved via the profile's own schoolId, not a route param. */
  async update(callerId: string, instructorId: string, dto: UpdateInstructorDto) {
    // Reuses findOne() rather than re-running the same fetch-and-404 query a second
    // time in this file (unlike TimetableService's update(), which can't do this).
    // findOne() now resolves firstName/surname/email/status onto the row (v1.2
    // backlog) — still safe to reuse here since this method only reads the raw
    // Instructor columns (schoolId/branchId/userId) off it, all of which survive that
    // resolution untouched; see the return below for where the resolved fields
    // themselves get carried into this method's own response.
    const existing = await this.findOne(callerId, instructorId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);

    const nextBranchId = dto.branchId !== undefined ? dto.branchId : existing.branchId;

    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, existing.schoolId);
    }
    // Revalidated whenever the profile will still resolve to some branch scope after
    // this patch, not only when branchId itself is part of the PATCH body — same
    // "re-check against the next value, not just the changed field" fix
    // ClassesService.update() needed after Phase 4's code review (TimetableService
    // applied it proactively from the start; this module follows that example, not
    // Phase 4's). The profiled userId itself never changes (UpdateInstructorDto omits
    // it), so only the branch side of the check can ever go stale here.
    await this.tenantAuth.assertValidInstructor(callerId, existing.userId, existing.schoolId, nextBranchId);

    // `specializations` is NOT NULL on the Instructor model (String[] @default([])) —
    // but `@IsOptional()` on UpdateInstructorDto only skips validation for `undefined`,
    // not an explicit `null` (class-validator's own IsOptional behavior), so a body
    // like `{"specializations": null}` would otherwise reach Prisma as a literal null
    // and hit a NOT NULL violation the global exception filter doesn't map to a clean
    // 400 (HttpExceptionFilter only handles P2002/P2025/P2003). Reject it explicitly
    // here instead of guessing at a silent reinterpretation (e.g. treating null as "").
    if (dto.specializations === null) {
      throw new BadRequestException('specializations cannot be null — send [] to clear it, or omit the field to leave it unchanged.');
    }
    if ((dto as { specializationStyleIds?: unknown }).specializationStyleIds === null) {
      throw new BadRequestException('specializationStyleIds cannot be null — send [] to clear it, or omit the field to leave it unchanged.');
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Replaced when sent, kept when omitted (Decision 152).
      const specs = await resolveInstructorSpecializations(tx, existing.schoolId, dto.specializationStyleIds, dto.specializations);
      const updated = await tx.instructor.update({
        where: { id: instructorId },
        data: {
          branchId: dto.branchId,
          photoUrl: dto.photoUrl,
          specializations: specs?.specializations,
          specializationStyleIds: specs?.specializationStyleIds,
          phone: dto.phone,
          yearsOfExperience: dto.yearsOfExperience,
          bio: dto.bio,
        },
      });
      // InstructorResponseDto declares firstName/surname/email/status required, but
      // none of this patch can change any of them (they're User/RoleGrant-derived,
      // not Instructor columns) — carried over from the already-resolved `existing`
      // rather than re-querying resolveUserNames/resolveInstructorStatuses for values
      // that can't have changed.
      return { ...updated, firstName: existing.firstName, surname: existing.surname, email: existing.email, status: existing.status };
    });
  }

  // No delete endpoint — same "general tenant offboarding is [UNRESOLVED]" reasoning as
  // every other module (ultm8-app-publishing §4).
  //
  // What happens to this profile when the underlying RoleGrant is later revoked is NOT
  // addressed anywhere in Spec 55 — left untouched on revocation here, same
  // conservative default Phase 5 used for TimetableSlot edits vs. already-materialized
  // Classes (see the Phase 6 kickoff prompt). A revoked-but-still-profiled Instructor
  // can end up unable to pass assertValidInstructor on their own next PATCH, at which
  // point update() above throws — that's a deliberate side effect of leaving the row
  // in place, not a bug to route around silently.
}
