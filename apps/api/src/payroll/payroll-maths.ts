import { DateTime } from 'luxon';

/**
 * Decision 320 item 4 — the payroll report's arithmetic, kept apart from the
 * service so it can be tested on its own.
 */

/** The report's date presets (Decision 320 item 4), or CUSTOM with from/to. */
export const PAYROLL_PRESETS = ['LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'LAST_12_MONTHS', 'CUSTOM'] as const;
export type PayrollPreset = (typeof PAYROLL_PRESETS)[number];

/** The longest custom range, in days: "last 12 months" fits (366 days in a
 * leap year), and a mistyped year can't ask for centuries. */
export const MAX_PAYROLL_RANGE_DAYS = 366;

/**
 * A preset as an inclusive [from, to] of local dates, "today" being `now` in
 * `zone`. The rolling presets end today; "this month" runs from the 1st to
 * today (classes still to come never count anyway); "last month" is the
 * whole calendar month before.
 */
export function presetRange(preset: Exclude<PayrollPreset, 'CUSTOM'>, now: Date, zone: string): { from: string; to: string } {
  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  const iso = (d: DateTime) => d.toISODate() as string;
  switch (preset) {
    case 'LAST_14_DAYS':
      return { from: iso(today.minus({ days: 13 })), to: iso(today) };
    case 'LAST_30_DAYS':
      return { from: iso(today.minus({ days: 29 })), to: iso(today) };
    case 'THIS_MONTH':
      return { from: iso(today.startOf('month')), to: iso(today) };
    case 'LAST_MONTH': {
      const first = today.startOf('month').minus({ months: 1 });
      return { from: iso(first), to: iso(first.endOf('month')) };
    }
    case 'LAST_12_MONTHS':
      return { from: iso(today.minus({ months: 12 }).plus({ days: 1 })), to: iso(today) };
  }
}

/** Number of local days in an inclusive [from, to] range (both YYYY-MM-DD). */
export function rangeDays(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: 'UTC' });
  const b = DateTime.fromISO(to, { zone: 'UTC' });
  return Math.round(b.diff(a, 'days').days) + 1;
}

/** A class's length in whole minutes, from its start to its end. A break
 * inside the class is not taken off (see the PR's choices). */
export function classMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/**
 * One person's pay (Decision 320 item 4): hours × the hourly rate plus
 * classes taught × the per-class rate, in minor units. A blank rate adds
 * nothing. The hourly part is rounded once, half up, to the minor unit.
 */
export function payFor(minutes: number, classes: number, hourlyRate: number | null, perClassRate: number | null): number {
  const hourly = hourlyRate === null ? 0 : Math.round((minutes * hourlyRate) / 60);
  const perClass = perClassRate === null ? 0 : classes * perClassRate;
  return hourly + perClass;
}
