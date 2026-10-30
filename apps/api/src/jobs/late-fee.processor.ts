import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { trialEndedUnpaid } from '../subscription-plans/subscription-gate.service';
import { dayIn, dayNumber, dayString, dayToDate } from '../memberships/freeze/membership-freeze';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { lockBalance } from '../charges/charge-ledger';
import { insertCharge, lockInvoiceNumbers } from '../charges/charge-insert';
import { computeCharge, formatInvoiceNumber } from '../charges/charge-maths';
import { LateFeeSetting, isLateFeeDue, lateFeeAmount } from '../late-fees/late-fee-maths';
import {
  lateFeeDescriptionForCharge,
  lateFeeDescriptionForRenewal,
  lateFeeForChargeNotice,
  lateFeeForRenewalNotice,
} from '../late-fees/late-fee-notices';
import { LATE_FEE_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

type Tx = Prisma.TransactionClient;

/** Daily, at 7am UTC: after charge-auto-pay (6am), so a charge paid
 * automatically on its due date is settled before late fees are looked at. */
const CRON_DAILY_AT_7AM_UTC = '0 7 * * *';
const REPEATABLE_JOB_ID = 'late-fee';

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class LateFeeScheduler implements OnModuleInit {
  private readonly logger = new Logger(LateFeeScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(LATE_FEE_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...LateFeeScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_7AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable late-fee job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable late-fee job after all retries — late fees will not be added until this succeeds.');
  }
}

export type LateFeeOutcome = { added: number; skipped: number };

type School = {
  id: string;
  timezone: string | null;
  defaultCurrency: string | null;
  taxCountry: string | null;
  taxRateBasisPoints: number;
  taxInclusive: boolean;
  lateFeeType: 'FIXED' | 'PERCENT';
  lateFeeFixedAmount: number | null;
  lateFeePercentBps: number | null;
  lateFeeGraceDays: number;
  lateFeeEnabledAt: Date | null;
};

/** What one late fee is for, worked out under the member's balance lock. */
type Overdue = {
  studentId: string;
  /** What is still owed (Decision 413 item 6): a charge's remaining amount
   * including tax, or the renewal invoice's amount due. */
  owed: number;
  currency: string;
  link: { lateFeeForChargeId: string } | { lateFeeForTransactionId: string };
  description: string;
  /** The member's notice, once the fee (with any tax added on top) is known. */
  notice: (fee: number, currency: string) => { title: string; body: string };
};

/**
 * Late fees (v1.3 backlog §3.7; Decision 413). Once a day, for each School
 * with late fees on, in the School's time zone:
 *
 * - Which payments: (a) a charge (one-off, or a recurring charge's occurrence:
 *   both are ordinary Charge rows) not cancelled and still not fully paid after
 *   its due date plus the grace days; (b) a card Subscription renewal Stripe
 *   couldn't collect: a RENEWAL Transaction still FAILED (Decision 346, keyed on
 *   the Stripe invoice) after its invoice date plus the grace days. A renewal
 *   paid within the grace period has turned SUCCESSFUL on the same row, so it
 *   gets nothing. Cash and bank-transfer membership payments waiting at the
 *   desk are not late fees' business (they have no due date).
 * - Only payments whose grace period ends on or after the day the School
 *   switched late fees on: switching them on is never retroactive.
 * - One late fee per payment, ever: the fee's link to the payment is unique,
 *   so a rerun (or two runs at once) never adds a second. A late fee never
 *   gets its own late fee.
 * - How much: the fixed amount (in the School's currency), or the % of what is
 *   still owed (a charge's remaining amount including tax; a renewal's amount
 *   due), rounded half up. The School's tax settings apply to the fee as to any
 *   charge (Decision 411), and it keeps them.
 * - Never charged to a card: it is a charge on the member's balance, due
 *   today, paid in the app or at the desk; charge-auto-pay skips late fees.
 *   Credit already on the balance pays it, as for any new charge.
 * - Skipped: a closed or degraded School, a former student (no current
 *   student role at the School).
 * - The member gets "Late fee added" (a Guardian the usual copy).
 */
@Processor(LATE_FEE_QUEUE)
export class LateFeeProcessor extends WorkerHost {
  private readonly logger = new Logger(LateFeeProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.run(new Date());
  }

  /** Separate from process() so tests can pass the date, and one School. */
  async run(now: Date, onlySchoolIds?: string[]): Promise<LateFeeOutcome> {
    const schools = await this.prismaJobs.school.findMany({
      where: { lateFeeEnabled: true, archivedAt: null, ...(onlySchoolIds ? { id: { in: onlySchoolIds } } : {}) },
      select: {
        id: true,
        timezone: true,
        defaultCurrency: true,
        taxCountry: true,
        taxRateBasisPoints: true,
        taxInclusive: true,
        lateFeeType: true,
        lateFeeFixedAmount: true,
        lateFeePercentBps: true,
        lateFeeGraceDays: true,
        lateFeeEnabledAt: true,
        platformSubscriptionStatus: true,
        platformTrialEndsAt: true,
      },
    });
    const total: LateFeeOutcome = { added: 0, skipped: 0 };
    for (const school of schools) {
      // Degraded (Spec 55 §10.2): no new payments, so no new charges either.
      if (school.platformSubscriptionStatus === 'CANCELED' || trialEndedUnpaid(school, now)) continue;
      try {
        const outcome = await this.runSchool(school, now);
        total.added += outcome.added;
        total.skipped += outcome.skipped;
      } catch (err) {
        this.logger.error(`late-fee: School ${school.id} failed; tried again on the next run.`, err as Error);
      }
    }
    this.logger.log(`late-fee: ${total.added} added, ${total.skipped} skipped.`);
    return total;
  }

  private setting(school: School): LateFeeSetting | null {
    if (school.lateFeeType === 'FIXED') return school.lateFeeFixedAmount ? { type: 'FIXED', fixedAmount: school.lateFeeFixedAmount } : null;
    return school.lateFeePercentBps ? { type: 'PERCENT', percentBps: school.lateFeePercentBps } : null;
  }

  private async runSchool(school: School, now: Date): Promise<LateFeeOutcome> {
    const outcome: LateFeeOutcome = { added: 0, skipped: 0 };
    const setting = this.setting(school);
    if (!setting || !school.lateFeeEnabledAt) return outcome;
    const grace = school.lateFeeGraceDays;
    const today = dayIn(now, school.timezone);
    const enabledDay = dayIn(school.lateFeeEnabledAt, school.timezone);
    // Due on or before this day, and late no earlier than the day late fees were switched on.
    const lastDue = dayString(dayNumber(today) - grace - 1);
    const firstDue = dayString(dayNumber(enabledDay) - grace - 1);
    if (lastDue < firstDue) return outcome;

    const current = new Set(
      (await this.prismaJobs.roleGrant.findMany({ where: { schoolId: school.id, role: 'STUDENT', revokedAt: null }, select: { userId: true } })).map((g) => g.userId),
    );
    if (current.size === 0) return outcome;

    const charges = await this.prismaJobs.charge.findMany({
      where: {
        schoolId: school.id,
        studentId: { in: [...current] },
        cancelledAt: null,
        lateFeeForChargeId: null,
        lateFeeForTransactionId: null,
        lateFee: { is: null },
        dueDate: { gte: dayToDate(firstDue), lte: dayToDate(lastDue) },
      },
      select: { id: true },
      orderBy: [{ dueDate: 'asc' }, { invoiceNumber: 'asc' }],
    });
    // A renewal's due day is its invoice's date in the School's time zone; a
    // day either side of the window is read and then checked exactly.
    const renewals = (
      await this.prismaJobs.transaction.findMany({
        where: {
          schoolId: school.id,
          studentId: { in: [...current] },
          kind: 'RENEWAL',
          status: 'FAILED',
          amount: { gt: 0 },
          lateFee: { is: null },
          billingDate: { gte: dayToDate(dayString(dayNumber(firstDue) - 1)), lt: dayToDate(dayString(dayNumber(lastDue) + 2)) },
        },
        select: { id: true, billingDate: true },
        orderBy: { billingDate: 'asc' },
      })
    ).filter((r) => isLateFeeDue(dayIn(r.billingDate, school.timezone), grace, today, enabledDay));

    const items = [...charges.map((c) => ({ chargeId: c.id })), ...renewals.map((r) => ({ transactionId: r.id }))];
    for (const item of items) {
      try {
        const added = await this.addLateFee(school, setting, today, item);
        if (added) {
          outcome.added++;
          await this.notify(added);
        } else {
          outcome.skipped++;
        }
      } catch (err) {
        if (err instanceof ForbiddenException) return outcome; // closed meanwhile (lockSchoolOpen)
        this.logger.error(`late-fee: ${JSON.stringify(item)} at School ${school.id} failed; tried again on the next run.`, err as Error);
        outcome.skipped++;
      }
    }
    return outcome;
  }

  /**
   * Adds one late fee in one transaction: re-reads the payment under the
   * member's balance lock (it may have been paid or cancelled since the list
   * was read), works out the fee and inserts it as a charge with the next
   * invoice number. Returns what to tell the member, or null when no fee is
   * due after all, or another run added it first (the unique link).
   */
  private async addLateFee(school: School, setting: LateFeeSetting, today: string, item: { chargeId: string } | { transactionId: string }) {
    try {
      return await this.prismaJobs.$transaction(async (tx) => {
        await lockSchoolOpen(tx, school.id);
        // Invoice numbers first, then the member's balance: the order every
        // path takes these two locks in (ChargesService.create).
        await lockInvoiceNumbers(tx, school.id);
        const overdue = 'chargeId' in item ? await this.overdueCharge(tx, school, item.chargeId) : await this.overdueRenewal(tx, school, item.transactionId);
        if (!overdue) return null;
        const fee = lateFeeAmount(setting, overdue.owed);
        // A fixed fee is in the School's currency; a % is of the payment, in its currency.
        const currency = setting.type === 'FIXED' ? school.defaultCurrency?.toUpperCase() : overdue.currency;
        if (fee <= 0 || !currency) return null;
        const totals = computeCharge({ unitAmount: fee, taxRateBasisPoints: school.taxRateBasisPoints, taxInclusive: school.taxInclusive });
        // Invoice number, balance and any credit, as for every charge.
        const { id } = await insertCharge(tx, {
          schoolId: school.id,
          studentId: overdue.studentId,
          description: overdue.description,
          unitAmount: fee,
          discountType: null,
          discountValue: null,
          taxCountry: school.taxCountry,
          taxRateBasisPoints: school.taxRateBasisPoints,
          taxInclusive: school.taxInclusive,
          totals,
          currency,
          dueDate: dayToDate(today),
          createdById: null,
          lateFee: {
            ...overdue.link,
            lateFeeOverdueAmount: overdue.owed,
            lateFeePercentBps: setting.type === 'PERCENT' ? setting.percentBps : null,
          },
        });
        return { id, studentId: overdue.studentId, schoolId: school.id, ...overdue.notice(totals.grossAmount, currency) };
      });
    } catch (err) {
      // Another run added this payment's late fee first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  private async overdueCharge(tx: Tx, school: School, chargeId: string): Promise<Overdue | null> {
    const head = await tx.charge.findUnique({ where: { id: chargeId }, select: { studentId: true } });
    if (!head) return null;
    await lockBalance(tx, school.id, head.studentId);
    const charge = await tx.charge.findUnique({ where: { id: chargeId }, include: { allocations: { select: { amount: true } }, lateFee: { select: { id: true } } } });
    if (!charge || charge.cancelledAt || charge.lateFee || charge.lateFeeForChargeId || charge.lateFeeForTransactionId) return null;
    const owed = charge.grossAmount - charge.allocations.reduce((n, a) => n + a.amount, 0);
    if (owed <= 0) return null;
    const invoice = formatInvoiceNumber(charge.invoiceNumber);
    return {
      studentId: charge.studentId,
      owed,
      currency: charge.currency,
      link: { lateFeeForChargeId: charge.id },
      description: lateFeeDescriptionForCharge(invoice),
      notice: (fee, currency) => lateFeeForChargeNotice(fee, currency, invoice, charge.description),
    };
  }

  private async overdueRenewal(tx: Tx, school: School, transactionId: string): Promise<Overdue | null> {
    const head = await tx.transaction.findUnique({ where: { id: transactionId }, select: { studentId: true } });
    if (!head) return null;
    await lockBalance(tx, school.id, head.studentId);
    const row = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { lateFee: { select: { id: true } }, membershipPlan: { select: { title: true } } },
    });
    // Paid since (a Stripe retry, or the member's new card): no fee.
    if (!row || row.kind !== 'RENEWAL' || row.status !== 'FAILED' || row.lateFee || row.amount <= 0) return null;
    const plan = row.membershipPlan?.title ?? '';
    const currency = (row.currency ?? school.defaultCurrency ?? '').toUpperCase();
    if (!currency) return null;
    return {
      studentId: row.studentId,
      owed: row.amount,
      currency,
      link: { lateFeeForTransactionId: row.id },
      description: lateFeeDescriptionForRenewal(plan),
      notice: (fee, feeCurrency) => lateFeeForRenewalNotice(fee, feeCurrency, plan, row.amount, currency),
    };
  }

  /** Best-effort, as ChargesService.notify(): a notice that fails to enqueue never undoes the fee. */
  private async notify(added: { id: string; studentId: string; schoolId: string; title: string; body: string }) {
    const data: NotificationFanoutJobData = {
      notificationId: `late-fee-${added.id}`,
      userId: added.studentId,
      title: added.title,
      body: added.body,
      type: 'CHARGE',
      schoolId: added.schoolId,
      targetType: 'PAYMENT',
      targetId: added.id,
    };
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the late-fee notice ${data.notificationId}: ${err}`);
    }
  }
}
