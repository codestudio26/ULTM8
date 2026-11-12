import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';
import { registerForPushNotificationsAsync, stopPushTokenRefresh } from './pushRegistration';

jest.mock('../api', () => ({
  apiClient: { POST: jest.fn() },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}));
// @react-native-firebase/messaging is mocked globally in jest.setup.js.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiClient } = require('../api') as { apiClient: { POST: ReturnType<typeof jest.fn> } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Notifications = require('expo-notifications') as {
  getPermissionsAsync: ReturnType<typeof jest.fn>;
  requestPermissionsAsync: ReturnType<typeof jest.fn>;
  getDevicePushTokenAsync: ReturnType<typeof jest.fn>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Messaging = require('@react-native-firebase/messaging') as {
  getMessaging: ReturnType<typeof jest.fn>;
  getToken: ReturnType<typeof jest.fn>;
  onTokenRefresh: ReturnType<typeof jest.fn>;
};

function okResponse<T>(data: T) {
  return Promise.resolve({ data, response: { ok: true, status: 201 } as Response });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('registerForPushNotificationsAsync', () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let unsubscribe: ReturnType<typeof jest.fn>;
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    apiClient.POST.mockReset();
    Notifications.getPermissionsAsync.mockReset();
    Notifications.requestPermissionsAsync.mockReset();
    Notifications.getDevicePushTokenAsync.mockReset();
    Messaging.getMessaging.mockReset().mockReturnValue({});
    Messaging.getToken.mockReset();
    unsubscribe = jest.fn();
    Messaging.onTokenRefresh.mockReset().mockReturnValue(unsubscribe);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Module-level refresh listener: reset between tests.
    stopPushTokenRefresh();
    warnSpy.mockRestore();
    Platform.OS = originalPlatformOS;
  });

  it('registers the FCM token on Android once permission is already granted', async () => {
    Platform.OS = 'android';
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Messaging.getToken.mockResolvedValue('fcm-token-123');
    apiClient.POST.mockReturnValue(okResponse({ id: 'dt-1', userId: 'u1', platform: 'ANDROID', token: 'fcm-token-123' }));

    await registerForPushNotificationsAsync();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(apiClient.POST).toHaveBeenCalledWith('/v1/notifications/device-tokens', {
      body: { token: 'fcm-token-123', platform: 'ANDROID' },
    });
  });

  it('on iOS registers the FCM token from Firebase, never the raw APNs token expo-notifications returns', async () => {
    Platform.OS = 'ios';
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    // What getDevicePushTokenAsync really returns on iOS: the APNs token (hex),
    // which FCM HTTP v1 can't send to. It must not be what gets registered.
    Notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'a1b2c3d4e5f6apns' });
    Messaging.getToken.mockResolvedValue('fcm-token-456');
    apiClient.POST.mockReturnValue(okResponse({ id: 'dt-2', userId: 'u1', platform: 'IOS', token: 'fcm-token-456' }));

    await registerForPushNotificationsAsync();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(apiClient.POST).toHaveBeenCalledTimes(1);
    expect(apiClient.POST).toHaveBeenCalledWith('/v1/notifications/device-tokens', {
      body: { token: 'fcm-token-456', platform: 'IOS' },
    });
  });

  it('never calls the API when permission is denied, and never throws', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined();
    expect(Messaging.getToken).not.toHaveBeenCalled();
    expect(apiClient.POST).not.toHaveBeenCalled();
  });

  it('never throws when Firebase cannot give a token (Expo Go, or iOS without an APNs token yet)', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Messaging.getToken.mockRejectedValue(new Error('[messaging/unregistered] no APNs token'));

    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined();
    expect(apiClient.POST).not.toHaveBeenCalled();
    expect(Messaging.onTokenRefresh).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when the Firebase native module is missing altogether', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Messaging.getMessaging.mockImplementation(() => {
      throw new Error('You attempted to use a Firebase module that is not installed natively');
    });

    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined();
    expect(apiClient.POST).not.toHaveBeenCalled();
  });

  it('never throws when the server call itself rejects (e.g. a 409 from a shared-device re-login — see this file’s own header comment)', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Messaging.getToken.mockResolvedValue('fcm-token-789');
    apiClient.POST.mockReturnValue(Promise.resolve({ error: { message: 'conflict' }, response: { ok: false, status: 409 } as Response }));

    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined();
  });

  it('does nothing on the web app (no push there, and no pointless browser permission prompt)', async () => {
    Platform.OS = 'web';

    await registerForPushNotificationsAsync();

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Messaging.getToken).not.toHaveBeenCalled();
    expect(apiClient.POST).not.toHaveBeenCalled();
  });

  describe('token refresh', () => {
    beforeEach(() => {
      Platform.OS = 'android';
      Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
      Messaging.getToken.mockResolvedValue('fcm-token-old');
      apiClient.POST.mockReturnValue(okResponse({}));
    });

    it('registers a refreshed token the same way', async () => {
      await registerForPushNotificationsAsync();
      const listener = Messaging.onTokenRefresh.mock.calls[0][1] as (token: string) => void;

      listener('fcm-token-new');
      await flush();

      expect(apiClient.POST).toHaveBeenLastCalledWith('/v1/notifications/device-tokens', {
        body: { token: 'fcm-token-new', platform: 'ANDROID' },
      });
    });

    it('listens only once however many times registration runs', async () => {
      await registerForPushNotificationsAsync();
      await registerForPushNotificationsAsync();

      expect(Messaging.onTokenRefresh).toHaveBeenCalledTimes(1);
    });

    it('a failed refresh registration is logged, never thrown', async () => {
      await registerForPushNotificationsAsync();
      const listener = Messaging.onTokenRefresh.mock.calls[0][1] as (token: string) => void;
      apiClient.POST.mockReturnValue(Promise.resolve({ error: { message: 'unauthorized' }, response: { ok: false, status: 401 } as Response }));

      listener('fcm-token-new');
      await flush();

      expect(warnSpy).toHaveBeenCalledWith('Push notification token refresh not registered:', expect.anything());
    });

    it('stopPushTokenRefresh (logout) stops listening, and the next login listens again', async () => {
      await registerForPushNotificationsAsync();
      stopPushTokenRefresh();
      expect(unsubscribe).toHaveBeenCalledTimes(1);

      await registerForPushNotificationsAsync();
      expect(Messaging.onTokenRefresh).toHaveBeenCalledTimes(2);
    });
  });
});
