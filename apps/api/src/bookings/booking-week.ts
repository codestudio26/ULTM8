import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { dayNumber, localDay } from '../ranks/engine';

/**
 * v1.2 backend backlog — Dashboard "Bookings This Week" drill-down (GET
 * /schools/:schoolId/bookings/summary). Date-range math for that endpoint, kept
 * separate from BookingsService so it can be unit-reasoned about on its own.
 *
 * Week boundary: the School's own week-start day (School.weekStartsOn, Decision
 * 431 item 7); it used to reuse the grading engine's Monday week. "Today" is
 * anchored to the School's own `timezone` (falls back to UTC when the School hasn't
 * set one — School.timezone is nullable), the same local-day reasoning the grading
 * engine already applies per-Branch/School.
 */

const DAY_MS = 86_400_000;

/** Inverse of `dayNumber` — the YYYY-MM-DD a day-number represents. */
function dayString(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/** The first day of the School's week containing `today` (YYYY-MM-DD), for a
 * week that starts on Monday or on Sunday (School.weekStartsOn, Decision 319).
 * Shared by the Dashboard, the bookings summary and the weekly
 * membership-ending report. */
export function weekStartOf(today: string, weekStartsOn: 'MONDAY' | 'SUNDAY'): string {
  const weekday = DateTime.fromISO(today, { zone: 'UTC' }).weekday; // 1 = Monday … 7 = Sunday
  const back = weekStartsOn === 'SUNDAY' ? weekday % 7 : weekday - 1;
  return dayString((dayNumber(today) as number) - back);
}

/** The current week as a `{ from, to }` inclusive YYYY-MM-DD pair, anchored to
 * "today" in `timeZone` (null/undefined -> UTC). It starts on the School's
 * week-start day (Decision 431 item 7: a Sunday-start School used to get
 * Monday–Sunday). The grading engine's weekly cap keeps its own Monday week
 * (Decision 171) and doesn't use this. */
export function defaultWeekRange(timeZone: string | null | undefined, weekStartsOn: 'MONDAY' | 'SUNDAY' = 'MONDAY', now: Date = new Date()): { from: string; to: string } {
  const start = weekStartOf(localDay(now, timeZone ?? 'UTC'), weekStartsOn);
  const first = dayNumber(start) as number;
  return { from: start, to: dayString(first + 6) };
}

/**
 * Converts an inclusive `[from, to]` YYYY-MM-DD range — interpreted as local
 * calendar days in `timeZone` — into the half-open UTC instant range
 * `{ gte, lt }` a Prisma `Class.startDate` filter needs (`lt` is the instant right
 * after the range's last local day ends, so callers never need a separate
 * end-of-day/millisecond computation).
 */
export function localDateRangeToInstants(from: string, to: string, timeZone: string | null | undefined): { gte: Date; lt: Date } {
  const zone = timeZone ?? 'UTC';
  const gte = DateTime.fromISO(from, { zone }).startOf('day');
  const lt = DateTime.fromISO(to, { zone }).startOf('day').plus({ days: 1 });
  if (!gte.isValid || !lt.isValid) {
    throw new BadRequestException(`Invalid date range: from=${from}, to=${to}.`);
  }
  return { gte: gte.toJSDate(), lt: lt.toJSDate() };
}

/** Every YYYY-MM-DD from `from` to `to` inclusive, in order — the day buckets the
 * response's day-by-day breakdown always includes, even a day with zero Bookings. */
export function daysInRange(from: string, to: string): string[] {
  const fromNum = dayNumber(from);
  const toNum = dayNumber(to);
  if (fromNum === null || toNum === null) {
    throw new BadRequestException(`Invalid date range: from=${from}, to=${to}.`);
  }
  const days: string[] = [];
  for (let d = fromNum; d <= toNum; d++) {
    days.push(dayString(d));
  }
  return days;
}

/** Decision 367 (D2) — the longest range the summary answers, in days. Typing a
 * year into a date box passes through years like 0202; without a limit each of
 * those built hundreds of thousands of empty days. */
export const MAX_SUMMARY_RANGE_DAYS = 92;

/** `zone` when Luxon knows it, else UTC — a mistyped stored time zone never
 * breaks the whole summary. */
export function safeZone(zone: string | null | undefined): string {
  if (!zone) return 'UTC';
  return DateTime.local().setZone(zone).isValid ? zone : 'UTC';
}
