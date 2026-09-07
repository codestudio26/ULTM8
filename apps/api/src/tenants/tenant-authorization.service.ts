import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';

/**
 * Fresh-DB authorization checks for TenantsModule's mutating endpoints.
 *
 * Deliberate split of responsibilities (mirrors the RLS design already established in
 * Phase 1's migration.sql): Row-Level Security answers "which School/Branch/RoleGrant
 * rows can this caller's connection see or write at all" (tenant-boundary enforcement —
 * ultm8-tenant-isolation §2) — but School/Branch's RLS policies deliberately admit ANY
 * active RoleGrant holder at a School (Student, Instructor, Branch Staff, School
 * Owner/Manager alike — see school_tenant_isolation/branch_tenant_isolation in
 * migration.sql), not just School Owner/Manager. That's correct for read visibility,
 * but wrong for the write endpoints this module adds, which the only confirmed rule
 * (Spec §8.2: "School Owner/Manager: Manage their own School/Branches") actually
 * restricts to School Owner/Manager alone. This service is that narrower, business-
 * level authorization layer, sitting on top of (not instead of) RLS.
 *
 * Queries the DB fresh on every call rather than trusting the JWT's embedded
 * RoleGrantClaim set, specifically so a revoked grant is respected immediately rather
 * than only once the caller's (up to 15-minute) access token expires and is reissued —
 * see the Phase 2 summary's note on RoleGrant-revocation-vs-token-staleness for the
 * general limitation this does NOT close (a stale token can still pass JwtAuthGuard and
 * read/attempt writes elsewhere; this check specifically closes it for the School-
 * Owner-gated actions in this module).
 */
@Injectable()
export class TenantAuthorizationService {
  constructor(private readonly prismaApp: PrismaAppService) {}

  /**
   * Throws ForbiddenException unless `userId` currently holds an active
   * SCHOOL_OWNER_MANAGER RoleGrant scoped to `schoolId`.
   */
  async assertSchoolOwner(userId: string, schoolId: string): Promise<void> {
    const grant = await this.prismaApp.withTenantContext(userId, (tx) =>
      tx.roleGrant.findFirst({
        where: {
          userId,
          schoolId,
          role: 'SCHOOL_OWNER_MANAGER',
          revokedAt: null,
        },
        select: { id: true },
      }),
    );
    if (!grant) {
      throw new ForbiddenException(
        'Only that School\'s Owner/Manager may perform this action (Spec §8.2).',
      );
    }
  }

  /**
   * Throws BadRequestException unless `branchId` references a Branch belonging to
   * `schoolId`. Shared by every module that lets a caller scope a child row (Class,
   * TimetableSlot, ...) to a specific Branch — moved here from ClassesService in
   * Phase 5 rather than copied a second time for TimetableSlotsService, per Phase 4's
   * code-review finding that this exact check was already duplicated once (from
   * role-grants.service.ts) and shouldn't be duplicated a third time.
   */
  async assertBranchBelongsToSchool(callerId: string, branchId: string, schoolId: string): Promise<void> {
    const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.findUnique({ where: { id: branchId }, select: { id: true, schoolId: true } }),
    );
    if (!branch || branch.schoolId !== schoolId) {
      throw new BadRequestException('branchId must reference a Branch belonging to this School');
    }
  }

  /**
   * "Taught by an Instructor" (domain-rules §9) means instructorId references a User
   * holding an active INSTRUCTOR RoleGrant at this School — not a separate Instructor
   * table (§6.1). The branch check is a three-way structure, not a flat equality: a
   * School-scoped Instructor grant (branchId null) may teach/staff ANY row at the
   * School, including a Branch-specific one; a Branch-scoped Instructor grant may
   * cover that Branch's rows plus School-wide ones; it may never cover a DIFFERENT
   * Branch's row. A flat equality would wrongly reject the first case.
   *
   * Shared by ClassesModule and TimetableModule (moved here in Phase 5, same reasoning
   * as assertBranchBelongsToSchool above — this was ClassesService's private
   * assertValidInstructor, copied nowhere else, now the one shared implementation).
   * `targetBranchId` is the Branch of whatever row is being validated (a Class or a
   * TimetableSlot) — the error message below is deliberately generic ("the given
   * Branch", not "this Class's Branch") since it now serves more than one caller.
   */
  async assertValidInstructor(
    callerId: string,
    instructorId: string,
    schoolId: string,
    targetBranchId: string | null,
  ): Promise<void> {
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: {
          userId: instructorId,
          schoolId,
          role: 'INSTRUCTOR',
          revokedAt: null,
        },
        select: { branchId: true },
      }),
    );
    const valid = grants.some(
      (g) => g.branchId === null || targetBranchId === null || g.branchId === targetBranchId,
    );
    if (!valid) {
      throw new BadRequestException(
        'instructorId must reference a User holding an active INSTRUCTOR RoleGrant at this School (matching the given Branch, if any).',
      );
    }
  }
}
