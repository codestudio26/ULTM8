import { DateTime } from 'luxon';

/**
 * Decision 404: freezing a membership. Frozen is never a stored status; it is
 * worked out live from the freeze dates, as expiry is (Decision 26). This file
 * holds that one rule and the date arithmetic every caller shares.
 *
 * Dates are calendar days in the School's time zone (School.timezone, else
 * UTC), written as YYYY-MM-DD. A freeze's startsAt is the first frozen day and
 * endsAt is the day the member is back: endsAt is exclusive, so a freeze lasts
 * endsAt - startsAt days. Ending a freeze early (endedEarlyAt) brings the member
 * back on the day it was ended, never before the start.
 */

/** A freeze is at least this many days (Decision 404). */
export const FREEZE_MIN_DAYS = 7;
/** The School's default most frozen days in any 12 months (Decision 404). */
export const FREEZE_DEFAULT_MAX_DAYS = 90;
/** The window the School's maximum counts over. */
export const FREEZE_WINDOW_DAYS = 365;

/**
 * The plan types that can be frozen. Class packs can't (Decision 404). Friend
 * passes and visit passes are free passes the School gives, not a paid
 * membership, so they can't either (a conservative reading, not in the
 * decision).
 */
export const FREEZABLE_PLAN_TYPES = ['SUBSCRIPTION', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'] as const;

export function isFreezablePlanType(type: string): boolean {
  return (FREEZABLE_PLAN_TYPES as readonly string[]).includes(type);
}

export type FreezeDates = {
  status: string;
  startsAt: Date;
  endsAt: Date;
  endedEarlyAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A @db.Date value (UTC midnight) or a YYYY-MM-DD string as a day number. */
export function dayNumber(day: Date | string): number {
  const ms = typeof day === 'string' ? Date.parse(`${day}T00:00:00.000Z`) : day.getTime();
  return Math.floor(ms / DAY_MS);
}

export function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** A YYYY-MM-DD day as the value Prisma stores in a @db.Date column. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** `zone` when Luxon knows it, else UTC. */
export function freezeZone(zone: string | null | undefined): string {
  if (!zone) return 'UTC';
  return DateTime.local().setZone(zone).isValid ? zone : 'UTC';
}

/** The calendar day an instant falls on in the School's time zone. */
export function dayIn(instant: Date, zone: string | null | undefined): string {
  return DateTime.fromJSDate(instant, { zone: freezeZone(zone) }).toISODate() as string;
}

/** The day the member is back: endsAt, or the day it was ended early (never
 * before the start, never after endsAt). */
export function backDay(freeze: FreezeDates, zone: string | null | undefined): number {
  const end = dayNumber(freeze.endsAt);
  if (!freeze.endedEarlyAt) return end;
  const ended = dayNumber(dayIn(freeze.endedEarlyAt, zone));
  return Math.min(end, Math.max(dayNumber(freeze.startsAt), ended));
}

/** Whether an approved freeze covers this day. */
export function isFrozenOn(freeze: FreezeDates, day: string, zone: string | null | undefined): boolean {
  if (freeze.status !== 'APPROVED') return false;
  const d = dayNumber(day);
  return dayNumber(freeze.startsAt) <= d && d < backDay(freeze, zone);
}

/** Days an approved freeze actually freezes (fewer when ended early). */
export function frozenDays(freeze: FreezeDates, zone: string | null | undefined): number {
  if (freeze.status !== 'APPROVED') return 0;
  return Math.max(0, backDay(freeze, zone) - dayNumber(freeze.startsAt));
}

/** Days of an approved freeze inside [from, to) (day numbers). */
export function frozenDaysWithin(freeze: FreezeDates, zone: string | null | undefined, from: number, to: number): number {
  if (freeze.status !== 'APPROVED') return 0;
  const start = Math.max(dayNumber(freeze.startsAt), from);
  const end = Math.min(backDay(freeze, zone), to);
  return Math.max(0, end - start);
}

/** Whether a freeze still blocks dates: a request waiting, or an approved
 * freeze that hasn't ended. Two of these can't overlap on one membership. */
export function holdsDates(freeze: FreezeDates, zone: string | null | undefined): boolean {
  if (freeze.status === 'REQUESTED') return true;
  return freeze.status === 'APPROVED' && backDay(freeze, zone) > dayNumber(freeze.startsAt);
}

/** The days [start, end) a held freeze covers. */
export function heldRange(freeze: FreezeDates, zone: string | null | undefined): [number, number] {
  const start = dayNumber(freeze.startsAt);
  return [start, freeze.status === 'APPROVED' ? backDay(freeze, zone) : dayNumber(freeze.endsAt)];
}

/**
 * The freeze a membership's screens show: the approved freeze in effect or
 * still to come (the earliest), else the latest request waiting. Null when
 * there is neither.
 */
export function currentFreeze<T extends FreezeDates & { createdAt: Date }>(freezes: T[], today: string, zone: string | null | undefined): T | null {
  const t = dayNumber(today);
  const approved = freezes
    .filter((f) => f.status === 'APPROVED' && backDay(f, zone) > t && backDay(f, zone) > dayNumber(f.startsAt))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (approved.length) return approved[0];
  const requested = freezes.filter((f) => f.status === 'REQUESTED').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return requested[0] ?? null;
}

/** The freeze summary membership responses carry. `endsAt` is the day the
 * member is back (exclusive), already moved for an early end. */
export type FreezeSummary = { id: string; status: 'REQUESTED' | 'APPROVED'; startsAt: string; endsAt: string };

export function freezeSummary(
  freeze: (FreezeDates & { id: string }) | null,
  zone: string | null | undefined,
): FreezeSummary | null {
  if (!freeze) return null;
  return {
    id: freeze.id,
    status: freeze.status as 'REQUESTED' | 'APPROVED',
    startsAt: dayString(dayNumber(freeze.startsAt)),
    endsAt: dayString(freeze.status === 'APPROVED' ? backDay(freeze, zone) : dayNumber(freeze.endsAt)),
  };
}

/** A freeze rule refused, with the code the apps translate (each app shows
 * its own wording for these codes; the numbers come from the English text). */
export class FreezeRuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * The length rules (Decision 404): at least FREEZE_MIN_DAYS, starting today or
 * later, and no more than the School's maximum frozen days in the 12 months
 * before the new freeze ends (the new freeze included; an early-ended freeze
 * counts only the days it froze). Also: no overlap with another request or
 * freeze on the same membership. Throws FreezeRuleError with a message the
 * member or staff can act on.
 */
export function assertFreezeAllowed(input: {
  startsAt: string;
  endsAt: string;
  today: string;
  maxDays: number;
  others: Array<FreezeDates & { id: string }>;
  zone: string | null | undefined;
  /** The request being approved, left out of the overlap check. */
  ignoreId?: string;
}): number {
  const start = dayNumber(input.startsAt);
  const end = dayNumber(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new FreezeRuleError('FREEZE_DATES_REQUIRED', 'Give the freeze a start date and an end date.');
  }
  if (start < dayNumber(input.today)) {
    throw new FreezeRuleError('FREEZE_START_PASSED', 'A freeze must start today or later.');
  }
  const days = end - start;
  if (days < FREEZE_MIN_DAYS) {
    throw new FreezeRuleError('FREEZE_TOO_SHORT', `A freeze must last at least ${FREEZE_MIN_DAYS} days.`);
  }
  const others = input.others.filter((f) => f.id !== input.ignoreId);
  for (const other of others) {
    if (!holdsDates(other, input.zone)) continue;
    const [s, e] = heldRange(other, input.zone);
    if (start < e && s < end) {
      throw new FreezeRuleError('FREEZE_OVERLAP', 'These dates overlap another freeze or freeze request on this membership.');
    }
  }
  const windowStart = end - FREEZE_WINDOW_DAYS;
  const used = others.reduce((sum, f) => sum + frozenDaysWithin(f, input.zone, windowStart, end), 0);
  const allowed = Math.min(days, end - windowStart);
  if (used + allowed > input.maxDays) {
    const left = Math.max(0, input.maxDays - used);
    throw new FreezeRuleError(
      'FREEZE_OVER_LIMIT',
      `This School allows at most ${input.maxDays} frozen days in any 12 months. ${left} days are left for these dates.`,
    );
  }
  return days;
}
