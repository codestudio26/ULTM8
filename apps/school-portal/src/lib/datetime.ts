import { DateTime } from 'luxon';

/**
 * ISO 8601 <-> `<input type="datetime-local">`'s own value format
 * ("YYYY-MM-DDTHH:mm", no timezone/seconds) conversion — first datetime-field
 * pattern in this codebase's frontend (Class/TimetableSlot are the first
 * screens with real date-time inputs).
 *
 * FOUND ON REVIEW, corrected before this ever shipped: an earlier draft of
 * this comment claimed "no confirmed per-School timezone-of-record for these
 * fields" — false. `Branch.timezone` (IANA name, Decision 76) IS confirmed,
 * IS already passed into ClassFormModal as `branches`, and IS already the
 * authoritative source `class-occurrence-generation.processor.ts` uses for
 * this exact local-wall-clock<->UTC conversion on the sibling TimetableSlot
 * entity (via luxon, DST-safe). This helper does NOT do that — it converts
 * through the browser's OWN local timezone instead, a real, known gap: a
 * School Owner/Franchise admin editing a Class from a different timezone than
 * the selected Branch will see `Class.startDate` drift from that Branch's
 * actual local schedule. Left unfixed here deliberately rather than rushed —
 * doing it correctly needs the same DST-safe timezone-conversion approach the
 * backend job already uses (luxon or equivalent), not a hand-rolled
 * `Date`-based approximation, and is a real enough chunk of work to warrant
 * its own focused follow-up rather than a rushed fix inside this review pass.
 * Flagged, not silently accepted as correct. Since fixed for Classes: see
 * the zone-aware helpers below (Classes review C12).
 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * The zone-aware pair the comment above asked for (Classes review C12): a
 * Class's times are typed and shown on its Branch's clock (else the School's,
 * else UTC — the same order `class-occurrence-generation` uses), wherever the
 * person editing happens to be. luxon handles daylight-saving changes.
 */
export function isoToZonedInput(iso: string | null | undefined, zone: string): string {
  if (!iso) return '';
  const d = DateTime.fromISO(iso, { zone: safeZone(zone) });
  return d.isValid ? d.toFormat("yyyy-MM-dd'T'HH:mm") : '';
}

export function zonedInputToIso(value: string, zone: string): string | undefined {
  if (!value) return undefined;
  const d = DateTime.fromISO(value, { zone: safeZone(zone) });
  return d.isValid ? d.toUTC().toISO() ?? undefined : undefined;
}

/** Date and time on `zone`'s clock, in the reader's language. */
export function formatInZone(iso: string, zone: string, locale?: string): string {
  return new Date(iso).toLocaleString(locale, { timeZone: safeZone(zone), dateStyle: 'medium', timeStyle: 'short' });
}

/** The zone a Class runs on: its Branch's, else the School's, else UTC. */
export function classZone(branchTimezone: string | null | undefined, schoolTimezone: string | null | undefined): string {
  return safeZone(branchTimezone || schoolTimezone || 'UTC');
}

function safeZone(zone: string): string {
  return DateTime.local().setZone(zone).isValid ? zone : 'UTC';
}
