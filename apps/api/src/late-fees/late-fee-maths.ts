import { MAX_BASIS_POINTS, MAX_CHARGE_MINOR, divideRoundHalfUp } from '../charges/charge-maths';
import { dayNumber, dayString } from '../memberships/freeze/membership-freeze';

/**
 * The sums and dates behind a late fee (v1.3 backlog §3.7; Decision 413).
 * Pure: no database, no clock. Money in minor units, % in hundredths of a
 * percent (250 = 2.5%), days as YYYY-MM-DD in the School's time zone.
 */

export const LATE_FEE_MAX_GRACE_DAYS = 30;
export const LATE_FEE_DEFAULT_GRACE_DAYS = 3;

export type LateFeeSetting = { type: 'FIXED'; fixedAmount: number } | { type: 'PERCENT'; percentBps: number };

/**
 * The late fee on a payment that still has `overdueAmount` owed: the fixed
 * amount, or the % of what is owed (Decision 413 item 6), rounded half up to
 * the minor unit as a charge's discount is (charge-maths.ts). Never more than
 * a charge can be. 0 when a % of a tiny amount rounds to nothing: no fee.
 */
export function lateFeeAmount(setting: LateFeeSetting, overdueAmount: number): number {
  if (!Number.isSafeInteger(overdueAmount) || overdueAmount <= 0) return 0;
  const fee = setting.type === 'FIXED' ? setting.fixedAmount : divideRoundHalfUp(overdueAmount * setting.percentBps, MAX_BASIS_POINTS);
  return Math.min(Math.max(0, fee), MAX_CHARGE_MINOR);
}

/**
 * The first day a payment due on `dueDay` can get a late fee: the day after
 * its grace days have passed. Grace 0: the day after the due date. Grace 3,
 * due 1 Nov: 2, 3 and 4 Nov are grace days, the fee comes on 5 Nov.
 */
export function firstLateDay(dueDay: string, graceDays: number): string {
  return dayString(dayNumber(dueDay) + graceDays + 1);
}

/**
 * Whether a payment due on `dueDay`, still unpaid on `today`, gets its late
 * fee now. Only payments whose grace ends while late fees are on: a payment
 * that was already late before the School switched them on (`enabledDay`)
 * never gets one, so switching them on is never retroactive.
 */
export function isLateFeeDue(dueDay: string, graceDays: number, today: string, enabledDay: string): boolean {
  const late = firstLateDay(dueDay, graceDays);
  return late <= today && late >= enabledDay;
}
