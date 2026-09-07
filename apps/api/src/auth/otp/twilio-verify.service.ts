import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Twilio } from 'twilio';
import { OTP_DELIVERY_QUEUE } from '../../jobs/queue.constants';

/**
 * Twilio Verify integration (Spec 55 §11.4 — confirmed OTP provider, "the purpose-
 * built OTP product, not Twilio's generic Messaging API"). Scoped to registration and
 * passcode-recovery verification only, per Decision 72's own follow-up note: that
 * boundary (OTP for registration/recovery, not routine login) is asserted by the task
 * that scoped this module, not independently re-derived here.
 *
 * `sendOtp()` now enqueues onto the `otp-delivery` BullMQ queue (Phase 5) instead of
 * calling Twilio synchronously — closes the exact gap this file's own header comment
 * flagged since Phase 1 ("a slow/failed Twilio call currently blocks the request
 * instead of being queued and retried"). `sendOtpNow()` is the real Twilio call,
 * called by `OtpDeliveryProcessor` (src/jobs/), not by callers of this service
 * directly. `checkOtp()` (verification) stays synchronous — only the send side has a
 * queue in Spec 55's confirmed design.
 *
 * `sendOtp()` still checks configuration synchronously before enqueueing (code review
 * caught that the original version of this change lost that signal entirely — the
 * caller previously got an immediate throw for "Twilio isn't configured at all," and
 * after this queue was introduced would instead get a silent 200 response with the
 * job failing invisibly in the background 3 retries later, with nothing anywhere
 * listening for that failure). This restores the fail-fast behavior for the actually-
 * common failure mode (misconfiguration, which will fail identically on every retry)
 * while still queueing — and retrying — the rarer case a *configured* Twilio call
 * itself fails transiently (a real outage worth retrying). `OtpDeliveryProcessor` also
 * now logs loudly when a job exhausts its retries, so a transient-but-real delivery
 * failure isn't completely invisible either, even though this codebase has no
 * alerting/health-check infrastructure to do more than log it yet.
 */
@Injectable()
export class TwilioVerifyService {
  private readonly logger = new Logger(TwilioVerifyService.name);
  private readonly client: Twilio | null;
  private readonly verifyServiceSid: string | undefined;

  constructor(@InjectQueue(OTP_DELIVERY_QUEUE) private readonly otpDeliveryQueue: Queue) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!accountSid || !authToken || !this.verifyServiceSid) {
      this.logger.warn(
        'Twilio Verify is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_VERIFY_SERVICE_SID) — OTP send/verify will fail until it is.',
      );
      this.client = null;
      return;
    }
    this.client = new Twilio(accountSid, authToken);
  }

  /** Enqueues delivery — does not itself call Twilio. Resolves once the job is
   * accepted by Redis, not once the SMS actually sends; a slow/failed Twilio call no
   * longer blocks the caller's request. Retry/backoff is configured on the job
   * (3 attempts, exponential backoff — a reasonable default, flagged for Architect
   * review same as everything else inferred in this phase, not independently
   * spec-confirmed). */
  async sendOtp(phone: string): Promise<void> {
    this.assertConfigured();
    await this.otpDeliveryQueue.add(
      'send',
      { phone },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }

  /** The real Twilio call — used only by OtpDeliveryProcessor. */
  async sendOtpNow(phone: string): Promise<void> {
    this.assertConfigured();
    await this.client!.verify.v2
      .services(this.verifyServiceSid!)
      .verifications.create({ to: phone, channel: 'sms' });
  }

  async checkOtp(phone: string, code: string): Promise<boolean> {
    this.assertConfigured();
    const result = await this.client!.verify.v2
      .services(this.verifyServiceSid!)
      .verificationChecks.create({ to: phone, code });
    return result.status === 'approved';
  }

  private assertConfigured() {
    if (!this.client || !this.verifyServiceSid) {
      throw new Error(
        'TwilioVerifyService is not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID',
      );
    }
  }
}
