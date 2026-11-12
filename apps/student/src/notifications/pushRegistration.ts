import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { getFcmTokenAsync, onFcmTokenRefresh } from './fcmToken';

/**
 * Device-token registration (Decision 223/264; FCM token on both platforms,
 * Decision 462). Registers this device's FCM registration token with
 * `POST /notifications/device-tokens`, so PushNotificationService (FCM HTTP
 * v1 only, Decision 250) can reach it.
 *
 * The token comes from Firebase (`fcmToken.native.ts`), not from
 * `expo-notifications`' `getDevicePushTokenAsync()`: on iOS that returns the
 * raw APNs token, which FCM can't send to. `expo-notifications` still asks
 * for the OS permission (it covers Android 13's POST_NOTIFICATIONS too) and
 * shows notifications.
 *
 * Needs a native build with the Firebase config files (app.json's
 * `googleServicesFile`); in Expo Go, or on iOS before the APNs key is in the
 * Firebase project, getting the token fails. That is caught, logged and never
 * thrown: push must never block launch or login. The next launch or login
 * tries again.
 *
 * Token refresh: FCM can rotate a token at any time. After the first
 * successful registration this listens for a new token and registers it the
 * same way. `stopPushTokenRefresh()` (called on logout) stops listening, so a
 * logged-out device doesn't try to register.
 *
 * Known, deliberately unresolved edge case: if a second person logs into
 * this same device (e.g. a shared family phone, a Guardian and a Student),
 * re-registering the same device token under a different user hits the
 * existing 409 (NotificationsService.registerDeviceToken's own documented
 * conflict response) — swallowed by the catch below like any other failure,
 * not actively handled by deregistering the previous user's token on
 * logout. Flagged, not built, this phase.
 */
export async function registerForPushNotificationsAsync(): Promise<void> {
  // The web app has no push notifications (fcmToken.ts). Returning here also
  // spares web users a browser permission prompt that could never lead to a push.
  if (Platform.OS === 'web') return;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let status = existingStatus;
    if (status !== 'granted') {
      const { status: requestedStatus } = await Notifications.requestPermissionsAsync();
      status = requestedStatus;
    }
    if (status !== 'granted') {
      console.warn('Push notification permission was not granted — device token not registered.');
      return;
    }

    const token = await getFcmTokenAsync();
    await registerToken(token);
    listenForTokenRefresh();
  } catch (err) {
    // No Firebase native module (Expo Go), no APNs token yet on iOS, no
    // network, or a 409 from the server: never block app launch or login.
    console.warn('Push notification registration unavailable:', err instanceof Error ? err.message : err);
  }
}

/** Stops re-registering refreshed tokens. Called on logout. */
export function stopPushTokenRefresh(): void {
  unsubscribeTokenRefresh?.();
  unsubscribeTokenRefresh = null;
}

let unsubscribeTokenRefresh: (() => void) | null = null;

function platformName(): 'IOS' | 'ANDROID' {
  return Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
}

async function registerToken(token: string): Promise<void> {
  await unwrap(apiClient.POST('/v1/notifications/device-tokens', { body: { token, platform: platformName() } }));
}

// One listener per app run, however many times registration runs (launch,
// login, token refresh on launch all call it).
function listenForTokenRefresh(): void {
  if (unsubscribeTokenRefresh) return;
  unsubscribeTokenRefresh = onFcmTokenRefresh((token) => {
    registerToken(token).catch((err: unknown) => {
      console.warn('Push notification token refresh not registered:', err instanceof Error ? err.message : err);
    });
  });
}
