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
