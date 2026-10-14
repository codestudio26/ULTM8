import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';
import { registerForPushNotificationsAsync } from './pushRegistration';

jest.mock('../api', () => ({
  apiClient: { POST: jest.fn() },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiClient } = require('../api') as { apiClient: { POST: ReturnType<typeof jest.fn> } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Notifications = require('expo-notifications') as {
  getPermissionsAsync: ReturnType<typeof jest.fn>;
  requestPermissionsAsync: ReturnType<typeof jest.fn>;
  getDevicePushTokenAsync: ReturnType<typeof jest.fn>;
};

function okResponse<T>(data: T) {
  return Promise.resolve({ data, response: { ok: true, status: 201 } as Response });
}

describe('registerForPushNotificationsAsync', () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    apiClient.POST.mockReset();
    Notifications.getPermissionsAsync.mockReset();
    Notifications.requestPermissionsAsync.mockReset();
    Notifications.getDevicePushTokenAsync.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    Platform.OS = originalPlatformOS;
  });

  it('registers the device push token on Android once permission is already granted', async () => {
    Platform.OS = 'android';
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-123' });
    apiClient.POST.mockReturnValue(okResponse({ id: 'dt-1', userId: 'u1', platform: 'ANDROID', token: 'fcm-token-123' }));

    await registerForPushNotificationsAsync();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(apiClient.POST).toHaveBeenCalledWith('/v1/notifications/device-tokens', {
      body: { token: 'fcm-token-123', platform: 'ANDROID' },
    });
  });

  it('requests permission when not already granted, and registers on success (iOS)', async () => {
    Platform.OS = 'ios';
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'ios', data: 'fcm-token-456' });
    apiClient.POST.mockReturnValue(okResponse({ id: 'dt-2', userId: 'u1', platform: 'IOS', token: 'fcm-token-456' }));

    await registerForPushNotificationsAsync();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(apiClient.POST).toHaveBeenCalledWith('/v1/notifications/device-tokens', {
      body: { token: 'fcm-token-456', platform: 'IOS' },
    });
  });

  it('never calls the API when permission is denied, and never throws', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined();
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(apiClient.POST).not.toHaveBeenCalled();
  });

  it('never throws when getDevicePushTokenAsync rejects (expected in this environment — no Firebase project configured)', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.getDevicePushTokenAsync.mockRejectedValue(new Error('no native push config'));

    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined();
    expect(apiClient.POST).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never throws when the server call itself rejects (e.g. a 409 from a shared-device re-login — see this file’s own header comment)', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token-789' });
    apiClient.POST.mockReturnValue(Promise.resolve({ error: { message: 'conflict' }, response: { ok: false, status: 409 } as Response }));

    await expect(registerForPushNotificationsAsync()).resolves.toBeUndefined();
  });
});
