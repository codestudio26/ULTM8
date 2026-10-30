import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { allocate, chargePaid } from './charge-ledger';

type Tx = Prisma.TransactionClient;
type ChargeRow = Prisma.ChargeGetPayload<{ include: { allocations: { select: { amount: true } } } }>;

/**
 * Cancelling a charge on the ledger (Decision 338 item 1), shared by staff
 * cancelling on the Payments card (ChargesService.cancel, which also waives a
 * late fee this way) and by waiving or cancelling a promotion fee from grading
 * (PromotionFeeService, backlog §3.6 step 6). The charge is never deleted: it
 * is marked cancelled, a CHARGE_CANCELLED entry takes it off the balance, and
 * anything already paid toward it is credit again, put toward the member's
 * next open charge. Runs inside the caller's transaction, on the jobs
 * connection, under the member's balance lock (lockBalance), after the
 * caller's checks. Returns null when the charge was already cancelled.
 */
export async function cancelChargeInTx(
  tx: Tx,
  input: { schoolId: string; chargeId: string; cancelledById: string | null; reason: string | null; lateFeeWaived?: boolean },
): Promise<{ charge: ChargeRow; paid: number } | null> {
  const updated = await tx.charge.updateMany({
    where: { id: input.chargeId, schoolId: input.schoolId, cancelledAt: null },
    data: { cancelledAt: new Date(), cancelledById: input.cancelledById, cancelReason: input.reason, lateFeeWaived: input.lateFeeWaived ?? false },
  });
  if (updated.count === 0) return null;
  const row = await tx.charge.findUniqueOrThrow({ where: { id: input.chargeId }, include: { allocations: { select: { amount: true } } } });
  // What is left of its total after refunds (step 4) comes off the
  // balance; a charge refunded in full has nothing left to take off.
  const left = row.grossAmount - row.refundedAmount;
  if (left > 0) {
    await tx.balanceEntry.create({
      data: { id: randomUUID(), schoolId: input.schoolId, studentId: row.studentId, kind: 'CHARGE_CANCELLED', amount: -left, currency: row.currency, chargeId: row.id },
    });
  }
  // Anything already paid toward it is credit now, and goes to the next open charge.
  await allocate(tx, input.schoolId, row.studentId, row.currency, null, null);
  return { charge: row, paid: chargePaid(row) };
}

/** The member's "Charge cancelled" notice (Decision 338 item 1), the same
 * English text ChargesService has always sent, so @ultm8/i18n translates it
 * by the same pattern. */
export function chargeCancelledNotice(description: string, grossAmount: number, currency: string, paid: number) {
  const money = (minor: number) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  return {
    title: 'Charge cancelled',
    body: `Your charge '${description}, ${money(grossAmount)}' was cancelled. Nothing to pay.` + (paid > 0 ? ` The ${money(paid)} already paid is now credit on your balance.` : ''),
  };
}
