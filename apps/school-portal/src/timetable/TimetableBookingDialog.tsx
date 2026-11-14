import React, { useState } from 'react';
import { Button, ErrorBanner, Modal, ModalActions, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { StudentSummary } from '../students/studentQueries';
import type { InstructorResponse } from '../instructors/instructorQueries';
import { useBookClass } from '../bookings/bookingQueries';
import { useJoinWaitlist } from '../waitlist/waitlistQueries';
import { useClass } from '../classes/classQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useClassZone } from '../classes/useClassZone';
import { endsNextDayInZone, formatTimeInZone } from '../lib/datetime';
import { whoCanBookLabel } from '../classes/WhoCanBookFields';
import { StudentPickerField } from '../students/StudentPickerField';
import '../classes/classForms.css';

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
  classId,
  title,
  date,
  students,
  instructors,
  onClose,
  onBooked,
  onWaitlisted,
}: {
  /** The real Class picked on the calendar (Decision 353, T7). */
  classId: string;
  title: string;
  date: string;
  students: StudentSummary[];
  instructors: InstructorResponse[];
  onClose: () => void;
  onBooked: () => void;
  onWaitlisted: (position: number) => void;
}) {
  const t = useT();
  const occurrence = useClass(classId);
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
    <Modal title={t('timetable.booking.title', { title })} onClose={onClose}>
      {occurrence.isLoading ? (
        <Spinner />
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
          <ModalActions>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('timetable.booking.close')}
            </Button>
          </ModalActions>
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
  occurrence: {
    id: string;
    schoolId: string;
    branchId?: string | null;
    title: string;
    instructorId?: string | null;
    startDate: string;
    endDate: string;
    breakStartAt?: string | null;
    breakEndAt?: string | null;
    audience?: 'EVERYONE' | 'WOMEN' | 'MEN';
    minAge?: number | null;
    maxAge?: number | null;
  };
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
  // On the class's own clock, not the browser's (Decision 432 item 5); a
  // class past midnight says so (item 3).
  const zone = useClassZone(occurrence);
  const timeOf = (iso: string) => formatTimeInZone(iso, zone, formatLocale());
  const timings =
    `${timeOf(occurrence.startDate)} – ${timeOf(occurrence.endDate)}` +
    (endsNextDayInZone(occurrence.startDate, occurrence.endDate, zone) ? ` (${t('timetable.endsNextDayShort')})` : '') +
    (whoCanBookLabel(occurrence, t) ? ` · ${whoCanBookLabel(occurrence, t)}` : '');
  // Decision 353 (Q6): the break is shown with the class details only.
  const breakLine = occurrence.breakStartAt && occurrence.breakEndAt ? t('timetable.booking.breakLine', { start: timeOf(occurrence.breakStartAt), end: timeOf(occurrence.breakEndAt) }) : null;

  return (
    <>
      {bookError ? <ErrorBanner message={bookError} /> : null}

      <StudentPickerField
        id="booking-student"
        label={t('timetable.booking.studentLabel')}
        emptyLabel={t('timetable.booking.selectStudent')}
        hint={t('timetable.booking.studentHint')}
        students={students}
        value={studentId}
        onChange={setStudentId}
      />

      {/* The class's details, read-only, in the calm grey card. */}
      <dl className="u8cf-facts">
        <div className="u8cf-facts__row">
          <dt>{t('timetable.booking.classLabel')}</dt>
          <dd>{occurrence.title}</dd>
        </div>
        <div className="u8cf-facts__row">
          <dt>{t('timetable.booking.instructorLabel')}</dt>
          <dd>{instructor ? `${instructor.firstName} ${instructor.surname}`.trim() : '—'}</dd>
        </div>
        <div className="u8cf-facts__row">
          <dt>{t('timetable.booking.timingsLabel')}</dt>
          <dd>
            {timings}
            {breakLine ? <span className="u8cf-facts__sub">{breakLine}</span> : null}
          </dd>
        </div>
        <div className="u8cf-facts__row">
          <dt>{t('timetable.booking.dateLabel')}</dt>
          <dd>{dateLabel}</dd>
        </div>
      </dl>

      <ModalActions>
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
          {t('common.cancel')}
        </Button>
        {full ? (
          <Button type="button" onClick={onJoinWaitlist} disabled={!studentId} loading={submitting}>
            {t('timetable.booking.addToWaitlist')}
          </Button>
        ) : (
          <Button type="button" onClick={onConfirm} disabled={!studentId} loading={submitting}>
            {t('timetable.booking.confirm')}
          </Button>
        )}
      </ModalActions>
    </>
  );
}
