import { DateTime } from 'luxon';

/**
 * Grading engine — calendar days. The engine works in whole calendar days
 * written as YYYY-MM-DD, already in the school's local time. Converting an
 * instant to a local day is the caller's job (`localDay`), so the rules never
 * depend on the server's clock or time zone.
 */

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a valid YYYY-MM-DD, otherwise null. */
export function dayNumber(day: string | null | undefined): number | null {
  const m = ISO_DAY.exec(String(day ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  // Rejects dates like 2026-02-30 that Date.UTC would silently roll over.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

/** Whole days from `since` to `today`. A missing, unreadable or future date
 * reads as 0 — never as a huge number (prototype `daysSince`). */
export function daysSince(since: string | null | undefined, today: string): number {
  const from = dayNumber(since);
  const to = dayNumber(today);
  if (from === null || to === null) return 0;
  return Math.max(0, to - from);
}

/** Monday of the Mon–Sun week a day falls in, as a day number (Decision 171). */
export function weekStart(dayNum: number): number {
  // 1970-01-01 was a Thursday: (dayNum + 3) % 7 is 0 on a Monday.
  return dayNum - (((dayNum + 3) % 7) + 7) % 7;
}

/** The calendar day an instant falls on in an IANA time zone. */
export function localDay(instant: Date, timeZone: string): string {
  const dt = DateTime.fromJSDate(instant, { zone: timeZone });
  if (!dt.isValid) {
    throw new Error(`Invalid time zone: ${timeZone}`);
  }
  return dt.toISODate() as string;
}
