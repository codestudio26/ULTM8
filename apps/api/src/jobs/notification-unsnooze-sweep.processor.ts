import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { NOTIFICATION_UNSNOOZE_SWEEP_QUEUE } from './queue.constants';

/** How often the sweep runs — same Developer-level choice (and same caveat:
 * flagged for Architect review, not a confirmed business rule) as
 * BookingNoShowProcessingScheduler's own CRON_EVERY_15_MINUTES, which this
 * mirrors — frequent enough that a snoozed Notification reliably returns to
 * the unread list close to when it elapses, without a dedicated per-row timer. */
const CRON_EVERY_15_MINUTES = '*/15 * * * *';
const REPEATABLE_JOB_ID = 'notification-unsnooze-sweep';

/**
 * Registers the notification-unsnooze-sweep repeatable job on module init —
 * same fixed-jobId / not-awaited / bounded-retry-with-backoff pattern as
 * BookingNoShowProcessingScheduler/ClassOccurrenceGenerationScheduler (see
 * either class's own doc comment for the full reasoning, not repeated here).
 */
@Injectable()
export class NotificationUnsnoozeSweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationUnsnoozeSweepScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(NOTIFICATION_UNSNOOZE_SWEEP_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...NotificationUnsnoozeSweepScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_EVERY_15_MINUTES }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable notification-unsnooze-sweep job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable notification-unsnooze-sweep job after all retries — ' +
        'an elapsed Snooze will only be reflected live (NotificationsService.getCountsForCaller already computes it ' +
        'live either way) but the stored snoozedUntil column will never be cleared until this succeeds.',
    );
  }
}

/**
 * Consumes the notification-unsnooze-sweep queue (v1.2 backend backlog —
 * Notifications page Snooze, approved by the product owner) — clears
 * `Notification.snoozedUntil` once it elapses, returning the Notification to
 * the ordinary unread list in storage. Runs via PrismaJobsService
 * (ultm8_jobs), NOT PrismaAppService — a genuine cross-tenant sweep with no
 * single caller, same reasoning every other scheduled job in this codebase
 * already uses (class-occurrence-generation, booking-no-show-processing).
 *
 * Deliberately NOT the only place this business rule is enforced —
 * NotificationsService.getCountsForCaller already live-computes "snoozed"
 * (snoozedUntil in the future) for its own unread total, the same
 * live-computed-first convention Membership.status's own expiry already
 * established in this codebase. This sweep exists so the STORED state
 * (`snoozedUntil` itself, and therefore anything else that might read it
 * directly in future — e.g. a "Snoozed" filter/badge) doesn't keep showing a
 * Notification as snoozed indefinitely once its time has actually passed.
 */
@Processor(NOTIFICATION_UNSNOOZE_SWEEP_QUEUE)
export class NotificationUnsnoozeSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationUnsnoozeSweepProcessor.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const result = await this.prismaJobs.notification.updateMany({
      where: { snoozedUntil: { not: null, lte: new Date() } },
      data: { snoozedUntil: null },
    });
    this.logger.log(`notification-unsnooze-sweep: ${result.count} Notification(s) un-snoozed.`);
  }
}
