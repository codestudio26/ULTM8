import type { ClosureResponse, TimetableCalendarClass, TimetableCalendarResponse, TimetableSlotResponse } from './timetableQueries';

/** Same order TimetablePage.tsx's original weekday-grouped table used. */
export const WEEKDAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

/** A weekday's display name in `locale` (e.g. en-GB "Monday" / "Mon") — 1 Jan
 * 2024 was a Monday, so a WEEKDAY_ORDER index is a day offset from it. */
export function weekdayName(weekday: (typeof WEEKDAY_ORDER)[number], locale: string, width: 'long' | 'short'): string {
  return new Date(2024, 0, 1 + WEEKDAY_ORDER.indexOf(weekday)).toLocaleDateString(locale, { weekday: width });
}
export type Weekday = (typeof WEEKDAY_ORDER)[number];

/**
 * Pure date helpers for the Timetable's Day/Week/Month range control. The days
 * on screen are browser-local calendar dates; each real Class comes from the API
 * already placed on its own local date in its Branch's (else School's) zone
 * (Decision 353, T7), so the calendar never works a class's date out here.
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

/** One thing on a calendar day (Decision 353, T7):
 * - `class`: a real Class, bookable or not (cancelled, ended), from the API;
 * - `later`: an On slot's date past the 4-week horizon, no Class yet;
 * - `template`: an Off or archived slot on its weekday, shown dimmed so the
 *   owner can still find and change it. */
export type CalendarEntry =
  | { kind: 'class'; cls: TimetableCalendarClass; slot: TimetableSlotResponse | null }
  | { kind: 'later'; slot: TimetableSlotResponse }
  | { kind: 'template'; slot: TimetableSlotResponse };

export interface DayOccurrences {
  date: string; // YYYY-MM-DD
  weekday: Weekday;
  entries: CalendarEntry[];
  /** Closures covering this date (Decision 353, Q8). */
  closures: ClosureResponse[];
}

/** The start time an entry sorts by. */
export function entryStart(entry: CalendarEntry): string {
  return entry.kind === 'class' ? entry.cls.startTime : entry.slot.startTime;
}

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

/** Every day in `[from, to]` (inclusive) with what it shows: the real Classes
 * on that date, the later dates of On slots, and the weekdays of Off or archived
 * `slots` (the caller passes only the ones it wants shown). */
export function occurrencesForRange(
  slots: TimetableSlotResponse[],
  calendar: TimetableCalendarResponse | undefined,
  from: Date,
  to: Date,
): DayOccurrences[] {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const days: DayOccurrences[] = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= last) {
    const weekday = weekdayOf(cursor);
    const date = toDateKey(cursor);
    const entries: CalendarEntry[] = [
      ...(calendar?.classes ?? []).filter((c) => c.date === date).map((cls) => ({ kind: 'class' as const, cls, slot: cls.timetableSlotId ? (slotById.get(cls.timetableSlotId) ?? null) : null })),
      ...(calendar?.later ?? []).filter((l) => l.date === date && slotById.has(l.slotId)).map((l) => ({ kind: 'later' as const, slot: slotById.get(l.slotId)! })),
      ...slots.filter((s) => s.weekday === weekday && (s.status !== 'ON' || s.archivedAt)).map((slot) => ({ kind: 'template' as const, slot })),
    ];
    entries.sort((a, b) => entryStart(a).localeCompare(entryStart(b)));
    const closures = (calendar?.closures ?? []).filter((c) => c.startDate <= date && date <= c.endDate);
    days.push({ date, weekday, entries, closures });
    cursor = addDays(cursor, 1);
  }
  return days;
}
