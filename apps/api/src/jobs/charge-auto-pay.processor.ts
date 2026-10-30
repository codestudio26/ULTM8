import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { NoSavedPaymentMethodError, PaymentsService } from '../payments/payments.service';
import { cardSurchargeAmount, readCardSurchargeBps } from '../payments/card-surcharge';
import { trialEndedUnpaid } from '../subscription-plans/subscription-gate.service';
import { dayIn, dayToDate } from '../memberships/freeze/membership-freeze';
import { allocate, chargeNoticeSwitches, chargeRemaining, freeCredit, lockBalance, noticeMoney, receiptNotice, settleChargePayment } from '../charges/charge-ledger';
import { formatInvoiceNumber } from '../charges/charge-maths';
import { CHARGE_AUTO_PAY_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Daily, at 6am UTC: after the 5am waiver-renewal sweep. */
const CRON_DAILY_AT_6AM_UTC = '0 6 * * *';
const REPEATABLE_JOB_ID = 'charge-auto-pay';

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see WaiverRenewalSweepScheduler). */
@Injectable()
export class ChargeAutoPayScheduler implements OnModuleInit {
  private readonly logger = new Logger(ChargeAutoPayScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(CHARGE_AUTO_PAY_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...ChargeAutoPayScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_6AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable charge-auto-pay job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable charge-auto-pay job after all retries — automatic charge payments will not run until this succeeds.');
  }
}

export type ChargeAutoPayOutcome = { paid: number; failed: number; skipped: number };

/**
 * Backlog §3.6 step 2 (Decision 338 item 8): members who turned on "Pay charges
 * automatically with my saved card" have each open charge charged to that card
 * on its due date, off-session, the way a late-cancellation fee is (Decisions
 * 234, 238, 346): no step-up, since no one is there to give it; the member gave
 * it when they turned the switch on (ChargesService.setAutoPay).
 *
 * - Which charges: open (not cancelled, something still owed) and due today or
 *   earlier in the School's time zone, never tried before, and not a late fee
 *   (Decision 413: a late fee is never charged to a card automatically). One attempt per
 *   charge, ever: a partial unique index on Transaction makes that hold even if
 *   two runs overlap. A charge that was already overdue when the member turned
 *   the switch on is tried once on the next run. No retries and no dunning: a
 *   declined card leaves the charge owed, and the member pays it in the app or
 *   at the desk (Stripe's own retries are for subscriptions only).
 * - How much: what the charge still owes after the member's credit (Decision
 *   303 item 2). A charge credit covers is never charged; it is paid from the
 *   credit instead. Plus the School's card surcharge (Decision 406), kept apart
 *   on the Transaction as for every card payment.
 * - Skipped: a closed or degraded School, a School without Stripe, a member
 *   restricted to cash and bank transfer (Decision 68), and a member with a
 *   card payment in the app still Pending at that School (they are paying now;
 *   the charge is tried on the next run).
 * - Each attempt is a CHARGE_PAYMENT Transaction (channel AUTOMATIC), written
 *   Pending before Stripe is called. Success settles it through the same
 *   ledger code as a desk or app payment and sends the receipt; a decline marks
 *   it Failed and sends "Automatic payment failed". The payment_intent.*
 *   webhooks for the same PaymentIntent settle the same row at most once.
 */
@Processor(CHARGE_AUTO_PAY_QUEUE)
export class ChargeAutoPayProcessor extends WorkerHost {
  private readonly logger = new Logger(ChargeAutoPayProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaApp: PrismaAppService,
    private readonly payments: PaymentsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.run(new Date());
  }

  /** Separate from process() so tests can pass the date. */
  async run(now: Date): Promise<ChargeAutoPayOutcome> {
    const members = await this.prismaJobs.studentPaymentMethod.findMany({ where: { autoPayCharges: true }, select: { studentId: true, schoolId: true } });
    const total: ChargeAutoPayOutcome = { paid: 0, failed: 0, skipped: 0 };
    for (const m of members) {
      try {
        const outcome = await this.runMember(m.studentId, m.schoolId, now);
        total.paid += outcome.paid;
        total.failed += outcome.failed;
        total.skipped += outcome.skipped;
      } catch (err) {
        this.logger.error(`charge-auto-pay: student ${m.studentId} at School ${m.schoolId} failed; tried again on the next run.`, err as Error);
      }
    }
    this.logger.log(`charge-auto-pay: ${total.paid} paid, ${total.failed} failed, ${total.skipped} skipped.`);
    return total;
  }

  private async runMember(studentId: string, schoolId: string, now: Date): Promise<ChargeAutoPayOutcome> {
    const outcome: ChargeAutoPayOutcome = { paid: 0, failed: 0, skipped: 0 };
    const school = await this.prismaJobs.school.findUnique({
      where: { id: schoolId },
      select: { archivedAt: true, timezone: true, platformSubscriptionStatus: true, platformTrialEndsAt: true },
    });
    if (!school || school.archivedAt || school.platformSubscriptionStatus === 'CANCELED' || trialEndedUnpaid(school, now)) return outcome;
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { id: true, provider: true, stripeConnectedAccountId: true } });
    if (!account || account.provider !== 'STRIPE' || !account.stripeConnectedAccountId) return outcome;
    const user = await this.prismaApp.withTenantContext(studentId, (tx) => tx.user.findUnique({ where: { id: studentId }, select: { paymentRestrictedAt: true } }));
    if (!user || user.paymentRestrictedAt) return outcome;
    const paying = await this.prismaJobs.transaction.findFirst({
      where: { schoolId, studentId, kind: 'CHARGE_PAYMENT', status: 'PENDING', chargePaymentChannel: 'APP' },
      select: { id: true },
    });
    if (paying) return outcome;

    const today = dayToDate(dayIn(now, school.timezone));
    const due = await this.prismaJobs.charge.findMany({
      where: {
        schoolId,
        studentId,
        cancelledAt: null,
        dueDate: { lte: today },
        transactions: { none: { chargePaymentChannel: 'AUTOMATIC' } },
        // Decision 413 item 5: a late fee is never charged to a card
        // automatically; the member pays it in the app or at the desk.
        lateFeeForChargeId: null,
        lateFeeForTransactionId: null,
      },
      orderBy: [{ dueDate: 'asc' }, { invoiceNumber: 'asc' }],
      select: { id: true },
    });
    if (due.length === 0) return outcome;
    const bps = await this.prismaApp.withTenantContext(studentId, (tx) => readCardSurchargeBps(tx, schoolId));

    for (const { id: chargeId } of due) {
      const attempt = await this.claimAttempt(studentId, schoolId, chargeId, account.id, bps);
      if (!attempt) {
        outcome.skipped++;
        continue;
      }
      if (await this.charge(attempt)) outcome.paid++;
      else outcome.failed++;
    }
    return outcome;
  }

  /**
   * Under the member's balance lock: works out what the charge still owes after
   * credit and writes the Pending attempt. Returns null when there is nothing
   * to charge (paid meanwhile, or covered by credit, which is then put on it)
   * or another run already claimed this charge.
   */
  private async claimAttempt(studentId: string, schoolId: string, chargeId: string, paymentAccountId: string, bps: number) {
    try {
      return await this.prismaJobs.$transaction(async (tx) => {
        await lockBalance(tx, schoolId, studentId);
        const charge = await tx.charge.findUniqueOrThrow({ where: { id: chargeId }, include: { allocations: { select: { amount: true } } } });
        if (charge.cancelledAt) return null;
        const owed = chargeRemaining(charge);
        const credit = await freeCredit(tx, schoolId, studentId, charge.currency);
        if (owed <= 0) return null;
        if (credit >= owed) {
          // Never charge the card for what credit covers: use the credit.
          await allocate(tx, schoolId, studentId, charge.currency, null, chargeId);
          return null;
        }
        const amount = owed - credit;
        const surcharge = cardSurchargeAmount(amount, bps);
        const transactionId = randomUUID();
        await tx.transaction.create({
          data: {
            id: transactionId,
            schoolId,
            studentId,
            paymentAccountId,
            kind: 'CHARGE_PAYMENT',
            chargeId,
            amount,
            surchargeAmount: surcharge,
            currency: charge.currency,
            status: 'PENDING',
            paymentMethod: 'STRIPE',
            chargePaymentChannel: 'AUTOMATIC',
          },
        });
        return {
          transactionId,
          studentId,
          schoolId,
          chargeId,
          amount,
          surcharge,
          currency: charge.currency,
          invoiceLabel: formatInvoiceNumber(charge.invoiceNumber),
          description: charge.description,
        };
      });
    } catch (err) {
      // Another run claimed this charge first (Transaction_one_auto_pay_attempt_per_charge).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** Charges the saved card for one claimed attempt. True when it was paid. */
  private async charge(a: {
    transactionId: string;
    studentId: string;
    schoolId: string;
    chargeId: string;
    amount: number;
    surcharge: number;
    currency: string;
    invoiceLabel: string;
    description: string;
  }): Promise<boolean> {
    let result: { succeeded: boolean; paymentIntentId: string };
    try {
      result = await this.payments.chargeOffSession(
        a.studentId,
        a.schoolId,
        a.amount + a.surcharge,
        a.currency,
        `Invoice ${a.invoiceLabel}: ${a.description}`,
        `charge-auto-pay-${a.transactionId}`,
      );
    } catch (err) {
      // No card any more, or Stripe could not be reached: one attempt only, so
      // the charge is left for the member to pay, and they are told.
      if (!(err instanceof NoSavedPaymentMethodError)) {
        this.logger.error(`charge-auto-pay: charging Transaction ${a.transactionId} failed; marked Failed.`, err as Error);
      }
      result = { succeeded: false, paymentIntentId: '' };
    }

    const paymentIntentId = result.paymentIntentId || null;
    if (!result.succeeded) {
      await this.prismaJobs.transaction.updateMany({
        where: { id: a.transactionId, status: 'PENDING' },
        data: { status: 'FAILED', ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}) },
      });
      // Decision 338 item 10: "failed or overdue payment", switchable off by the School.
      if ((await chargeNoticeSwitches(this.prismaJobs, a.schoolId)).failedOverdue) {
        await this.notify({
          notificationId: `charge-auto-pay-failed-${a.transactionId}`,
          userId: a.studentId,
          title: 'Automatic payment failed',
          body: `We couldn't charge your saved card for invoice ${a.invoiceLabel} (${a.description}, ${noticeMoney(a.amount + a.surcharge, a.currency)}). Pay it in the app or at the front desk.`,
          type: 'CHARGE',
          schoolId: a.schoolId,
          targetType: 'PAYMENT',
          targetId: a.transactionId,
        });
      }
      return false;
    }

    const settled = await this.prismaJobs.$transaction(async (tx) => {
      // The webhook for this PaymentIntent may have come first and settled it already.
      await tx.transaction.updateMany({ where: { id: a.transactionId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: paymentIntentId } });
      return settleChargePayment(tx, a.transactionId);
    });
    // Decision 338 item 10: the School may switch receipts off.
    if (settled && (await chargeNoticeSwitches(this.prismaJobs, a.schoolId)).receipt) {
      const receipt = receiptNotice(a.transactionId, a.amount + a.surcharge, a.currency);
      await this.notify({
        notificationId: receipt.key,
        userId: a.studentId,
        title: receipt.title,
        body: receipt.body,
        type: 'CHARGE',
        schoolId: a.schoolId,
        targetType: 'PAYMENT',
        targetId: a.transactionId,
      });
    }
    return true;
  }

  /** Best-effort, as ChargesService.notify(): a notice that fails to enqueue never undoes the payment. */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the charge notice ${data.notificationId}: ${err}`);
    }
  }
}
