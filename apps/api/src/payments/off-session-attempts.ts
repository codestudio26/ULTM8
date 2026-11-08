import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { chargeCurrency } from '../common/school-currency';

type Tx = Pick<Prisma.TransactionClient, 'transaction' | 'booking'>;

/**
 * What an off-session PaymentIntent is tagged with, in its metadata (and its
 * idempotency key is derived from the same id): the Pending Transaction the
 * caller wrote first (Decision 446 item 5), or, for a no-show fee, whose
 * attempt is recorded on its Booking, its Booking (Decision 447 item 4).
 */
export type OffSessionTag = { transactionId: string } | { noShowBookingId: string };

/** Whether a PaymentIntent's metadata carries this tag. */
export function offSessionTagMatches(metadata: Record<string, string> | null | undefined, tag: OffSessionTag): boolean {
  if ('transactionId' in tag) return metadata?.transactionId === tag.transactionId;
  return metadata?.noShowBookingId === tag.noShowBookingId;
}

/**
 * Decision 446 item 5: an off-session card attempt is written Pending before
 * Stripe is called, and tagged with its Transaction id in the PaymentIntent's
 * metadata, so a payment Stripe took is never lost if the worker stops before
 * the outcome is saved. Its outcome is then saved by whichever comes first:
 * the caller, Stripe's payment_intent.* webhook, or the stale-attempt sweep
 * (ChargeAutoPayProcessor.resolveStaleAttempts()).
 *
 * After this long a Pending attempt is no longer in flight: the sweep asks
 * Stripe what became of it.
 */
export const STALE_OFF_SESSION_ATTEMPT_MS = 60 * 60 * 1000;

/** A charge's automatic card payment still Pending: its outcome is not known
 * yet, so no late fee or overdue notice is made for the charge meanwhile. */
export const PENDING_AUTOMATIC_ATTEMPT = { kind: 'CHARGE_PAYMENT', chargePaymentChannel: 'AUTOMATIC', status: 'PENDING' } satisfies Prisma.TransactionWhereInput;

/**
 * A late-cancellation fee attempt's outcome (Decision 234/346): the
 * LATE_CANCEL_FEE Transaction becomes Successful or Failed, with Stripe's
 * PaymentIntent id, and its Booking records the same outcome. Only a row still
 * Pending changes the Transaction, so the caller, the webhook and the sweep
 * settle it at most once; a failure never undoes a success. Returns whether
 * this call settled it.
 */
export async function settleLateCancelFee(tx: Tx, transactionId: string, paymentIntentId: string | null, succeeded: boolean): Promise<boolean> {
  if (paymentIntentId) {
    await tx.transaction.updateMany({ where: { id: transactionId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: paymentIntentId } });
  }
  const flipped = await tx.transaction.updateMany({
    where: { id: transactionId, kind: 'LATE_CANCEL_FEE', status: succeeded ? { in: ['PENDING', 'FAILED'] } : 'PENDING' },
    data: { status: succeeded ? 'SUCCESSFUL' : 'FAILED' },
  });
  if (flipped.count === 0) return false;
  const row = await tx.transaction.findUnique({ where: { id: transactionId }, select: { bookingId: true, stripePaymentIntentId: true } });
  if (row?.bookingId) {
    await tx.booking.updateMany({
      where: { id: row.bookingId },
      data: { cancellationChargeOutcome: succeeded ? 'CHARGED' : 'FAILED', stripeCancellationPaymentIntentId: row.stripePaymentIntentId },
    });
  }
  return true;
}

/**
 * Decision 447 item 4: a no-show fee attempt's outcome (Decision 291). The
 * attempt is the Booking itself (Decision 448 item 18 adds the ledger row
 * only once the outcome is saved, recordNoShowFeeTransaction()): noShowFeeAmount is written before Stripe is
 * called, with noShowFeeOutcome left empty until the answer is saved, and the
 * PaymentIntent carries the Booking's id (metadata noShowBookingId,
 * idempotency key no-show-fee-<booking id>). Saved by whichever comes first:
 * the no-show job, Stripe's payment_intent.* webhook, or the stale-attempt
 * sweep. Only an outcome still empty changes, so it is saved at most once; a
 * failure never undoes a success, and a success saved after a failure wins
 * (the money was taken). The outcome's Transactions ledger row is written in
 * the same transaction (Decision 448 item 18). Returns whether this call
 * saved it.
 */
export async function settleNoShowFee(tx: NoShowTx, bookingId: string, paymentIntentId: string | null, succeeded: boolean): Promise<boolean> {
  const flipped = await tx.booking.updateMany({
    where: {
      id: bookingId,
      noShowFeeAmount: { not: null },
      ...(succeeded ? { OR: [{ noShowFeeOutcome: null }, { noShowFeeOutcome: 'FAILED' }] } : { noShowFeeOutcome: null }),
    },
    data: { noShowFeeOutcome: succeeded ? 'CHARGED' : 'FAILED', ...(paymentIntentId ? { stripeNoShowPaymentIntentId: paymentIntentId } : {}) },
  });
  if (flipped.count === 0) return false;
  await recordNoShowFeeTransaction(tx, bookingId);
  return true;
}

type NoShowTx = Pick<Prisma.TransactionClient, 'booking' | 'transaction' | 'school' | 'paymentAccount'>;

/**
 * Decision 448 item 18: a no-show fee on the School's Transactions page, as
 * a late-cancellation fee is (Decision 346): a NO_SHOW_FEE row for its
 * Booking once the outcome is saved, Successful when the card was charged
 * and Failed when it was tried and declined. Nothing is written when no card
 * could be tried (NO_SAVED_PAYMENT_METHOD), or the School has no currency or
 * payment account, as for late-cancellation fees. Called in the transaction
 * that saves the Booking's outcome, so the two never disagree; one row per
 * Booking (bookingId is unique). A success saved after a failure turns the
 * row Successful; nothing ever turns a Successful row back.
 */
export async function recordNoShowFeeTransaction(tx: NoShowTx, bookingId: string): Promise<void> {
  const b = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { schoolId: true, studentId: true, noShowFeeOutcome: true, noShowFeeAmount: true, stripeNoShowPaymentIntentId: true },
  });
  if (!b || !b.noShowFeeAmount || (b.noShowFeeOutcome !== 'CHARGED' && b.noShowFeeOutcome !== 'FAILED')) return;
  const status = b.noShowFeeOutcome === 'CHARGED' ? ('SUCCESSFUL' as const) : ('FAILED' as const);
  const existing = await tx.transaction.findUnique({ where: { bookingId }, select: { id: true, kind: true, status: true, stripePaymentIntentId: true } });
  if (existing) {
    if (existing.kind !== 'NO_SHOW_FEE') return;
    const paid = status === 'SUCCESSFUL' && existing.status === 'FAILED';
    const intent = !existing.stripePaymentIntentId ? await freeIntent(tx, b.stripeNoShowPaymentIntentId) : null;
    if (paid || intent) {
      await tx.transaction.update({ where: { id: existing.id }, data: { ...(paid ? { status } : {}), ...(intent ? { stripePaymentIntentId: intent } : {}) } });
    }
    return;
  }
  const school = await tx.school.findUnique({ where: { id: b.schoolId }, select: { defaultCurrency: true } });
  const currency = chargeCurrency(null, school?.defaultCurrency);
  const account = await tx.paymentAccount.findUnique({ where: { schoolId: b.schoolId }, select: { id: true } });
  if (!currency || !account) return;
  await tx.transaction.create({
    data: {
      id: randomUUID(),
      schoolId: b.schoolId,
      studentId: b.studentId,
      paymentAccountId: account.id,
      kind: 'NO_SHOW_FEE',
      bookingId,
      amount: b.noShowFeeAmount,
      currency: currency.toUpperCase(),
      status,
      paymentMethod: 'STRIPE',
      stripePaymentIntentId: await freeIntent(tx, b.stripeNoShowPaymentIntentId),
    },
  });
}

/** The PaymentIntent id to put on the no-show fee's row, unless another
 * Transaction already holds it (the column is unique): the row is then
 * written without it, so the Booking's outcome is still saved. The Booking
 * keeps the id either way. */
async function freeIntent(tx: NoShowTx, paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  const taken = await tx.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } });
  return taken ? null : paymentIntentId;
}

const freezeFeeLogger = new Logger('FreezeFeeAttempt');

/**
 * Decision 447 item 4: a freeze fee's card attempt (Decision 404). The
 * FREEZE_FEE Transaction is written Pending (paymentMethod STRIPE) and made
 * the freeze's fee (MembershipFreeze.feeTransactionId) before Stripe is
 * called, so only one attempt is ever made per freeze. Its outcome, saved by
 * whichever comes first (the approval, Stripe's webhook, or the stale-attempt
 * sweep), is as before: paid, the attempt is the fee; declined (or never
 * made), the attempt stays on the ledger as Failed and a pending desk charge
 * becomes the fee, which the desk collects. Only a row still Pending changes
 * on a failure. Paid after a failure was saved (the sweep found no payment,
 * and Stripe later said otherwise): the attempt becomes Successful, so the
 * money taken is on the ledger, and the desk charge made in its place is left
 * for staff to cancel (logged). Returns whether this call settled it.
 */
export async function settleFreezeFee(
  tx: Pick<Prisma.TransactionClient, 'transaction' | 'membershipFreeze'>,
  attemptId: string,
  paymentIntentId: string | null,
  succeeded: boolean,
): Promise<boolean> {
  if (paymentIntentId) {
    await tx.transaction.updateMany({ where: { id: attemptId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: paymentIntentId } });
  }
  const attempt = await tx.transaction.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.kind !== 'FREEZE_FEE' || attempt.paymentMethod !== 'STRIPE') return false;
  if (succeeded) {
    const flipped = await tx.transaction.updateMany({ where: { id: attemptId, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'SUCCESSFUL' } });
    if (flipped.count === 0) return false;
    if (attempt.status === 'FAILED') {
      freezeFeeLogger.warn(`Freeze fee attempt ${attemptId} was paid after it was recorded as failed; the desk charge made in its place may need cancelling.`);
    }
    return true;
  }
  const flipped = await tx.transaction.updateMany({ where: { id: attemptId, status: 'PENDING' }, data: { status: 'FAILED' } });
  if (flipped.count === 0) return false;
  const freeze = await tx.membershipFreeze.findFirst({ where: { feeTransactionId: attemptId }, select: { id: true } });
  if (freeze) {
    const deskId = randomUUID();
    await tx.transaction.create({
      data: {
        id: deskId,
        schoolId: attempt.schoolId,
        studentId: attempt.studentId,
        paymentAccountId: attempt.paymentAccountId,
        membershipId: attempt.membershipId,
        kind: 'FREEZE_FEE',
        amount: attempt.amount,
        currency: attempt.currency,
        status: 'PENDING',
        // A card School's account is a Stripe one: the desk takes cash, as
        // for a member with no saved card.
        paymentMethod: 'CASH',
      },
    });
    await tx.membershipFreeze.updateMany({ where: { id: freeze.id, feeTransactionId: attemptId }, data: { feeTransactionId: deskId } });
  }
  return true;
}
