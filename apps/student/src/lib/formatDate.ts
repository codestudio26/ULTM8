/** Every date/timestamp in this app was being rendered as a raw ISO-8601 string
 * (ClassBookingRow's startDate/endDate, then NotificationsScreen's createdAt) with no
 * shared formatter — found on review after the second occurrence. `Intl.DateTimeFormat`
 * is used directly rather than a date library: no other dependency for this exists in
 * apps/student, and RN's Hermes engine has supported `Intl` fully since well before the
 * versions this app targets. */
export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
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
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso;
  }
}
