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

/** For calendar-only values (Prisma `@db.Date` columns — currently just
 * Minor.dateOfBirth), never `formatDate`/`formatDateTime` above. Those format in the
 * viewer's local timezone, which is correct for a real timestamp (a Class actually
 * starts at a specific instant) but wrong for a date-of-birth: the backend serializes
 * a `@db.Date` as UTC midnight (e.g. "2015-06-01T00:00:00.000Z"), and formatting that
 * in a timezone west of UTC renders it as May 31 — a genuinely wrong birth date, not
 * just a display nicety. Pinning `timeZone: 'UTC'` makes the rendered calendar day
 * match the stored one for every viewer, regardless of their own timezone. */
export function formatDateOnly(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso;
  }
}
