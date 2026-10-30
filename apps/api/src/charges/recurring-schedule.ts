import { DateTime } from 'luxon';

/**
 * The calendar of a recurring charge (Decision 412; backlog §3.6 step 3).
 * Pure: no database. Days are calendar days written YYYY-MM-DD.
 *
 * Occurrence n is worked out from the first date, never from the occurrence
 * before it, so a month end never drifts (31 Jan, 28 Feb, 31 Mar, 30 Apr…):
 * - weekly: the first date + 7n days (the same weekday);
 * - monthly: the first date + n months; on the 29th, 30th or 31st, a shorter
 *   month uses its last day;
 * - yearly: the first date + n years; 29 Feb is 28 Feb in a year that isn't a
 *   leap year.
 *
 * A series ends after its end date (no occurrence later than it) or after its
 * number of payments, or never (until stopped).
 */

export const RECURRING_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** At most this many payments in a series with a number of payments. */
export const MAX_RECURRING_OCCURRENCES = 520;
/** One run of the job never makes more than this many charges for one series
 * (a weekly series missed for ten years); the rest come on the next run. */
export const MAX_OCCURRENCES_PER_RUN = 520;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(day: string): { y: number; m: number; d: number } {
  const match = DAY.exec(day);
  if (!match) throw new Error(`Not a day: ${day}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const format = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Days in a month (m is 1-12). */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The day of occurrence `index` (0 = the first date). */
export function occurrenceDay(firstDay: string, frequency: RecurringFrequency, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error(`Not an occurrence index: ${index}`);
  const { y, m, d } = parts(firstDay);
  if (frequency === 'WEEKLY') {
    const t = Date.UTC(y, m - 1, d) + index * 7 * 24 * 60 * 60 * 1000;
    return new Date(t).toISOString().slice(0, 10);
  }
  const months = frequency === 'MONTHLY' ? index : index * 12;
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return format(year, month, Math.min(d, daysInMonth(year, month)));
}

export interface SeriesState {
  firstDate: string;
  frequency: RecurringFrequency;
  /** No occurrence after this day. */
  endDate: string | null;
  /** At most this many charges. */
  maxOccurrences: number | null;
  /** The next occurrence to make. */
  nextIndex: number;
  /** Charges made so far. */
  createdCount: number;
}

/** Whether occurrence `index` is still inside the series' end. */
function withinEnd(s: SeriesState, index: number, createdCount: number): boolean {
  if (s.maxOccurrences !== null && createdCount >= s.maxOccurrences) return false;
  if (s.endDate !== null && occurrenceDay(s.firstDate, s.frequency, index) > s.endDate) return false;
  return true;
}

/** The day of the next occurrence to make, or null when the series has ended. */
export function nextDay(s: SeriesState): string | null {
  return withinEnd(s, s.nextIndex, s.createdCount) ? occurrenceDay(s.firstDate, s.frequency, s.nextIndex) : null;
}

export interface Plan {
  /** The occurrences due today or earlier, oldest first: one per missed day, never more. */
  due: Array<{ index: number; day: string }>;
  /** What nextIndex becomes once they are made. */
  nextIndex: number;
  /** The next occurrence's day after them, or null when the series has ended. */
  nextDay: string | null;
}

/**
 * The occurrences to make on `today` (the School's day): each one from the
 * next occurrence up to and including today, inside the series' end. After a
 * day or more without a run, that is one per missed occurrence (catching up),
 * never more. `limit` caps one run.
 */
export function planOccurrences(s: SeriesState, today: string, limit = MAX_OCCURRENCES_PER_RUN): Plan {
  const due: Plan['due'] = [];
  let index = s.nextIndex;
  let created = s.createdCount;
  while (due.length < limit && withinEnd(s, index, created)) {
    const day = occurrenceDay(s.firstDate, s.frequency, index);
    if (day > today) break;
    due.push({ index, day });
    index++;
    created++;
  }
  const after = { ...s, nextIndex: index, createdCount: created };
  return { due, nextIndex: index, nextDay: nextDay(after) };
}

/**
 * The first occurrence on or after `day`, never before `fromIndex`: where a
 * restarted series picks up. Occurrences that fell while it was stopped are
 * skipped, not made late.
 */
export function firstIndexOnOrAfter(firstDay: string, frequency: RecurringFrequency, day: string, fromIndex = 0): number {
  if (day <= firstDay) return fromIndex;
  const a = parts(firstDay);
  const b = parts(day);
  // An estimate a little below the answer, then step forward.
  let index: number;
  if (frequency === 'WEEKLY') {
    const days = (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / (24 * 60 * 60 * 1000);
    index = Math.floor(days / 7);
  } else {
    const months = (b.y - a.y) * 12 + (b.m - a.m);
    index = Math.max(0, frequency === 'MONTHLY' ? months - 1 : Math.floor(months / 12) - 1);
  }
  index = Math.max(index, fromIndex);
  while (occurrenceDay(firstDay, frequency, index) < day) index++;
  return index;
}

/** `day` plus `n` calendar days. */
export function addDays(day: string, n: number): string {
  const { y, m, d } = parts(day);
  return new Date(Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Where a series picks up after occurrences that must not be made (the School
 * was closed or its ULTM8 subscription degraded on their day): the first
 * occurrence after `today`, never before `fromIndex`.
 */
export function skipThrough(s: SeriesState, today: string): { nextIndex: number; nextDay: string | null } {
  const nextIndex = firstIndexOnOrAfter(s.firstDate, s.frequency, addDays(today, 1), s.nextIndex);
  return { nextIndex, nextDay: nextDay({ ...s, nextIndex }) };
}

/** The School's calendar day at `instant` (its time zone, else UTC). */
export function schoolToday(instant: Date, zone: string | null | undefined): string {
  const z = zone && DateTime.local().setZone(zone).isValid ? zone : 'UTC';
  return DateTime.fromJSDate(instant, { zone: z }).toISODate() as string;
}

/** A YYYY-MM-DD day as the value Prisma stores in a @db.Date column. */
export function dayValue(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** A @db.Date value as YYYY-MM-DD. */
export function dayOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}
