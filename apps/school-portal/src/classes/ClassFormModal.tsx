import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import type { InstructorResponse } from '../instructors/instructorQueries';
import { isoToLocalInput, localInputToIso } from '../lib/datetime';
import type { ClassResponse } from './classQueries';

export interface ClassFormValues {
  /**
   * `null` (not `undefined`) means "the field was cleared" — UpdateClassDto now
   * accepts `null` on these specific fields to mean exactly that (FOUND ON
   * REVIEW: an earlier draft used `undefined` for a cleared field, which
   * `openapi-fetch`'s JSON body serializer drops from the request entirely,
   * so ClassesService.update()'s own `dto.branchId !== undefined ? ... :
   * existing.branchId` read it as "unchanged" — the Owner could select "Whole
   * School"/"Unassigned"/blank a text field, get no error, and the old value
   * would silently stick). `ClassesPage` maps `null` back to `undefined` for
   * the CREATE path, where there's nothing to clear and CreateClassDto doesn't
   * accept `null` on these fields.
   */
  branchId?: string | null;
  instructorId?: string | null;
  title: string;
  activities: string[];
  bannerUrl?: string | null;
  description?: string | null;
  startDate: string;
  endDate: string;
  capacity?: number | null;
  /** Not clearable via this form yet — ClassesService.update() converts these
   * via `dto.X ? new Date(dto.X) : undefined`, a falsy check that would treat
   * an explicit `null` the same as an omitted field. A real, separate,
   * flagged backend gap (see that service's own comment), not something this
   * form can fix on its own. */
  bookingEndAt?: string;
  qrAttendanceEndAt?: string;
  refundFeeDate?: string;
  cancellationCharge?: number | null;
  /** Always populated — the checkbox defaults to false, never undefined. */
  termsWaiverRequired: boolean;
  membershipInclusion: boolean;
}

/** Fields match CreateClassDto/UpdateClassDto exactly —
 * apps/api/src/classes/dto/create-class.dto.ts. `instructorId` is a dropdown
 * sourced from this School's own Instructor profiles (value = the profile's
 * `userId`, since instructorId means "a User holding an active INSTRUCTOR
 * RoleGrant", not the Instructor profile's own id — see that DTO's own
 * comment) — labeled by belt/ranking since Instructor profiles don't carry a
 * display name (see InstructorFormModal's own comment on why). `activities`
 * is comma-separated free text, same convention as School.activities and
 * Discipline.classTypesOffered — not a hard FK to Discipline (the DTO
 * validates it as free-form strings, not discipline ids). */
export function ClassFormModal({
  title,
  initial,
  branches,
  instructors,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<ClassResponse>;
  branches: BranchResponse[];
  instructors: InstructorResponse[];
  submitting: boolean;
  onSubmit: (values: ClassFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    branchId: initial?.branchId ?? '',
    instructorId: initial?.instructorId ?? '',
    title: initial?.title ?? '',
    activities: (initial?.activities ?? []).join(', '),
    bannerUrl: initial?.bannerUrl ?? '',
    description: initial?.description ?? '',
    startDate: isoToLocalInput(initial?.startDate),
    endDate: isoToLocalInput(initial?.endDate),
    capacity: initial?.capacity?.toString() ?? '',
    bookingEndAt: isoToLocalInput(initial?.bookingEndAt),
    qrAttendanceEndAt: isoToLocalInput(initial?.qrAttendanceEndAt),
    refundFeeDate: isoToLocalInput(initial?.refundFeeDate),
    cancellationCharge: initial?.cancellationCharge?.toString() ?? '',
    termsWaiverRequired: initial?.termsWaiverRequired ?? false,
    membershipInclusion: initial?.membershipInclusion ?? false,
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const startDate = localInputToIso(form.startDate);
    const endDate = localInputToIso(form.endDate);
    if (!startDate || !endDate) {
      setError('Start date and end date are required.');
      return;
    }
    // FOUND ON REVIEW: `required` on the raw Activities input only guarantees
    // non-empty TEXT (e.g. "," alone passes) — validate the actual parsed
    // array, which is what CreateClassDto's own ArrayMinSize(1) enforces.
    const activities = form.activities
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (activities.length === 0) {
      setError('At least one activity is required.');
      return;
    }
    // FOUND ON REVIEW: the backend does enforce this too (assertValidDateRange),
    // but only after a round trip — catch the common case here for immediate
    // feedback.
    if (new Date(endDate).getTime() <= new Date(startDate).getTime()) {
      setError('End date must be after start date.');
      return;
    }
    try {
      await onSubmit({
        branchId: form.branchId || null,
        instructorId: form.instructorId || null,
        title: form.title,
        activities,
        bannerUrl: form.bannerUrl || null,
        description: form.description || null,
        startDate,
        endDate,
        capacity: form.capacity ? Number(form.capacity) : null,
        bookingEndAt: localInputToIso(form.bookingEndAt),
        qrAttendanceEndAt: localInputToIso(form.qrAttendanceEndAt),
        refundFeeDate: localInputToIso(form.refundFeeDate),
        cancellationCharge: form.cancellationCharge ? Number(form.cancellationCharge) : null,
        termsWaiverRequired: form.termsWaiverRequired,
        membershipInclusion: form.membershipInclusion,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Title" htmlFor="class-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Activities" htmlFor="class-activities" hint="Comma-separated, at least one — e.g. Jiu Jitsu, Kids Fundamentals">
          <TextField
            required
            value={form.activities}
            onChange={(e) => setForm((f) => ({ ...f, activities: e.target.value }))}
          />
        </Field>
        <Field label="Branch" htmlFor="class-branch" hint="Leave unselected for a School-wide Class.">
          <SelectField
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
            options={[{ value: '', label: 'Whole School' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
        <Field label="Instructor" htmlFor="class-instructor">
          <SelectField
            value={form.instructorId}
            onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
            options={[
              { value: '', label: 'Unassigned' },
              ...instructors.map((i) => ({ value: i.userId, label: i.beltRanking ?? `Instructor ${i.userId.slice(0, 8)}` })),
            ]}
          />
        </Field>
        <Field label="Start date" htmlFor="class-startDate">
          <TextField
            required
            type="datetime-local"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
          />
        </Field>
        <Field label="End date" htmlFor="class-endDate">
          <TextField
            required
            type="datetime-local"
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
          />
        </Field>
        <Field label="Capacity" htmlFor="class-capacity" hint="Leave blank for unlimited.">
          <TextField
            type="number"
            min={1}
            value={form.capacity}
            onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
          />
        </Field>
        <Field
          label="Booking cutoff"
          htmlFor="class-bookingEndAt"
          hint={initial?.bookingEndAt ? "Can't be cleared from this form yet — set a new date instead." : undefined}
        >
          <TextField
            type="datetime-local"
            value={form.bookingEndAt}
            onChange={(e) => setForm((f) => ({ ...f, bookingEndAt: e.target.value }))}
          />
        </Field>
        <Field
          label="QR check-in window ends"
          htmlFor="class-qrAttendanceEndAt"
          hint={initial?.qrAttendanceEndAt ? "Can't be cleared from this form yet — set a new date instead." : undefined}
        >
          <TextField
            type="datetime-local"
            value={form.qrAttendanceEndAt}
            onChange={(e) => setForm((f) => ({ ...f, qrAttendanceEndAt: e.target.value }))}
          />
        </Field>
        <Field
          label="Refund/credit cutoff"
          htmlFor="class-refundFeeDate"
          hint={initial?.refundFeeDate ? "Can't be cleared from this form yet — set a new date instead." : undefined}
        >
          <TextField
            type="datetime-local"
            value={form.refundFeeDate}
            onChange={(e) => setForm((f) => ({ ...f, refundFeeDate: e.target.value }))}
          />
        </Field>
        <Field label="Cancellation charge" htmlFor="class-cancellationCharge" hint="Minor currency unit (e.g. cents).">
          <TextField
            type="number"
            min={0}
            value={form.cancellationCharge}
            onChange={(e) => setForm((f) => ({ ...f, cancellationCharge: e.target.value }))}
          />
        </Field>
        <Field label="Banner URL" htmlFor="class-banner">
          <TextField value={form.bannerUrl} onChange={(e) => setForm((f) => ({ ...f, bannerUrl: e.target.value }))} />
        </Field>
        <Field label="Description" htmlFor="class-description">
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
