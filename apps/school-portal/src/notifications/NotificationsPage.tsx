import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useMarkNotificationRead, useNotificationCounts, useNotifications, type NotificationResponse } from './notificationQueries';

/** Small, page-local summary tile — same shape/style as TransactionsPage's and
 * MembershipPlansPage's own `StatTile` (not promoted to @ultm8/ui yet, per
 * TransactionsPage's own header comment on why three occurrences still isn't
 * worth it). No `proposed` placeholder variant here: Total/Unread are both
 * real, backed by the dedicated `GET /notifications/me/counts` endpoint —
 * see useNotificationCounts's own header comment. */
function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '14px 18px',
        background: 'var(--surface-0)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

/** The logged-in User's own notification inbox — every School Owner/Manager,
 * Branch Staff, or Instructor using this portal has one, same as a Student
 * would in the mobile app (GET /notifications/me is not School-scoped). List
 * + mark-read only — no device-token registration here (see
 * notificationQueries.ts's own header comment on why). */
export function NotificationsPage() {
  const { data, isLoading, error } = useNotifications();
  // v1.2 backend backlog (Decision 204's Concept 5 finding) — a SEPARATE
  // query against the new dedicated counts endpoint, deliberately NOT
  // `data.items.length`/`.filter(n => !n.read).length` over the list above:
  // that list is only one page of the caller's notifications (resolveLimit's
  // default/max, cursor-paginate.ts), so a client-side derivation would
  // silently under-count the moment a caller has more notifications than fit
  // on one page — the exact gap this endpoint exists to close.
  const counts = useNotificationCounts();
  const markRead = useMarkNotificationRead();
  const [markReadError, setMarkReadError] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Notifications.'} />;

  const notifications = data?.items ?? [];

  async function handleMarkRead(id: string) {
    setMarkReadError(null);
    try {
      await markRead.mutateAsync(id);
    } catch (err) {
      setMarkReadError(err instanceof ApiError ? err.message : 'Could not mark this notification as read — please try again.');
    }
  }

  return (
    <>
      <PageHeader title="Notifications" subtitle="Updates sent to your own account." />

      {/* Stats ribbon (v1.2 backend backlog, Decision 204's Concept 5 finding:
          "Total/Unread are real but page-scoped (no count endpoint exists to
          total across every page)") — both tiles are real, backed by the new
          GET /notifications/me/counts endpoint, not the page-local `notifications`
          list below. A failed counts fetch degrades to an em dash rather than
          blocking the whole page — the list is still perfectly usable without it. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Total" value={counts.isLoading ? <Spinner /> : counts.error ? '—' : counts.data!.total} />
        <StatTile label="Unread" value={counts.isLoading ? <Spinner /> : counts.error ? '—' : counts.data!.unread} />
      </div>

      {markReadError ? <ErrorBanner message={markReadError} /> : null}
      <Card>
        {notifications.length === 0 ? (
          <EmptyState title="No notifications yet" description="You're all caught up." />
        ) : (
          <Table<NotificationResponse>
            rows={notifications}
            columns={[
              {
                key: 'status',
                header: '',
                render: (n) => (n.read ? <Badge>Read</Badge> : <Badge variant="accent">New</Badge>),
              },
              { key: 'title', header: 'Title', render: (n) => n.title },
              { key: 'body', header: 'Message', render: (n) => n.body },
              { key: 'createdAt', header: 'Received', render: (n) => new Date(n.createdAt).toLocaleString() },
              {
                key: 'actions',
                header: '',
                render: (n) =>
                  n.read ? null : (
                    // FOUND ON REVIEW: this Button used to pass the single
                    // shared `markRead.isPending`, which put EVERY unread
                    // row's button into a loading+disabled state whenever
                    // any one of them was mutating (`markRead.variables`
                    // — react-query's own record of the last-called
                    // mutate() argument — scopes it back down to just the
                    // row actually in flight). Also now goes through
                    // handleMarkRead so a failed PATCH surfaces an
                    // ErrorBanner instead of silently doing nothing,
                    // matching WaiverFormModal's own established
                    // try/catch-into-ErrorBanner convention.
                    <Button
                      variant="secondary"
                      loading={markRead.isPending && markRead.variables === n.id}
                      onClick={() => handleMarkRead(n.id)}
                    >
                      Mark read
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
