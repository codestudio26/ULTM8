import type { TimetableSlotFormValues } from './TimetableSlotFormModal';
import type { TimetableSlotResponse, UpdateTimetableSlotInput } from './timetableQueries';

/**
 * Only the fields the owner actually changed. The API carries an edit's changed
 * fields onto the slot's upcoming Classes (Decision 322), so sending the whole
 * form would overwrite a change made to one Class on its own (its capacity, its
 * instructor) on every unrelated slot edit.
 */
export function changedSlotFields(slot: TimetableSlotResponse, values: TimetableSlotFormValues): UpdateTimetableSlotInput {
  const changes: Record<string, unknown> = {};
  const before: Record<string, unknown> = {
    branchId: slot.branchId ?? null,
    instructorId: slot.instructorId ?? null,
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    breakStart: slot.breakStart ?? undefined,
    breakEnd: slot.breakEnd ?? undefined,
    status: slot.status,
    title: slot.title,
    activities: slot.activities,
    styles: slot.styles.map((s) => ({ disciplineId: s.disciplineId, classType: s.classType ?? null })),
    capacity: slot.capacity ?? null,
    description: slot.description ?? null,
    bannerUrl: slot.bannerUrl ?? null,
    termsWaiverRequired: slot.termsWaiverRequired,
    membershipInclusion: slot.membershipInclusion,
    bookingCutoffMinutesBeforeStart: slot.bookingCutoffMinutesBeforeStart ?? null,
    qrAttendanceWindowMinutes: slot.qrAttendanceWindowMinutes ?? null,
    refundCutoffHoursBeforeStart: slot.refundCutoffHoursBeforeStart ?? null,
    cancellationCharge: slot.cancellationCharge ?? null,
  };
  for (const [key, value] of Object.entries(values)) {
    // An omitted break time can't be cleared through this form (see
    // TimetableSlotFormValues.breakStart), so it is never a change.
    if (value === undefined) continue;
    const normalized = key === 'styles' ? (value as TimetableSlotFormValues['styles'])!.map((s) => ({ disciplineId: s.disciplineId, classType: s.classType ?? null })) : value;
    if (JSON.stringify(normalized) !== JSON.stringify(before[key])) changes[key] = value;
  }
  return changes as UpdateTimetableSlotInput;
}

/** Whether a change moves the slot's Classes in time or place, or switches the
 * slot off — the same test TimetableService.movesClasses applies. */
export function slotChangeMovesClasses(slot: TimetableSlotResponse, changes: UpdateTimetableSlotInput): boolean {
  return (
    changes.weekday !== undefined ||
    changes.startTime !== undefined ||
    changes.endTime !== undefined ||
    changes.branchId !== undefined ||
    (changes.status === 'OFF' && slot.status === 'ON')
  );
}
