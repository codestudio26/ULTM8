import { Prisma, Transaction } from '@prisma/client';
import { randomUUID } from 'crypto';

type Tx = Prisma.TransactionClient;
type ChargeRow = Prisma.ChargeGetPayload<{ include: { allocations: { select: { amount: true } } } }>;

/**
 * The member balance's ledger writes (v1.3 backlog §3.6; Decisions 303, 338),
 * shared by every path that moves money on it: staff at the desk
 * (ChargesService, step 1), the stripe-webhook-processing job settling a
 * payment made in the app, and the daily charge-auto-pay job (step 2). One
 * implementation, so a payment in the app is allocated exactly as a desk
 * payment is. Every function runs inside the caller's transaction, on the jobs
 * connection.
 */

/** One student's balance at one School, one writer at a time. */
export async function lockBalance(tx: Tx, schoolId: string, studentId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`charge-balance:${schoolId}:${studentId}`}, 0))`;
}

const remaining = (c: ChargeRow) => c.grossAmount - c.allocations.reduce((n, a) => n + a.amount, 0);

/**
 * Money not on a charge yet, in `currency` (credit): the total paid in minus
 * what is on charges still standing (money on a cancelled charge is free
 * again). Never below 0.
 */
export async function freeCredit(tx: Tx, schoolId: string, studentId: string, currency: string): Promise<number> {
  const [sum, charges] = await Promise.all([
    tx.balanceEntry.aggregate({ where: { schoolId, studentId, currency }, _sum: { amount: true } }),
    tx.charge.findMany({ where: { schoolId, studentId, currency, cancelledAt: null }, include: { allocations: { select: { amount: true } } } }),
  ]);
  const owed = charges.reduce((n, c) => n + Math.max(0, remaining(c)), 0);
  return Math.max(0, owed - (sum._sum.amount ?? 0));
}

/**
 * Puts money that isn't on a charge yet toward open charges in `currency`:
 * `firstChargeId` first, then the oldest due. Each step is a ChargeAllocation
 * row, marked with the payment it came from, or none for credit. Never puts
 * more on a charge than it still owes, so a second payment for a charge that
 * is already paid (two Checkout sessions, say) goes to the next charge and
 * then stays as credit, as an overpayment at the desk does.
 */
export async function allocate(tx: Tx, schoolId: string, studentId: string, currency: string, transactionId: string | null, firstChargeId: string | null): Promise<void> {
  const [sum, charges] = await Promise.all([
    tx.balanceEntry.aggregate({ where: { schoolId, studentId, currency }, _sum: { amount: true } }),
    tx.charge.findMany({
      where: { schoolId, studentId, currency, cancelledAt: null },
      include: { allocations: { select: { amount: true } } },
      orderBy: [{ dueDate: 'asc' }, { invoiceNumber: 'asc' }],
    }),
  ]);
  const owed = charges.reduce((n, c) => n + Math.max(0, remaining(c)), 0);
  let free = owed - (sum._sum.amount ?? 0);
  const ordered = firstChargeId ? [...charges.filter((c) => c.id === firstChargeId), ...charges.filter((c) => c.id !== firstChargeId)] : charges;
  for (const c of ordered) {
    if (free <= 0) break;
    const take = Math.min(free, remaining(c));
    if (take <= 0) continue;
    await tx.chargeAllocation.create({ data: { id: randomUUID(), schoolId, studentId, chargeId: c.id, amount: take, transactionId } });
    free -= take;
  }
}

const SETTLEABLE: Transaction['status'][] = ['PENDING', 'FAILED'];

/**
 * Settles a card payment toward charges (a Checkout in the app, or an
 * automatic charge): the Pending (or Failed: a failed Checkout attempt can
 * still succeed with another card) CHARGE_PAYMENT row becomes Successful, the
 * payment goes on the ledger, and it is put toward its charge first, then the
 * oldest due, then credit. Only the caller that flips the status writes the
 * ledger, so a webhook redelivery, or the webhook racing the auto-pay job,
 * settles it once. Returns the settled row, or null when there was nothing to
 * do. The surcharge (Decision 406) is not part of the balance: only `amount`
 * goes on the ledger.
 */
export async function settleChargePayment(tx: Tx, transactionId: string): Promise<Transaction | null> {
  const row = await tx.transaction.findUnique({ where: { id: transactionId } });
  if (!row || row.kind !== 'CHARGE_PAYMENT' || !SETTLEABLE.includes(row.status) || !row.currency) return null;
  await lockBalance(tx, row.schoolId, row.studentId);
  const flipped = await tx.transaction.updateMany({ where: { id: row.id, status: { in: SETTLEABLE } }, data: { status: 'SUCCESSFUL' } });
  if (flipped.count === 0) return null;
  await tx.balanceEntry.create({
    data: {
      id: randomUUID(),
      schoolId: row.schoolId,
      studentId: row.studentId,
      kind: 'PAYMENT',
      amount: -row.amount,
      currency: row.currency,
      transactionId: row.id,
      paymentMethod: row.paymentMethod,
    },
  });
  await allocate(tx, row.schoolId, row.studentId, row.currency, row.id, row.chargeId);
  return { ...row, status: 'SUCCESSFUL' };
}

/** Money as the API's English notices write it ("120.00 BRL"); @ultm8/i18n
 * matches the shape and shows it in the reader's language. */
export const noticeMoney = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** The receipt notice (Decision 338 item 9), the same text for a desk payment
 * and a card payment, so it is translated by the same pattern. A card payment
 * names what left the card: the amount plus any surcharge. */
export function receiptNotice(transactionId: string, amountPaid: number, currency: string) {
  return { key: `charge-payment-${transactionId}`, title: 'Payment received', body: `Your payment of ${noticeMoney(amountPaid, currency)} was received.` };
}
