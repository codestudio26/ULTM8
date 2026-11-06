import { PrismaClient } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Whether a Student holds a Signed waiver that counts at this School: the
 * check behind a class's or a plan's "requires a waiver". A signature on an
 * archived waiver counts unless the School turned that off (Decision 354,
 * Waiver settings). An Expired signature never counts. Runs in the caller's
 * transaction, usually the Student's own tenant context. */
export async function hasCountingWaiverSignature(tx: TenantTx, studentId: string, schoolId: string): Promise<boolean> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { waiverArchivedSignaturesCount: true } });
  const signed = await tx.waiverSignature.findFirst({
    where: {
      studentId,
      schoolId,
      status: 'SIGNED',
      ...(school && !school.waiverArchivedSignaturesCount ? { waiver: { archivedAt: null } } : {}),
    },
    select: { id: true },
  });
  return !!signed;
}

/** Decision 441 item 5: the refusal when the School's "Waiver must be signed
 * before booking or check-in" stops a booking (a class, its waiting list, an
 * offered place). Coded, so the apps show their own translated wording. */
export const WAIVER_REQUIRED_TO_BOOK = {
  code: 'WAIVER_REQUIRED',
  message: 'This School needs a signed waiver before booking a class or checking in.',
} as const;

/** Whether the School has a waiver in use (not archived): the School's
 * waiver a member can sign now. With none, "Waiver must be signed before
 * booking or check-in" stops nobody (Decision 441 item 5). Read via
 * ultm8_jobs: whether the School has a waiver, nothing else about it. */
export async function schoolHasWaiverInUse(prismaJobs: PrismaJobsService, schoolId: string): Promise<boolean> {
  return !!(await prismaJobs.waiver.findFirst({ where: { schoolId, archivedAt: null }, select: { id: true } }));
}

/**
 * Which waiver rule stops this Student booking a class here, if any:
 * - `'school'`: the School's "Waiver must be signed before booking or
 *   check-in" (School.checkInRequireWaiver, Decision 441 item 5) is on, the
 *   School has a waiver in use, and the Student holds no signature that
 *   counts (hasCountingWaiverSignature: any of the School's waivers, as a
 *   Class's own mark has always been checked).
 * - `'class'`: the Class's own "needs a waiver" (termsWaiverRequired), as
 *   before, whatever the School setting says.
 * - null: nothing stops them.
 * The setting and whether a waiver exists are read via ultm8_jobs (School
 * settings, as the check-in rules are); the signature in the caller's
 * transaction (the Student's own context). A child's signature is the one
 * their parent gave for them (WaiverSignature.studentId is the child).
 */
export async function bookingWaiverRefusal(
  prismaJobs: PrismaJobsService,
  tx: TenantTx,
  studentId: string,
  schoolId: string,
  classNeedsWaiver: boolean,
): Promise<'school' | 'class' | null> {
  const school = await prismaJobs.school.findUnique({ where: { id: schoolId }, select: { checkInRequireWaiver: true } });
  const schoolRule = !!school?.checkInRequireWaiver;
  if (!schoolRule && !classNeedsWaiver) return null;
  if (await hasCountingWaiverSignature(tx, studentId, schoolId)) return null;
  if (schoolRule && (await schoolHasWaiverInUse(prismaJobs, schoolId))) return 'school';
  return classNeedsWaiver ? 'class' : null;
}
