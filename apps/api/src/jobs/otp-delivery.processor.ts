import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TwilioVerifyService } from '../auth/otp/twilio-verify.service';
import { OTP_DELIVERY_QUEUE } from './queue.constants';

/**
 * Consumes the `otp-delivery` queue (Phase 5) — makes the real Twilio call
 * TwilioVerifyService.sendOtp() used to make synchronously. Retry/backoff is
 * configured on the job itself when it's enqueued (see TwilioVerifyService.sendOtp),
 * not here.
 *
 * `onFailed` logs loudly once a job has exhausted every retry attempt — code review
 * caught that without this, a genuine delivery failure (Twilio configured but the API
 * call itself keeps failing — a real outage, not a typo in the account SID) had
 * *nothing* surfacing it anywhere once BullMQ gave up: the job just sat in Redis's
 * failed-job set forever. This doesn't add real alerting (this codebase has none yet),
 * but it means the failure is at least visible in application logs, matching the
 * "warn/error, don't silently do nothing" convention used everywhere else here
 * (PrismaAppService, QueueModule, ClassOccurrenceGenerationScheduler).
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

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ phone: string }> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `OTP delivery permanently failed after ${attemptsMade} attempt(s) for job ${job.id} — the user was never sent a code.`,
        error,
      );
    }
  }
}
