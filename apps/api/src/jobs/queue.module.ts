import { Module } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  OTP_DELIVERY_QUEUE,
  CLASS_OCCURRENCE_GENERATION_QUEUE,
  STRIPE_WEBHOOK_PROCESSING_QUEUE,
  WAIVER_SIGNATURE_REQUESTS_QUEUE,
  BOOKING_NO_SHOW_PROCESSING_QUEUE,
  WAITLIST_CASCADE_PROCESSING_QUEUE,
  NOTIFICATION_FANOUT_QUEUE,
} from './queue.constants';

const logger = new Logger('QueueModule');

/**
 * First Redis/BullMQ infrastructure in this codebase (Phase 5) — closes two
 * previously-flagged gaps at once: TwilioVerifyService's own header comment ("Spec §9's
 * confirmed job list routes OTP delivery through a BullMQ `otp-delivery` queue in
 * production, but Redis/BullMQ aren't part of Phase 1's four scoped items") and
 * TimetableModule's class-occurrence-generation job, which needs a real repeatable-job
 * scheduler, not `@nestjs/schedule` — Spec §9's confirmed job list treats every job the
 * same way, and mixing two scheduling mechanisms for no reason isn't worth the
 * inconsistency.
 *
 * Follows this codebase's established pattern for an unconfigured external dependency
 * (PrismaAppService, TwilioVerifyService): warn and let the app boot without Redis
 * reachable, defer the actual failure to when a queue operation is attempted, rather
 * than crashing at startup. `lazyConnect: true` is what makes that true for BullMQ's
 * underlying ioredis client specifically — without it, ioredis attempts to connect
 * immediately on construction regardless of whether anything has enqueued a job yet.
 */
function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL is not set — job enqueue/processing will fail until it is.');
  }
  const parsed = new URL(url ?? 'redis://localhost:6379');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    lazyConnect: true,
    // BullMQ's own documented requirement for a Worker's blocking connection — without
    // this, ioredis's default retry cap can make a Worker throw instead of retrying
    // indefinitely, which is the actually-correct behavior for something meant to keep
    // trying to reconnect rather than give up.
    maxRetriesPerRequest: null,
  };
}

export {
  OTP_DELIVERY_QUEUE,
  CLASS_OCCURRENCE_GENERATION_QUEUE,
  STRIPE_WEBHOOK_PROCESSING_QUEUE,
  WAIVER_SIGNATURE_REQUESTS_QUEUE,
  BOOKING_NO_SHOW_PROCESSING_QUEUE,
  WAITLIST_CASCADE_PROCESSING_QUEUE,
  NOTIFICATION_FANOUT_QUEUE,
};

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue(
      { name: OTP_DELIVERY_QUEUE },
      { name: CLASS_OCCURRENCE_GENERATION_QUEUE },
      { name: STRIPE_WEBHOOK_PROCESSING_QUEUE },
      { name: WAIVER_SIGNATURE_REQUESTS_QUEUE },
      { name: BOOKING_NO_SHOW_PROCESSING_QUEUE },
      { name: WAITLIST_CASCADE_PROCESSING_QUEUE },
      { name: NOTIFICATION_FANOUT_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
