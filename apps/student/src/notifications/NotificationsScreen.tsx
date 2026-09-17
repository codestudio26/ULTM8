import React from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, ErrorBanner, InlineError, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateTime } from '../lib/formatDate';
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
      style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}
      accessibilityLabel={`${notification.title}, ${notification.read ? 'read' : 'unread'}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: notification.read ? '400' : '700', flex: 1, marginRight: 8 }}>{notification.title}</Text>
        {!notification.read ? (
          <View
            accessibilityLabel="Unread"
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#1F6FEB', marginTop: 6 }}
          />
        ) : null}
      </View>
      <Text style={{ color: '#5F6368', marginTop: 2 }}>{notification.body}</Text>
      <Text style={{ color: '#9AA0A6', fontSize: 11, marginTop: 4 }}>{formatDateTime(notification.createdAt)}</Text>
      {markRead.isError ? (
        <InlineError message={getApiErrorMessage(markRead.error, 'Could not mark this as read — please try again.')} />
      ) : null}
      {!notification.read ? <Button title="Mark as read" variant="secondary" onPress={handleMarkRead} loading={markRead.isPending} /> : null}
    </View>
  );
}

export function NotificationsScreen() {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotifications();
  const notifications: Notification[] = data?.pages.flatMap((p) => p.items) ?? [];

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, 'Failed to load notifications — please try again.')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator /> : null}
        ListEmptyComponent={<Text style={{ color: '#5F6368' }}>No notifications yet.</Text>}
        renderItem={({ item }) => <NotificationRow notification={item} />}
      />
    </Screen>
  );
}
