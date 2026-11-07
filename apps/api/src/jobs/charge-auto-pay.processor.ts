import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { NoSavedPaymentMethodError, PaymentsService } from '../payments/payments.service';
import { cardSurchargeAmount, readCardSurchargeBps } from '../payments/card-surcharge';
import { CARD_ACCOUNT_SELECT, takesCards } from '../payments/takes-cards';
import { trialEndedUnpaid } from '../subscription-plans/subscription-gate.service';
import { dayIn, dayToDate } from '../memberships/freeze/membership-freeze';
import { allocate, chargeNoticeSwitches, chargeRemaining, freeCredit, lockBalance, noticeMoney, receiptNotice, settleChargePayment } from '../charges/charge-ledger';
import { formatInvoiceNumber } from '../charges/charge-maths';
import { CHARGE_AUTO_PAY_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';
import { PromotionFeeService } from '../ranks/promotion-fee.service';
import { settleFreezeFee, settleLateCancelFee, settleNoShowFee, STALE_OFF_SESSION_ATTEMPT_MS } from '../payments/off-session-attempts';
import {
  failOffSessionPurchase,
  OFF_SESSION_PURCHASE,
  OffSessionPurchaseRefusedError,
  offSessionPurchaseNotices,
  refuseOffSessionPurchase,
  settleOffSessionPurchase,
} from '../memberships/off-session-purchase';

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

type Attempt = {
  transactionId: string;
  studentId: string;
  schoolId: string;
  chargeId: string;
  amount: number;
  surcharge: number;
  currency: string;
  invoiceLabel: string;
  description: string;
};

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
 *   webhooks for the same PaymentIntent settle the same row at most once:
 *   the PaymentIntent carries the row's id in its metadata (Decision 446
 *   item 5), so they find it even when Stripe's answer was never saved here.
 *   An attempt with no answer from Stripe stays Pending, and the next run
 *   asks Stripe what became of it (resolveStaleAttempts()).
 * - Promotion fees (backlog §3.6 step 6) are charges like any other and are
 *   paid automatically too: Decision 300 item 2 has an accepted fee "charged,
 *   by saved card or as the school takes payment". Each run starts with the
 *   fees' catch-up (PromotionFeeService.reconcile()), and a fee this pays in
 *   full becomes Paid (settlePaidCharges()).
 */
@Processor(CHARGE_AUTO_PAY_QUEUE)
export class ChargeAutoPayProcessor extends WorkerHost {
  private readonly logger = new Logger(ChargeAutoPayProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaApp: PrismaAppService,
    private readonly payments: PaymentsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
    private readonly promotionFees: PromotionFeeService,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.run(new Date());
  }

  /** Separate from process() so tests can pass the date. */
  async run(now: Date): Promise<ChargeAutoPayOutcome> {
    // Backlog §3.6 step 6: promotion fees first. Accepted fees with no charge
    // yet get one (those accepted before charges existed included), so they
    // are paid below like any charge; paid ones are settled; waived or
    // cancelled ones lose their open charge. Never stops the payments.
    try {
      const caughtUp = await this.promotionFees.reconcile();
      this.logger.log(`charge-auto-pay: promotion fees caught up: ${caughtUp.created} charges made, ${caughtUp.settled} settled, ${caughtUp.cancelled} cancelled.`);
    } catch (err) {
      this.logger.error('charge-auto-pay: the promotion fee catch-up failed; tried again on the next run.', err as Error);
    }
    // Decision 446 item 5: earlier attempts whose outcome was never saved.
    try {
      const resolved = await this.resolveStaleAttempts(now);
      if (resolved.paid + resolved.failed + resolved.left > 0) {
        this.logger.warn(`charge-auto-pay: stale card attempts: ${resolved.paid} paid, ${resolved.failed} not paid, ${resolved.left} left for the next run.`);
      }
    } catch (err) {
      this.logger.error('charge-auto-pay: the stale card attempt check failed; tried again on the next run.', err as Error);
    }
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
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { id: true, ...CARD_ACCOUNT_SELECT } });
    // Decision 442 item 2: no card is charged until Stripe says the School's
    // account is ready (or while Stripe wants more details again).
    if (!account || !takesCards(account)) return outcome;
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
      const result = await this.charge(attempt);
      if (result === 'paid') outcome.paid++;
      else if (result === 'failed') outcome.failed++;
      else outcome.skipped++;
    }
    // A promotion fee paid by credit or by the card becomes Paid (step 6).
    await this.promotionFees.settlePaidCharges(schoolId, studentId);
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
        const surcharge = cardSurchargeAmount(amount, bps, charge.currency);
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

  /**
   * Charges the saved card for one claimed attempt. The PaymentIntent carries
   * the attempt's id in its metadata and as its idempotency key (Decision 446
   * item 5), so the payment_intent.* webhooks find the row even if its outcome
   * is never saved here. Returns 'paid', 'failed', or 'unknown' when Stripe's
   * answer never came back (left Pending for resolveStaleAttempts()).
   */
  private async charge(a: Attempt): Promise<'paid' | 'failed' | 'unknown'> {
    let result: { succeeded: boolean; paymentIntentId: string };
    try {
      result = await this.payments.chargeOffSession(
        a.studentId,
        a.schoolId,
        a.amount + a.surcharge,
        a.currency,
        `Invoice ${a.invoiceLabel}: ${a.description}`,
        `charge-auto-pay-${a.transactionId}`,
        a.surcharge,
        { transactionId: a.transactionId },
      );
    } catch (err) {
      // No card any more (or the School's account isn't ready): nothing was
      // charged, and one attempt only, so the charge is left for the member
      // to pay, and they are told.
      if (err instanceof NoSavedPaymentMethodError) {
        await this.markFailed(a, null);
        return 'failed';
      }
      // Stripe could not be reached, or its answer was lost: the card may have
      // been charged. Left Pending; Stripe's webhook or the stale-attempt
      // sweep settles it from what Stripe says (Decision 446 item 5).
      this.logger.error(`charge-auto-pay: charging Transaction ${a.transactionId} had no answer from Stripe; left Pending for Stripe's webhook or the next run's check.`, err as Error);
      return 'unknown';
    }
    const paymentIntentId = result.paymentIntentId || null;
    if (!result.succeeded) {
      await this.markFailed(a, paymentIntentId);
      return 'failed';
    }
    await this.settlePaid(a, paymentIntentId);
    return 'paid';
  }

  /** A declined (or impossible) attempt: Failed, and the member is told, once. */
  private async markFailed(a: Attempt, paymentIntentId: string | null) {
    const marked = await this.prismaJobs.transaction.updateMany({
      where: { id: a.transactionId, status: 'PENDING' },
      data: { status: 'FAILED', ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}) },
    });
    // Settled meanwhile by Stripe's webhook: not failed.
    if (marked.count === 0) return;
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
  }

  /** A paid attempt: settled on the ledger with Stripe's PaymentIntent id, and the receipt sent. */
  private async settlePaid(a: Attempt, paymentIntentId: string | null) {
    const settled = await this.prismaJobs.$transaction(async (tx) => {
      // The webhook for this PaymentIntent may have come first and settled it already.
      if (paymentIntentId) {
        await tx.transaction.updateMany({ where: { id: a.transactionId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: paymentIntentId } });
      }
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
  }

  /**
   * Decision 446 item 5: off-session card attempts still Pending an hour
   * after they were written (the worker stopped between Stripe's answer and
   * saving it, or Stripe could not be reached) are settled from what Stripe
   * says: paid (the charge is paid and the receipt sent), still processing
   * (left), or declined or never made (Failed; for an automatic payment the
   * member is told). Covers automatic charge payments and late-cancellation
   * fees, and (Decision 447 item 4) freeze fees, saved-card purchases and
   * plan switches (their Membership is created here if Stripe was paid, once:
   * off-session-purchase.ts) and no-show fees (recorded on their Booking).
   * Runs first in every run, before the 7am late-fee and overdue-notice
   * jobs, which leave a charge alone while its automatic attempt is Pending.
   * A Stripe that can't be reached leaves the row for the next run.
   */
  async resolveStaleAttempts(now: Date): Promise<{ paid: number; failed: number; left: number }> {
    const staleBefore = new Date(now.getTime() - STALE_OFF_SESSION_ATTEMPT_MS);
    const stale = await this.prismaJobs.transaction.findMany({
      where: {
        status: 'PENDING',
        paymentMethod: 'STRIPE',
        createdAt: { lt: staleBefore },
        OR: [{ kind: 'CHARGE_PAYMENT', chargePaymentChannel: 'AUTOMATIC' }, { kind: 'LATE_CANCEL_FEE' }, { kind: 'FREEZE_FEE' }, OFF_SESSION_PURCHASE],
      },
      include: { charge: { select: { invoiceNumber: true, description: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const total = { paid: 0, failed: 0, left: 0 };
    for (const row of stale) {
      try {
        const intent = await this.payments.findOffSessionPayment(row.studentId, row.schoolId, { transactionId: row.id }, row.stripePaymentIntentId, row.createdAt);
        if (intent?.status === 'processing') {
          total.left++;
          continue;
        }
        const succeeded = intent?.status === 'succeeded';
        if (row.kind === 'LATE_CANCEL_FEE') {
          await this.prismaJobs.$transaction((tx) => settleLateCancelFee(tx, row.id, intent?.id ?? null, succeeded));
        } else if (row.kind === 'FREEZE_FEE') {
          await this.prismaJobs.$transaction((tx) => settleFreezeFee(tx, row.id, intent?.id ?? null, succeeded));
        } else if (row.kind === 'MEMBERSHIP') {
          await this.resolveOffSessionPurchase(row.id, row.studentId, row.schoolId, succeeded ? intent.id : null, intent?.id ?? null, now);
        } else {
          const a: Attempt = {
            transactionId: row.id,
            studentId: row.studentId,
            schoolId: row.schoolId,
            chargeId: row.chargeId!,
            amount: row.amount,
            surcharge: row.surchargeAmount,
            currency: row.currency!,
            invoiceLabel: row.charge ? formatInvoiceNumber(row.charge.invoiceNumber) : '',
            description: row.charge?.description ?? '',
          };
          if (succeeded) await this.settlePaid(a, intent.id);
          else await this.markFailed(a, intent?.id ?? null);
        }
        if (succeeded) total.paid++;
        else total.failed++;
        this.logger.warn(`charge-auto-pay: Pending ${row.kind} Transaction ${row.id} resolved from Stripe as ${succeeded ? 'paid' : 'not paid'}${intent ? ` (PaymentIntent ${intent.id}, ${intent.status})` : ' (no PaymentIntent)'}.`);
      } catch (err) {
        total.left++;
        this.logger.error(`charge-auto-pay: checking Pending Transaction ${row.id} with Stripe failed; tried again on the next run.`, err as Error);
      }
    }

    // Decision 447 item 4: no-show fees whose outcome was never saved. The
    // attempt is the Booking (noShowFeeAmount written, no outcome). Its
    // PaymentIntent can only have been made after the class's check-in window
    // closed (the Booking became a no-show then), so Stripe is searched from
    // that moment.
    const noShows = await this.prismaJobs.booking.findMany({
      where: { noShowFeeAmount: { not: null }, noShowFeeOutcome: null, updatedAt: { lt: staleBefore } },
      select: { id: true, studentId: true, schoolId: true, stripeNoShowPaymentIntentId: true, class: { select: { endDate: true, qrAttendanceEndAt: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    for (const b of noShows) {
      try {
        const since = b.class.qrAttendanceEndAt ?? b.class.endDate;
        const intent = await this.payments.findOffSessionPayment(b.studentId, b.schoolId, { noShowBookingId: b.id }, b.stripeNoShowPaymentIntentId, since);
        if (intent?.status === 'processing') {
          total.left++;
          continue;
        }
        const succeeded = intent?.status === 'succeeded';
        await this.prismaJobs.$transaction((tx) => settleNoShowFee(tx, b.id, intent?.id ?? null, succeeded));
        if (succeeded) total.paid++;
        else total.failed++;
        this.logger.warn(`charge-auto-pay: no-show fee of Booking ${b.id} resolved from Stripe as ${succeeded ? 'paid' : 'not paid'}${intent ? ` (PaymentIntent ${intent.id}, ${intent.status})` : ' (no PaymentIntent)'}.`);
      } catch (err) {
        total.left++;
        this.logger.error(`charge-auto-pay: checking the no-show fee of Booking ${b.id} with Stripe failed; tried again on the next run.`, err as Error);
      }
    }
    return total;
  }

  /**
   * Decision 447 item 4: a saved-card purchase or plan switch Stripe was
   * paid for (`paidBy`, the PaymentIntent) or not. Paid, its Membership is
   * created (unless the caller or Stripe's webhook did first); refused (general
   * access held, a switch's next plan full, or the School closed since), the card is refunded with the
   * key the caller and the webhook use, so it is refunded once. The member is
   * told as the caller would have told them.
   */
  private async resolveOffSessionPurchase(transactionId: string, studentId: string, schoolId: string, paidBy: string | null, paymentIntentId: string | null, now: Date) {
    let notices: NotificationFanoutJobData[] = [];
    if (!paidBy) {
      const failed = await this.prismaJobs.$transaction((tx) => failOffSessionPurchase(tx, transactionId, paymentIntentId));
      if (failed) notices = await offSessionPurchaseNotices(this.prismaJobs, failed, 'failed');
    } else {
      const zone = (await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }))?.timezone ?? null;
      try {
        const settled = await this.prismaJobs.$transaction((tx) => settleOffSessionPurchase(tx, transactionId, paidBy, zone, now, { refuseClosedSchool: true }));
        if (settled) notices = await offSessionPurchaseNotices(this.prismaJobs, settled.transaction, 'paid');
      } catch (err) {
        if (!(err instanceof OffSessionPurchaseRefusedError)) throw err;
        await this.payments.refundOffSessionCharge(studentId, schoolId, paidBy, `off-session-purchase-refund-${transactionId}`);
        const refused = await this.prismaJobs.$transaction((tx) => refuseOffSessionPurchase(tx, transactionId, paidBy));
        if (refused) notices = await offSessionPurchaseNotices(this.prismaJobs, refused, 'refunded');
      }
    }
    for (const n of notices) await this.notify(n);
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
