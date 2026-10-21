import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from './classQueries';
import { useClassBookings, type BookingResponse } from '../bookings/bookingQueries';
import { useClassWaitlist, type WaitlistEntryResponse } from '../waitlist/waitlistQueries';
import { titleCase } from '../lib/text';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useCancelClass } from '../cancellations/cancellationQueries';

/** Decision 279 — the School cancels this whole class: every booking is
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
 * pattern as TransactionsPage). No write actions here yet (cancel/override-
 * reason/withdraw already exist as Student/self-service or override
 * endpoints — this phase is visibility only, matching TransactionsPage's own
 * "read-only first" scoping). */
export function ClassDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const classId = id ?? null;
  const { data: cls, isLoading: classLoading, error: classError } = useClass(classId);
  const { data: bookingData, isLoading: bookingsLoading, error: bookingsError } = useClassBookings(classId);
  const { data: waitlistData, isLoading: waitlistLoading, error: waitlistError } = useClassWaitlist(classId);
  const mayCancel = !!useOwnedSchoolId() || !!useCoachSchoolId();

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

  return (
    <>
      <PageHeader
        title={cls?.title ?? t('classes.detail.fallbackTitle')}
        subtitle={cls ? `${new Date(cls.startDate).toLocaleString(formatLocale())} – ${new Date(cls.endDate).toLocaleString(formatLocale())}` : undefined}
        actions={cls && mayCancel && !cls.cancelledAt && new Date(cls.endDate) > new Date() ? <CancelClassButton classId={cls.id} /> : undefined}
      />
      {cls?.cancelledAt ? (
        <div style={{ marginBottom: 16 }}>
          <Badge variant="danger">{t('classes.detail.cancelledBadge')}</Badge>
          {cls.cancellationReason ? <span style={{ marginLeft: 8 }}>{t('classes.detail.cancelledReason', { reason: cls.cancellationReason })}</span> : null}
        </div>
      ) : null}

      <div style={{ marginBottom: 24 }}>
        <Card>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
            {t('classes.detail.bookingsHeading')}
          </h2>
          {bookings.length === 0 ? (
            <EmptyState title={t('classes.detail.bookingsEmptyTitle')} description={t('classes.detail.bookingsEmptyDescription')} />
          ) : (
            <Table<BookingResponse>
              rows={bookings}
              columns={[
                { key: 'student', header: t('classes.detail.columnStudent'), render: (b) => (b.studentFirstName || b.studentSurname ? `${b.studentFirstName} ${b.studentSurname}`.trim() : b.studentId.slice(0, 8)) },
                { key: 'status', header: t('classes.detail.columnStatus'), render: (b) => bookingStatusBadge(b.status, t) },
                { key: 'attendees', header: t('classes.detail.columnAttendees'), render: (b) => b.attendees.length || '—' },
                { key: 'override', header: t('classes.detail.columnOverrideReason'), render: (b) => b.overrideReason ?? '—' },
                { key: 'createdAt', header: t('classes.detail.columnBooked'), render: (b) => new Date(b.createdAt).toLocaleString(formatLocale()) },
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
    </>
  );
}
