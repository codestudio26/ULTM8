import type { TimetableSlotResponse } from './timetableQueries';

/** Same order TimetablePage.tsx's original weekday-grouped table used. */
export const WEEKDAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type Weekday = (typeof WEEKDAY_ORDER)[number];

/**
 * Pure date helpers for the Timetable redesign's Day/Week/Month range control —
 * deliberately operating on LOCAL calendar dates (the browser's own timezone), not
 * the slot's resolved Branch/School timezone the backend's class-occurrence-
 * generation job uses. This is a presentation-only "which occurrences does this
 * agenda/calendar show" concern, not a booking-eligibility one — the actual
 * materialized-Class lookup (GET /timetable/:id/occurrence) is the real source of
 * truth for whether a given date is genuinely bookable, so a client/School timezone
 * mismatch here can at most show (or hide) a date in the wrong local day, never
 * mis-book anything.
 */

/** `YYYY-MM-DD` in LOCAL time (never `toISOString()`, which is UTC and can land on
 * the wrong calendar day for a timezone behind UTC). */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function weekdayOf(date: Date): Weekday {
  // JS getDay(): 0=Sunday..6=Saturday; WEEKDAY_ORDER starts at Monday.
  return WEEKDAY_ORDER[(date.getDay() + 6) % 7];
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export interface DayOccurrences {
  date: string; // YYYY-MM-DD
  weekday: Weekday;
  slots: TimetableSlotResponse[];
}

/** Every day in `[from, to]` (inclusive), each paired with the TimetableSlots whose
 * weekday matches that day — ON and OFF alike; callers that only care about
 * bookable occurrences (e.g. the Monthly dots) filter to `status === 'ON'`
 * themselves, since an OFF slot still needs to be visible/editable somewhere in the
 * redesigned page (see TimetablePage.tsx's own header comment). */
/** A stable left-border color per slot (Grid view's "day columns, left-border-
 * colored cards" look, and the Monthly dots) — derived from the slot's own `id`
 * (not its title/activities, which can repeat or be edited), so a given slot's
 * color never changes across renders/sessions. No canonical per-Discipline color
 * exists anywhere in this codebase to reuse instead (SKILL.md §4's own
 * `activities`/Discipline reconciliation gap) — a deterministic hash is a
 * presentation-only stand-in, not a claim about discipline identity. */
export function colorForSlot(slot: { id: string }): string {
  let hash = 0;
  for (let i = 0; i < slot.id.length; i++) {
    hash = (hash * 31 + slot.id.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 60%, 45%)`;
}

export function occurrencesForRange(slots: TimetableSlotResponse[], from: Date, to: Date): DayOccurrences[] {
  const days: DayOccurrences[] = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= last) {
    const weekday = weekdayOf(cursor);
    days.push({
      date: toDateKey(cursor),
      weekday,
      slots: slots.filter((s) => s.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    });
    cursor = addDays(cursor, 1);
  }
  return days;
}
