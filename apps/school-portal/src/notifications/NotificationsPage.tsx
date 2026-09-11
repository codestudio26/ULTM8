import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useMarkNotificationRead, useNotifications, type NotificationResponse } from './notificationQueries';

/** The logged-in User's own notification inbox — every School Owner/Manager,
 * Branch Staff, or Instructor using this portal has one, same as a Student
 * would in the mobile app (GET /notifications/me is not School-scoped). List
 * + mark-read only — no device-token registration here (see
 * notificationQueries.ts's own header comment on why). */
export function NotificationsPage() {
  const { data, isLoading, error } = useNotifications();
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
