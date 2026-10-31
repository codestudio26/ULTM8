import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { hasCountingWaiverSignature } from '../waivers/waiver-signed-check';
import { frozenMembershipIds, MEMBERSHIP_FROZEN } from '../memberships/freeze/frozen-lookup';
import { dayIn, dayNumber, dayString, dayToDate } from '../memberships/freeze/membership-freeze';
import { chargeRemaining } from '../charges/charge-ledger';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** The choices for "Block check-in for overdue payments" besides No (backlog §3.5). */
export const OVERDUE_DAYS = [7, 14] as const;
export type OverdueDays = (typeof OVERDUE_DAYS)[number];

/**
 * A School's check-in rules (Decision 394; Decision 317 item 1; front-desk
 * handover F9; backlog §3.5). Every default is what check-in did before the
 * rules existed. They apply to every way in (app QR and code, the coach's
 * scan, the front desk and the locked tablet), because every one of them ends
 * in AttendanceService.assertWithinWindow and completeInTx.
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
  /** The welcome card on the front desk and the tablet shows the member's
   * classes toward their next belt (backlog §3.5; on, as it always did). */
  showBeltProgress: boolean;
  /** Refuse check-in while a charge is still owed more than this many days
   * after its due date; null: never, as before (backlog §3.5). */
  blockOverdueDays: OverdueDays | null;
}

export const CHECK_IN_RULES_SELECT = {
  checkInOpensMinutesBeforeStart: true,
  checkInClosesMinutesAfterStart: true,
  checkInRequireWaiver: true,
  checkInOtherBranches: true,
  checkInVisitors: true,
  checkInSeveralClasses: true,
  checkInFrozenMembers: true,
  checkInShowBeltProgress: true,
  checkInBlockOverdueDays: true,
} as const;

type RuleColumns = {
  checkInOpensMinutesBeforeStart: number;
  checkInClosesMinutesAfterStart: number | null;
  checkInRequireWaiver: boolean;
  checkInOtherBranches: boolean;
  checkInVisitors: boolean;
  checkInSeveralClasses: boolean;
  checkInFrozenMembers: boolean;
  checkInShowBeltProgress: boolean;
  checkInBlockOverdueDays: number | null;
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
  showBeltProgress: true,
  blockOverdueDays: null,
};

function overdueDaysFrom(value: number | null): OverdueDays | null {
  return OVERDUE_DAYS.find((d) => d === value) ?? null;
}

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
    showBeltProgress: row.checkInShowBeltProgress,
    blockOverdueDays: overdueDaysFrom(row.checkInBlockOverdueDays),
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
  paymentOverdue: "This School doesn't check members in while a payment is overdue. Pay it in the app or at the desk.",
} as const;

/** Why the School's rules refuse a check-in: a code the apps translate, and
 * the English text. */
export interface CheckInRefusal {
  code: string;
  message: string;
}

/**
 * Whether a charge due on `dueDay`, still owed on `today`, blocks check-in
 * under "after N days": it does once more than N days have passed since the
 * due day. Due 1 Nov, 7 days: still allowed on 8 Nov, refused from 9 Nov.
 * Pure; days as YYYY-MM-DD in the School's time zone.
 */
export function overdueBlocksCheckIn(dueDay: string, blockOverdueDays: number, today: string): boolean {
  return dayNumber(today) - dayNumber(dueDay) > blockOverdueDays;
}

/**
 * The check-in policy about the person (backlog §3.5), checked just before a
 * Booking is marked checked in, inside that transaction (the Student's own
 * context). Every way in (app QR and code, the coach's scan, the front desk
 * and the tablet) ends here through AttendanceService.completeInTx; the
 * Class's own times are AttendanceService.assertWithinWindow. The Booking is
 * the one being checked in: its Class says where, and the Membership that
 * paid for it says whether it is a visit pass or frozen.
 *
 * Returns null when the person may check in, else the first rule that
 * refuses, with its reason.
 */
export async function personCheckInRefusal(
  prismaJobs: PrismaJobsService,
  tx: TenantTx,
  studentId: string,
  bookingId: string,
  now: Date = new Date(),
): Promise<CheckInRefusal | null> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { schoolId: true, sourceMembershipId: true, class: { select: { branchId: true } } },
  });
  const rules = await loadCheckInRules(prismaJobs, booking.schoolId);
  if (rules.requireWaiver && !(await hasCountingWaiverSignature(tx, studentId, booking.schoolId))) {
    return { code: 'CHECK_IN_WAIVER_REQUIRED', message: CHECK_IN_RULE_MESSAGES.waiver };
  }
  if (!rules.otherBranches && booking.class.branchId) {
    // A member with no home Branch has no "other" Branch: nothing to refuse.
    const home = await tx.studentHomeBranch.findUnique({
      where: { schoolId_studentId: { schoolId: booking.schoolId, studentId } },
      select: { branchId: true },
    });
    if (home && home.branchId !== booking.class.branchId) {
      return { code: 'CHECK_IN_HOME_BRANCH_ONLY', message: CHECK_IN_RULE_MESSAGES.otherBranch };
    }
  }
  if (!rules.visitors && booking.sourceMembershipId) {
    // Read via ultm8_jobs: the visit-pass plan is never read in the app's context (Decision 391).
    const paidBy = await prismaJobs.membership.findUnique({
      where: { id: booking.sourceMembershipId },
      select: { membershipPlan: { select: { type: true } } },
    });
    if (paidBy?.membershipPlan.type === 'VISIT_PASS') {
      return { code: 'CHECK_IN_VISITORS_OFF', message: CHECK_IN_RULE_MESSAGES.visitors };
    }
  }
  // Decision 404: a frozen member can't check in unless the School allows it.
  // "Frozen" is the membership that paid for this Booking, frozen today.
  if (!rules.frozenMembers && booking.sourceMembershipId) {
    const frozen = await frozenMembershipIds(prismaJobs, booking.schoolId, [booking.sourceMembershipId], [now]);
    if (frozen.size > 0) {
      return { ...MEMBERSHIP_FROZEN };
    }
  }
  if (rules.blockOverdueDays !== null && (await hasChargeOverdueBy(prismaJobs, booking.schoolId, studentId, rules.blockOverdueDays, now))) {
    return { code: 'CHECK_IN_PAYMENT_OVERDUE', message: CHECK_IN_RULE_MESSAGES.paymentOverdue };
  }
  return null;
}

/** personCheckInRefusal, thrown as a 403 carrying its code and reason. */
export async function assertPersonMayCheckIn(prismaJobs: PrismaJobsService, tx: TenantTx, studentId: string, bookingId: string): Promise<void> {
  const refusal = await personCheckInRefusal(prismaJobs, tx, studentId, bookingId);
  if (refusal) throw new ForbiddenException(refusal);
}

/**
 * Whether the member owes anything on a charge at this School more than
 * `days` days after its due date, in the School's time zone. "Overdue" is the
 * member balance's own (backlog §3.6, ChargesService): a charge not
 * cancelled, with something still owed, past its due day. Read via
 * ultm8_jobs, only this member's charges at this School.
 */
async function hasChargeOverdueBy(prismaJobs: PrismaJobsService, schoolId: string, studentId: string, days: number, now: Date): Promise<boolean> {
  const school = await prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  const today = dayIn(now, school.timezone);
  const lastBlockedDue = dayString(dayNumber(today) - days - 1);
  const charges = await prismaJobs.charge.findMany({
    where: { schoolId, studentId, cancelledAt: null, dueDate: { lte: dayToDate(lastBlockedDue) } },
    select: { dueDate: true, grossAmount: true, refundedAmount: true, allocations: { select: { amount: true } } },
  });
  return charges.some((c) => chargeRemaining(c) > 0 && overdueBlocksCheckIn(dayString(dayNumber(c.dueDate)), days, today));
}
