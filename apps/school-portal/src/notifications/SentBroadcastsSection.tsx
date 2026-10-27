import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBanner, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useSentBroadcasts, type SentBroadcast } from './notificationQueries';
import { useI18n } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const CLASS_GROUP_KEYS = {
  BOOKED: 'notifications.broadcastModal.classGroupBooked',
  WAITLIST: 'notifications.broadcastModal.classGroupWaitlist',
  CANCELLED: 'notifications.broadcastModal.classGroupCancelled',
} as const;

/** Decision 363 — the School's sent broadcasts, under the Owner's own inbox on
 * NotificationsPage: when each went out and who sent it, the message, who it
 * went to and how many Students it reached. The Branch/Class names are the
 * ones they had when it was sent; a Class still on the schedule links to it. */
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{b.classId ? <Link to={`/classes/${b.classId}`}>{t('notifications.sentBroadcasts.toClass', { name })}</Link> : t('notifications.sentBroadcasts.toClass', { name })}</span>
          {groups ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{groups}</span> : null}
        </div>
      );
    }
    return t('notifications.sentBroadcasts.toAll');
  }

  return (
    <section style={{ marginTop: 32 }} aria-labelledby="sent-broadcasts-heading">
      <h2 id="sent-broadcasts-heading" className="ultm8-page-header__title" style={{ fontSize: 18, marginBottom: 4 }}>
        {t('notifications.sentBroadcasts.title')}
      </h2>
      <p style={{ margin: '0 0 12px', color: 'var(--text-muted)' }}>{t('notifications.sentBroadcasts.subtitle')}</p>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : t('notifications.sentBroadcasts.loadFailed')} />
      ) : (
        <Card>
          {broadcasts.length === 0 ? (
            <EmptyState title={t('notifications.sentBroadcasts.emptyTitle')} description={t('notifications.sentBroadcasts.emptyDescription')} />
          ) : (
            <Table<SentBroadcast>
              rows={broadcasts}
              columns={[
                {
                  key: 'createdAt',
                  header: t('notifications.sentBroadcasts.columnSent'),
                  render: (b) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span>{new Date(b.createdAt).toLocaleString(formatLocale())}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('notifications.sentBroadcasts.sentBy', { name: b.sentByName })}</span>
                    </div>
                  ),
                },
                {
                  key: 'message',
                  header: t('notifications.columnMessage'),
                  render: (b) => (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <strong>{b.title}</strong>
                      <span style={{ whiteSpace: 'pre-wrap' }}>{b.body}</span>
                    </div>
                  ),
                },
                { key: 'audience', header: t('notifications.sentBroadcasts.columnSentTo'), render: audience },
                {
                  key: 'recipientCount',
                  header: t('notifications.sentBroadcasts.columnReached'),
                  render: (b) => t('notifications.sentBroadcasts.reached', { count: b.recipientCount }),
                },
              ]}
            />
          )}
        </Card>
      )}
      {hasNextPage ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {t('notifications.loadMore')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
