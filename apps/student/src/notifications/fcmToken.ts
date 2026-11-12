/**
 * Web stand-in for `fcmToken.native.ts` (Metro picks the `.native` file for
 * iOS and Android builds). The web app has no push notifications, and
 * React Native Firebase has no web messaging, so keeping it out of this file
 * also keeps the Firebase SDK out of the web bundle. `pushRegistration.ts`
 * returns early on web, so nothing normally calls these.
 */
export function getFcmTokenAsync(): Promise<string> {
  return Promise.reject(new Error('Push notifications are not available on the web app.'));
}

export function onFcmTokenRefresh(_listener: (token: string) => void): () => void {
  return () => undefined;
}
