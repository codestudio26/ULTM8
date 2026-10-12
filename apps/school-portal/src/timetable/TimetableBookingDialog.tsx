import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { StudentSummary } from '../students/studentQueries';
import type { InstructorResponse } from '../instructors/instructorQueries';
import { useBookClass } from '../bookings/bookingQueries';
import { useTimetableOccurrence } from './timetableQueries';

/**
 * The Timetable redesign's click-to-book confirmation dialog — backlog doc's own
 * confirmed shape (Spec §3.2's booking flow): Student, Class, Instructor, Class
 * Timings, Class Date, plus payment if required. Payment is deliberately NOT
 * collected inline here: confirmed by checking every other Staff-on-behalf-of
 * booking entry point in this app (BookingsDrilldownPage.tsx has none at all — no
 * click-to-book exists anywhere yet; RollCallPage/ClassDetailPage's Bookings tab are
 * both read-only) — there is no existing precedent for an inline payment UI to
 * match, and Spec §3.2's "payment if required" is already handled server-side by
 * BookingsService.bookClass() itself (membership-credit selection, or the existing
 * error surfaced when the Student has none) — see this file's own PR description for
 * this disclosed judgment call.
 *
 * DISCLOSED JUDGMENT CALL (layout): a single-column confirmation form, same visual
 * weight as TimetableSlotFormModal/ClassFormModal's own Modal-based forms elsewhere
 * in this app — not a denser summary-card style the mockup might have used, since no
 * mockup is reachable this session (see TimetablePage.tsx's own header comment).
 */
export function TimetableBookingDialog({
  slotId,
  slotTitle,
  date,
  students,
  instructors,
  onClose,
  onBooked,
}: {
  slotId: string;
  slotTitle: string;
  date: string;
  students: StudentSummary[];
  instructors: InstructorResponse[];
  onClose: () => void;
  onBooked: () => void;
}) {
  const occurrence = useTimetableOccurrence(slotId, date);
  const bookClass = useBookClass();
  const [studentId, setStudentId] = useState('');
  const [bookError, setBookError] = useState<string | null>(null);

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Modal title={`Book — ${slotTitle}`} onClose={onClose}>
      {occurrence.isLoading ? (
        <Spinner />
      ) : occurrence.error instanceof ApiError && occurrence.error.status === 404 ? (
        // The disclosed, expected gap — never silently hidden, never created on
        // demand. See TimetableService.findOccurrence's own header comment for why
        // this is the correct behavior, not a bug: a Class is materialized ahead of
        // time (4-week horizon) or created as an independent one-off, never on the
        // fly from a booking click.
        <>
          <p>
            <strong>Not bookable yet.</strong> This occurrence ({dateLabel}) hasn't been generated as a real
            Class yet — Classes are generated up to 4 weeks ahead of time. Check back closer to the date, or
            confirm this slot is turned On.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : occurrence.error ? (
        <ErrorBanner
          message={occurrence.error instanceof ApiError ? occurrence.error.message : 'Could not load this occurrence.'}
        />
      ) : occurrence.data ? (
        <BookingForm
          occurrence={occurrence.data}
          dateLabel={dateLabel}
          students={students}
          instructors={instructors}
          studentId={studentId}
          setStudentId={setStudentId}
          bookError={bookError}
          submitting={bookClass.isPending}
          onClose={onClose}
          onConfirm={async () => {
            setBookError(null);
            try {
              await bookClass.mutateAsync({ classId: occurrence.data!.id, body: { studentId } });
              onBooked();
            } catch (err) {
              setBookError(err instanceof ApiError ? err.message : 'Could not create this Booking.');
            }
          }}
        />
      ) : null}
    </Modal>
  );
}

function BookingForm({
  occurrence,
  dateLabel,
  students,
  instructors,
  studentId,
  setStudentId,
  bookError,
  submitting,
  onClose,
  onConfirm,
}: {
  occurrence: { id: string; title: string; instructorId?: string | null; startDate: string; endDate: string };
  dateLabel: string;
  students: StudentSummary[];
  instructors: InstructorResponse[];
  studentId: string;
  setStudentId: (id: string) => void;
  bookError: string | null;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const instructor = instructors.find((i) => i.userId === occurrence.instructorId);
  const timings = `${new Date(occurrence.startDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(
    occurrence.endDate,
  ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <>
      {bookError ? <ErrorBanner message={bookError} /> : null}

      <Field label="Student" htmlFor="booking-student" hint="Required — the dialog won't Confirm without one.">
        <SelectField
          id="booking-student"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          options={[
            { value: '', label: 'Select a Student…' },
            ...students.map((s) => ({ value: s.id, label: `${s.firstName} ${s.surname}`.trim() })),
          ]}
        />
      </Field>

      <div className="ultm8-field">
        <span className="ultm8-field__label">Class</span>
        <p style={{ margin: '4px 0 0' }}>{occurrence.title}</p>
      </div>

      <div className="ultm8-field">
        <span className="ultm8-field__label">Instructor</span>
        <p style={{ margin: '4px 0 0' }}>
          {instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : '—'}
        </p>
      </div>

      <div className="ultm8-field">
        <span className="ultm8-field__label">Class Timings</span>
        <p style={{ margin: '4px 0 0' }}>{timings}</p>
      </div>

      <div className="ultm8-field">
        <span className="ultm8-field__label">Class Date</span>
        <p style={{ margin: '4px 0 0' }}>{dateLabel}</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={!studentId} loading={submitting}>
          Confirm
        </Button>
      </div>
    </>
  );
}
