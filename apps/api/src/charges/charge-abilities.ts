import { ForbiddenException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';

const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'] as const;

export interface ChargeAbilities {
  owner: boolean;
  create: boolean;
  cancel: boolean;
  recordPayment: boolean;
}

/**
 * What the caller may do with this student's charges at this School
 * (Decision 303 item 3, Decision 338 items 1 and 9):
 * - create: the owner; staff who cover the student and have "Can create
 *   charges" (on by default for Branch Staff, off for Instructors).
 * - cancel: the owner; covering staff with "Can cancel charges" (off).
 * - record a desk payment: the owner; Branch Staff who cover the student
 *   when the School lets Branch Staff record payments.
 *
 * Shared by ChargesService and by PaymentsService.cancelTransaction: a
 * membership's Pending cash or bank-transfer payment is cancelled by the same
 * people as a charge (Decision 338 item 1, last point).
 */
export async function chargeAbilities(
  prismaApp: PrismaAppService,
  tenantAuth: TenantAuthorizationService,
  callerId: string,
  schoolId: string,
  studentId: string,
): Promise<ChargeAbilities> {
  const none: ChargeAbilities = { owner: false, create: false, cancel: false, recordPayment: false };
  const grants = await prismaApp.withTenantContext(callerId, (tx) =>
    tx.roleGrant.findMany({ where: { userId: callerId, schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null }, select: { role: true } }),
  );
  if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return { owner: true, create: true, cancel: true, recordPayment: true };
  if (grants.length === 0) return none;
  try {
    await tenantAuth.assertBranchCoversStudent(await tenantAuth.staffBranchCoverage(callerId, schoolId), schoolId, studentId);
  } catch (err) {
    if (err instanceof ForbiddenException) return none;
    throw err;
  }
  const branchStaff = grants.some((g) => g.role === 'BRANCH_STAFF');
  const [row, school] = await prismaApp.withTenantContext(callerId, async (tx) => [
    await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: { canCreateCharges: true, canCancelCharges: true } }),
    await tx.school.findUnique({ where: { id: schoolId }, select: { branchStaffCanRecordPayments: true } }),
  ]);
  return {
    owner: false,
    create: row?.canCreateCharges ?? branchStaff,
    cancel: row?.canCancelCharges ?? false,
    recordPayment: branchStaff && !!school?.branchStaffCanRecordPayments,
  };
}
