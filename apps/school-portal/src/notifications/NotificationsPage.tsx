import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBanner, RowActionsMenu, Spinner } from '@ultm8/ui';
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
import { SentBroadcastsSection } from './SentBroadcastsSection';
import { useI18n } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import './notificationsPage.css';

/** One number card in the stats row (DESIGN.md → "Stat rows"): the label in a
 * two-line slot, then its number, so a label that wraps never pushes the
 * number down. The label comes first and the number straight after it. */
function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="u8n-notes__stat">
      <span className="u8n-notes__stat-label">{label}</span>
      <span className="u8n-notes__stat-value">{value}</span>
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
 * a School-Owner-only header action, since the backend endpoint it calls
 * is School-Owner-gated — a Branch Staff/Instructor using this same page
 * never sees it (useOwnedSchoolId is null for them, same gate
 * WaiversPage/MembershipPlansPage's own "Add" actions already use). No
 * device-token registration here (see notificationQueries.ts's own header
 * comment on why).
 *
 * The new look (Decision 453; DESIGN-BRIEF §8, DESIGN.md → "Stat rows", "One
 * accent: mint", "Phone layout"): the white page header, the three number
 * cards, then the inbox as one white card of rows like the Dashboard's
 * "Needs attention" list. The page has no selected-item view, so it has no
 * right-hand panel. Layout only: the same data, actions and API calls. */
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

  const header = (actions?: React.ReactNode) => <NewLookPageHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} actions={actions} />;

  if (isLoading)
    return (
      <>
        {header()}
        <Spinner />
      </>
    );
  if (error)
    return (
      <>
        {header()}
        <ErrorBanner message={error instanceof ApiError ? error.message : t('notifications.loadFailed')} />
      </>
    );

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

  /** Decision 355 — opening a notification also marks it read. */
  function handleOpen(n: NotificationResponse, to: string) {
    if (!n.read) markRead.mutate(n.id);
    navigate(to);
  }

  async function handleSnooze(minutes: number) {
    if (!snoozing) return;
    await snooze.mutateAsync({ id: snoozing.id, body: { minutes } });
    setSnoozing(null);
  }

  // A failed counts fetch degrades to an em dash rather than blocking the
  // whole page — the list is still perfectly usable without it.
  const countValue = (pick: (c: NonNullable<typeof counts.data>) => React.ReactNode) =>
    counts.isLoading ? <Spinner /> : counts.error || !counts.data ? '—' : pick(counts.data);

  return (
    <>
      {header(
        <>
          {/* Decision 355 — every unread notification, on every page. */}
          <button
            type="button"
            className="u8n-notes__btn"
            onClick={handleMarkAllRead}
            disabled={markAllRead.isPending || !counts.data || counts.data.unread === 0}
            aria-busy={markAllRead.isPending || undefined}
          >
            {markAllRead.isPending ? <span className="u8n-notes__spin" aria-hidden="true" /> : null}
            {t('notifications.markAllRead')}
          </button>
          {/* Decision 277 — every User can clear their own read
              notifications. Disabled when Total equals Unread, from the
              counts endpoint rather than the loaded page (a snoozed unread
              row also counts towards the gap, so this can occasionally
              stay enabled with nothing to clear; that clears 0, harmlessly). */}
          <button
            type="button"
            className="u8n-notes__btn"
            onClick={() => setClearingRead(true)}
            disabled={!counts.data || counts.data.total - counts.data.unread === 0}
          >
            {t('notifications.clearAllRead')}
          </button>
          {/* v1.2 backend backlog — Broadcast/compose, approved by the
              product owner. School-Owner-only: schoolId is null for a
              Branch Staff/Instructor viewing their own inbox on this same
              page. */}
          {schoolId ? (
            <button type="button" className="u8n-notes__btn u8n-notes__btn--primary" onClick={() => setBroadcasting(true)}>
              {t('notifications.broadcastButton')}
            </button>
          ) : null}
        </>,
      )}

      <NewLookPage>
        <div className="u8n-notes">
          {/* Stats row (v1.2 backend backlog, Decision 204's Concept 5
              finding) — all three are real, backed by the
              GET /notifications/me/counts endpoint, not the loaded rows below. */}
          <div className="u8n-notes__stats">
            <StatCard label={t('notifications.statTotal')} value={countValue((c) => c.total)} />
            <StatCard label={t('notifications.statUnread')} value={countValue((c) => c.unread)} />
            {/* v1.2 backend backlog — Read within 24h, approved by the
                product owner. `null` (nothing read yet) is an em dash: a
                genuinely empty metric, not an error. */}
            <StatCard
              label={t('notifications.statReadWithin24h')}
              value={countValue((c) => (c.readWithin24hPercent === null ? '—' : `${c.readWithin24hPercent}%`))}
            />
          </div>

          {actionError ? <ErrorBanner message={actionError} /> : null}

          <section className="u8n-notes__card" aria-label={t('notifications.title')}>
            {notifications.length === 0 ? (
              <div className="u8n-notes__empty">
                <p className="u8n-notes__empty-title">{t('notifications.emptyTitle')}</p>
                <p className="u8n-notes__empty-text">{t('notifications.emptyDescription')}</p>
              </div>
            ) : (
              <ul className="u8n-notes__list">
                {notifications.map((n) => (
                  <InboxRow
                    key={n.id}
                    n={n}
                    onOpen={handleOpen}
                    onMarkRead={() => handleMarkRead(n.id)}
                    onSnooze={() => setSnoozing(n)}
                    onDelete={() => setDeleting(n)}
                  />
                ))}
              </ul>
            )}
            {hasNextPage ? (
              <div className="u8n-notes__more">
                <button
                  type="button"
                  className="u8n-notes__btn"
                  disabled={isFetchingNextPage}
                  aria-busy={isFetchingNextPage || undefined}
                  onClick={() => fetchNextPage()}
                >
                  {isFetchingNextPage ? <span className="u8n-notes__spin" aria-hidden="true" /> : null}
                  {t('notifications.loadMore')}
                </button>
              </div>
            ) : null}
          </section>

          {/* Decision 363 — the School's sent broadcasts, Owner only like sending. */}
          {schoolId ? <SentBroadcastsSection schoolId={schoolId} /> : null}
        </div>
      </NewLookPage>

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

/** One notification: an unread dot, the title (Decision 355: it opens what
 * the notification is about) with the School it came from, the message, then
 * its status and when it arrived, and the row's ⋯ menu. */
function InboxRow({
  n,
  onOpen,
  onMarkRead,
  onSnooze,
  onDelete,
}: {
  n: NotificationResponse;
  onOpen: (n: NotificationResponse, to: string) => void;
  onMarkRead: () => void;
  onSnooze: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const to = notificationLink(n);
  const snoozed = isSnoozed(n);
  const state = snoozed ? 'snoozed' : n.read ? 'read' : 'new';
  return (
    <li className="u8n-notes__item" data-state={state}>
      <span className="u8n-notes__dot" aria-hidden="true" />
      <div className="u8n-notes__main">
        <div className="u8n-notes__title">
          {to ? (
            <a
              href={to}
              onClick={(e) => {
                e.preventDefault();
                onOpen(n, to);
              }}
            >
              {n.title}
            </a>
          ) : (
            n.title
          )}
        </div>
        {n.schoolName ? <div className="u8n-notes__school">{n.schoolName}</div> : null}
        <div className="u8n-notes__body">{n.body}</div>
      </div>
      <div className="u8n-notes__end">
        <span className={`u8n-notes__tag u8n-notes__tag--${state}`}>
          {snoozed ? t('notifications.statusSnoozed') : n.read ? t('notifications.statusRead') : t('notifications.statusNew')}
        </span>
        <span className="u8n-notes__when">{new Date(n.createdAt).toLocaleString(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</span>
      </div>
      <div className="u8n-notes__menu">
        {/* v1.2 backend backlog — Snooze is real (PATCH
            /notifications/:id/snooze). "Mark read" stays in the menu, disabled
            once already read, so every row offers the same set of items. */}
        <RowActionsMenu
          label={t('notifications.rowActionsAria', { title: n.title })}
          actions={[
            { label: t('notifications.markRead'), onClick: onMarkRead, disabled: n.read },
            // A read notification is already out of the Unread count,
            // so snoozing it would change nothing but its badge.
            { label: t('notifications.snooze'), onClick: onSnooze, disabled: n.read },
            { label: t('notifications.delete'), onClick: onDelete, variant: 'danger' },
          ]}
        />
      </div>
    </li>
  );
}
