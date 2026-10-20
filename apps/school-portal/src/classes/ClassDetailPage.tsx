import React from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from './classQueries';
import { useClassBookings, type BookingResponse } from '../bookings/bookingQueries';
import { useClassWaitlist, type WaitlistEntryResponse } from '../waitlist/waitlistQueries';
import { titleCase } from '../lib/text';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

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
      />

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
