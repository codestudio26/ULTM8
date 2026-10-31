import { DateTime } from 'luxon';

/** Students → Growth (backlog 5.8): the last 12 months, this one included. */
export const GROWTH_MONTHS = 12;

export type GrowthWindow = {
  /** YYYY-MM, oldest first; the last is the current month. */
  months: string[];
  /** The first day of the oldest month (YYYY-MM-DD). */
  firstDay: string;
  /** The instant that day starts in the School's time zone. */
  from: Date;
};

/**
 * The months Growth shows, in the School's time zone: the current month and
 * the `count - 1` before it. A month starts at local midnight on its 1st, so
 * "October" for a School in Tokyo begins at 15:00 UTC on 30 September.
 */
export function growthWindow(now: Date, zone: string, count = GROWTH_MONTHS): GrowthWindow {
  const current = DateTime.fromJSDate(now, { zone }).startOf('month');
  const first = current.minus({ months: count - 1 });
  const months: string[] = [];
  for (let i = 0; i < count; i++) months.push(first.plus({ months: i }).toFormat('yyyy-MM'));
  return { months, firstDay: first.toISODate() as string, from: first.toJSDate() };
}

/** The month (YYYY-MM) an instant falls in, in the School's time zone. */
export function monthOf(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat('yyyy-MM');
}

/** The month (YYYY-MM) of a calendar day stored as a @db.Date (UTC midnight). */
export function monthOfDay(day: Date): string {
  return day.toISOString().slice(0, 7);
}
