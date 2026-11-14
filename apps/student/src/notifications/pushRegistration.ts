import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { deleteFcmTokenAsync, getFcmTokenAsync, onFcmTokenRefresh } from './fcmToken';

/**
 * Device-token registration (Decision 223/264; FCM token on both platforms,
 * Decision 463). Registers this device's FCM registration token with
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
 * same way.
 *
 * Logout (`unregisterPushTokenAsync()`, Decision 464): logging out stops push
 * notifications on this phone. The app stops listening for refreshes, removes
 * this device's token from the account (`DELETE /notifications/device-tokens/
 * :id`), and makes Firebase throw the token away. So the next person to log in
 * on a shared phone (a family phone, a Guardian and a Student) gets a fresh
 * token instead of the 409 the server gives for a token another account
 * owns. If the delete can't reach the server, the old row's token is dead
 * anyway once Firebase drops it: the next send reports it stale and
 * NotificationFanoutProcessor deletes it.
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

/**
 * Called on logout, while the access token is still valid (Decision 464).
 * Best effort and never throws: a failure here must not stop the logout.
 */
export async function unregisterPushTokenAsync(): Promise<void> {
  unsubscribeTokenRefresh?.();
  unsubscribeTokenRefresh = null;
  if (Platform.OS === 'web') return;

  const id = registeredDeviceTokenId;
  registeredDeviceTokenId = null;
  if (id) {
    try {
      await unwrap(apiClient.DELETE('/v1/notifications/device-tokens/{id}', { params: { path: { id } } }));
    } catch (err) {
      console.warn('Push notification token not removed from the account:', err instanceof Error ? err.message : err);
    }
  }
  try {
    await deleteFcmTokenAsync();
  } catch (err) {
    // Also covers no Firebase native module (Expo Go).
    console.warn('Push notification token not deleted in Firebase:', err instanceof Error ? err.message : err);
  }
}

let unsubscribeTokenRefresh: (() => void) | null = null;
// The server's id for this device's token row, from the last registration in
// this app run (every launch and login registers again, so it is always set
// once registration has succeeded).
let registeredDeviceTokenId: string | null = null;

function platformName(): 'IOS' | 'ANDROID' {
  return Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
}

async function registerToken(token: string): Promise<void> {
  const deviceToken = await unwrap(apiClient.POST('/v1/notifications/device-tokens', { body: { token, platform: platformName() } }));
  registeredDeviceTokenId = deviceToken.id;
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
