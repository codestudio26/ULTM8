import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from '../classes/classQueries';
import { useClassBookings, type BookingResponse } from '../bookings/bookingQueries';
import { useInstructorScan } from './attendanceQueries';
import { QrScanModal } from './QrScanModal';

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
    return <ErrorBanner message={classError instanceof ApiError ? classError.message : 'Could not load this Class.'} />;
  }
  if (bookingsError) {
    return <ErrorBanner message={bookingsError instanceof ApiError ? bookingsError.message : 'Could not load this Class’s bookings.'} />;
  }

  const bookings = bookingData?.items ?? [];

  function handleManualConfirm(studentId: string) {
    setRowError(null);
    instructorScan.mutate({ studentId }, { onError: (err) => setRowError({ studentId, message: errorMessage(err) }) });
  }

  function handleScanDecoded(studentId: string, studentToken: string) {
    setScanningStudentId(null);
    setRowError(null);
    instructorScan.mutate({ studentId, studentToken }, { onError: (err) => setRowError({ studentId, message: errorMessage(err) }) });
  }

  return (
    <>
      <PageHeader
        title={cls ? `Roll call — ${cls.title}` : 'Roll call'}
        subtitle={cls ? `${new Date(cls.startDate).toLocaleString()} – ${new Date(cls.endDate).toLocaleString()}` : undefined}
      />
      <Card>
        {bookings.length === 0 ? (
          <EmptyState title="No Bookings" description="Nobody is booked into this Class." />
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

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Could not check in this Student — please try again.';
}

const CHECK_IN_METHOD_LABEL: Record<string, string> = {
  SELF_SERVICE: 'Self check-in',
  INSTRUCTOR_SCAN: 'Scanned by you',
  INSTRUCTOR_MANUAL: 'Confirmed by you',
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
  const name = `${booking.studentFirstName} ${booking.studentSurname}`.trim();
  const isUpcoming = booking.status === 'UPCOMING';
  const isCompleted = booking.status === 'COMPLETED';

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
      <div>
        <div>{name || booking.studentId}</div>
        {isCompleted && booking.checkInMethod ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{CHECK_IN_METHOD_LABEL[booking.checkInMethod] ?? booking.checkInMethod}</div>
        ) : !isUpcoming ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{booking.status}</div>
        ) : null}
        {error ? <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: '4px 0 0' }}>{error}</p> : null}
      </div>
      {isCompleted ? (
        <Badge variant="success">Present ✓</Badge>
      ) : isUpcoming ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={onScan} disabled={pending}>
            Scan
          </Button>
          <Button onClick={onManualConfirm} loading={pending} disabled={pending}>
            Confirm present
          </Button>
        </div>
      ) : (
        <Badge variant="default">{booking.status}</Badge>
      )}
    </div>
  );
}
