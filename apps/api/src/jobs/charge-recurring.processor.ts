import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { runSeries } from '../charges/recurring-occurrences';
import { addDays, dayValue, schoolToday } from '../charges/recurring-schedule';
import { CHARGE_RECURRING_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/**
 * Daily at 5:30am UTC: half an hour before charge-auto-pay (6am UTC), so a
 * charge made today is paid automatically on the same run for a member who
 * turned that on. charge-auto-pay takes every charge due today or earlier
 * that was never tried, so a charge made late (this job slow, or down) is
 * still picked up on its next run.
 */
const CRON_DAILY_AT_0530_UTC = '30 5 * * *';
const REPEATABLE_JOB_ID = 'charge-recurring';

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class ChargeRecurringScheduler implements OnModuleInit {
  private readonly logger = new Logger(ChargeRecurringScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(CHARGE_RECURRING_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...ChargeRecurringScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_0530_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable charge-recurring job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable charge-recurring job after all retries — recurring charges will not be made until this succeeds.');
  }
}

export type ChargeRecurringOutcome = { created: number; skipped: number; stopped: number; failed: number };

/**
 * Backlog §3.6 step 3 (Decision 412): makes each recurring charge's
 * occurrences on their day, in the School's time zone, as normal charges
 * (recurring-occurrences.ts runSeries): one per series and date, so a rerun
 * never doubles, and one per missed occurrence after days without a run.
 * Each new charge sends step 1's "New invoice" notice.
 *
 * Which series: not stopped, not ended, whose next date is on or before the
 * latest calendar day anywhere (UTC + 14 hours); runSeries then compares it
 * with the School's own day.
 */
@Processor(CHARGE_RECURRING_QUEUE)
export class ChargeRecurringProcessor extends WorkerHost {
  private readonly logger = new Logger(ChargeRecurringProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.run(new Date());
  }

  /** Separate from process() so tests can pass the date. */
  async run(now: Date): Promise<ChargeRecurringOutcome> {
    const latestDay = addDays(schoolToday(now, 'UTC'), 1);
    const series = await this.prismaJobs.recurringCharge.findMany({
      where: { stoppedAt: null, nextDate: { not: null, lte: dayValue(latestDay) } },
      select: { id: true, studentId: true, schoolId: true },
      orderBy: [{ nextDate: 'asc' }, { id: 'asc' }],
    });
    const total: ChargeRecurringOutcome = { created: 0, skipped: 0, stopped: 0, failed: 0 };
    for (const s of series) {
      try {
        const result = await runSeries(this.prismaJobs, s.id, now);
        total.created += result.created.length;
        total.skipped += result.skipped;
        if (result.studentLeft) total.stopped++;
        for (const n of result.created) {
          await this.notify({ notificationId: n.key, userId: s.studentId, title: n.title, body: n.body, type: 'CHARGE', schoolId: s.schoolId, targetType: 'PAYMENT', targetId: n.targetId });
        }
      } catch (err) {
        total.failed++;
        this.logger.error(`charge-recurring: series ${s.id} failed; tried again on the next run.`, err as Error);
      }
    }
    this.logger.log(`charge-recurring: ${total.created} charges made, ${total.skipped} skipped (School closed or degraded), ${total.stopped} series stopped (student left), ${total.failed} failed.`);
    return total;
  }

  /** Best-effort, as ChargesService.notify(): a notice that fails to enqueue never undoes the charge. */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the charge notice ${data.notificationId}: ${err}`);
    }
  }
}
