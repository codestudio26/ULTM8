import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { Prisma, TimetableSlot } from '@prisma/client';

/** How many weeks of Classes are materialized ahead of today for each active slot. */
export const WEEKS_AHEAD = 4;

const WEEKDAY_TO_LUXON: Record<string, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

/** The weekday number (Monday 1 … Sunday 7) of a slot's weekday. */
export function weekdayNumber(weekday: string): number {
  return WEEKDAY_TO_LUXON[weekday];
}

/** Combines a local calendar date with a `@db.Time(0)` value (stored against
 * 1970-01-01 UTC, see TimetableService's parseHHmm) into the UTC instant for that
 * occurrence, in the date's own zone. */
export function combineDateAndTime(localDate: DateTime, time: Date): Date {
  return localDate.set({ hour: time.getUTCHours(), minute: time.getUTCMinutes(), second: 0, millisecond: 0 }).toUTC().toJSDate();
}

/** Minutes after midnight of a `@db.Time(0)` value. */
export function minuteOfDay(time: Date): number {
  return time.getUTCHours() * 60 + time.getUTCMinutes();
}

/** The longest a weekly class may run (Decision 432 item 3): 12 hours. */
export const MAX_SLOT_MINUTES = 720;

/** Wall-clock minutes from one HH:mm (as minutes after midnight) to the next
 * one, going past midnight when the second is earlier (Decision 432 item 3):
 * 23:00 to 00:30 is 90. The same two times give 0. */
export function minutesBetween(fromMinute: number, toMinute: number): number {
  return (toMinute - fromMinute + 1440) % 1440;
}

/** Whether a weekly class ends on the day after it starts (23:00–00:30). */
export function endsNextDay(startTime: Date, endTime: Date): boolean {
  return minuteOfDay(endTime) <= minuteOfDay(startTime);
}

/**
 * A time inside one occurrence, as an instant (Decision 432 items 3 and 4).
 * It is on the class's start date, or on the next day when `nextDay` says so
 * (an overnight class). The printed wall-clock time is kept; only when that
 * lands at or before `after` (a DST night: the clock skipped the start, or
 * repeated the end) is it `after` plus the wall-clock minutes between the two,
 * so a class or break is never 0 minutes long or backwards.
 */
function instantInClass(localDate: DateTime, time: Date, nextDay: boolean, after?: { instant: Date; time: Date }): Date {
  const instant = combineDateAndTime(nextDay ? localDate.plus({ days: 1 }) : localDate, time);
  if (after && instant.getTime() <= after.instant.getTime()) {
    return new Date(after.instant.getTime() + minutesBetween(minuteOfDay(after.time), minuteOfDay(time)) * 60_000);
  }
  return instant;
}

/** A slot's occurrence fields for one local date: times, cut-offs and the copied
 * Class fields. Shared by the daily generator and slot edits (Decision 322).
 * The occurrence belongs to its start date, also when the class ends after
 * midnight (Decision 432 item 3): closures and the calendar use that date. */
export function occurrenceFields(slot: TimetableSlot, localDate: DateTime) {
  const start = minuteOfDay(slot.startTime);
  const startDate = combineDateAndTime(localDate, slot.startTime);
  const endDate = instantInClass(localDate, slot.endTime, endsNextDay(slot.startTime, slot.endTime), { instant: startDate, time: slot.startTime });
  // Decision 353 (Q6): shown on the class details only, no effect on bookings.
  // A break time earlier than the start is after midnight.
  const breakStartAt = slot.breakStart && slot.breakEnd ? instantInClass(localDate, slot.breakStart, minuteOfDay(slot.breakStart) < start) : null;
  const breakEndAt =
    slot.breakStart && slot.breakEnd && breakStartAt
      ? instantInClass(localDate, slot.breakEnd, minuteOfDay(slot.breakEnd) < start, { instant: breakStartAt, time: slot.breakStart })
      : null;
  return {
    occurrenceDate: DateTime.utc(localDate.year, localDate.month, localDate.day).toJSDate(),
    branchId: slot.branchId,
    instructorId: slot.instructorId,
    title: slot.title,
    activities: slot.activities,
    styles: slot.styles ?? [],
    bannerUrl: slot.bannerUrl,
    description: slot.description,
    startDate,
    endDate,
    breakStartAt,
    breakEndAt,
    capacity: slot.capacity,
    bookingEndAt: slot.bookingCutoffMinutesBeforeStart != null ? new Date(startDate.getTime() - slot.bookingCutoffMinutesBeforeStart * 60_000) : null,
    qrAttendanceEndAt: slot.qrAttendanceWindowMinutes != null ? new Date(startDate.getTime() + slot.qrAttendanceWindowMinutes * 60_000) : null,
    refundFeeDate: slot.refundCutoffHoursBeforeStart != null ? new Date(startDate.getTime() - slot.refundCutoffHoursBeforeStart * 3_600_000) : null,
    cancellationCharge: slot.cancellationCharge,
    termsWaiverRequired: slot.termsWaiverRequired,
    membershipInclusion: slot.membershipInclusion,
    // Decision 432 item 14: who can book.
    audience: slot.audience,
    minAge: slot.minAge,
    maxAge: slot.maxAge,
  };
}

/**
 * The next WEEKS_AHEAD occurrences of a slot, as Class rows to create. The first
 * is the slot's next weekday from `now` in its zone (today if its start time is
 * still ahead).
 */
export function buildSlotOccurrences(slot: TimetableSlot, timezone: string, nowInstant: Date = new Date()): Prisma.ClassCreateManyInput[] {
  const now = DateTime.fromJSDate(nowInstant).setZone(timezone);
  let daysUntilTarget = (weekdayNumber(slot.weekday) - now.weekday + 7) % 7;
  if (daysUntilTarget === 0) {
    const todayAtStart = now.set({ hour: slot.startTime.getUTCHours(), minute: slot.startTime.getUTCMinutes(), second: 0, millisecond: 0 });
    if (todayAtStart <= now) {
      daysUntilTarget = 7;
    }
  }
  const occurrences: Prisma.ClassCreateManyInput[] = [];
  for (let weekIndex = 0; weekIndex < WEEKS_AHEAD; weekIndex++) {
    const localDate = now.plus({ days: daysUntilTarget + 7 * weekIndex }).startOf('day');
    const fields = occurrenceFields(slot, localDate);
    occurrences.push({
      id: randomUUID(),
      schoolId: slot.schoolId,
      timetableSlotId: slot.id,
      ...fields,
      styles: fields.styles as Prisma.InputJsonValue,
      bookingEndAt: fields.bookingEndAt ?? undefined,
      qrAttendanceEndAt: fields.qrAttendanceEndAt ?? undefined,
      refundFeeDate: fields.refundFeeDate ?? undefined,
      breakStartAt: fields.breakStartAt ?? undefined,
      breakEndAt: fields.breakEndAt ?? undefined,
    });
  }
  return occurrences;
}

/** A closure's dates and reach, as the generator and calendar need them
 * (Decision 353, Q8). branchId null closes the whole School. */
export type ClosureRange = { branchId: string | null; startDate: Date; endDate: Date };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Whether a local date (YYYY-MM-DD) is closed for a class at this Branch
 * (null: a School-wide class, closed only by a School-wide closure). */
export function isClosedOn(closures: ClosureRange[], branchId: string | null, date: string): boolean {
  return closures.some((c) => (c.branchId === null || c.branchId === branchId) && isoDay(c.startDate) <= date && date <= isoDay(c.endDate));
}

/** Drops the occurrences that fall on a closed date (Decision 319 §3). */
export function withoutClosedDates(occurrences: Prisma.ClassCreateManyInput[], closures: ClosureRange[], branchId: string | null): Prisma.ClassCreateManyInput[] {
  if (closures.length === 0) return occurrences;
  return occurrences.filter((o) => !isClosedOn(closures, branchId, isoDay(o.occurrenceDate as Date)));
}
