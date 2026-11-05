import { formatLocale } from '../i18n/format';

/** Every date/timestamp in this app was being rendered as a raw ISO-8601 string
 * (ClassBookingRow's startDate/endDate, then NotificationsScreen's createdAt) with no
 * shared formatter — found on review after the second occurrence. `Intl.DateTimeFormat`
 * is used directly rather than a date library: no other dependency for this exists in
 * apps/student, and RN's Hermes engine has supported `Intl` fully since well before the
 * versions this app targets. */
export function formatDate(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(formatLocale(), { dateStyle: 'medium', timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** A timestamp's time of day only (e.g. a class's break). `timeZone`, when
 * given, is the clock to show it on (a class's own, lib/classTime.ts);
 * otherwise the phone's. */
export function formatTime(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(formatLocale(), { timeStyle: 'short', timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(formatLocale(), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** FOUND ON REVIEW: for a date-ONLY value — no meaningful time component, e.g. a
 * `@db.Date` column serialized as UTC midnight, like Student.dateOfBirth — formatDate()
 * above is wrong, not just imprecise: it displays in the device's local timezone,
 * which is correct for a genuine timestamp (Class start/end, a Membership's expiry, a
 * Waiver signing time — all real instants) but shifts a date-only value back a
 * calendar day on any device set to a timezone behind UTC (a DOB of 2015-06-01,
 * serialized as 2015-06-01T00:00:00.000Z, would render as "May 31, 2015"). Formats in
 * UTC instead, so the displayed day always matches the stored date regardless of the
 * viewer's timezone. */
export function formatDateOnly(iso: string): string {
  try {
    return new Intl.DateTimeFormat(formatLocale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** A class's day and start–end time, e.g. "Thu, Nov 5, 2026, 6:00 PM – 7:00 PM"
 * (Decision 427, Student portal review SP6: class rows showed only the date).
 * `timeZone` is the class's own clock (its Branch's zone, else the School's,
 * else UTC: `classZone` in lib/classTime.ts), so the times read as the School
 * advertises them wherever the phone is. Without it, the phone's clock. */
export function formatClassTimes(startIso: string, endIso?: string | null, timeZone?: string): string {
  try {
    const locale = formatLocale();
    const day = new Intl.DateTimeFormat(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(new Date(startIso));
    const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone });
    const start = time.format(new Date(startIso));
    return endIso ? `${day}, ${start} – ${time.format(new Date(endIso))}` : `${day}, ${start}`;
  } catch {
    return startIso;
  }
}
