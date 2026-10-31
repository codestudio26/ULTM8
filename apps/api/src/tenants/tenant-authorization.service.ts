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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decision 387 — the owner's access switches for a Branch Staff member.
 * "disciplines" is Decision 383's "Can manage disciplines", shown on the same
 * Access window; the Disciplines module checks it itself. "checkInRules" is
 * Decision 394's "Change check-in rules", checked by assertMayManageCheckInRules.
 * "exportStudents" is Decision 399's "Export the student list", checked by
 * assertMayExportStudents. "freezeMemberships" is Decision 409's "Can freeze
 * memberships", checked by assertMayFreezeMemberships. "attendanceStats" is
 * Decision 317 item 3's "See attendance statistics", checked by
 * attendanceStatsScope. "memberFiles" is Decision 315 item 9's "See and
 * manage member files", checked by assertMayManageMemberFiles. "importData" is
 * Decision 315 items 12 and 13's "Import data", checked by importScope.
 * "seeMedicalInfo" is Decision 315 item 10's "See medical information",
 * checked by assertMaySeeMedicalInfo. */
export const STAFF_ACCESS = [
  'classes',
  'bookings',
  'students',
  'cancelClasses',
  'staffList',
  'inviteCoaches',
  'disciplines',
  'checkInRules',
  'exportStudents',
  'freezeMemberships',
  'attendanceStats',
  'memberFiles',
  'importData',
  'seeMedicalInfo',
] as const;
export type StaffAccess = (typeof STAFF_ACCESS)[number];
/** The switches staffMay checks. */
type GatedStaffAccess = Exclude<StaffAccess, 'disciplines' | 'checkInRules' | 'exportStudents' | 'freezeMemberships' | 'attendanceStats' | 'memberFiles' | 'importData' | 'seeMedicalInfo'>;
export type StaffAccessSet = Record<StaffAccess, boolean>;

/** A Branch Staff member with no StaffPermission row yet has these: what
 * Branch Staff could already do before the switches existed. Same as the
 * column defaults (migration 20261219000000_staff_access). */
export const DEFAULT_STAFF_ACCESS: StaffAccessSet = {
  classes: false,
  bookings: true,
  students: true,
  cancelClasses: true,
  staffList: false,
  inviteCoaches: false,
  disciplines: false,
  checkInRules: false,
  exportStudents: false,
  freezeMemberships: false,
  attendanceStats: false,
  memberFiles: false,
  importData: false,
  seeMedicalInfo: false,
};

/** What an Instructor may do by role, whatever the switches say (Spec 55
 * §8.2: attendance scan and booking override; Decision 341: their branch's
 * students). The switches are for Branch Staff only. */
const INSTRUCTOR_FLOOR: ReadonlySet<StaffAccess> = new Set(['bookings', 'students']);

/** One fixed message per switch, so the portal can translate each. */
export const STAFF_ACCESS_OFF_MESSAGES: Record<GatedStaffAccess, string> = {
  classes: "The School owner hasn't let you manage classes and the timetable here.",
  bookings: "The School owner hasn't let you manage bookings and check-in here.",
  students: "The School owner hasn't let you see or edit students.",
  cancelClasses: "The School owner hasn't let you cancel classes or give credit back.",
  staffList: "The School owner hasn't let you see the staff list.",
  inviteCoaches: "The School owner hasn't let you invite coaches.",
};

/** StaffPermission columns as a StaffAccessSet. */
export function staffAccessFrom(row: {
  canManageClasses: boolean;
  canManageBookings: boolean;
  canManageStudents: boolean;
  canCancelClasses: boolean;
  canSeeStaffList: boolean;
  canInviteCoaches: boolean;
  canManageDisciplines: boolean;
  canManageCheckInRules: boolean;
  canExportStudents: boolean;
  canFreezeMemberships: boolean;
  canSeeAttendanceStats: boolean;
  canManageMemberFiles: boolean;
  canImportData: boolean;
  canSeeMedicalInfo: boolean;
} | null | undefined): StaffAccessSet {
  if (!row) return { ...DEFAULT_STAFF_ACCESS };
  return {
    classes: row.canManageClasses,
    bookings: row.canManageBookings,
    students: row.canManageStudents,
    cancelClasses: row.canCancelClasses,
    staffList: row.canSeeStaffList,
    inviteCoaches: row.canInviteCoaches,
    disciplines: row.canManageDisciplines,
    checkInRules: row.canManageCheckInRules,
    exportStudents: row.canExportStudents,
    freezeMemberships: row.canFreezeMemberships,
    attendanceStats: row.canSeeAttendanceStats,
    memberFiles: row.canManageMemberFiles,
    importData: row.canImportData,
    seeMedicalInfo: row.canSeeMedicalInfo,
  };
}

/** The StaffPermission columns staffAccessFrom reads. */
export const STAFF_ACCESS_SELECT = {
  canManageClasses: true,
  canManageBookings: true,
  canManageStudents: true,
  canCancelClasses: true,
  canSeeStaffList: true,
  canInviteCoaches: true,
  canManageDisciplines: true,
  canManageCheckInRules: true,
  canExportStudents: true,
  canFreezeMemberships: true,
  canSeeAttendanceStats: true,
  canManageMemberFiles: true,
  canImportData: true,
  canSeeMedicalInfo: true,
} as const;

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
        // Spec §8.2
        'Only that School\'s Owner/Manager may perform this action.',
      );
    }
  }

  /** assertSchoolOwner as a yes/no. */
  async isSchoolOwner(userId: string, schoolId: string): Promise<boolean> {
    try {
      await this.assertSchoolOwner(userId, schoolId);
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) return false;
      throw err;
    }
  }

  /** Which students a staff member covers at a School (Decision 168, with
   * 139 and 148; the Grading Board's rule, used for grading and for the
   * Students page alike, Decision 341):
   * - A School with no branches is one branch: every staff member covers
   *   every student.
   * - In a School with branches, staff cover the students whose home branch
   *   is one of the branches they are assigned to (one staff RoleGrant per
   *   branch; a coach may hold several). A staff grant with no branch covers
   *   no students there, and a student with no home branch yet is the
   *   owner's alone until the owner assigns one.
   * Under the caller's context, Branch RLS shows a staff member at least
   * their own branch, so any row means the School has branches. */
  async staffBranchCoverage(callerId: string, schoolId: string): Promise<{ hasBranches: boolean; branchIds: Set<string> }> {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const anyBranch = await tx.branch.findFirst({ where: { schoolId }, select: { id: true } });
      if (!anyBranch) return { hasBranches: false, branchIds: new Set<string>() };
      const grants = await tx.roleGrant.findMany({
        where: { userId: callerId, schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null, branchId: { not: null } },
        select: { branchId: true },
      });
      return { hasBranches: true, branchIds: new Set(grants.map((g) => g.branchId as string)) };
    });
  }

  /** Throws unless `coverage` (staffBranchCoverage) includes the student's
   * home branch. The home branch is read under the student's own context. */
  async assertBranchCoversStudent(
    coverage: { hasBranches: boolean; branchIds: Set<string> },
    schoolId: string,
    studentId: string,
  ): Promise<void> {
    if (!coverage.hasBranches) return;
    if (!UUID_PATTERN.test(studentId)) throw new BadRequestException('studentId must be a valid UUID');
    const home = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.studentHomeBranch.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { branchId: true } }),
    );
    if (!home) {
      throw new ForbiddenException('This student has no home branch yet. Only the School owner can see or grade them until one is assigned.');
    }
    if (!coverage.branchIds.has(home.branchId)) {
      throw new ForbiddenException('This student belongs to a branch you are not assigned to.');
    }
  }

  /** The owner covers every student; other staff the students of their own
   * branches (staffBranchCoverage). */
  async assertStaffCoversStudent(callerId: string, schoolId: string, studentId: string): Promise<void> {
    if (await this.isSchoolOwner(callerId, schoolId)) return;
    await this.assertStaffAtSchool(callerId, schoolId);
    await this.assertBranchCoversStudent(await this.staffBranchCoverage(callerId, schoolId), schoolId, studentId);
  }

  /**
   * Decision 387 — may `userId` do `access` at this School (for a row at
   * `targetBranchId`, when given)? The owner always may. An Instructor may do
   * what their role already allows (INSTRUCTOR_FLOOR). Branch Staff may when
   * the owner's switch for them is on (a person with no StaffPermission row
   * has DEFAULT_STAFF_ACCESS). A target branch is covered by a staff grant at
   * that branch or a grant with no branch; "classes" on a School-wide row
   * (no target branch) stays the owner's.
   */
  async staffMay(userId: string, schoolId: string, access: GatedStaffAccess, targetBranchId?: string | null): Promise<boolean> {
    return this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: {
          userId,
          schoolId,
          role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'] },
          revokedAt: null,
          ...(targetBranchId ? { OR: [{ branchId: null }, { branchId: targetBranchId }] } : {}),
        },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return true;
      if (access === 'classes' && !targetBranchId) return false;
      if (INSTRUCTOR_FLOOR.has(access) && grants.some((g) => g.role === 'INSTRUCTOR')) return true;
      if (!grants.some((g) => g.role === 'BRANCH_STAFF')) return false;
      const row = await tx.staffPermission.findUnique({
        where: { schoolId_userId: { schoolId, userId } },
        select: STAFF_ACCESS_SELECT,
      });
      return staffAccessFrom(row)[access];
    });
  }

  /** Decision 387 — may `userId` manage classes and the timetable at every
   * one of `branchIds` (a School-wide row is null, the owner's alone)? Used
   * for a write that reads one branch and may move the row to another. */
  async assertMayManageClasses(userId: string, schoolId: string, branchIds: Array<string | null>): Promise<void> {
    for (const branchId of new Set(branchIds)) await this.assertStaffMay(userId, schoolId, 'classes', branchId);
  }

  /** Whether `userId` may manage classes at some branch here (the owner
   * always): for an upload made before the class it belongs to exists. */
  async mayManageClassesSomewhere(userId: string, schoolId: string): Promise<boolean> {
    const branchIds = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: 'BRANCH_STAFF', revokedAt: null, branchId: { not: null } },
        select: { branchId: true },
      });
      return grants.map((g) => g.branchId as string);
    });
    if (await this.isSchoolOwner(userId, schoolId)) return true;
    for (const branchId of branchIds) {
      if (await this.staffMay(userId, schoolId, 'classes', branchId)) return true;
    }
    return false;
  }

  /** Decision 394 — the School's check-in rules are changed by its owners,
   * and by Branch Staff the owner switches on ("Change check-in rules"). */
  async assertMayManageCheckInRules(userId: string, schoolId: string): Promise<void> {
    const allowed = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return true;
      if (grants.length === 0) return false;
      const row = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { canManageCheckInRules: true } });
      return !!row?.canManageCheckInRules;
    });
    if (!allowed) {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you change the check-in rules." });
    }
  }

  /** Decision 399 (backlog 3.9): the owner, or Branch Staff the owner let
   * export the student list. */
  async assertMayExportStudents(userId: string, schoolId: string): Promise<void> {
    const allowed = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return true;
      if (grants.length === 0) return false;
      const row = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { canExportStudents: true } });
      return !!row?.canExportStudents;
    });
    if (!allowed) {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you export the student list." });
    }
  }

  /**
   * Decision 317 item 3 (backlog 5.6): which attendance statistics `userId`
   * may see. The owner sees the whole School (`branchIds: null`); Branch
   * Staff the owner switched on ("See attendance statistics") see their own
   * Branches, or the whole School when one of their grants has no Branch
   * (the same reading staffMay gives a grant with no branch). Anyone else
   * gets 403 STAFF_ACCESS_OFF. Coaches have no switch (Decision 387 item 4)
   * and don't see statistics.
   */
  async attendanceStatsScope(userId: string, schoolId: string): Promise<{ isOwner: boolean; branchIds: string[] | null }> {
    const verdict = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true, branchId: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return { isOwner: true, branchIds: null };
      if (grants.length === 0) return null;
      const row = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { canSeeAttendanceStats: true } });
      if (!row?.canSeeAttendanceStats) return null;
      if (grants.some((g) => g.branchId === null)) return { isOwner: false, branchIds: null };
      return { isOwner: false, branchIds: [...new Set(grants.map((g) => g.branchId as string))] };
    });
    if (!verdict) {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you see attendance statistics." });
    }
    return verdict;
  }

  /**
   * Decision 315 items 12 and 13: who may import members, memberships and
   * past attendance from a spreadsheet. The owner, for the whole School; Branch
   * Staff the owner switched on ("Import data"), for the students of their own
   * Branches (staffBranchCoverage, the Students page's rule). Anyone else gets
   * 403 STAFF_ACCESS_OFF. Coaches have no switch (Decision 387 item 4).
   */
  async importScope(userId: string, schoolId: string): Promise<{ isOwner: boolean }> {
    const verdict = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return { isOwner: true };
      if (grants.length === 0) return null;
      const row = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { canImportData: true } });
      return row?.canImportData ? { isOwner: false } : null;
    });
    if (!verdict) {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you import data." });
    }
    return verdict;
  }

  /**
   * Decision 409: the School's owners, or Branch Staff the owner switched on
   * ("Can freeze memberships"), may freeze a membership and approve, decline
   * or end a freeze. With `studentId`, Branch Staff only for the students of
   * their own branches (staffBranchCoverage, the Students page's rule).
   * Returns whether the caller is an owner. The School's freeze settings
   * stay the owner's (SchoolsService).
   */
  async assertMayFreezeMemberships(userId: string, schoolId: string, studentId?: string): Promise<{ isOwner: boolean }> {
    const verdict = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return 'owner' as const;
      if (grants.length === 0) return 'no' as const;
      const row = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { canFreezeMemberships: true } });
      return row?.canFreezeMemberships ? ('staff' as const) : ('no' as const);
    });
    if (verdict === 'no') {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you freeze memberships." });
    }
    if (verdict === 'staff' && studentId) {
      await this.assertBranchCoversStudent(await this.staffBranchCoverage(userId, schoolId), schoolId, studentId);
    }
    return { isOwner: verdict === 'owner' };
  }

  /**
   * Decision 315 item 9 (backlog 5.11): files on a member are seen and
   * managed by the School's owners, and by Branch Staff the owner switched on
   * ("See and manage member files") for the students of their own branches
   * (staffBranchCoverage, the Students page's rule). Coaches and the member
   * never. Returns whether the caller is an owner.
   */
  async assertMayManageMemberFiles(userId: string, schoolId: string, studentId: string): Promise<{ isOwner: boolean }> {
    const verdict = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return 'owner' as const;
      if (grants.length === 0) return 'no' as const;
      const row = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { canManageMemberFiles: true } });
      return row?.canManageMemberFiles ? ('staff' as const) : ('no' as const);
    });
    if (verdict === 'no') {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you see member files." });
    }
    if (verdict === 'staff') {
      await this.assertBranchCoversStudent(await this.staffBranchCoverage(userId, schoolId), schoolId, studentId);
    }
    return { isOwner: verdict === 'owner' };
  }

  /**
   * Decision 315 item 10: a student's medical information is seen only by
   * the School's owners and Branch Staff the owner switched on ("See medical
   * information"), and those staff only for the students of their own
   * branches (staffBranchCoverage, the Students page's rule). Coaches never.
   */
  async assertMaySeeMedicalInfo(userId: string, schoolId: string, studentId: string): Promise<void> {
    const verdict = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return 'owner' as const;
      if (grants.length === 0) return 'no' as const;
      const row = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { canSeeMedicalInfo: true } });
      return row?.canSeeMedicalInfo ? ('staff' as const) : ('no' as const);
    });
    if (verdict === 'no') {
      throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you see medical information." });
    }
    if (verdict === 'staff') {
      await this.assertBranchCoversStudent(await this.staffBranchCoverage(userId, schoolId), schoolId, studentId);
    }
  }

  /** staffMay, throwing 403 STAFF_ACCESS_OFF when it says no. */
  async assertStaffMay(userId: string, schoolId: string, access: GatedStaffAccess, targetBranchId?: string | null): Promise<void> {
    if (await this.staffMay(userId, schoolId, access, targetBranchId)) return;
    throw new ForbiddenException({
      code: 'STAFF_ACCESS_OFF',
      message: STAFF_ACCESS_OFF_MESSAGES[access],
    });
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
        // Spec §8.2
        'Only that Franchise\'s Owner may perform this action.',
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
        // Spec §7
        'Only School staff (Owner/Manager, Branch Staff, or Instructor) may perform this action.',
      );
    }
  }

  /** assertStaffAtSchool as a yes/no. */
  async isStaffAtSchool(userId: string, schoolId: string): Promise<boolean> {
    try {
      await this.assertStaffAtSchool(userId, schoolId);
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) return false;
      throw err;
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

  /**
   * assertValidInstructor plus: an archived Instructor profile can't be given
   * new work (Decision 311, I2). For a NEW assignment only (create, or a
   * changed instructorId): a row that already has this instructor keeps them.
   * A User with the role but no profile yet is still assignable, as before.
   */
  async assertInstructorAssignable(
    callerId: string,
    instructorId: string,
    schoolId: string,
    targetBranchId: string | null,
  ): Promise<void> {
    await this.assertValidInstructor(callerId, instructorId, schoolId, targetBranchId);
    const profile = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructor.findUnique({ where: { schoolId_userId: { schoolId, userId: instructorId } }, select: { archivedAt: true } }),
    );
    if (profile?.archivedAt) {
      throw new BadRequestException('This instructor is archived. Unarchive them on the Instructors page, or pick another instructor.');
    }
  }

  /**
   * Throws ForbiddenException if `schoolId` is currently soft-archived
   * (Decision 110, Phase 56 — TenantLifecycleService's close-account action).
   * Called immediately after this file's own assertSchoolOwner/assertStaffAtSchool
   * check, in every one of the 10 services' create/update methods Decision 110
   * names (SchoolsService, BranchesService, ClassesService, TimetableService,
   * InstructorsService, MembershipsService, RanksService, WaiversService,
   * CurriculumService — FranchisesService gets the Franchise-scoped twin below).
   * Mirrors SubscriptionGateService.assertNotDegraded's own shape exactly (Phase
   * 54): a plain fresh-DB read through the caller's own ultm8_app/RLS context,
   * no new role or grant needed (ultm8_app already holds whole-table access to
   * School — see this phase's migration header comment).
   *
   * Deliberately does NOT block reads — Decision 110 part 1 calls the archived
   * state "read-only," not invisible; only the mutating endpoints this gate is
   * wired into are affected.
   */
  async assertSchoolNotArchived(callerId: string, schoolId: string): Promise<void> {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { archivedAt: true } }),
    );
    if (school?.archivedAt) {
      throw new ForbiddenException(
        'This School has been closed and no longer accepts new or updated records.',
      );
    }
  }

  /** Franchise-scoped twin of assertSchoolNotArchived above — see that method's
   * own comment for the full account. Used by FranchisesService.update(). */
  async assertFranchiseNotArchived(callerId: string, franchiseId: string): Promise<void> {
    const franchise = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.franchise.findUnique({ where: { id: franchiseId }, select: { archivedAt: true } }),
    );
    if (franchise?.archivedAt) {
      throw new ForbiddenException(
        'This Franchise has been closed and no longer accepts new or updated records.',
      );
    }
  }
}
