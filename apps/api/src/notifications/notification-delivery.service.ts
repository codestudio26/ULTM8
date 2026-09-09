import { Injectable, Logger } from '@nestjs/common';
import * as postmark from 'postmark';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/**
 * Email delivery — Spec 55 §11.4's confirmed decision: "email uses Postmark for
 * transactional delivery... AWS SES is the named fallback (Decision 34)... a
 * failed send routed to a dead-letter queue and surfaced to Platform Admin
 * rather than silently dropped."
 *
 * Same "warn on missing config, don't throw at construction, fail on first
 * actual use" convention StripeClientService/TwilioVerifyService already
 * established for every other unconfigured external dependency in this
 * codebase — see either's own header comment.
 *
 * "Surfaced to Platform Admin" is deliberately NOT built — PlatformAdminModule
 * doesn't exist yet (blocked on an SSO vendor decision, see the project
 * roadmap). A total delivery failure (both Postmark and SES fail, or neither
 * is configured) is logged loudly instead, matching the exact precedent
 * OtpDeliveryProcessor already established for "logs loudly when a job
 * exhausts its retries" — the closest existing analog to a dead-letter
 * surface this codebase has. Revisit once PlatformAdminModule ships.
 *
 * `sendEmail()` throws on total failure (both providers failed, or neither is
 * configured) rather than swallowing — its own caller (NotificationFanoutProcessor)
 * decides whether that should fail the whole job or just be logged, since the
 * Notification row itself (not email) is this module's durable source of
 * truth. See that processor's own header comment.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);
  private readonly postmarkClient: postmark.ServerClient | null;
  private readonly sesClient: SESv2Client | null;
  private readonly fromEmail: string | undefined;

  constructor() {
    this.fromEmail = process.env.NOTIFICATIONS_FROM_EMAIL;
    if (!this.fromEmail) {
      this.logger.warn('NOTIFICATIONS_FROM_EMAIL is not set — email notifications will fail until it is.');
    }

    const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
    if (!postmarkToken) {
      this.logger.warn('POSTMARK_SERVER_TOKEN is not set — Postmark email delivery will fail until it is.');
      this.postmarkClient = null;
    } else {
      this.postmarkClient = new postmark.ServerClient(postmarkToken);
    }

    const sesRegion = process.env.AWS_SES_REGION;
    if (!sesRegion) {
      this.logger.warn('AWS_SES_REGION is not set — the AWS SES email fallback will be unavailable until it is.');
      this.sesClient = null;
    } else {
      // Credentials resolve via the AWS SDK's standard provider chain (env vars,
      // shared config file, or an IAM role in a real deployment) — no explicit
      // access-key env var here, matching how this codebase never hand-rolls
      // credential plumbing a vendor SDK already does correctly.
      this.sesClient = new SESv2Client({ region: sesRegion });
    }
  }

  /**
   * Postmark first, AWS SES on Postmark failure (§11.4's confirmed fallback
   * order). Throws only once every configured provider has been tried and
   * failed (or none is configured) — a single provider's transient failure is
   * recovered by the fallback, not surfaced to the caller.
   *
   * FOUND ON REVIEW: an earlier draft's two separate try/catch blocks produced
   * a misleading final error in two real cases — Postmark configured+fails
   * with SES unconfigured fell through to "no provider configured" (discarding
   * the real Postmark error), and SES-only configured+fails claimed "both
   * Postmark and AWS SES failed" when Postmark was never attempted at all.
   * This version tracks exactly which providers were actually tried and what
   * each one's own error was, so the final message (and the one thrown/logged
   * on total failure) accurately reflects what happened rather than assuming
   * a fixed two-provider shape.
   */
  async sendEmail(to: string, subject: string, textBody: string): Promise<void> {
    if (!this.fromEmail) {
      throw new Error('NotificationDeliveryService is not configured — set NOTIFICATIONS_FROM_EMAIL');
    }

    const attempts: string[] = [];

    if (this.postmarkClient) {
      try {
        await this.postmarkClient.sendEmail({ From: this.fromEmail, To: to, Subject: subject, TextBody: textBody });
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push(`Postmark: ${message}`);
        this.logger.warn(`Postmark send to ${to} failed, trying the next configured provider: ${message}`);
      }
    }

    if (this.sesClient) {
      try {
        await this.sesClient.send(
          new SendEmailCommand({
            FromEmailAddress: this.fromEmail,
            Destination: { ToAddresses: [to] },
            Content: {
              Simple: {
                Subject: { Data: subject },
                Body: { Text: { Data: textBody } },
              },
            },
          }),
        );
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push(`AWS SES: ${message}`);
      }
    }

    if (attempts.length === 0) {
      throw new Error(`No email provider is configured (POSTMARK_SERVER_TOKEN/AWS_SES_REGION) — could not deliver to ${to}.`);
    }
    throw new Error(`Every configured email provider failed to deliver to ${to} — ${attempts.join('; ')}`);
  }
}
