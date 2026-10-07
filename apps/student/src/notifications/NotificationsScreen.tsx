import React from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateTime } from '../lib/formatDate';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useMarkNotificationRead, useNotifications } from './notificationQueries';

type Notification = components['schemas']['NotificationResponseDto'];

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
function NotificationRow({ notification }: { notification: Notification }) {
  const markRead = useMarkNotificationRead();

  function handleMarkRead() {
    if (markRead.isPending) return;
    markRead.mutate(notification.id);
  }

  return (
    <View
      style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}
      accessibilityLabel={`${notification.title}, ${notification.read ? 'read' : 'unread'}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: notification.read ? fontWeight.body : fontWeight.heading, flex: 1, marginRight: spacing[2] }}>
          {notification.title}
        </Text>
        {!notification.read ? (
          <View
            accessibilityLabel="Unread"
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.fillAccent, marginTop: spacing[1] }}
          />
        ) : null}
      </View>
      <Text style={{ color: theme.textSecondary, marginTop: spacing[1] }}>{notification.body}</Text>
      <Text style={{ color: theme.textMuted, fontSize: fontSize.caption, marginTop: spacing[1] }}>{formatDateTime(notification.createdAt)}</Text>
      {markRead.isError ? (
        <InlineError message={getApiErrorMessage(markRead.error, 'Could not mark this as read — please try again.')} />
      ) : null}
      {!notification.read ? <Button title="Mark as read" variant="secondary" onPress={handleMarkRead} loading={markRead.isPending} /> : null}
    </View>
  );
}

export function NotificationsScreen() {
  const query = useNotifications();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: Notification) => <NotificationRow notification={item} />}
      emptyMessage="No notifications yet."
      errorFallbackMessage="Failed to load notifications — please try again."
    />
  );
}
