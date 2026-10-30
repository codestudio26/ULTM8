import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { dayIn } from '../memberships/freeze/membership-freeze';
import { chargeRemaining, noticeMoney } from '../charges/charge-ledger';
import { formatInvoiceNumber } from '../charges/charge-maths';
import { CHARGE_OVERDUE_NOTICE_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Daily, at 7am UTC: after the 6am charge-auto-pay run, so a charge the
 * saved card paid on its due date is never called overdue. */
const CRON_DAILY_AT_7AM_UTC = '0 7 * * *';
const REPEATABLE_JOB_ID = 'charge-overdue-notice';

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class ChargeOverdueNoticeScheduler implements OnModuleInit {
  private readonly logger = new Logger(ChargeOverdueNoticeScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(CHARGE_OVERDUE_NOTICE_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...ChargeOverdueNoticeScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_7AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable charge-overdue-notice job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable charge-overdue-notice job after all retries — overdue notices will not go out until this succeeds.');
  }
}

export type ChargeOverdueNoticeOutcome = { sent: number; switchedOff: number };

/**
 * Backlog §3.6 step 4 (Decision 338 item 10, "failed or overdue payment"):
 * the member (a Guardian gets the usual copy) is told once a charge is
 * overdue: the day after its due date in the School's time zone, while
 * something is still owed. Once per charge, ever: Charge.overdueNoticeAt is set
 * in the same conditional update that claims it, so two runs never both send.
 * A School that switched the notice off has its charges marked handled without
 * a notice, so switching it back on later doesn't send a pile of old ones.
 * Cancelled charges, paid ones and closed Schools are skipped. Not built: the
 * reminder before a charge is due (Decision 338 item 10 names it, but no
 * decision says how many days before; asked of the product owner).
 */
@Processor(CHARGE_OVERDUE_NOTICE_QUEUE)
export class ChargeOverdueNoticeProcessor extends WorkerHost {
  private readonly logger = new Logger(ChargeOverdueNoticeProcessor.name);

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
  async run(now: Date): Promise<ChargeOverdueNoticeOutcome> {
    // Every time zone's "today" is at most a day after UTC's, so a charge due
    // before UTC's today + 1 may be overdue somewhere; each is checked below
    // against its own School's day.
    const latest = new Date(`${dayIn(now, 'UTC')}T00:00:00.000Z`);
    latest.setUTCDate(latest.getUTCDate() + 1);
    const candidates = await this.prismaJobs.charge.findMany({
      where: { cancelledAt: null, overdueNoticeAt: null, dueDate: { lt: latest }, school: { archivedAt: null } },
      include: {
        allocations: { select: { amount: true } },
        school: { select: { timezone: true, chargeNoticeFailedOverdue: true } },
      },
    });
    const outcome: ChargeOverdueNoticeOutcome = { sent: 0, switchedOff: 0 };
    for (const c of candidates) {
      const due = c.dueDate.toISOString().slice(0, 10);
      if (due >= dayIn(now, c.school.timezone)) continue;
      if (chargeRemaining(c) <= 0) continue;
      const claimed = await this.prismaJobs.charge.updateMany({ where: { id: c.id, overdueNoticeAt: null, cancelledAt: null }, data: { overdueNoticeAt: now } });
      if (claimed.count === 0) continue;
      if (!c.school.chargeNoticeFailedOverdue) {
        outcome.switchedOff++;
        continue;
      }
      await this.notify({
        notificationId: `charge-overdue-${c.id}`,
        userId: c.studentId,
        title: 'Payment overdue',
        body: `Invoice ${formatInvoiceNumber(c.invoiceNumber)} for ${c.description} was due on ${due}. ${noticeMoney(chargeRemaining(c), c.currency)} is still to pay.`,
        type: 'CHARGE',
        schoolId: c.schoolId,
        targetType: 'PAYMENT',
        targetId: c.id,
      });
      outcome.sent++;
    }
    this.logger.log(`charge-overdue-notice: ${outcome.sent} sent, ${outcome.switchedOff} switched off by the School.`);
    return outcome;
  }

  /** Best-effort, as ChargesService.notify(). */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the charge notice ${data.notificationId}: ${err}`);
    }
  }
}
