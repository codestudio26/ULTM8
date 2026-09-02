import { Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';

/**
 * Twilio Verify integration (Spec 55 §11.4 — confirmed OTP provider, "the purpose-
 * built OTP product, not Twilio's generic Messaging API"). Scoped to registration and
 * passcode-recovery verification only, per Decision 72's own follow-up note: that
 * boundary (OTP for registration/recovery, not routine login) is asserted by the task
 * that scoped this module, not independently re-derived here.
 *
 * Synchronous, direct API calls for this walking skeleton — Spec §9's confirmed job
 * list routes OTP delivery through a BullMQ `otp-delivery` queue in production, but
 * Redis/BullMQ aren't part of Phase 1's four scoped items. Flagged as a gap to close
 * before this handles real traffic (a slow/failed Twilio call currently blocks the
 * request instead of being queued and retried).
 */
@Injectable()
export class TwilioVerifyService {
  private readonly logger = new Logger(TwilioVerifyService.name);
  private readonly client: Twilio | null;
  private readonly verifyServiceSid: string | undefined;

  constructor() {
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

  async sendOtp(phone: string): Promise<void> {
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
