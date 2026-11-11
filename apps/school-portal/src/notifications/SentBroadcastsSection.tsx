import React from 'react';
import { Link } from 'react-router-dom';
import { ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useSentBroadcasts, type SentBroadcast } from './notificationQueries';
import { useI18n } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { MenuIconSvg } from '../layout/newLookIcons';
import './notificationsPage.css';

const CLASS_GROUP_KEYS = {
  BOOKED: 'notifications.broadcastModal.classGroupBooked',
  WAITLIST: 'notifications.broadcastModal.classGroupWaitlist',
  CANCELLED: 'notifications.broadcastModal.classGroupCancelled',
} as const;

/** Decision 363 — the School's sent broadcasts, under the Owner's own inbox on
 * NotificationsPage: when each went out and who sent it, the message, who it
 * went to and how many Students it reached. The Branch/Class names are the
 * ones they had when it was sent; a Class still on the schedule links to it.
 *
 * New look (Decision 453): a white card with a light header; on a computer a
 * tidy table, on a phone each message becomes a small card (DESIGN.md →
 * "Phone layout": short history lists). */
export function SentBroadcastsSection({ schoolId }: { schoolId: string }) {
  const { t } = useI18n();
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useSentBroadcasts(schoolId);
  const broadcasts = (data?.pages ?? []).flatMap((p) => p.items);

  function audience(b: SentBroadcast): React.ReactNode {
    if (b.audience === 'BRANCH') return t('notifications.sentBroadcasts.toBranch', { name: b.branchName ?? '—' });
    if (b.audience === 'CLASS') {
      const when = b.classStartDate
        ? new Date(b.classStartDate).toLocaleString(formatLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '';
      const name = [b.classTitle ?? '—', when].filter(Boolean).join(' · ');
      const groups = b.classAudience.map((g) => t(CLASS_GROUP_KEYS[g])).join(', ');
      return (
        <>
          <span>{b.classId ? <Link to={`/classes/${b.classId}`}>{t('notifications.sentBroadcasts.toClass', { name })}</Link> : t('notifications.sentBroadcasts.toClass', { name })}</span>
          {groups ? <span className="u8n-notes__sub">{groups}</span> : null}
        </>
      );
    }
    return t('notifications.sentBroadcasts.toAll');
  }

  return (
    <section className="u8n-notes__card" aria-labelledby="sent-broadcasts-heading">
      <header className="u8n-notes__card-head">
        <h2 id="sent-broadcasts-heading" className="u8n-notes__card-title">
          <MenuIconSvg icon="notifications" />
          {t('notifications.sentBroadcasts.title')}
        </h2>
        <p className="u8n-notes__card-sub">{t('notifications.sentBroadcasts.subtitle')}</p>
      </header>
      {isLoading ? (
        <div className="u8n-notes__state">
          <Spinner />
        </div>
      ) : error ? (
        <div className="u8n-notes__state">
          <ErrorBanner message={error instanceof ApiError ? error.message : t('notifications.sentBroadcasts.loadFailed')} />
        </div>
      ) : broadcasts.length === 0 ? (
        <div className="u8n-notes__empty">
          <p className="u8n-notes__empty-title">{t('notifications.sentBroadcasts.emptyTitle')}</p>
          <p className="u8n-notes__empty-text">{t('notifications.sentBroadcasts.emptyDescription')}</p>
        </div>
      ) : (
        <table className="u8n-notes__table">
          <thead>
            <tr>
              <th scope="col">{t('notifications.sentBroadcasts.columnSent')}</th>
              <th scope="col">{t('notifications.columnMessage')}</th>
              <th scope="col">{t('notifications.sentBroadcasts.columnSentTo')}</th>
              <th scope="col" className="u8n-notes__num">
                {t('notifications.sentBroadcasts.columnReached')}
              </th>
            </tr>
          </thead>
          <tbody>
            {broadcasts.map((b) => (
              <tr key={b.id}>
                <td className="u8n-notes__cell-sent">
                  <span className="u8n-notes__when-main">{new Date(b.createdAt).toLocaleString(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span className="u8n-notes__sub">{t('notifications.sentBroadcasts.sentBy', { name: b.sentByName })}</span>
                </td>
                <td className="u8n-notes__cell-message">
                  <span className="u8n-notes__message-title">{b.title}</span>
                  <span className="u8n-notes__message-body">{b.body}</span>
                </td>
                <td className="u8n-notes__cell-audience">{audience(b)}</td>
                <td className="u8n-notes__cell-reached u8n-notes__num">{t('notifications.sentBroadcasts.reached', { count: b.recipientCount })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasNextPage ? (
        <div className="u8n-notes__more">
          <button type="button" className="u8n-notes__btn" disabled={isFetchingNextPage} aria-busy={isFetchingNextPage || undefined} onClick={() => fetchNextPage()}>
            {isFetchingNextPage ? <span className="u8n-notes__spin" aria-hidden="true" /> : null}
            {t('notifications.loadMore')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
