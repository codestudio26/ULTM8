import { ForbiddenException } from '@nestjs/common';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { assertBaselineConsentGiven } from '../guardians/baseline-consent';
import { ACCOUNT_CLOSING } from '../account-deletion/account-closing';
import { SchoolWaiverRule, NO_SCHOOL_WAIVER_RULE } from '../waivers/waiver-signed-check';

/** What a booking's own transaction needs from the checks made before it. */
export interface BookingPreflight {
  /** The School's own time zone (School.timezone), for frozenMembershipIds. */
  schoolTimezone: string | null;
  /** The School's waiver rule, for bookingWaiverRefusal. */
  waiverRule: SchoolWaiverRule;
}

type PreflightRow = {
  schoolTimezone: string | null;
  branchTimezone: string | null;
  requireWaiver: boolean | null;
  archivedSignaturesCount: boolean | null;
  hasWaiverInUse: boolean;
  hasGuardianLink: boolean;
  deletionRequestedAt: Date | null;
  erasedAt: Date | null;
};

/**
 * The checks a booking, a waitlist join and a waitlist claim make on the
 * ultm8_jobs connection before their locked transaction, read in one
 * statement (stress test round 6, R-2: they had become seven reads, two of
 * them on this connection while the booking's transaction held its own). The
 * rules, and the order they answer in, are the ones they replace:
 *
 * 1. Decision 430 item 9 (FAM-9): a child whose parent hasn't given BASELINE
 *    consent can't be booked, by anyone. Only a Student with an active parent
 *    link can be refused, so assertBaselineConsentGiven (which reads the
 *    links, the birth date and the consent records) runs only for them, with
 *    the Branch-then-School zone schoolZone() gives.
 * 2. "Delete my account": an account being deleted is locked, by anyone
 *    (assertAccountNotClosing).
 *
 * It returns the School's waiver rule (readSchoolWaiverRule) and time zone,
 * so the transaction reads neither again.
 */
export async function bookingPreflight(
  prismaJobs: PrismaJobsService,
  studentId: string,
  schoolId: string,
  branchId: string | null,
): Promise<BookingPreflight> {
  const [row] = await prismaJobs.$queryRaw<PreflightRow[]>`
    SELECT s.timezone AS "schoolTimezone",
           (SELECT b.timezone FROM "Branch" b WHERE b.id = ${branchId} AND b."schoolId" = ${schoolId}) AS "branchTimezone",
           s."checkInRequireWaiver" AS "requireWaiver",
           s."waiverArchivedSignaturesCount" AS "archivedSignaturesCount",
           EXISTS (SELECT 1 FROM "Waiver" w WHERE w."schoolId" = ${schoolId} AND w."archivedAt" IS NULL) AS "hasWaiverInUse",
           EXISTS (SELECT 1 FROM "GuardianLink" g WHERE g."studentId" = ${studentId} AND g."revokedAt" IS NULL) AS "hasGuardianLink",
           u."deletionRequestedAt", u."erasedAt"
    FROM (SELECT 1) AS one
    LEFT JOIN "School" s ON s.id = ${schoolId}
    LEFT JOIN "User" u ON u.id = ${studentId}`;
  if (row.hasGuardianLink) {
    // schoolZone(): the Branch's own zone when it has one, else the School's.
    const zone = row.branchTimezone ? row.branchTimezone : row.schoolTimezone;
    await assertBaselineConsentGiven(prismaJobs, studentId, zone);
  }
  if (row.deletionRequestedAt || row.erasedAt) {
    throw new ForbiddenException(ACCOUNT_CLOSING);
  }
  return {
    schoolTimezone: row.schoolTimezone,
    waiverRule:
      row.requireWaiver === null || row.archivedSignaturesCount === null
        ? NO_SCHOOL_WAIVER_RULE
        : { requireWaiver: row.requireWaiver, archivedSignaturesCount: row.archivedSignaturesCount, hasWaiverInUse: row.hasWaiverInUse },
  };
}
