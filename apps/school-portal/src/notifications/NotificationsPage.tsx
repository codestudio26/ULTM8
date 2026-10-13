import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, RowActionsMenu, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches } from '../branches/branchQueries';
import { useClasses } from '../classes/classQueries';
import {
  useBroadcastNotification,
  useMarkNotificationRead,
  useNotificationCounts,
  useNotifications,
  useSnoozeNotification,
  type NotificationResponse,
} from './notificationQueries';
import { BroadcastNotificationModal } from './BroadcastNotificationModal';
import { SnoozeNotificationModal } from './SnoozeNotificationModal';

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

/** A Notification is "snoozed" exactly when `snoozedUntil` is set AND still
 * in the future — once it elapses, notification-unsnooze-sweep clears the
 * column (and getCountsForCaller's own live computation already treats it as
 * unread again even before that sweep next runs) — see
 * NotificationsService.getCountsForCaller's own header comment. Computed
 * client-side from the same field the list row already carries, not a
 * separate fetch. */
function isSnoozed(n: NotificationResponse): boolean {
  return !!n.snoozedUntil && new Date(n.snoozedUntil).getTime() > Date.now();
}

/** The logged-in User's own notification inbox — every School Owner/Manager,
 * Branch Staff, or Instructor using this portal has one, same as a Student
 * would in the mobile app (GET /notifications/me is not School-scoped).
 * Mark-read and Snooze (v1.2 backend backlog, approved by the product owner)
 * live in each row's action menu; Broadcast/compose (same backlog entry) is
 * a School-Owner-only PageHeader action, since the backend endpoint it calls
 * is School-Owner-gated — a Branch Staff/Instructor using this same page
 * never sees it (useOwnedSchoolId is null for them, same gate
 * WaiversPage/MembershipPlansPage's own "Add" actions already use). No
 * device-token registration here (see notificationQueries.ts's own header
 * comment on why). */
export function NotificationsPage() {
  const schoolId = useOwnedSchoolId();
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
  const snooze = useSnoozeNotification();
  const [actionError, setActionError] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState<NotificationResponse | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);

  // Broadcast's audience targeting (v1.2 backend backlog) needs the School's
  // Branch/Class lists for its own two scoped dropdowns — fetched here
  // (schoolId-gated, so a non-Owner never issues these requests at all) and
  // handed down to the modal, same "page owns the data, modal owns the form"
  // split BranchFormModal/ClassFormModal callers already use elsewhere.
  const branches = useBranches(schoolId);
  const classes = useClasses(schoolId);
  const broadcast = useBroadcastNotification(schoolId ?? '');

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Notifications.'} />;

  const notifications = data?.items ?? [];

  async function handleMarkRead(id: string) {
    setActionError(null);
    try {
      await markRead.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not mark this notification as read — please try again.');
    }
  }

  async function handleSnooze(minutes: number) {
    if (!snoozing) return;
    await snooze.mutateAsync({ id: snoozing.id, body: { minutes } });
    setSnoozing(null);
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Updates sent to your own account."
        actions={
          // v1.2 backend backlog — Broadcast/compose, approved by the product
          // owner. School-Owner-only: schoolId is null for a Branch Staff/
          // Instructor viewing their own inbox on this same page.
          schoolId ? <Button onClick={() => setBroadcasting(true)}>Broadcast to Students</Button> : undefined
        }
      />

      {/* Stats ribbon (v1.2 backend backlog, Decision 204's Concept 5 finding:
          "Total/Unread are real but page-scoped (no count endpoint exists to
          total across every page)") — all three tiles are real, backed by the
          GET /notifications/me/counts endpoint, not the page-local `notifications`
          list below. A failed counts fetch degrades to an em dash rather than
          blocking the whole page — the list is still perfectly usable without it. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Total" value={counts.isLoading ? <Spinner /> : counts.error ? '—' : counts.data!.total} />
        <StatTile label="Unread" value={counts.isLoading ? <Spinner /> : counts.error ? '—' : counts.data!.unread} />
        {/* v1.2 backend backlog — Read within 24h metric, approved by the
            product owner. `null` (nothing read yet) renders as an em dash,
            same convention the other two tiles already use for a failed fetch —
            here it's a genuinely empty metric, not an error. */}
        <StatTile
          label="Read within 24h"
          value={
            counts.isLoading ? (
              <Spinner />
            ) : counts.error || counts.data!.readWithin24hPercent === null ? (
              '—'
            ) : (
              `${counts.data!.readWithin24hPercent}%`
            )
          }
        />
      </div>

      {actionError ? <ErrorBanner message={actionError} /> : null}
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
                render: (n) =>
                  isSnoozed(n) ? (
                    <Badge>Snoozed</Badge>
                  ) : n.read ? (
                    <Badge>Read</Badge>
                  ) : (
                    <Badge variant="accent">New</Badge>
                  ),
              },
              { key: 'title', header: 'Title', render: (n) => n.title },
              { key: 'body', header: 'Message', render: (n) => n.body },
              { key: 'createdAt', header: 'Received', render: (n) => new Date(n.createdAt).toLocaleString() },
              {
                key: 'actions',
                header: '',
                // v1.2 backend backlog — Snooze, previously shown
                // disabled-styled in this menu with no endpoint behind it; now
                // real (PATCH /notifications/:id/snooze). "Mark read" stays
                // disabled once already read, same as the plain Button it
                // replaces did by simply not rendering at all — a menu item
                // reads clearer disabled than it would hidden, since the menu
                // itself should always offer a consistent set of items per row.
                render: (n) => (
                  <RowActionsMenu
                    label={`Actions for ${n.title}`}
                    actions={[
                      { label: 'Mark read', onClick: () => handleMarkRead(n.id), disabled: n.read },
                      { label: 'Snooze', onClick: () => setSnoozing(n) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      {snoozing ? (
        <SnoozeNotificationModal
          title={snoozing.title}
          submitting={snooze.isPending}
          onSubmit={handleSnooze}
          onClose={() => setSnoozing(null)}
        />
      ) : null}

      {broadcasting ? (
        <BroadcastNotificationModal
          branches={branches.data?.items ?? []}
          classes={classes.data?.items ?? []}
          submitting={broadcast.isPending}
          onSubmit={(input) => broadcast.mutateAsync(input)}
          onClose={() => setBroadcasting(false)}
        />
      ) : null}
    </>
  );
}
