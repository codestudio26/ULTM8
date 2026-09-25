import React from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from './classQueries';
import { useClassBookings, type BookingResponse } from '../bookings/bookingQueries';
import { useClassWaitlist, type WaitlistEntryResponse } from '../waitlist/waitlistQueries';
import { titleCase } from '../lib/text';

function bookingStatusBadge(status: string) {
  if (status === 'UPCOMING') return <Badge variant="success">Upcoming</Badge>;
  if (status === 'CANCELLED') return <Badge>Cancelled</Badge>;
  return <Badge variant="accent">{titleCase(status)}</Badge>;
}

function waitlistStatusBadge(status: string) {
  if (status === 'WAITING') return <Badge variant="accent">Waiting</Badge>;
  if (status === 'NOTIFIED') return <Badge variant="success">Notified</Badge>;
  if (status === 'CLAIMED') return <Badge variant="success">Claimed</Badge>;
  if (status === 'EXPIRED' || status === 'CANCELLED') return <Badge variant="danger">{titleCase(status)}</Badge>;
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
  const { id } = useParams<{ id: string }>();
  const classId = id ?? null;
  const { data: cls, isLoading: classLoading, error: classError } = useClass(classId);
  const { data: bookingData, isLoading: bookingsLoading, error: bookingsError } = useClassBookings(classId);
  const { data: waitlistData, isLoading: waitlistLoading, error: waitlistError } = useClassWaitlist(classId);

  if (!classId) return null;
  if (classLoading || bookingsLoading || waitlistLoading) return <Spinner />;
  if (classError) {
    return <ErrorBanner message={classError instanceof ApiError ? classError.message : 'Could not load this Class.'} />;
  }
  if (bookingsError) {
    return <ErrorBanner message={bookingsError instanceof ApiError ? bookingsError.message : 'Could not load Bookings.'} />;
  }
  if (waitlistError) {
    return <ErrorBanner message={waitlistError instanceof ApiError ? waitlistError.message : 'Could not load the Waitlist.'} />;
  }

  const bookings = bookingData?.items ?? [];
  const waitlist = waitlistData?.items ?? [];

  return (
    <>
      <PageHeader
        title={cls?.title ?? 'Class'}
        subtitle={cls ? `${new Date(cls.startDate).toLocaleString()} – ${new Date(cls.endDate).toLocaleString()}` : undefined}
      />

      <div style={{ marginBottom: 24 }}>
        <Card>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
            Bookings
          </h2>
          {bookings.length === 0 ? (
            <EmptyState title="No Bookings yet" description="Bookings appear here once Students start booking into this Class." />
          ) : (
            <Table<BookingResponse>
              rows={bookings}
              columns={[
                { key: 'student', header: 'Student', render: (b) => (b.studentFirstName || b.studentSurname ? `${b.studentFirstName} ${b.studentSurname}`.trim() : b.studentId.slice(0, 8)) },
                { key: 'status', header: 'Status', render: (b) => bookingStatusBadge(b.status) },
                { key: 'attendees', header: 'Attendees', render: (b) => b.attendees.length || '—' },
                { key: 'override', header: 'Override reason', render: (b) => b.overrideReason ?? '—' },
                { key: 'createdAt', header: 'Booked', render: (b) => new Date(b.createdAt).toLocaleString() },
              ]}
            />
          )}
        </Card>
      </div>

      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
          Waitlist
        </h2>
        {waitlist.length === 0 ? (
          <EmptyState title="No one on the Waitlist" description="Students who join the waitlist once this Class fills up will appear here." />
        ) : (
          <Table<WaitlistEntryResponse>
            rows={waitlist}
            columns={[
              { key: 'position', header: '#', render: (e) => e.position },
              { key: 'student', header: 'Student', render: (e) => (e.studentFirstName || e.studentSurname ? `${e.studentFirstName} ${e.studentSurname}`.trim() : e.studentId.slice(0, 8)) },
              { key: 'status', header: 'Status', render: (e) => waitlistStatusBadge(e.status) },
              { key: 'joinedAt', header: 'Joined', render: (e) => new Date(e.joinedAt).toLocaleString() },
              { key: 'claimBy', header: 'Claim by', render: (e) => (e.claimByDeadline ? new Date(e.claimByDeadline).toLocaleString() : '—') },
            ]}
          />
        )}
      </Card>
    </>
  );
}
