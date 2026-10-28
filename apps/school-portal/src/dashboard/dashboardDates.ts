import { formatLocale } from '../i18n/format';

/** Decision 367 (D2) — the longest range the Bookings page asks for; the API
 * refuses anything longer (MAX_SUMMARY_RANGE_DAYS). */
export const MAX_RANGE_DAYS = 92;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(iso: string): number | null {
  const m = ISO_DAY.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms / 86_400_000 : null;
}

/**
 * A YYYY-MM-DD the API sends is a calendar day, not a moment. Formatting it as
 * UTC midnight in the browser's own zone put every day one day early west of
 * London (D1), so it's always formatted in UTC.
 */
export function formatDay(iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' }): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(formatLocale(), { ...options, timeZone: 'UTC' });
}

/** "26 Oct – 1 Nov" in the picked language (D5). */
export function formatRange(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return from === to ? formatDay(from, opts) : `${formatDay(from, opts)} – ${formatDay(to, opts)}`;
}

/** A Class's start time on its own clock (its Branch's time zone). */
export function formatClassTime(startDate: string, timeZone: string): string {
  try {
    return new Date(startDate).toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return new Date(startDate).toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  }
}

export type RangeCheck =
  | { ok: true }
  /** Still being typed (a date box passes through years like 0202): ask nothing, say nothing. */
  | { ok: false; reason: 'typing' }
  | { ok: false; reason: 'missing' | 'order' | 'tooLong' };

/** Checks a picked range before the page asks the API for it (D2, D4). */
export function checkRange(from: string, to: string): RangeCheck {
  if (!from || !to) return { ok: false, reason: 'missing' };
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null) return { ok: false, reason: 'missing' };
  if (Number(from.slice(0, 4)) < 1900 || Number(to.slice(0, 4)) < 1900) return { ok: false, reason: 'typing' };
  if (a > b) return { ok: false, reason: 'order' };
  if (b - a + 1 > MAX_RANGE_DAYS) return { ok: false, reason: 'tooLong' };
  return { ok: true };
}
