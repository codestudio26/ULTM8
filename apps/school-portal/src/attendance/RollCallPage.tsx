import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from '../classes/classQueries';
import { useClassBookings, type BookingResponse } from '../bookings/bookingQueries';
import { useInstructorScan } from './attendanceQueries';
import { QrScanModal } from './QrScanModal';
import { useT, type TranslateFn, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

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

  if (!classId) return null;
  if (classLoading || bookingsLoading) return <Spinner />;
  if (classError) {
    return <ErrorBanner message={classError instanceof ApiError ? classError.message : t('attendance.rollCall.loadFailed')} />;
  }
  if (bookingsError) {
    return <ErrorBanner message={bookingsError instanceof ApiError ? bookingsError.message : t('attendance.rollCall.bookingsLoadFailed')} />;
  }

  const bookings = bookingData?.items ?? [];

  function handleManualConfirm(studentId: string) {
    setRowError(null);
    instructorScan.mutate({ studentId }, { onError: (err) => setRowError({ studentId, message: errorMessage(err, t) }) });
  }

  function handleScanDecoded(studentId: string, studentToken: string) {
    setScanningStudentId(null);
    setRowError(null);
    instructorScan.mutate({ studentId, studentToken }, { onError: (err) => setRowError({ studentId, message: errorMessage(err, t) }) });
  }

  return (
    <>
      <PageHeader
        title={cls ? t('attendance.rollCall.titleWithClass', { title: cls.title }) : t('attendance.rollCall.title')}
        subtitle={cls ? `${new Date(cls.startDate).toLocaleString(formatLocale())} – ${new Date(cls.endDate).toLocaleString(formatLocale())}` : undefined}
      />
      <Card>
        {bookings.length === 0 ? (
          <EmptyState title={t('attendance.rollCall.emptyTitle')} description={t('attendance.rollCall.emptyDescription')} />
        ) : (
          bookings.map((booking) => (
            <RollCallRow
              key={booking.id}
              booking={booking}
              pending={instructorScan.isPending && instructorScan.variables?.studentId === booking.studentId}
              error={rowError?.studentId === booking.studentId ? rowError.message : null}
              onScan={() => setScanningStudentId(booking.studentId)}
              onManualConfirm={() => handleManualConfirm(booking.studentId)}
            />
          ))
        )}
      </Card>

      {scanningStudentId ? (
        <QrScanModal
          onScan={(token) => handleScanDecoded(scanningStudentId, token)}
          onClose={() => setScanningStudentId(null)}
        />
      ) : null}
    </>
  );
}

function errorMessage(err: unknown, t: TranslateFn): string {
  return err instanceof ApiError ? err.message : t('attendance.rollCall.checkInFailed');
}

const CHECK_IN_METHOD_LABEL: Record<string, TranslationKey> = {
  SELF_SERVICE: 'attendance.rollCall.methodSelfService',
  INSTRUCTOR_SCAN: 'attendance.rollCall.methodInstructorScan',
  INSTRUCTOR_MANUAL: 'attendance.rollCall.methodInstructorManual',
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
      <div>
        <div>{name || booking.studentId}</div>
        {isCompleted && booking.checkInMethod ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{CHECK_IN_METHOD_LABEL[booking.checkInMethod] ? t(CHECK_IN_METHOD_LABEL[booking.checkInMethod]!) : booking.checkInMethod}</div>
        ) : !isUpcoming ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{statusLabel}</div>
        ) : null}
        {error ? <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: '4px 0 0' }}>{error}</p> : null}
      </div>
      {isCompleted ? (
        <Badge variant="success">{t('attendance.rollCall.present')}</Badge>
      ) : isUpcoming ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={onScan} disabled={pending}>
            {t('attendance.rollCall.scan')}
          </Button>
          <Button onClick={onManualConfirm} loading={pending} disabled={pending}>
            {t('attendance.rollCall.confirmPresent')}
          </Button>
        </div>
      ) : (
        <Badge variant="default">{statusLabel}</Badge>
      )}
    </div>
  );
}
