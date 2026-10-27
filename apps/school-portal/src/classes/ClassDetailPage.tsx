import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, SelectField, Spinner, SuccessBanner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from './classQueries';
import { useBookClass, useCancelBooking, useClassBookings, type BookingResponse } from '../bookings/bookingQueries';
import { useClassWaitlist, useJoinWaitlist, type WaitlistEntryResponse } from '../waitlist/waitlistQueries';
import { useStudents } from '../students/studentQueries';
import { titleCase } from '../lib/text';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useCancelClass } from '../cancellations/cancellationQueries';

/** Decision 291 — the School cancels this whole class: every booking is
 * resolved by the School's "When the school cancels a whole class" setting,
 * the waitlist is closed, and everyone booked or waiting is notified with the
 * reason. Owner/Manager or Branch Staff (the API re-checks, and refuses
 * Instructors). */
function CancelClassButton({ classId }: { classId: string }) {
  const t = useT();
  const cancelClass = useCancelClass(classId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      await cancelClass.mutateAsync(reason);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t('classes.detail.cancelClass')}
      </Button>
      {open ? (
        <Modal title={t('classes.detail.cancelClassTitle')} onClose={() => setOpen(false)}>
          <p style={{ marginTop: 0 }}>{t('classes.detail.cancelClassBody')}</p>
          {error ? <ErrorBanner message={error} /> : null}
          <Field label={t('classes.detail.cancelReasonLabel')} htmlFor="cancel-class-reason" hint={t('classes.detail.cancelReasonHint')}>
            <TextField id="cancel-class-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('classes.detail.cancelClassBack')}
            </Button>
            <Button variant="danger" loading={cancelClass.isPending} onClick={confirm}>
              {t('classes.detail.cancelClassConfirm')}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const fullName = (p: { studentFirstName?: string | null; studentSurname?: string | null; studentId: string }) =>
  p.studentFirstName || p.studentSurname ? `${p.studentFirstName ?? ''} ${p.studentSurname ?? ''}`.trim() : p.studentId.slice(0, 8);

/** Staff book a Student into this class (POST /classes/:id/book with
 * `studentId`), paid from the Student's own membership exactly as if they had
 * booked it themselves. When the class is full, or students are already
 * waiting, the next step is the waitlist instead (Decision 322). */
function AddStudentDialog({
  classId,
  schoolId,
  bookedIds,
  onClose,
  onDone,
}: {
  classId: string;
  schoolId: string;
  bookedIds: Set<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const { data: studentData, isLoading } = useStudents(schoolId);
  const bookClass = useBookClass();
  const joinWaitlist = useJoinWaitlist();
  const [studentId, setStudentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const students = (studentData?.items ?? []).filter((s) => !bookedIds.has(s.id));
  const name = (() => {
    const s = students.find((x) => x.id === studentId);
    return s ? `${s.firstName} ${s.surname}`.trim() : '';
  })();

  async function book() {
    setError(null);
    try {
      await bookClass.mutateAsync({ classId, body: { studentId } });
      onDone(t('classes.detail.addStudentBooked', { name }));
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'CLASS_FULL' || err.code === 'WAITLIST_FIRST')) setFull(true);
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  async function waitlist() {
    setError(null);
    try {
      const entry = await joinWaitlist.mutateAsync({ classId, studentId });
      onDone(t('classes.detail.addStudentWaitlisted', { name, position: entry.position }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('classes.detail.addStudentTitle')} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{t('classes.detail.addStudentBody')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? (
        <Spinner />
      ) : (
        <Field label={t('classes.detail.addStudentLabel')} htmlFor="add-student">
          <SelectField
            id="add-student"
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              setFull(false);
              setError(null);
            }}
            options={[
              { value: '', label: t('classes.detail.addStudentSelect') },
              ...students.map((s) => ({ value: s.id, label: `${s.firstName} ${s.surname}`.trim() })),
            ]}
          />
        </Field>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {full ? (
          <Button onClick={waitlist} disabled={!studentId} loading={joinWaitlist.isPending}>
            {t('classes.detail.addStudentWaitlist')}
          </Button>
        ) : (
          <Button onClick={book} disabled={!studentId} loading={bookClass.isPending}>
            {t('classes.detail.addStudentConfirm')}
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** Staff cancel one Booking (PATCH /bookings/:id/cancel). What goes back is
 * the School's (or Branch's) cancellation settings, decided server-side; a
 * refund by anyone but an Owner/Manager waits on the Cancellations page. */
function CancelBookingDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: BookingResponse;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const cancelBooking = useCancelBooking(booking.classId);
  const [error, setError] = useState<string | null>(null);
  const name = fullName(booking);

  async function confirm() {
    setError(null);
    try {
      await cancelBooking.mutateAsync(booking.id);
      onDone(t('classes.detail.cancelBookingDone', { name }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('classes.detail.cancelBookingTitle', { name })} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{t('classes.detail.cancelBookingBody')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>
          {t('classes.detail.cancelBookingBack')}
        </Button>
        <Button variant="danger" loading={cancelBooking.isPending} onClick={confirm}>
          {t('classes.detail.cancelBookingConfirm')}
        </Button>
      </div>
    </Modal>
  );
}

function bookingStatusBadge(status: string, t: TranslateFn) {
  if (status === 'UPCOMING') return <Badge variant="success">{t('classes.detail.bookingUpcoming')}</Badge>;
  if (status === 'CANCELLED') return <Badge>{t('classes.detail.bookingCancelled')}</Badge>;
  if (status === 'COMPLETED') return <Badge variant="accent">{t('classes.detail.bookingCompleted')}</Badge>;
  if (status === 'NO_SHOW') return <Badge variant="accent">{t('classes.detail.bookingNoShow')}</Badge>;
  return <Badge variant="accent">{titleCase(status)}</Badge>;
}

function waitlistStatusBadge(status: string, t: TranslateFn) {
  if (status === 'WAITING') return <Badge variant="accent">{t('classes.detail.waitlistWaiting')}</Badge>;
  if (status === 'NOTIFIED') return <Badge variant="success">{t('classes.detail.waitlistNotified')}</Badge>;
  if (status === 'CLAIMED') return <Badge variant="success">{t('classes.detail.waitlistClaimed')}</Badge>;
  if (status === 'EXPIRED') return <Badge variant="danger">{t('classes.detail.waitlistExpired')}</Badge>;
  if (status === 'CANCELLED') return <Badge variant="danger">{t('classes.detail.waitlistCancelled')}</Badge>;
  return <Badge>{titleCase(status)}</Badge>;
}

/** Read-only Booking/Waitlist admin view for one Class — reached via a "View
 * bookings" link from ClassesPage's own table. Both GET endpoints this page
 * depends on (`/classes/:id/bookings`, `/classes/:id/waitlist`) are new this
 * phase — see their own service methods' header comments for why they never
 * existed before despite the RLS policies already anticipating them. Student
 * names resolve via studentFirstName/studentSurname (Decision 114, same
 * pattern as TransactionsPage). Staff can Add student and Cancel booking
 * while the class is still open (not cancelled, archived or ended); the API
 * re-checks every rule. */
export function ClassDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const classId = id ?? null;
  const { data: cls, isLoading: classLoading, error: classError } = useClass(classId);
  const { data: bookingData, isLoading: bookingsLoading, error: bookingsError } = useClassBookings(classId);
  const { data: waitlistData, isLoading: waitlistLoading, error: waitlistError } = useClassWaitlist(classId);
  const mayCancel = !!useOwnedSchoolId() || !!useCoachSchoolId();
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<BookingResponse | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!classId) return null;
  if (classLoading || bookingsLoading || waitlistLoading) return <Spinner />;
  if (classError) {
    return <ErrorBanner message={classError instanceof ApiError ? classError.message : t('classes.detail.loadFailed')} />;
  }
  if (bookingsError) {
    return <ErrorBanner message={bookingsError instanceof ApiError ? bookingsError.message : t('classes.detail.bookingsLoadFailed')} />;
  }
  if (waitlistError) {
    return <ErrorBanner message={waitlistError instanceof ApiError ? waitlistError.message : t('classes.detail.waitlistLoadFailed')} />;
  }

  const bookings = bookingData?.items ?? [];
  const waitlist = waitlistData?.items ?? [];
  // Bookings change only while the class is still open: not cancelled,
  // archived or over (the API refuses the rest anyway).
  const open = !!cls && mayCancel && !cls.cancelledAt && !cls.archivedAt && new Date(cls.endDate) > new Date();
  const booked = new Set(bookings.filter((b) => b.status === 'UPCOMING').map((b) => b.studentId));
  const finish = (message: string) => {
    setAdding(false);
    setCancelling(null);
    setDone(message);
  };

  return (
    <>
      <PageHeader
        title={cls?.title ?? t('classes.detail.fallbackTitle')}
        subtitle={
          cls
            ? `${new Date(cls.startDate).toLocaleString(formatLocale())} – ${new Date(cls.endDate).toLocaleString(formatLocale())}` +
              // Decision 353 (Q6): the slot's break, shown on the class details only.
              (cls.breakStartAt && cls.breakEndAt
                ? ` · ${t('timetable.booking.breakLine', {
                    start: new Date(cls.breakStartAt).toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit' }),
                    end: new Date(cls.breakEndAt).toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit' }),
                  })}`
                : '')
            : undefined
        }
        actions={cls && mayCancel && !cls.cancelledAt && new Date(cls.endDate) > new Date() ? <CancelClassButton classId={cls.id} /> : undefined}
      />
      {done ? <SuccessBanner message={done} /> : null}
      {cls?.cancelledAt ? (
        <div style={{ marginBottom: 16 }}>
          <Badge variant="danger">{t('classes.detail.cancelledBadge')}</Badge>
          {cls.cancellationReason ? <span style={{ marginLeft: 8 }}>{t('classes.detail.cancelledReason', { reason: cls.cancellationReason })}</span> : null}
        </div>
      ) : null}

      <div style={{ marginBottom: 24 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
              {t('classes.detail.bookingsHeading')}
            </h2>
            {open ? (
              <Button
                onClick={() => {
                  setDone(null);
                  setAdding(true);
                }}
              >
                {t('classes.detail.addStudent')}
              </Button>
            ) : null}
          </div>
          {bookings.length === 0 ? (
            <EmptyState title={t('classes.detail.bookingsEmptyTitle')} description={t('classes.detail.bookingsEmptyDescription')} />
          ) : (
            <Table<BookingResponse>
              rows={bookings}
              columns={[
                { key: 'student', header: t('classes.detail.columnStudent'), render: (b) => fullName(b) },
                { key: 'status', header: t('classes.detail.columnStatus'), render: (b) => bookingStatusBadge(b.status, t) },
                { key: 'attendees', header: t('classes.detail.columnAttendees'), render: (b) => b.attendees.length || '—' },
                { key: 'override', header: t('classes.detail.columnOverrideReason'), render: (b) => b.overrideReason ?? '—' },
                { key: 'createdAt', header: t('classes.detail.columnBooked'), render: (b) => new Date(b.createdAt).toLocaleString(formatLocale()) },
                ...(open
                  ? [
                      {
                        key: 'actions',
                        header: t('classes.detail.columnActions'),
                        render: (b: BookingResponse) =>
                          b.status === 'UPCOMING' ? (
                            <Button
                              variant="secondary"
                              aria-label={t('classes.detail.cancelBookingFor', { name: fullName(b) })}
                              onClick={() => {
                                setDone(null);
                                setCancelling(b);
                              }}
                            >
                              {t('classes.detail.cancelBooking')}
                            </Button>
                          ) : null,
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Card>
      </div>

      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
          {t('classes.detail.waitlistHeading')}
        </h2>
        {waitlist.length === 0 ? (
          <EmptyState title={t('classes.detail.waitlistEmptyTitle')} description={t('classes.detail.waitlistEmptyDescription')} />
        ) : (
          <Table<WaitlistEntryResponse>
            rows={waitlist}
            columns={[
              { key: 'position', header: '#', render: (e) => e.position },
              { key: 'student', header: t('classes.detail.columnStudent'), render: (e) => (e.studentFirstName || e.studentSurname ? `${e.studentFirstName} ${e.studentSurname}`.trim() : e.studentId.slice(0, 8)) },
              { key: 'status', header: t('classes.detail.columnStatus'), render: (e) => waitlistStatusBadge(e.status, t) },
              { key: 'joinedAt', header: t('classes.detail.columnJoined'), render: (e) => new Date(e.joinedAt).toLocaleString(formatLocale()) },
              { key: 'claimBy', header: t('classes.detail.columnClaimBy'), render: (e) => (e.claimByDeadline ? new Date(e.claimByDeadline).toLocaleString(formatLocale()) : '—') },
            ]}
          />
        )}
      </Card>

      {adding && cls ? (
        <AddStudentDialog classId={cls.id} schoolId={cls.schoolId} bookedIds={booked} onClose={() => setAdding(false)} onDone={finish} />
      ) : null}
      {cancelling ? <CancelBookingDialog booking={cancelling} onClose={() => setCancelling(null)} onDone={finish} /> : null}
    </>
  );
}
