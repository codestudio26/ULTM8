import { formatLocale } from '../i18n/format';

/**
 * A Class's times on its own clock (the School Portal's `classZone` /
 * `formatInZone`, apps/school-portal/src/lib/datetime.ts): its Branch's time
 * zone, else the School's, else UTC — the order `class-occurrence-generation`
 * uses — wherever the phone happens to be.
 */
export function classZone(branchTimezone: string | null | undefined, schoolTimezone: string | null | undefined): string {
  return safeZone(branchTimezone || schoolTimezone || 'UTC');
}

/** Date and start time on `zone`'s clock, in the reader's language. */
export function formatInZone(iso: string, zone: string): string {
  return new Date(iso).toLocaleString(formatLocale(), { timeZone: safeZone(zone), dateStyle: 'medium', timeStyle: 'short' });
}

/** Start time only, on `zone`'s clock. */
export function formatTimeInZone(iso: string, zone: string): string {
  return new Date(iso).toLocaleTimeString(formatLocale(), { timeZone: safeZone(zone), timeStyle: 'short' });
}

/** A zone name the device's Intl data knows, else UTC (a mistyped or unknown
 * zone must never crash the screen). */
function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}
