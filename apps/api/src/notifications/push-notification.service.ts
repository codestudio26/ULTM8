import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

/**
 * Push notification SEND (Decision 223/264) — FCM only, for BOTH platforms
 * (Decision 250: "FCM can deliver to APNs under the hood for iOS, so the
 * backend needs one integration point... instead of maintaining a separate
 * direct-APNs client"). `DeviceToken.token` is expected to be a real FCM
 * registration token regardless of `platform` — on iOS that token only
 * exists once the client app links a real Firebase project (see
 * apps/student's own `pushRegistration.ts` header comment for the client
 * side of this), which this environment does not have.
 *
 * Same "warn on missing config, don't throw at construction, fail on first
 * actual use" convention R2ClientService/CloudflareStreamService/
 * NotificationDeliveryService already established for every other
 * unconfigured external dependency here. Firebase Admin SDK (not a hand-rolled
 * OAuth2/JWT client over raw `fetch`, unlike CloudflareStreamService) — FCM's
 * HTTP v1 API requires a signed Google OAuth2 access token per call, which is
 * exactly what `firebase-admin` exists to handle correctly; hand-rolling that
 * would be reinventing a vendor's own official SDK, the one case this
 * codebase's usual "avoid an HTTP-client dependency it doesn't otherwise
 * need" reasoning (CloudflareStreamService's own header comment) doesn't
 * apply to — same as R2ClientService using `@aws-sdk/client-s3` rather than
 * hand-rolling S3's request signing.
 *
 * Still blocked on real credentials (Decision 223/250's own "Still blocked"
 * note) — this service's constructor and config-check logic are fully real
 * and testable without them (see push-notification.service.spec.ts); only
 * the actual outbound call to Firebase needs real FCM_PROJECT_ID/
 * FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY to do anything.
 */
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly app: admin.app.App | null;

  constructor() {
    const projectId = process.env.FCM_PROJECT_ID;
    const clientEmail = process.env.FCM_CLIENT_EMAIL;
    const privateKey = process.env.FCM_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY are not set — push notification delivery will fail until they are.',
      );
      this.app = null;
      return;
    }

    this.app = admin.initializeApp(
      {
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          // Env vars can't carry a literal newline — the standard escape
          // convention every Firebase Admin service-account guide uses for
          // this exact var, since the key's PEM body is itself multi-line.
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      },
      // Named, not the default app — a second PushNotificationService
      // instance (e.g. in a test module) re-initializing the SDK under the
      // default app name throws ("already exists"); firebase-admin keys
      // named apps by this string, so collisions are scoped to one project id.
      `push-notification-${projectId}`,
    );
  }

  private assertConfigured(): admin.app.App {
    if (!this.app) {
      throw new Error('PushNotificationService is not configured — set FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY');
    }
    return this.app;
  }

  /**
   * Sends one notification to every token given, in a single FCM multicast
   * call. A token FCM reports as unregistered/invalid is returned in
   * `staleTokens` — FCM's own documented signal that the app was uninstalled
   * or the token rotated (there is no separate webhook for this; a failed
   * send IS the mechanism) — so the caller (NotificationFanoutProcessor) can
   * delete that DeviceToken row rather than retrying it forever.
   */
  async send(tokens: string[], title: string, body: string): Promise<{ sent: number; staleTokens: string[] }> {
    if (tokens.length === 0) return { sent: 0, staleTokens: [] };
    const app = this.assertConfigured();

    const response = await admin.messaging(app).sendEachForMulticast({ tokens, notification: { title, body } });

    const staleTokens: string[] = [];
    response.responses.forEach((result, i) => {
      if (!result.success && isStaleTokenErrorCode(result.error?.code)) {
        staleTokens.push(tokens[i]);
      }
    });

    return { sent: response.successCount, staleTokens };
  }
}

function isStaleTokenErrorCode(code: string | undefined): boolean {
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}
