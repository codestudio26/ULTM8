import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/**
 * Device-token registration (Decision 223/264) — the client half the
 * NotificationsScreen.tsx header comment flagged as deliberately NOT built
 * (Decision 95), closed now that server-side push SEND is real (see
 * PushNotificationService's own header comment). `POST /notifications/
 * device-tokens` itself was already built and tested server-side; this is
 * the first real caller.
 *
 * Requests a native FCM/APNs device push token DIRECTLY via
 * `getDevicePushTokenAsync()` — NOT Expo's own push token/Expo push service
 * — because Decision 250 commits the backend to one FCM integration point for
 * both platforms, reached only once a real Firebase project's native config
 * files (`google-services.json` / `GoogleService-Info.plist`) are added to
 * this app's build. This environment has no Firebase project (Decision
 * 223/250's own "Still blocked" note), so `getDevicePushTokenAsync()` is
 * expected to reject here today — caught below, logged, never thrown. This
 * is the real integration point, not a placeholder/fake-token stand-in (the
 * roadmap's own "registering a token that can never receive anything yet"
 * rejection still holds for THAT idea) — it starts actually registering a
 * usable token the moment the native config files exist, with zero further
 * code changes needed here, the same "real code, inert without real vendor
 * config" shape R2ClientService/CloudflareStreamService already establish
 * server-side.
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

    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const platform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';

    await unwrap(apiClient.POST('/v1/notifications/device-tokens', { body: { token: devicePushToken.data, platform } }));
  } catch (err) {
    // Expected to fail in this environment today — no Firebase project (see
    // this file's own header comment) — and must never block app launch or
    // login either way. Logged, not thrown.
    console.warn('Push notification registration unavailable:', err instanceof Error ? err.message : err);
  }
}
