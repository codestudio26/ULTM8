import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { dayIn, dayToDate } from '../memberships/freeze/membership-freeze';
import { chargeRemaining, noticeMoney } from '../charges/charge-ledger';
import { formatInvoiceNumber } from '../charges/charge-maths';
import { CHARGE_DUE_REMINDER_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Daily, at 6:30am UTC: after the 5:30am charge-recurring run, so an
 * occurrence made today is in. */
const CRON_DAILY_AT_6_30AM_UTC = '30 6 * * *';
const REPEATABLE_JOB_ID = 'charge-due-reminder';
/** Lead time: the product owner, 30 Oct 2026 ("3 days before the due date", the same for every School). */
export const DUE_REMINDER_DAYS = 3;

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class ChargeDueReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(ChargeDueReminderScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(CHARGE_DUE_REMINDER_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...ChargeDueReminderScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_6_30AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable charge-due-reminder job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable charge-due-reminder job after all retries — due-date reminders will not go out until this succeeds.');
  }
}

export type ChargeDueReminderOutcome = { sent: number; switchedOff: number };

/**
 * Backlog §3.6 step 4 (Decision 338 item 10, "reminder before a charge is
 * due"): the member (a Guardian gets the usual copy) is told once, 3 days
 * before a charge's due date in the School's time zone (DUE_REMINDER_DAYS,
 * the product owner, 30 Oct 2026), while something is still owed on it.
 *
 * - Once per charge, ever: Charge.dueReminderAt is set in the same
 *   conditional update that claims it. A run that was missed catches up on
 *   the next day, as long as the charge isn't due yet.
 * - A charge created less than 3 days before its due date gets no reminder
 *   (the "New invoice" notice already gave the date). That includes late
 *   fees, which are due the day they are added, and recurring occurrences
 *   made on their own due date.
 * - Skipped: cancelled charges, and charges with nothing left to pay (paid,
 *   refunded off, or paid by credit: credit is put on open charges as soon as
 *   there is any, so what is still owed is already after credit). Closed
 *   Schools are skipped.
 * - A School that switched the reminder off has its charges marked handled
 *   without a notice, so switching it back on sends nothing old.
 */
@Processor(CHARGE_DUE_REMINDER_QUEUE)
export class ChargeDueReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ChargeDueReminderProcessor.name);

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
  async run(now: Date): Promise<ChargeDueReminderOutcome> {
    // Due within the next DUE_REMINDER_DAYS (+1 for time zones ahead of UTC);
    // each charge is checked below against its own School's day.
    const utcToday = dayIn(now, 'UTC');
    const latest = dayToDate(addDays(utcToday, DUE_REMINDER_DAYS + 1));
    const earliest = dayToDate(addDays(utcToday, -1));
    const candidates = await this.prismaJobs.charge.findMany({
      where: { cancelledAt: null, dueReminderAt: null, dueDate: { gte: earliest, lte: latest }, school: { archivedAt: null } },
      include: {
        allocations: { select: { amount: true } },
        school: { select: { timezone: true, chargeNoticeDueReminder: true } },
      },
    });
    const outcome: ChargeDueReminderOutcome = { sent: 0, switchedOff: 0 };
    for (const c of candidates) {
      const due = c.dueDate.toISOString().slice(0, 10);
      const today = dayIn(now, c.school.timezone);
      const remindOn = addDays(due, -DUE_REMINDER_DAYS);
      // From 3 days before until the day before the due date.
      if (today < remindOn || today >= due) continue;
      // Created less than 3 days before it was due: no reminder.
      if (dayIn(c.createdAt, c.school.timezone) > remindOn) continue;
      if (chargeRemaining(c) <= 0) continue;
      const claimed = await this.prismaJobs.charge.updateMany({ where: { id: c.id, dueReminderAt: null, cancelledAt: null }, data: { dueReminderAt: now } });
      if (claimed.count === 0) continue;
      if (!c.school.chargeNoticeDueReminder) {
        outcome.switchedOff++;
        continue;
      }
      await this.notify({
        notificationId: `charge-due-reminder-${c.id}`,
        userId: c.studentId,
        title: 'Payment due soon',
        body: `Invoice ${formatInvoiceNumber(c.invoiceNumber)} for ${c.description}: ${noticeMoney(chargeRemaining(c), c.currency)} is due on ${due}.`,
        type: 'CHARGE',
        schoolId: c.schoolId,
        targetType: 'PAYMENT',
        targetId: c.id,
      });
      outcome.sent++;
    }
    this.logger.log(`charge-due-reminder: ${outcome.sent} sent, ${outcome.switchedOff} switched off by the School.`);
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

/** YYYY-MM-DD plus `days` calendar days. */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
