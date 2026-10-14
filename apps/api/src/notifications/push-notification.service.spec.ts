import { PushNotificationService } from './push-notification.service';

/**
 * Covers only the config-check logic — pure, no network, no mocking of the
 * Firebase Admin SDK needed (initializeApp() with any shape of credential
 * object is itself inert; it never makes a network call on its own). The
 * actual dispatch call and FCM-response/stale-token handling is deliberately
 * NOT unit-tested here, same precedent as this codebase's other vendor
 * wrappers (R2ClientService, CloudflareStreamService, NotificationDeliveryService
 * — none of which has its own *.spec.ts either): see
 * notifications.e2e-spec.ts's `fakePush` injection into
 * NotificationFanoutProcessor for that coverage instead, the exact same
 * fake-injection shape that file's own `fakeDelivery` already established
 * for NotificationDeliveryService.
 */
describe('PushNotificationService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_CLIENT_EMAIL;
    delete process.env.FCM_PRIVATE_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not throw at construction when unconfigured — warns instead (same convention as every other vendor service)', () => {
    expect(() => new PushNotificationService()).not.toThrow();
  });

  it('send() rejects on first actual use when unconfigured, naming the missing env vars', async () => {
    const service = new PushNotificationService();
    await expect(service.send(['token-1'], 'Title', 'Body')).rejects.toThrow(
      'PushNotificationService is not configured — set FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY',
    );
  });

  it('send() with an empty token list no-ops without requiring configuration at all', async () => {
    const service = new PushNotificationService();
    await expect(service.send([], 'Title', 'Body')).resolves.toEqual({ sent: 0, staleTokens: [] });
  });

  // FOUND ON REVIEW: `admin.credential.cert()` is not as inert as this file's
  // own header comment first assumed — it parses the private key's DER
  // structure EAGERLY, at construction, not lazily on first real API call. A
  // genuinely malformed (non-PEM) key now throws from the constructor rather
  // than failing later inside send() — stricter than this service's own
  // documented "don't throw at construction" convention intends for a merely
  // UNCONFIGURED service, but a deliberately malformed one is a different,
  // narrower case this test doesn't attempt to construct (it would need a
  // real RSA key pair to produce a FCM_PRIVATE_KEY value that parses
  // successfully, which buys this suite nothing a live e2e credential
  // wouldn't already need). Not unit-tested here for that reason — see this
  // file's own header comment for where the "configured" path is covered
  // instead.
});
