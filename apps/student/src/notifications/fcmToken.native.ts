import { getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';

/**
 * The FCM registration token for this device, on iOS AND Android (Decision
 * 250's single FCM integration point; this file's choice is Decision 462).
 *
 * `expo-notifications`' `getDevicePushTokenAsync()` was used before, but on
 * iOS it returns the raw APNs device token, which FCM HTTP v1
 * (PushNotificationService, the only sender) rejects. The Firebase iOS SDK is
 * what swaps the APNs token for an FCM registration token, so the token comes
 * from `@react-native-firebase/messaging` on both platforms.
 *
 * Native builds only (a development or release build with the Firebase config
 * files from app.json). Expo Go has no Firebase native module, so this rejects
 * there; the web build uses `fcmToken.ts` instead.
 */
export function getFcmTokenAsync(): Promise<string> {
  return getToken(getMessaging());
}

/** Calls `listener` with the new token whenever FCM rotates it. Returns the unsubscribe. */
export function onFcmTokenRefresh(listener: (token: string) => void): () => void {
  return onTokenRefresh(getMessaging(), listener);
}
