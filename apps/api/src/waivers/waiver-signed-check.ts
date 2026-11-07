import { PrismaClient } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Whether a Student holds a Signed waiver that counts at this School: the
 * check behind a class's or a plan's "requires a waiver". A signature on an
 * archived waiver counts unless the School turned that off (Decision 354,
 * Waiver settings). An Expired signature never counts. Runs in the caller's
 * transaction, usually the Student's own tenant context.
 *
 * `archivedSignaturesCount`: School.waiverArchivedSignaturesCount when the
 * caller already read it (readSchoolWaiverRule), so it isn't read again here
 * (stress test round 6, R-2). Left out, it is read in `tx`. */
export async function hasCountingWaiverSignature(tx: TenantTx, studentId: string, schoolId: string, archivedSignaturesCount?: boolean): Promise<boolean> {
  const archivedCount =
    archivedSignaturesCount ??
    // No School row: no filter, as before.
    (await tx.school.findUnique({ where: { id: schoolId }, select: { waiverArchivedSignaturesCount: true } }))?.waiverArchivedSignaturesCount ??
    true;
  const signed = await tx.waiverSignature.findFirst({
    where: {
      studentId,
      schoolId,
      status: 'SIGNED',
      ...(!archivedCount ? { waiver: { archivedAt: null } } : {}),
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

/** What the booking waiver rule needs to know about a School (Decision 441
 * item 5; Decision 354), read once, before the booking's transaction. */
export interface SchoolWaiverRule {
  /** School.checkInRequireWaiver: "Waiver must be signed before booking or check-in". */
  requireWaiver: boolean;
  /** School.waiverArchivedSignaturesCount: a signature on an archived waiver counts. */
  archivedSignaturesCount: boolean;
  /** The School has a waiver in use (schoolHasWaiverInUse). */
  hasWaiverInUse: boolean;
}

/** A School with no row: no School rule, archived signatures count, no
 * waiver in use (what the separate reads answered for a missing School). */
export const NO_SCHOOL_WAIVER_RULE: SchoolWaiverRule = { requireWaiver: false, archivedSignaturesCount: true, hasWaiverInUse: false };

/**
 * The School's waiver rule in one statement on the ultm8_jobs connection
 * (School settings and whether a waiver exists, nothing else about it), the
 * reads bookingWaiverRefusal used to make one by one inside the booking's
 * locked transaction, two of them on this second connection while the
 * transaction held its own (stress test round 6, R-2). Callers read it before
 * their transaction opens.
 */
export async function readSchoolWaiverRule(prismaJobs: Pick<PrismaJobsService, '$queryRaw'>, schoolId: string): Promise<SchoolWaiverRule> {
  const [row] = await prismaJobs.$queryRaw<SchoolWaiverRule[]>`
    SELECT s."checkInRequireWaiver" AS "requireWaiver",
           s."waiverArchivedSignaturesCount" AS "archivedSignaturesCount",
           EXISTS (SELECT 1 FROM "Waiver" w WHERE w."schoolId" = s.id AND w."archivedAt" IS NULL) AS "hasWaiverInUse"
    FROM "School" s WHERE s.id = ${schoolId}`;
  return row ?? NO_SCHOOL_WAIVER_RULE;
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
 * `rule` is the School's setting and whether a waiver exists, read via
 * ultm8_jobs before the caller's transaction (readSchoolWaiverRule); only the
 * signature is read here, in the caller's transaction (the Student's own
 * context). A child's signature is the one their parent gave for them
 * (WaiverSignature.studentId is the child).
 */
export async function bookingWaiverRefusal(
  tx: TenantTx,
  studentId: string,
  schoolId: string,
  classNeedsWaiver: boolean,
  rule: SchoolWaiverRule,
): Promise<'school' | 'class' | null> {
  if (!rule.requireWaiver && !classNeedsWaiver) return null;
  if (await hasCountingWaiverSignature(tx, studentId, schoolId, rule.archivedSignaturesCount)) return null;
  if (rule.requireWaiver && rule.hasWaiverInUse) return 'school';
  return classNeedsWaiver ? 'class' : null;
}
