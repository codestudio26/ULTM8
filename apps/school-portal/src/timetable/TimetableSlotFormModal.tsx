import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import type { InstructorResponse } from '../instructors/instructorQueries';
import type { TimetableSlotResponse } from './timetableQueries';

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

export interface TimetableSlotFormValues {
  /** `null` means "cleared" — UpdateTimetableSlotDto accepts `null` on these
   * fields to mean exactly that (see that DTO's own header comment); the
   * page-level caller maps `null` back to `undefined` for the CREATE path,
   * which has nothing to clear. */
  branchId?: string | null;
  instructorId?: string | null;
  weekday: (typeof WEEKDAYS)[number];
  startTime: string;
  endTime: string;
  /** NOT clearable via this form yet — TimetableService.update() converts
   * these via `dto.X ? parseHHmm(dto.X) : undefined`, a falsy check that
   * would treat an explicit `null` the same as an omitted field. A real,
   * separate, flagged backend gap (see that service's own comment), not
   * something this form can fix on its own. */
  breakStart?: string;
  breakEnd?: string;
  /** Always populated — defaults to 'ON', never undefined. */
  status: 'ON' | 'OFF';
  title: string;
  activities: string[];
  capacity?: number | null;
  description?: string | null;
  bannerUrl?: string | null;
  /** Always populated — the checkboxes default to false, never undefined. */
  termsWaiverRequired: boolean;
  membershipInclusion: boolean;
  bookingCutoffMinutesBeforeStart?: number | null;
  qrAttendanceWindowMinutes?: number | null;
  refundCutoffHoursBeforeStart?: number | null;
  cancellationCharge?: number | null;
}

/** Fields match CreateTimetableSlotDto/UpdateTimetableSlotDto exactly —
 * apps/api/src/timetable/dto/create-timetable-slot.dto.ts. This is the
 * recurring weekly TEMPLATE (weekday + HH:mm times), a separate resource
 * from Class per that DTO's own header comment — Spec 55 doesn't confirm how
 * (or whether) a bookable Class gets generated from a slot occurrence, so
 * this screen manages the template only, same as the backend. `title`/
 * `activities`/etc. are template copies of the same fields CreateClassDto
 * has, kept in sync with that form's own field set and validation limits. */
export function TimetableSlotFormModal({
  title,
  initial,
  branches,
  instructors,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<TimetableSlotResponse>;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  submitting: boolean;
  onSubmit: (values: TimetableSlotFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    branchId: initial?.branchId ?? '',
    instructorId: initial?.instructorId ?? '',
    weekday: (initial?.weekday as (typeof WEEKDAYS)[number]) ?? 'MONDAY',
    startTime: initial?.startTime ?? '18:00',
    endTime: initial?.endTime ?? '19:00',
    breakStart: initial?.breakStart ?? '',
    breakEnd: initial?.breakEnd ?? '',
    status: (initial?.status as 'ON' | 'OFF') ?? 'ON',
    title: initial?.title ?? '',
    activities: (initial?.activities ?? []).join(', '),
    capacity: initial?.capacity?.toString() ?? '',
    description: initial?.description ?? '',
    bannerUrl: initial?.bannerUrl ?? '',
    termsWaiverRequired: initial?.termsWaiverRequired ?? false,
    membershipInclusion: initial?.membershipInclusion ?? false,
    bookingCutoffMinutesBeforeStart: initial?.bookingCutoffMinutesBeforeStart?.toString() ?? '',
    qrAttendanceWindowMinutes: initial?.qrAttendanceWindowMinutes?.toString() ?? '',
    refundCutoffHoursBeforeStart: initial?.refundCutoffHoursBeforeStart?.toString() ?? '',
    cancellationCharge: initial?.cancellationCharge?.toString() ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // FOUND ON REVIEW: `required` on the raw Activities input only guarantees
    // non-empty TEXT (e.g. "," alone passes) — validate the actual parsed
    // array, which is what CreateTimetableSlotDto's own ArrayMinSize(1)
    // enforces.
    const activities = form.activities
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (activities.length === 0) {
      setError('At least one activity is required.');
      return;
    }
    if (form.endTime <= form.startTime) {
      setError('End time must be after start time.');
      return;
    }
    try {
      await onSubmit({
        branchId: form.branchId || null,
        instructorId: form.instructorId || null,
        weekday: form.weekday,
        startTime: form.startTime,
        endTime: form.endTime,
        breakStart: form.breakStart || undefined,
        breakEnd: form.breakEnd || undefined,
        status: form.status,
        title: form.title,
        activities,
        capacity: form.capacity ? Number(form.capacity) : null,
        description: form.description || null,
        bannerUrl: form.bannerUrl || null,
        termsWaiverRequired: form.termsWaiverRequired,
        membershipInclusion: form.membershipInclusion,
        bookingCutoffMinutesBeforeStart: form.bookingCutoffMinutesBeforeStart
          ? Number(form.bookingCutoffMinutesBeforeStart)
          : null,
        qrAttendanceWindowMinutes: form.qrAttendanceWindowMinutes ? Number(form.qrAttendanceWindowMinutes) : null,
        refundCutoffHoursBeforeStart: form.refundCutoffHoursBeforeStart
          ? Number(form.refundCutoffHoursBeforeStart)
          : null,
        cancellationCharge: form.cancellationCharge ? Number(form.cancellationCharge) : null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Title" htmlFor="slot-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Activities" htmlFor="slot-activities" hint="Comma-separated, at least one">
          <TextField
            required
            value={form.activities}
            onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))}
          />
        </Field>
        <Field label="Weekday" htmlFor="slot-weekday">
          <SelectField
            value={form.weekday}
            onChange={(e) => setForm((f) => ({ ...f, weekday: e.target.value as (typeof WEEKDAYS)[number] }))}
            options={WEEKDAYS.map((w) => ({ value: w, label: w.charAt(0) + w.slice(1).toLowerCase() }))}
          />
        </Field>
        <Field label="Start time" htmlFor="slot-startTime" hint="24-hour clock, HH:mm">
          <TextField
            required
            type="time"
            value={form.startTime}
            onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
          />
        </Field>
        <Field label="End time" htmlFor="slot-endTime" hint="24-hour clock, HH:mm">
          <TextField
            required
            type="time"
            value={form.endTime}
            onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
          />
        </Field>
        <Field label="Break start" htmlFor="slot-breakStart">
          <TextField type="time" value={form.breakStart} onChange={(e) => setForm((f) => ({ ...f, breakStart: e.target.value }))} />
        </Field>
        <Field label="Break end" htmlFor="slot-breakEnd">
          <TextField type="time" value={form.breakEnd} onChange={(e) => setForm((f) => ({ ...f, breakEnd: e.target.value }))} />
        </Field>
        <Field label="Status" htmlFor="slot-status">
          <SelectField
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'ON' | 'OFF' }))}
            options={[
              { value: 'ON', label: 'On' },
              { value: 'OFF', label: 'Off' },
            ]}
          />
        </Field>
        <Field label="Branch" htmlFor="slot-branch" hint="Leave unselected for a School-wide slot.">
          <SelectField
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
            options={[{ value: '', label: 'Whole School' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
        <Field label="Instructor" htmlFor="slot-instructor">
          <SelectField
            value={form.instructorId}
            onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
            options={[
              { value: '', label: 'Unassigned' },
              ...instructors.map((i) => ({ value: i.userId, label: i.beltRanking ?? `Instructor ${i.userId.slice(0, 8)}` })),
            ]}
          />
        </Field>
        <Field label="Capacity" htmlFor="slot-capacity" hint="Leave blank for unlimited.">
          <TextField type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
        </Field>
        <Field label="Booking cutoff" htmlFor="slot-bookingCutoff" hint="Minutes before each occurrence starts.">
          <TextField
            type="number"
            min={0}
            value={form.bookingCutoffMinutesBeforeStart}
            onChange={(e) => setForm((f) => ({ ...f, bookingCutoffMinutesBeforeStart: e.target.value }))}
          />
        </Field>
        <Field label="QR check-in window" htmlFor="slot-qrWindow" hint="Minutes from each occurrence's start.">
          <TextField
            type="number"
            min={0}
            value={form.qrAttendanceWindowMinutes}
            onChange={(e) => setForm((f) => ({ ...f, qrAttendanceWindowMinutes: e.target.value }))}
          />
        </Field>
        <Field label="Refund/credit cutoff" htmlFor="slot-refundCutoff" hint="Hours before each occurrence starts.">
          <TextField
            type="number"
            min={0}
            value={form.refundCutoffHoursBeforeStart}
            onChange={(e) => setForm((f) => ({ ...f, refundCutoffHoursBeforeStart: e.target.value }))}
          />
        </Field>
        <Field label="Cancellation charge" htmlFor="slot-cancellationCharge" hint="Minor currency unit (e.g. cents).">
          <TextField
            type="number"
            min={0}
            value={form.cancellationCharge}
            onChange={(e) => setForm((f) => ({ ...f, cancellationCharge: e.target.value }))}
          />
        </Field>
        <Field label="Banner URL" htmlFor="slot-banner">
          <TextField value={form.bannerUrl} onChange={(e) => setForm((f) => ({ ...f, bannerUrl: e.target.value }))} />
        </Field>
        <Field label="Description" htmlFor="slot-description">
          <TextArea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Checkbox
          label="Requires signed waiver/terms to book"
          checked={form.termsWaiverRequired}
          onChange={(e) => setForm((f) => ({ ...f, termsWaiverRequired: e.target.checked }))}
        />
        <Checkbox
          label="Included in general membership access (no separate ticket required)"
          checked={form.membershipInclusion}
          onChange={(e) => setForm((f) => ({ ...f, membershipInclusion: e.target.checked }))}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
