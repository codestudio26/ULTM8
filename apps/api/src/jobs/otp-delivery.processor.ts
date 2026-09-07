import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TwilioVerifyService } from '../auth/otp/twilio-verify.service';
import { OTP_DELIVERY_QUEUE } from './queue.constants';

/**
 * Consumes the `otp-delivery` queue (Phase 5) — makes the real Twilio call
 * TwilioVerifyService.sendOtp() used to make synchronously. Retry/backoff is
 * configured on the job itself when it's enqueued (see TwilioVerifyService.sendOtp),
 * not here.
 */
@Processor(OTP_DELIVERY_QUEUE)
export class OtpDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(OtpDeliveryProcessor.name);

  constructor(private readonly twilioVerify: TwilioVerifyService) {
    super();
  }

  async process(job: Job<{ phone: string }>): Promise<void> {
    await this.twilioVerify.sendOtpNow(job.data.phone);
  }
}
