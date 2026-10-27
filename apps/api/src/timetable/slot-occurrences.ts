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

/** A slot's occurrence fields for one local date: times, cut-offs and the copied
 * Class fields. Shared by the daily generator and slot edits (Decision 322). */
export function occurrenceFields(slot: TimetableSlot, localDate: DateTime) {
  const startDate = combineDateAndTime(localDate, slot.startTime);
  const endDate = combineDateAndTime(localDate, slot.endTime);
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
    // Decision 353 (Q6): shown on the class details only, no effect on bookings.
    breakStartAt: slot.breakStart && slot.breakEnd ? combineDateAndTime(localDate, slot.breakStart) : null,
    breakEndAt: slot.breakStart && slot.breakEnd ? combineDateAndTime(localDate, slot.breakEnd) : null,
    capacity: slot.capacity,
    bookingEndAt: slot.bookingCutoffMinutesBeforeStart != null ? new Date(startDate.getTime() - slot.bookingCutoffMinutesBeforeStart * 60_000) : null,
    qrAttendanceEndAt: slot.qrAttendanceWindowMinutes != null ? new Date(startDate.getTime() + slot.qrAttendanceWindowMinutes * 60_000) : null,
    refundFeeDate: slot.refundCutoffHoursBeforeStart != null ? new Date(startDate.getTime() - slot.refundCutoffHoursBeforeStart * 3_600_000) : null,
    cancellationCharge: slot.cancellationCharge,
    termsWaiverRequired: slot.termsWaiverRequired,
    membershipInclusion: slot.membershipInclusion,
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
