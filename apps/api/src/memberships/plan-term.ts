import { BadRequestException } from '@nestjs/common';
import { passExpiryDate } from './pass-expiry';
import { dayIn, dayNumber, dayStart } from './freeze/membership-freeze';

/**
 * Decision 316 item 4, as answered by Decision 435 items 7-9: when a plan's
 * membership starts and ends, and what happens when it ends.
 *
 * - Starts on first check-in (item 7): Class Packs, Weekly Passes and Trials
 *   only (never a Subscription). The membership has no end date until the
 *   member's first check-in with it; that check-in starts its days.
 * - Fixed dates (item 8): a one-off plan that runs from one day to another
 *   (a 6-week camp). It can be bought before it starts, and after it has
 *   started at full price; never once it is over. Its days replace the plan's
 *   number of days.
 * - Switch to another plan when it ends (item 9): only after a plan that has
 *   an end date. See plan-switch.processor.ts.
 */

/** The plan types that can start on first check-in (item 7), run on fixed
 * dates (item 8) or switch at their end (item 9): the one-off ones a member
 * buys. A Subscription renews until cancelled; a Friend Pass is given. */
export const TERM_PLAN_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'] as const;

const isTermType = (type: string) => (TERM_PLAN_TYPES as readonly string[]).includes(type);

export interface PlanTermSettings {
  startsOnFirstCheckIn: boolean;
  fixedStartDate: Date | null;
  fixedEndDate: Date | null;
}

/**
 * Checks a plan's start and end settings as an owner saves them. `days` is
 * the plan's number of days (expiryDurationDays) as it will be saved.
 */
export function assertPlanTermValid(type: string, term: PlanTermSettings, days: number | null): void {
  const fixed = term.fixedStartDate !== null || term.fixedEndDate !== null;
  if (term.startsOnFirstCheckIn) {
    if (!isTermType(type)) {
      throw new BadRequestException({ code: 'FIRST_CHECK_IN_NOT_FOR_TYPE', message: 'Only a Class Pack, a Weekly Pass or a Trial can start on the first check-in.' });
    }
    if (fixed) {
      throw new BadRequestException({ code: 'PLAN_TERM_CONFLICT', message: 'A plan on fixed dates starts on its first day, not on the first check-in.' });
    }
    if (!days) {
      throw new BadRequestException({ code: 'FIRST_CHECK_IN_NEEDS_DAYS', message: 'A plan that starts on the first check-in needs the number of days it lasts.' });
    }
  }
  if (fixed) {
    if (!isTermType(type)) {
      throw new BadRequestException({ code: 'FIXED_DATES_NOT_FOR_TYPE', message: 'Only a Class Pack, a Weekly Pass or a Trial can run on fixed dates.' });
    }
    if (!term.fixedStartDate || !term.fixedEndDate) {
      throw new BadRequestException({ code: 'FIXED_DATES_NEED_BOTH', message: 'Give both the first and the last day.' });
    }
    if (dayNumber(term.fixedEndDate) < dayNumber(term.fixedStartDate)) {
      throw new BadRequestException({ code: 'FIXED_DATES_ORDER', message: 'The last day must be on or after the first day.' });
    }
    if (days) {
      throw new BadRequestException({ code: 'PLAN_TERM_CONFLICT', message: 'A plan on fixed dates runs between them, so it has no number of days. Leave the number of days empty.' });
    }
  }
}

/** A YYYY-MM-DD day an owner typed, as the value a @db.Date column holds;
 * refuses a day that doesn't exist (2027-02-30). */
export function planDay(day: string): Date {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new BadRequestException({ code: 'FIXED_DATES_INVALID', message: 'Give real days for the first and the last day.' });
  }
  return date;
}

/** Whether a fixed-date plan is over in the School's time zone: its last day
 * has passed (item 8: it can still be bought on its last day). */
export function fixedPlanOver(plan: Pick<PlanTermSettings, 'fixedEndDate'>, zone: string | null, now: Date = new Date()): boolean {
  return !!plan.fixedEndDate && dayNumber(dayIn(now, zone)) > dayNumber(plan.fixedEndDate);
}

export const PLAN_OVER = { code: 'PLAN_DATES_OVER', message: "This plan's dates are over, so it can't be bought any more." };

/**
 * The dates a new Membership on `plan` gets, bought or sold at `now`:
 * - fixed dates: from the first day (or now, once it has started) to the
 *   start of the day after the last day, in the School's time zone;
 * - starts on first check-in: no end date yet, and waiting for that check-in;
 * - otherwise: from now, for the plan's number of days (Decision 432 item 8).
 */
export function membershipTerm(
  plan: { expiryDurationDays: number | null } & Partial<PlanTermSettings>,
  zone: string | null,
  now: Date = new Date(),
): { startDate: Date; expiryDate: Date | undefined; awaitingFirstCheckIn: boolean } {
  if (plan.fixedStartDate && plan.fixedEndDate) {
    const first = dayStart(dayNumber(plan.fixedStartDate), zone);
    return { startDate: first > now ? first : now, expiryDate: dayStart(dayNumber(plan.fixedEndDate) + 1, zone), awaitingFirstCheckIn: false };
  }
  if (plan.startsOnFirstCheckIn) {
    return { startDate: now, expiryDate: undefined, awaitingFirstCheckIn: true };
  }
  return { startDate: now, expiryDate: passExpiryDate(plan.expiryDurationDays, zone, now), awaitingFirstCheckIn: false };
}
