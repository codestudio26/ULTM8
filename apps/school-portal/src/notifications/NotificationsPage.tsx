import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, RowActionsMenu, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useBranches } from '../branches/branchQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import {
  useBroadcastNotification,
  useClearReadNotifications,
  notificationLink,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationCounts,
  useNotificationPages,
  useSnoozeNotification,
  useUpcomingClassesForBroadcast,
  type NotificationResponse,
} from './notificationQueries';
import { BroadcastNotificationModal } from './BroadcastNotificationModal';
import { SnoozeNotificationModal } from './SnoozeNotificationModal';
import { useI18n } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

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
 * and Delete (Decision 277) live in each row's action menu, with a "Clear all
 * read" header action beside them; Broadcast/compose (same backlog entry) is
 * a School-Owner-only PageHeader action, since the backend endpoint it calls
 * is School-Owner-gated — a Branch Staff/Instructor using this same page
 * never sees it (useOwnedSchoolId is null for them, same gate
 * WaiversPage/MembershipPlansPage's own "Add" actions already use). No
 * device-token registration here (see notificationQueries.ts's own header
 * comment on why). */
export function NotificationsPage() {
  const schoolId = useOwnedSchoolId();
  const { t, serverText } = useI18n();
  // Every loaded page, newest first, with "Load more" for the next one.
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationPages();
  // v1.2 backend backlog (Decision 204's Concept 5 finding) — a SEPARATE
  // query against the new dedicated counts endpoint, deliberately NOT
  // `data.items.length`/`.filter(n => !n.read).length` over the list above:
  // that list is only one page of the caller's notifications (resolveLimit's
  // default/max, cursor-paginate.ts), so a client-side derivation would
  // silently under-count the moment a caller has more notifications than fit
  // on one page — the exact gap this endpoint exists to close.
  const counts = useNotificationCounts();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const navigate = useNavigate();
  const snooze = useSnoozeNotification();
  const deleteNotification = useDeleteNotification();
  const clearRead = useClearReadNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState<NotificationResponse | null>(null);
  const [deleting, setDeleting] = useState<NotificationResponse | null>(null);
  const [clearingRead, setClearingRead] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  // Broadcast's audience targeting (v1.2 backend backlog) needs the School's
  // Branch/Class lists for its own two scoped dropdowns — fetched here
  // (schoolId-gated, so a non-Owner never issues these requests at all) and
  // handed down to the modal, same "page owns the data, modal owns the form"
  // split BranchFormModal/ClassFormModal callers already use elsewhere.
  const branches = useBranches(schoolId);
  const classes = useUpcomingClassesForBroadcast(schoolId);
  const broadcast = useBroadcastNotification(schoolId ?? '');

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('notifications.loadFailed')} />;

  // Titles/bodies the API's jobs wrote in English, shown in the picked language.
  const notifications = (data?.pages ?? []).flatMap((p) => p.items).map((n) => ({ ...n, ...serverText.notification(n) }));

  async function handleMarkRead(id: string) {
    setActionError(null);
    try {
      await markRead.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('notifications.markReadFailed'));
    }
  }

  async function handleMarkAllRead() {
    setActionError(null);
    try {
      await markAllRead.mutateAsync();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('notifications.markAllReadFailed'));
    }
  }

  /** Decision 352 — opening a notification also marks it read. */
  function handleOpen(n: NotificationResponse, to: string) {
    if (!n.read) markRead.mutate(n.id);
    navigate(to);
  }

  async function handleSnooze(minutes: number) {
    if (!snoozing) return;
    await snooze.mutateAsync({ id: snoozing.id, body: { minutes } });
    setSnoozing(null);
  }

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Decision 352 — every unread notification, on every page. */}
            <Button
              variant="secondary"
              onClick={handleMarkAllRead}
              loading={markAllRead.isPending}
              disabled={!counts.data || counts.data.unread === 0}
            >
              {t('notifications.markAllRead')}
            </Button>
            {/* Decision 277 — every User can clear their own read
                notifications. Disabled when Total equals Unread, from the
                counts endpoint rather than the loaded page (a snoozed unread
                row also counts towards the gap, so this can occasionally
                stay enabled with nothing to clear; that clears 0, harmlessly). */}
            <Button
              variant="secondary"
              onClick={() => setClearingRead(true)}
              disabled={!counts.data || counts.data.total - counts.data.unread === 0}
            >
              {t('notifications.clearAllRead')}
            </Button>
            {/* v1.2 backend backlog — Broadcast/compose, approved by the
                product owner. School-Owner-only: schoolId is null for a
                Branch Staff/Instructor viewing their own inbox on this same
                page. */}
            {schoolId ? <Button onClick={() => setBroadcasting(true)}>{t('notifications.broadcastButton')}</Button> : null}
          </div>
        }
      />

      {/* Stats ribbon (v1.2 backend backlog, Decision 204's Concept 5 finding:
          "Total/Unread are real but page-scoped (no count endpoint exists to
          total across every page)") — all three tiles are real, backed by the
          GET /notifications/me/counts endpoint, not the page-local `notifications`
          list below. A failed counts fetch degrades to an em dash rather than
          blocking the whole page — the list is still perfectly usable without it. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label={t('notifications.statTotal')} value={counts.isLoading ? <Spinner /> : counts.error ? '—' : counts.data!.total} />
        <StatTile label={t('notifications.statUnread')} value={counts.isLoading ? <Spinner /> : counts.error ? '—' : counts.data!.unread} />
        {/* v1.2 backend backlog — Read within 24h metric, approved by the
            product owner. `null` (nothing read yet) renders as an em dash,
            same convention the other two tiles already use for a failed fetch —
            here it's a genuinely empty metric, not an error. */}
        <StatTile
          label={t('notifications.statReadWithin24h')}
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
          <EmptyState title={t('notifications.emptyTitle')} description={t('notifications.emptyDescription')} />
        ) : (
          <Table<NotificationResponse>
            rows={notifications}
            columns={[
              {
                key: 'status',
                header: '',
                render: (n) =>
                  isSnoozed(n) ? (
                    <Badge>{t('notifications.statusSnoozed')}</Badge>
                  ) : n.read ? (
                    <Badge>{t('notifications.statusRead')}</Badge>
                  ) : (
                    <Badge variant="accent">{t('notifications.statusNew')}</Badge>
                  ),
              },
              {
                key: 'title',
                header: t('notifications.columnTitle'),
                // Decision 352: the title opens what the notification is about,
                // and the School it came from sits under it.
                render: (n) => {
                  const to = notificationLink(n);
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {to ? (
                        <a
                          href={to}
                          onClick={(e) => {
                            e.preventDefault();
                            handleOpen(n, to);
                          }}
                        >
                          {n.title}
                        </a>
                      ) : (
                        n.title
                      )}
                      {n.schoolName ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{n.schoolName}</span> : null}
                    </div>
                  );
                },
              },
              { key: 'body', header: t('notifications.columnMessage'), render: (n) => n.body },
              { key: 'createdAt', header: t('notifications.columnReceived'), render: (n) => new Date(n.createdAt).toLocaleString(formatLocale()) },
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
                    label={t('notifications.rowActionsAria', { title: n.title })}
                    actions={[
                      { label: t('notifications.markRead'), onClick: () => handleMarkRead(n.id), disabled: n.read },
                      // A read notification is already out of the Unread count,
                      // so snoozing it would change nothing but its badge.
                      { label: t('notifications.snooze'), onClick: () => setSnoozing(n), disabled: n.read },
                      { label: t('notifications.delete'), onClick: () => setDeleting(n), variant: 'danger' },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>
      {hasNextPage ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {t('notifications.loadMore')}
          </Button>
        </div>
      ) : null}

      {snoozing ? (
        <SnoozeNotificationModal
          title={snoozing.title}
          submitting={snooze.isPending}
          onSubmit={handleSnooze}
          onClose={() => setSnoozing(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDeleteModal
          title={t('notifications.deleteModal.title')}
          description={t('notifications.deleteModal.description', { title: deleting.title })}
          genericErrorMessage={t('notifications.deleteModal.failed')}
          onConfirm={() => deleteNotification.mutateAsync(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {clearingRead ? (
        <ConfirmDeleteModal
          title={t('notifications.clearReadModal.title')}
          description={t('notifications.clearReadModal.description')}
          confirmLabel={t('notifications.clearAllRead')}
          genericErrorMessage={t('notifications.clearReadModal.failed')}
          onConfirm={() => clearRead.mutateAsync()}
          onClose={() => setClearingRead(false)}
        />
      ) : null}

      {broadcasting ? (
        <BroadcastNotificationModal
          branches={branches.data?.items ?? []}
          classes={classes.data ?? []}
          submitting={broadcast.isPending}
          onSubmit={(input) => broadcast.mutateAsync(input)}
          onClose={() => setBroadcasting(false)}
        />
      ) : null}
    </>
  );
}
