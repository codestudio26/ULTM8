import React from 'react';
import { Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateTime } from '../lib/formatDate';
import { useI18n, useT } from '../i18n/I18nProvider';
import type { AppStackParamList } from '../navigation/types';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from './notificationQueries';

type Notification = components['schemas']['NotificationResponseDto'];
type Props = NativeStackScreenProps<AppStackParamList, 'Notifications'>;

/** Decision 355 — the screen a notification opens, or null when there is
 * none in this app (CANCELLATIONS is a School staff page). */
type Target = 'MyBookings' | 'Waivers' | 'TransactionHistory' | 'MyGrading' | 'MyCharges';
function notificationTarget(n: Notification): Target | null {
  switch (n.targetType) {
    case 'CLASS':
      return 'MyBookings';
    case 'WAIVER':
      return 'Waivers';
    case 'PAYMENT':
      // A staff-created charge, its receipt or its cancellation (Decision 338).
      return n.type === 'CHARGE' ? 'MyCharges' : 'TransactionHistory';
    case 'GRADING':
      return 'MyGrading';
    default:
      return null;
  }
}

/** Read-side only (Phase 15 scope, Decision 95). DeviceToken registration
 * (POST /notifications/device-tokens) is deliberately NOT built here, even though
 * docs/TRACK-B-ROADMAP.md's original Slice 5 plan described it — found on review:
 * that plan didn't account for what registering one actually requires client-side
 * (expo-notifications, a new native module; permission prompts; an EAS project
 * configured for Expo's push service for a real token), pulled in for a capability
 * whose other half — FCM/APNs dispatch — is explicitly deferred server-side
 * (Decision 95). Registering a token that can never receive anything yet is new
 * infrastructure with no present payoff. This deviation from the roadmap's original
 * plan is recorded in the roadmap doc itself, not just here, per CLAUDE.md's "flag
 * the mismatch, don't silently pick one." Revisit once server-side dispatch exists. */
function NotificationRow({ notification: raw, onOpen }: { notification: Notification; onOpen: (target: Target) => void }) {
  const { t, serverText } = useI18n();
  // Titles/bodies the API's own jobs wrote, in the app's language (a School's
  // own broadcast is shown as written) — the same call the portal's
  // NotificationsPage makes.
  const notification = { ...raw, ...serverText.notification(raw) };
  const markRead = useMarkNotificationRead();

  function handleMarkRead() {
    if (markRead.isPending) return;
    markRead.mutate(notification.id);
  }

  const target = notificationTarget(raw);
  function handleOpen() {
    if (!target) return;
    // Opening it counts as reading it.
    if (!notification.read && !markRead.isPending) markRead.mutate(notification.id);
    onOpen(target);
  }

  return (
    <View
      style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}
      accessibilityLabel={t(notification.read ? 'notifications.row.labelRead' : 'notifications.row.labelUnread', { title: notification.title })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: notification.read ? '400' : '700', flex: 1, marginRight: 8 }}>{notification.title}</Text>
        {!notification.read ? (
          <View
            accessibilityLabel={t('notifications.row.unread')}
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#1F6FEB', marginTop: 6 }}
          />
        ) : null}
      </View>
      {/* Decision 355: the School it came from. */}
      {notification.schoolName ? <Text style={{ color: '#9AA0A6', fontSize: 12, marginTop: 2 }}>{notification.schoolName}</Text> : null}
      <Text style={{ color: '#5F6368', marginTop: 2 }}>{notification.body}</Text>
      <Text style={{ color: '#9AA0A6', fontSize: 11, marginTop: 4 }}>{formatDateTime(notification.createdAt)}</Text>
      {markRead.isError ? (
        <InlineError message={getApiErrorMessage(markRead.error, t('notifications.row.markReadFailed'))} />
      ) : null}
      {target ? <Button title={t('notifications.row.open')} onPress={handleOpen} /> : null}
      {!notification.read ? <Button title={t('notifications.row.markAsRead')} variant="secondary" onPress={handleMarkRead} loading={markRead.isPending} /> : null}
    </View>
  );
}

export function NotificationsScreen({ navigation }: Props) {
  const t = useT();
  const query = useNotifications();
  const markAllRead = useMarkAllNotificationsRead();
  const anyUnread = (query.data?.pages ?? []).some((p) => p.items.some((n) => !n.read));

  return (
    <PaginatedListScreen
      query={query}
      header={
        anyUnread || markAllRead.isError ? (
          <View style={{ marginBottom: 8 }}>
            {/* Decision 355 — every unread notification, not only the loaded ones. */}
            <Button title={t('notifications.list.markAllRead')} variant="secondary" onPress={() => markAllRead.mutate()} loading={markAllRead.isPending} />
            {markAllRead.isError ? (
              <InlineError message={getApiErrorMessage(markAllRead.error, t('notifications.list.markAllReadFailed'))} />
            ) : null}
          </View>
        ) : undefined
      }
      renderItem={(item: Notification) => <NotificationRow notification={item} onOpen={(target) => navigation.navigate(target)} />}
      emptyMessage={t('notifications.list.empty')}
      errorFallbackMessage={t('notifications.list.loadFailed')}
    />
  );
}
