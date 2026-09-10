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
   * Throws ForbiddenException unless `userId` currently holds an active
   * FRANCHISE_OWNER RoleGrant scoped to `franchiseId`. Mirrors assertSchoolOwner
   * exactly — added in Phase 8 for PaymentAccount's Franchise side.
   *
   * Untestable via any real product flow through Phase 8-15: no
   * FranchisesController/FranchisesService existed yet (Phase 2 deliberately
   * deferred Franchise CRUD), and FRANCHISE_OWNER was deliberately excluded from
   * GrantableRoleDto (see its own header comment) — there was no self-service way
   * for anyone to hold this grant. Phase 16 closes that: FranchisesService.create()
   * now grants FRANCHISE_OWNER self-service (mirroring SchoolsService.create()'s own
   * SCHOOL_OWNER_MANAGER bootstrap), so this is a live, real-user-reachable
   * authorization path now — used by FranchisesService.update() and
   * PaymentsService.createForFranchise(), not just exercised via direct-seed e2e
   * fixtures.
   */
  async assertFranchiseOwner(userId: string, franchiseId: string): Promise<void> {
    const grant = await this.prismaApp.withTenantContext(userId, (tx) =>
      tx.roleGrant.findFirst({
        where: {
          userId,
          franchiseId,
          role: 'FRANCHISE_OWNER',
          revokedAt: null,
        },
        select: { id: true },
      }),
    );
    if (!grant) {
      throw new ForbiddenException(
        'Only that Franchise\'s Owner may perform this action (Spec §8.2).',
      );
    }
  }

  /**
   * Throws ForbiddenException unless `userId` currently holds an active
   * SCHOOL_OWNER_MANAGER, BRANCH_STAFF, or INSTRUCTOR RoleGrant scoped to `schoolId` —
   * i.e. any School staff role, not just Owner/Manager. Added in Phase 9 for
   * GET /students/{id}/membership-status, whose confirmed authorization (Spec 55 §7:
   * "Branch Staff-accessible") is new ground in this codebase — grepped before
   * writing this: BRANCH_STAFF had never appeared as an access check on another
   * module's endpoint, only in role-grants.service.ts's own grant-management DTOs.
   * Reads "Branch Staff-accessible" loosely as "any School staff role" rather than
   * literally excluding School Owner/Manager from their own School's check, since
   * nothing in Spec 55 suggests Owner/Manager should be locked out of a narrower
   * signal than what assertSchoolOwner already grants them. A School-scoped
   * BRANCH_STAFF/INSTRUCTOR grant (branchId null) or a Branch-scoped one both count —
   * this endpoint returns a computed active/expired signal only, never a raw
   * Membership/Transaction row, so there's no Branch-level row to scope further
   * against (see Membership/Transaction's own RLS policy comment in this phase's
   * migration for why raw rows are denied to these two roles entirely).
   */
  /**
   * `targetBranchId` — FOUND ON REVIEW (Phase 22, BookingsService/
   * WaitlistService.findAllForClass()): optional, additive, backward-compatible
   * for every existing call site (all 10 call it with only 2 args today). When
   * the target itself is Branch-scoped (a real branch id, not null/omitted),
   * mirrors the exact three-way School/Branch structure this project's own RLS
   * policies already use (e.g. `class_tenant_isolation`, `booking_staff_read`,
   * `waitlist_entry_staff_read` — see each migration's own comment): a
   * School-wide grant (branchId null) always passes; a Branch-scoped grant
   * only passes if it matches. When the target is School-wide (`targetBranchId`
   * explicitly `null`) OR omitted entirely, EVERY staff grant qualifies
   * regardless of its own branch — this is deliberately the SAME no-filter
   * behavior for both, not two different cases (a first draft of this
   * comment/implementation treated `null` as "require a school-wide grant,"
   * which is backwards: a target with no branch of its own has nothing to
   * mismatch against, so a Branch-scoped staff member must still be able to
   * see it).
   *
   * CORRECTED AFTER CI CAUGHT IT (Phase 22): an earlier version of this comment
   * claimed a Branch-A-scoped caller reading Branch-B-scoped data would "still
   * be correctly blocked by RLS — but as a silent empty result, not a clear
   * 403." That was never actually traced against `class_tenant_isolation`'s own
   * SQL, and CI's e2e run proved it wrong: for the common case (a caller
   * holding exactly ONE RoleGrant at this School, at the wrong Branch),
   * `class_tenant_isolation` already makes the target row itself invisible to
   * that caller's `tx.class.findUnique` — the caller never gets past the
   * `NotFoundException` upstream of this call at all, producing a 404, not an
   * empty 200 and not a 403. That 404 is correct and intentional, consistent
   * with `ClassesService.findOne()`'s own documented "RLS-blocked and
   * genuinely-missing are indistinguishable by design" convention.
   *
   * What THIS check actually adds: a caller holding MULTIPLE RoleGrants at the
   * School, where a grant OTHER than their Staff one (e.g. a School-wide grant,
   * or a same-Branch grant under a non-Staff role like STUDENT) already
   * satisfies the target row's own RLS visibility — so the caller reaches this
   * method at all — while none of their Staff-role grants cover the target's
   * Branch. Without this param, that caller's mismatched Staff grant alone
   * would incorrectly authorize them. See the dual-grant e2e test in
   * bookings.e2e-spec.ts for a concrete, proven instance of this.
   */
  async assertStaffAtSchool(userId: string, schoolId: string, targetBranchId?: string | null): Promise<void> {
    const grant = await this.prismaApp.withTenantContext(userId, (tx) =>
      tx.roleGrant.findFirst({
        where: {
          userId,
          schoolId,
          role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'] },
          revokedAt: null,
          ...(targetBranchId ? { OR: [{ branchId: null }, { branchId: targetBranchId }] } : {}),
        },
        select: { id: true },
      }),
    );
    if (!grant) {
      throw new ForbiddenException(
        'Only School staff (Owner/Manager, Branch Staff, or Instructor) may perform this action (Spec §7).',
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
