import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from '../classes/classQueries';
import { useClassBookings, type BookingResponse } from '../bookings/bookingQueries';
import { useInstructorScan } from './attendanceQueries';
import { QrScanModal } from './QrScanModal';
import { useT, type TranslateFn, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useClassZone } from '../classes/useClassZone';
import { formatInZone } from '../lib/datetime';
import { useRosterStudents, useRosters } from '../students/rosterQueries';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import '../schedule/schedule.css';
import '../classes/classDetail.css';
import './attendanceLook.css';

/** Instructor roll-call (Decision 71's named concept; mechanics shipped Phase
 * 51/Decision 107 as `POST /classes/{id}/attendance-scan`) — the client half
 * of that endpoint, never built until now (confirmed directly: no
 * `instructorScan`/`attendance-scan` reference anywhere in apps/school-portal
 * before this). Reached via a per-Class "Roll call" action on ClassesPage,
 * the same pattern "Show QR"/"View bookings" already establish — not a new
 * top-level nav item.
 *
 * Shows every Booking for this Class via the already-existing
 * `GET /classes/{id}/bookings` (no backend change needed here — this is a
 * client-only slice against an already-complete contract, same shape the
 * Waiver drawn-signature-capture UI slice just established). Each UPCOMING
 * row offers both of Decision 107's two modes: "Scan" (camera, opens
 * QrScanModal, records `INSTRUCTOR_SCAN`) and "Confirm present" (no camera,
 * records `INSTRUCTOR_MANUAL` — the deliberate fallback for a Student whose
 * camera-tier consent is withdrawn, or who has an accessibility need). Both
 * call the identical `useInstructorScan` mutation; only the presence of a
 * decoded `studentToken` differs. */
export function RollCallPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const classId = id ?? null;
  const { data: cls, isLoading: classLoading, error: classError } = useClass(classId);
  const { data: bookingData, isLoading: bookingsLoading, error: bookingsError } = useClassBookings(classId);
  const instructorScan = useInstructorScan(classId ?? '');
  const [scanningStudentId, setScanningStudentId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ studentId: string; message: string } | null>(null);
  // Decision 317 item 6: take attendance for one roster's students.
  const [rosterFilter, setRosterFilter] = useState('');
  const rosters = useRosters(cls?.schoolId ?? null);
  const rosterMembers = useRosterStudents(cls?.schoolId ?? null, rosterFilter || null);
  const onRoster = useMemo(() => (rosterFilter ? new Set(rosterMembers.data?.studentIds ?? []) : null), [rosterFilter, rosterMembers.data]);
  // Times on the class's own clock (Decision 432 item 5).
  const zone = useClassZone(cls);

  if (!classId) return null;
  if (classLoading || bookingsLoading) return <Spinner />;
  if (classError) {
    return <ErrorBanner message={classError instanceof ApiError ? classError.message : t('attendance.rollCall.loadFailed')} />;
  }
  if (bookingsError) {
    return <ErrorBanner message={bookingsError instanceof ApiError ? bookingsError.message : t('attendance.rollCall.bookingsLoadFailed')} />;
  }

  const bookings = sortForRollCall(bookingData?.items ?? []).filter((b) => !onRoster || onRoster.has(b.studentId));
  const rosterItems = rosters.data?.items ?? [];

  function handleManualConfirm(studentId: string) {
    setRowError(null);
    instructorScan.mutate({ studentId }, { onError: (err) => setRowError({ studentId, message: errorMessage(err, t) }) });
  }

  function handleScanDecoded(studentId: string, studentToken: string) {
    setScanningStudentId(null);
    setRowError(null);
    instructorScan.mutate({ studentId, studentToken }, { onError: (err) => setRowError({ studentId, message: errorMessage(err, t) }) });
  }

  // New look (Decision 460 item 17): the shell's header, the class page's
  // white cards and tags, and our own drop-down for the roster. The rows, their
  // order and both check-in buttons are as before.
  return (
    <>
      <NewLookPageHeader
        parent={{ to: '/classes', label: t('layout.nav.classes') }}
        title={cls ? t('attendance.rollCall.titleWithClass', { title: cls.title }) : t('attendance.rollCall.title')}
        subtitle={cls ? `${formatInZone(cls.startDate, zone, formatLocale())} – ${formatInZone(cls.endDate, zone, formatLocale())}` : undefined}
      />
      <NewLookPage>
        {rosterItems.length > 0 ? (
          <section className="u8s-card u8cd-card u8at-filter">
            <div className="u8n-dd-field">
              <NewLookSelect
                id="roll-call-roster"
                label={t('attendance.rollCall.rosterLabel')}
                value={rosterFilter}
                onChange={setRosterFilter}
                aria-describedby="roll-call-roster-hint"
                options={[{ value: '', label: t('attendance.rollCall.rosterAll') }, ...rosterItems.map((r) => ({ value: r.id, label: r.name }))]}
              />
              <span id="roll-call-roster-hint" className="u8n-dd-field__hint">
                {t('attendance.rollCall.rosterHint')}
              </span>
            </div>
          </section>
        ) : null}
        <section className="u8s-card u8cd-card">
          {bookings.length === 0 ? (
            <div className="u8cd-card__note">
              <EmptyState title={t('attendance.rollCall.emptyTitle')} description={t('attendance.rollCall.emptyDescription')} />
            </div>
          ) : (
            <ul className="u8at-rows" data-testid="roll-call">
              {bookings.map((booking) => (
                <RollCallRow
                  key={booking.id}
                  booking={booking}
                  pending={instructorScan.isPending && instructorScan.variables?.studentId === booking.studentId}
                  error={rowError?.studentId === booking.studentId ? rowError.message : null}
                  onScan={() => setScanningStudentId(booking.studentId)}
                  onManualConfirm={() => handleManualConfirm(booking.studentId)}
                />
              ))}
            </ul>
          )}
        </section>
      </NewLookPage>

      {scanningStudentId ? (
        <QrScanModal
          onScan={(token) => handleScanDecoded(scanningStudentId, token)}
          onClose={() => setScanningStudentId(null)}
        />
      ) : null}
    </>
  );
}

/** Students still to check in first, then those already present, then
 * cancelled/no-show; alphabetical within each group (C2: the API returns
 * bookings in id order, which reads as random on a long roll call). */
const ROLL_CALL_ORDER: Record<string, number> = { UPCOMING: 0, COMPLETED: 1 };
function sortForRollCall(bookings: BookingResponse[]): BookingResponse[] {
  const name = (b: BookingResponse) => `${b.studentFirstName} ${b.studentSurname}`.trim().toLocaleLowerCase();
  return [...bookings].sort(
    (a, b) => (ROLL_CALL_ORDER[a.status] ?? 2) - (ROLL_CALL_ORDER[b.status] ?? 2) || name(a).localeCompare(name(b)),
  );
}

function errorMessage(err: unknown, t: TranslateFn): string {
  return err instanceof ApiError ? err.message : t('attendance.rollCall.checkInFailed');
}

const CHECK_IN_METHOD_LABEL: Record<string, TranslationKey> = {
  SELF_SERVICE: 'attendance.rollCall.methodSelfService',
  INSTRUCTOR_SCAN: 'attendance.rollCall.methodInstructorScan',
  INSTRUCTOR_MANUAL: 'attendance.rollCall.methodInstructorManual',
  PERSONAL_CODE: 'attendance.rollCall.methodPersonalCode',
};

/** Non-UPCOMING, non-COMPLETED statuses are shown as the raw enum value in
 * English; the label is still looked up so other locales can translate it. */
const BOOKING_STATUS_LABEL: Record<string, TranslationKey> = {
  CANCELLED: 'attendance.rollCall.statusCancelled',
  NO_SHOW: 'attendance.rollCall.statusNoShow',
};

function RollCallRow({
  booking,
  pending,
  error,
  onScan,
  onManualConfirm,
}: {
  booking: BookingResponse;
  pending: boolean;
  error: string | null;
  onScan: () => void;
  onManualConfirm: () => void;
}) {
  const t = useT();
  const name = `${booking.studentFirstName} ${booking.studentSurname}`.trim();
  const isUpcoming = booking.status === 'UPCOMING';
  const isCompleted = booking.status === 'COMPLETED';
  const statusKey = BOOKING_STATUS_LABEL[booking.status];
  const statusLabel = statusKey ? t(statusKey) : booking.status;

  return (
    <li className="u8at-row">
      <div className="u8at-row__who">
        <div className="u8at-row__name">{name || booking.studentId}</div>
        {isCompleted && booking.checkInMethod ? (
          <div className="u8at-row__sub">{CHECK_IN_METHOD_LABEL[booking.checkInMethod] ? t(CHECK_IN_METHOD_LABEL[booking.checkInMethod]!) : booking.checkInMethod}</div>
        ) : !isUpcoming ? (
          <div className="u8at-row__sub">{statusLabel}</div>
        ) : null}
        {error ? <p className="u8at-row__error">{error}</p> : null}
      </div>
      {isCompleted ? (
        <span className="u8s-tag u8s-tag--mint">{t('attendance.rollCall.present')}</span>
      ) : isUpcoming ? (
        <div className="u8at-row__buttons">
          <Button variant="secondary" onClick={onScan} disabled={pending}>
            {t('attendance.rollCall.scan')}
          </Button>
          <Button onClick={onManualConfirm} loading={pending} disabled={pending}>
            {t('attendance.rollCall.confirmPresent')}
          </Button>
        </div>
      ) : (
        <span className="u8s-tag">{statusLabel}</span>
      )}
    </li>
  );
}
