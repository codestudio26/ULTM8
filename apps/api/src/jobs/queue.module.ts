import { Module } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import {
  OTP_DELIVERY_QUEUE,
  CLASS_OCCURRENCE_GENERATION_QUEUE,
  STRIPE_WEBHOOK_PROCESSING_QUEUE,
  WAIVER_SIGNATURE_REQUESTS_QUEUE,
  BOOKING_NO_SHOW_PROCESSING_QUEUE,
  WAITLIST_CASCADE_PROCESSING_QUEUE,
  NOTIFICATION_FANOUT_QUEUE,
  FRANCHISE_FEE_USAGE_REPORTING_QUEUE,
  TENANT_LIFECYCLE_PURGE_QUEUE,
  CHARGEBACK_PATTERN_RESTRICTION_QUEUE,
  MEMBERSHIP_EXPIRY_SWEEP_QUEUE,
  GRADING_NOTIFICATIONS_QUEUE,
  MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE,
  NOTIFICATION_UNSNOOZE_SWEEP_QUEUE,
  ENTITY_OFFBOARDING_PURGE_QUEUE,
  VIDEO_PROCESSING_POLL_QUEUE,
  FRANCHISE_FEE_RATE_MIGRATION_QUEUE,
  WAIVER_RENEWAL_SWEEP_QUEUE,
  CHARGE_AUTO_PAY_QUEUE,
  CHARGE_OVERDUE_NOTICE_QUEUE,
  CHARGE_DUE_REMINDER_QUEUE,
  LATE_FEE_QUEUE,
  CHARGE_RECURRING_QUEUE,
  LARGE_SCHOOL_CHECK_IN_CODES_QUEUE,
  MEMBERSHIP_EXPIRY_REMINDER_QUEUE,
  STUDENT_ABSENCE_ALERT_QUEUE,
  MEMBERSHIP_ENDING_REPORT_QUEUE,
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
function redisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL is not set — job enqueue/processing will fail until it is.');
  }
  const parsed = new URL(url ?? 'redis://localhost:6379');
  // ONE shared ioredis client for every Queue and Worker, instead of BullMQ's
  // default of a fresh connection per Queue plus two per Worker. With 17 queues
  // and 17 workers that default came to 52 connections from a single API
  // process, over the 50 a free Render Key Value allows — the staging API
  // crashed with "Connection is closed" on every redeploy. Sharing leaves only
  // each Worker's own blocking connection (BullMQ duplicates the client for
  // that), so the API now uses about 18.
  const client = new IORedis({
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    lazyConnect: true,
    // BullMQ's own documented requirement for a Worker's blocking connection — without
    // this, ioredis's default retry cap can make a Worker throw instead of retrying
    // indefinitely, which is the actually-correct behavior for something meant to keep
    // trying to reconnect rather than give up.
    maxRetriesPerRequest: null,
  });
  // Without a listener, ioredis reports connection errors as unhandled 'error'
  // events; log them instead (ioredis keeps reconnecting on its own).
  client.on('error', (err) => logger.warn(`Redis connection error: ${err.message}`));
  return client;
}

export {
  OTP_DELIVERY_QUEUE,
  CLASS_OCCURRENCE_GENERATION_QUEUE,
  STRIPE_WEBHOOK_PROCESSING_QUEUE,
  WAIVER_SIGNATURE_REQUESTS_QUEUE,
  BOOKING_NO_SHOW_PROCESSING_QUEUE,
  WAITLIST_CASCADE_PROCESSING_QUEUE,
  NOTIFICATION_FANOUT_QUEUE,
  FRANCHISE_FEE_USAGE_REPORTING_QUEUE,
  TENANT_LIFECYCLE_PURGE_QUEUE,
  CHARGEBACK_PATTERN_RESTRICTION_QUEUE,
  MEMBERSHIP_EXPIRY_SWEEP_QUEUE,
  GRADING_NOTIFICATIONS_QUEUE,
  MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE,
  NOTIFICATION_UNSNOOZE_SWEEP_QUEUE,
  ENTITY_OFFBOARDING_PURGE_QUEUE,
  VIDEO_PROCESSING_POLL_QUEUE,
  FRANCHISE_FEE_RATE_MIGRATION_QUEUE,
  WAIVER_RENEWAL_SWEEP_QUEUE,
  CHARGE_AUTO_PAY_QUEUE,
  CHARGE_OVERDUE_NOTICE_QUEUE,
  CHARGE_DUE_REMINDER_QUEUE,
  LATE_FEE_QUEUE,
  CHARGE_RECURRING_QUEUE,
  LARGE_SCHOOL_CHECK_IN_CODES_QUEUE,
  MEMBERSHIP_EXPIRY_REMINDER_QUEUE,
  STUDENT_ABSENCE_ALERT_QUEUE,
  MEMBERSHIP_ENDING_REPORT_QUEUE,
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
      { name: FRANCHISE_FEE_USAGE_REPORTING_QUEUE },
      { name: TENANT_LIFECYCLE_PURGE_QUEUE },
      { name: CHARGEBACK_PATTERN_RESTRICTION_QUEUE },
      { name: MEMBERSHIP_EXPIRY_SWEEP_QUEUE },
      { name: GRADING_NOTIFICATIONS_QUEUE },
      { name: MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE },
      { name: NOTIFICATION_UNSNOOZE_SWEEP_QUEUE },
      { name: ENTITY_OFFBOARDING_PURGE_QUEUE },
      { name: VIDEO_PROCESSING_POLL_QUEUE },
      { name: FRANCHISE_FEE_RATE_MIGRATION_QUEUE },
      { name: WAIVER_RENEWAL_SWEEP_QUEUE },
      { name: CHARGE_AUTO_PAY_QUEUE },
      { name: CHARGE_OVERDUE_NOTICE_QUEUE },
      { name: CHARGE_DUE_REMINDER_QUEUE },
      { name: LATE_FEE_QUEUE },
      { name: CHARGE_RECURRING_QUEUE },
      { name: LARGE_SCHOOL_CHECK_IN_CODES_QUEUE },
      { name: MEMBERSHIP_EXPIRY_REMINDER_QUEUE },
      { name: STUDENT_ABSENCE_ALERT_QUEUE },
      { name: MEMBERSHIP_ENDING_REPORT_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
