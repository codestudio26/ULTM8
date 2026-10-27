import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { StudentSummary } from '../students/studentQueries';
import type { InstructorResponse } from '../instructors/instructorQueries';
import { useBookClass } from '../bookings/bookingQueries';
import { useJoinWaitlist } from '../waitlist/waitlistQueries';
import { useTimetableOccurrence } from './timetableQueries';
import { useT } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';
import { formatLocale } from '../i18n/format';

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
  onWaitlisted,
}: {
  slotId: string;
  slotTitle: string;
  date: string;
  students: StudentSummary[];
  instructors: InstructorResponse[];
  onClose: () => void;
  onBooked: () => void;
  onWaitlisted: (position: number) => void;
}) {
  const t = useT();
  const occurrence = useTimetableOccurrence(slotId, date);
  const bookClass = useBookClass();
  const joinWaitlist = useJoinWaitlist();
  const [studentId, setStudentId] = useState('');
  const [bookError, setBookError] = useState<string | null>(null);
  // Set when the API says the Class is full (or Students are already queued):
  // the next step is the waitlist, not another Confirm (Decision 322).
  const [full, setFull] = useState(false);

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(formatLocale(), {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Modal title={t('timetable.booking.title', { title: slotTitle })} onClose={onClose}>
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
            <Trans
              k="timetable.booking.notBookable"
              vars={{ date: dateLabel }}
              nodes={{ notBookableTitle: <strong>{t('timetable.booking.notBookableTitle')}</strong> }}
            />
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={onClose}>
              {t('timetable.booking.close')}
            </Button>
          </div>
        </>
      ) : occurrence.error ? (
        <ErrorBanner
          message={occurrence.error instanceof ApiError ? occurrence.error.message : t('timetable.booking.loadFailed')}
        />
      ) : occurrence.data && (occurrence.data.cancelledAt || occurrence.data.archivedAt || new Date(occurrence.data.endDate) < new Date()) ? (
        // Decision 332, T13 — a cancelled or finished Class can't take a booking;
        // say so instead of offering a Confirm the API would refuse. Decision 291:
        // one the School cancelled outright says so, with its reason.
        <>
          {occurrence.data.cancelledAt ? (
            <p>
              <strong>{t('classes.detail.cancelledBadge')}</strong>
              {occurrence.data.cancellationReason ? ` — ${t('classes.detail.cancelledReason', { reason: occurrence.data.cancellationReason })}` : null}
            </p>
          ) : (
            <p>{t(occurrence.data.archivedAt ? 'timetable.booking.cancelled' : 'timetable.booking.ended')}</p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={onClose}>
              {t('timetable.booking.close')}
            </Button>
          </div>
        </>
      ) : occurrence.data ? (
        <BookingForm
          occurrence={occurrence.data}
          dateLabel={dateLabel}
          students={students}
          instructors={instructors}
          studentId={studentId}
          setStudentId={(id) => {
            setStudentId(id);
            setFull(false);
            setBookError(null);
          }}
          bookError={bookError}
          full={full}
          submitting={bookClass.isPending || joinWaitlist.isPending}
          onClose={onClose}
          onConfirm={async () => {
            setBookError(null);
            try {
              await bookClass.mutateAsync({ classId: occurrence.data!.id, body: { studentId } });
              onBooked();
            } catch (err) {
              if (err instanceof ApiError && (err.code === 'CLASS_FULL' || err.code === 'WAITLIST_FIRST')) setFull(true);
              setBookError(err instanceof ApiError ? err.message : t('timetable.booking.bookFailed'));
            }
          }}
          onJoinWaitlist={async () => {
            setBookError(null);
            try {
              const entry = await joinWaitlist.mutateAsync({ classId: occurrence.data!.id, studentId });
              onWaitlisted(entry.position);
            } catch (err) {
              setBookError(err instanceof ApiError ? err.message : t('timetable.booking.waitlistFailed'));
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
  full,
  submitting,
  onClose,
  onConfirm,
  onJoinWaitlist,
}: {
  occurrence: { id: string; title: string; instructorId?: string | null; startDate: string; endDate: string };
  dateLabel: string;
  students: StudentSummary[];
  instructors: InstructorResponse[];
  studentId: string;
  setStudentId: (id: string) => void;
  bookError: string | null;
  full: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onJoinWaitlist: () => void;
}) {
  const t = useT();
  const instructor = instructors.find((i) => i.userId === occurrence.instructorId);
  const timings = `${new Date(occurrence.startDate).toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit' })} – ${new Date(
    occurrence.endDate,
  ).toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <>
      {bookError ? <ErrorBanner message={bookError} /> : null}

      <Field label={t('timetable.booking.studentLabel')} htmlFor="booking-student" hint={t('timetable.booking.studentHint')}>
        <SelectField
          id="booking-student"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          options={[
            { value: '', label: t('timetable.booking.selectStudent') },
            ...students.map((s) => ({ value: s.id, label: `${s.firstName} ${s.surname}`.trim() })),
          ]}
        />
      </Field>

      <div className="ultm8-field">
        <span className="ultm8-field__label">{t('timetable.booking.classLabel')}</span>
        <p style={{ margin: '4px 0 0' }}>{occurrence.title}</p>
      </div>

      <div className="ultm8-field">
        <span className="ultm8-field__label">{t('timetable.booking.instructorLabel')}</span>
        <p style={{ margin: '4px 0 0' }}>
          {instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : '—'}
        </p>
      </div>

      <div className="ultm8-field">
        <span className="ultm8-field__label">{t('timetable.booking.timingsLabel')}</span>
        <p style={{ margin: '4px 0 0' }}>{timings}</p>
      </div>

      <div className="ultm8-field">
        <span className="ultm8-field__label">{t('timetable.booking.dateLabel')}</span>
        <p style={{ margin: '4px 0 0' }}>{dateLabel}</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t('common.cancel')}
        </Button>
        {full ? (
          <Button onClick={onJoinWaitlist} disabled={!studentId} loading={submitting}>
            {t('timetable.booking.addToWaitlist')}
          </Button>
        ) : (
          <Button onClick={onConfirm} disabled={!studentId} loading={submitting}>
            {t('timetable.booking.confirm')}
          </Button>
        )}
      </div>
    </>
  );
}
