import type { TranslationKey } from '../i18n/I18nProvider';

/** Minutes after midnight of an HH:mm. */
const minute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Wall-clock minutes from one HH:mm to the next, past midnight when the
 * second is earlier (Decision 431 item 3): 23:00 to 00:30 is 90. */
export function minutesBetween(from: string, to: string): number {
  return (minute(to) - minute(from) + 1440) % 1440;
}

/** Whether a weekly class ends the day after it starts (23:00–00:30). */
export function slotEndsNextDay(start: string, end: string): boolean {
  return !!start && !!end && end < start;
}

/** The checks TimetableService.assertValidTimes makes, as a message key, or
 * null: an end before the start is the next day; the end can't equal the
 * start; at most 12 hours; a break has both ends, in order, inside the class. */
export function slotTimesProblem(start: string, end: string, breakStart: string | null, breakEnd: string | null): TranslationKey | null {
  const length = minutesBetween(start, end);
  if (length === 0) return 'timetable.form.endSameAsStart';
  if (length > 720) return 'timetable.form.tooLong';
  if (!breakStart !== !breakEnd) return 'timetable.form.breakBothEnds';
  if (breakStart && breakEnd) {
    const bs = minutesBetween(start, breakStart);
    const be = minutesBetween(start, breakEnd);
    if (bs > length || be > length) return 'timetable.form.breakInsideClass';
    if (be <= bs) return 'timetable.form.breakEndAfterStart';
  }
  return null;
}
