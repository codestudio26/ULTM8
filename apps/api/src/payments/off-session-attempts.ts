import { Prisma } from '@prisma/client';

type Tx = Pick<Prisma.TransactionClient, 'transaction' | 'booking'>;

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
