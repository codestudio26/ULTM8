import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { hasCountingWaiverSignature } from '../waivers/waiver-signed-check';
import { frozenMembershipIds, MEMBERSHIP_FROZEN } from '../memberships/freeze/frozen-lookup';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * A School's check-in rules (Decision 394; Decision 317 item 1; front-desk
 * handover F9). Every default is what check-in did before the rules existed.
 * They apply to every way in (app QR and code, the coach's scan, the front
 * desk and the locked tablet), because every one of them ends in
 * AttendanceService.assertWithinWindow and completeInTx.
 */
export interface CheckInRules {
  /** Check-in opens this many minutes before a Class starts (26 Oct 2026; 30). */
  opensMinutesBeforeStart: number;
  /** Closes this many minutes after the start (0 = at the start); null = when the Class ends. */
  closesMinutesAfterStart: number | null;
  /** A signed waiver for the School is needed to check in, whatever the Class says. */
  requireWaiver: boolean;
  /** Members with a home Branch may check in at the School's other Branches. */
  otherBranches: boolean;
  /** Visitors may check in on their visit pass (Decision 391). */
  visitors: boolean;
  /** The front desk may check someone in to several Classes at once (Decision 378). */
  severalClasses: boolean;
  /** Members whose membership is frozen may still check in (Decision 404). */
  frozenMembers: boolean;
}

export const CHECK_IN_RULES_SELECT = {
  checkInOpensMinutesBeforeStart: true,
  checkInClosesMinutesAfterStart: true,
  checkInRequireWaiver: true,
  checkInOtherBranches: true,
  checkInVisitors: true,
  checkInSeveralClasses: true,
  checkInFrozenMembers: true,
} as const;

type RuleColumns = {
  checkInOpensMinutesBeforeStart: number;
  checkInClosesMinutesAfterStart: number | null;
  checkInRequireWaiver: boolean;
  checkInOtherBranches: boolean;
  checkInVisitors: boolean;
  checkInSeveralClasses: boolean;
  checkInFrozenMembers: boolean;
};

/** What check-in did before the rules: the column defaults. */
export const DEFAULT_CHECK_IN_RULES: CheckInRules = {
  opensMinutesBeforeStart: 30,
  closesMinutesAfterStart: null,
  requireWaiver: false,
  otherBranches: true,
  visitors: true,
  severalClasses: true,
  frozenMembers: false,
};

export function checkInRulesFrom(row: RuleColumns | null | undefined): CheckInRules {
  if (!row) return { ...DEFAULT_CHECK_IN_RULES };
  return {
    opensMinutesBeforeStart: row.checkInOpensMinutesBeforeStart,
    closesMinutesAfterStart: row.checkInClosesMinutesAfterStart,
    requireWaiver: row.checkInRequireWaiver,
    otherBranches: row.checkInOtherBranches,
    visitors: row.checkInVisitors,
    severalClasses: row.checkInSeveralClasses,
    frozenMembers: row.checkInFrozenMembers,
  };
}

/** Read via ultm8_jobs: a School setting, not a row the caller owns. */
export async function loadCheckInRules(prismaJobs: PrismaJobsService, schoolId: string): Promise<CheckInRules> {
  return checkInRulesFrom(await prismaJobs.school.findUnique({ where: { id: schoolId }, select: CHECK_IN_RULES_SELECT }));
}

/** When check-in for a Class closes: its own QR end time, else its end, and
 * no later than the School's "latest check-in" after the start. */
export function checkInClosesAt(cls: { startDate: Date; qrAttendanceEndAt: Date | null; endDate: Date }, rules: CheckInRules): Date {
  const end = cls.qrAttendanceEndAt ?? cls.endDate;
  if (rules.closesMinutesAfterStart === null) return end;
  const latest = new Date(cls.startDate.getTime() + rules.closesMinutesAfterStart * 60_000);
  return latest < end ? latest : end;
}

/** One fixed message per rule, so the apps can translate each. */
export const CHECK_IN_RULE_MESSAGES = {
  waiver: 'This School needs a signed waiver before checking in.',
  otherBranch: "This School checks members in only at their home Branch.",
  visitors: "This School doesn't check visitors in on a visit pass at the moment.",
  severalClasses: 'This School checks people in to one class at a time.',
} as const;

/**
 * The rules about the person, checked just before a Booking is marked
 * checked in, inside that transaction (the Student's own context). The
 * Booking is the one being checked in: its Class says where, and the
 * Membership that paid for it says whether it is a visit pass.
 */
export async function assertPersonMayCheckIn(
  prismaJobs: PrismaJobsService,
  tx: TenantTx,
  studentId: string,
  bookingId: string,
): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { schoolId: true, sourceMembershipId: true, class: { select: { branchId: true } } },
  });
  const rules = await loadCheckInRules(prismaJobs, booking.schoolId);
  if (rules.requireWaiver && !(await hasCountingWaiverSignature(tx, studentId, booking.schoolId))) {
    throw new ForbiddenException({ code: 'CHECK_IN_WAIVER_REQUIRED', message: CHECK_IN_RULE_MESSAGES.waiver });
  }
  if (!rules.otherBranches && booking.class.branchId) {
    // A member with no home Branch has no "other" Branch: nothing to refuse.
    const home = await tx.studentHomeBranch.findUnique({
      where: { schoolId_studentId: { schoolId: booking.schoolId, studentId } },
      select: { branchId: true },
    });
    if (home && home.branchId !== booking.class.branchId) {
      throw new ForbiddenException({ code: 'CHECK_IN_HOME_BRANCH_ONLY', message: CHECK_IN_RULE_MESSAGES.otherBranch });
    }
  }
  if (!rules.visitors && booking.sourceMembershipId) {
    // Read via ultm8_jobs: the visit-pass plan is never read in the app's context (Decision 391).
    const paidBy = await prismaJobs.membership.findUnique({
      where: { id: booking.sourceMembershipId },
      select: { membershipPlan: { select: { type: true } } },
    });
    if (paidBy?.membershipPlan.type === 'VISIT_PASS') {
      throw new ForbiddenException({ code: 'CHECK_IN_VISITORS_OFF', message: CHECK_IN_RULE_MESSAGES.visitors });
    }
  }
  // Decision 404: a frozen member can't check in unless the School allows it.
  // "Frozen" is the membership that paid for this Booking, frozen today.
  if (!rules.frozenMembers && booking.sourceMembershipId) {
    const frozen = await frozenMembershipIds(prismaJobs, booking.schoolId, [booking.sourceMembershipId], [new Date()]);
    if (frozen.size > 0) {
      throw new ForbiddenException(MEMBERSHIP_FROZEN);
    }
  }
}
