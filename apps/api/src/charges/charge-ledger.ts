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

/** What has been put toward a charge, net of refunds taken back off it. */
export const chargePaid = (c: Pick<ChargeRow, 'allocations'>) => c.allocations.reduce((n, a) => n + a.amount, 0);

/** What a charge still owes before anything else is put on it: its total,
 * less what was refunded off it (step 4: a refund never re-opens a charge),
 * less what was paid. Not floored, and blind to cancelling: callers decide. */
export const chargeRemaining = (c: Pick<ChargeRow, 'grossAmount' | 'refundedAmount' | 'allocations'>) => c.grossAmount - c.refundedAmount - chargePaid(c);

const remaining = chargeRemaining;

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

/**
 * The refund notice (Decision 414 item 4): the amount and where it went, never
 * the owner's notes. Sent for a refund the owner makes (to the card, money
 * given back, as credit) and for one made in the Stripe dashboard; a lost
 * dispute sends none, as the member already has the dispute notice ("The
 * money goes back to your card"). Translated by @ultm8/i18n's pattern, as the
 * receipt is.
 */
export function refundNotice(refundId: string, kind: ChargeRefundKindValue, amount: number, currency: string) {
  const money = noticeMoney(amount, currency);
  const body: Record<ChargeRefundKindValue, string | null> = {
    CARD: `${money} was refunded to your card.`,
    STRIPE: `${money} was refunded to your card.`,
    MONEY_BACK: `${money} was given back to you.`,
    CREDIT: `${money} was added to your balance as credit.`,
    DISPUTE_LOST: null,
  };
  const text = body[kind];
  return text ? { key: `charge-refund-${refundId}`, title: 'Refund', body: text } : null;
}

export type RefundNotice = { key: string; title: string; body: string };

/**
 * The same "Refund" notice for a refund outside charges (Decision 415 item 4:
 * every refund): a Class Pack's share refunded to the card or given back when
 * a booking is cancelled, a membership payment refunded in the Stripe
 * dashboard. Same texts as refundNotice(). `key` is the caller's, one per
 * refund, so a retry or a webhook redelivery sends it once.
 */
export function paymentRefundNotice(key: string, way: 'CARD' | 'GIVEN_BACK', amount: number, currency: string): RefundNotice {
  const money = noticeMoney(amount, currency);
  return { key, title: 'Refund', body: way === 'CARD' ? `${money} was refunded to your card.` : `${money} was given back to you.` };
}

/** A membership purchase refused after the card was charged (one active
 * general-access membership, or the School closed) and refunded in full: the
 * notice says why, as the member may not have seen it happen. */
export function refusedPurchaseRefundNotice(key: string, amount: number, currency: string, plan: string): RefundNotice {
  return { key, title: 'Refund', body: `${noticeMoney(amount, currency)} was refunded to your card: ${plan} couldn't be bought.` };
}

// ---------------------------------------------------------------------------
// Step 4: refunds and owner-given credit (Decision 338 item 3, Decision 303
// item 3: owner only).
// ---------------------------------------------------------------------------

export type ChargeRefundKindValue = 'CARD' | 'MONEY_BACK' | 'CREDIT' | 'DISPUTE_LOST' | 'STRIPE';

/** Refund kinds where money leaves the School (everything but CREDIT). */
const MONEY_LEAVES: ChargeRefundKindValue[] = ['CARD', 'MONEY_BACK', 'DISPUTE_LOST', 'STRIPE'];
/** Refund kinds that are refunds in the Transaction's own sense
 * (Transaction.refundedAmount, the Transactions page's Refunded column). A lost
 * dispute is recorded by the dispute handler instead (disputedAmount). */
const TRANSACTION_REFUNDS: ChargeRefundKindValue[] = ['CARD', 'MONEY_BACK', 'STRIPE'];

export class ChargeRefundError extends Error {
  constructor(
    readonly code: 'CHARGE_REFUND_TOO_MUCH' | 'CHARGE_REFUND_USED_ELSEWHERE' | 'CHARGE_REFUND_NOT_ON_CHARGES',
    message: string,
  ) {
    super(message);
  }
}

/**
 * How much of one payment toward charges can still be refunded:
 * - `left`: what was paid less every earlier refund of it, of any kind (the
 *   cap: never more than was paid, Decision 338 item 3);
 * - `onCharges`: the part still on charges that aren't cancelled;
 * - `asMoney`: what can go back to the member (card, cash): the part still in
 *   credit, as far as the member's credit hasn't been used on other charges
 *   since, plus `onCharges`;
 * - `asCredit`: what can be turned into credit: `onCharges` (the rest is
 *   credit already).
 */
export async function paymentRefundable(tx: Tx, transaction: Pick<Transaction, 'id' | 'amount' | 'schoolId' | 'studentId' | 'currency'>) {
  const [refunded, allocations] = await Promise.all([
    tx.chargeRefund.aggregate({ where: { transactionId: transaction.id }, _sum: { amount: true } }),
    tx.chargeAllocation.findMany({
      where: { transactionId: transaction.id },
      include: { charge: { select: { id: true, cancelledAt: true, dueDate: true, invoiceNumber: true } } },
    }),
  ]);
  const left = Math.max(0, transaction.amount - (refunded._sum.amount ?? 0));
  const perCharge = new Map<string, { chargeId: string; net: number; dueDate: Date; invoiceNumber: number }>();
  for (const a of allocations) {
    if (a.charge.cancelledAt) continue;
    const row = perCharge.get(a.chargeId) ?? { chargeId: a.chargeId, net: 0, dueDate: a.charge.dueDate, invoiceNumber: a.charge.invoiceNumber };
    row.net += a.amount;
    perCharge.set(a.chargeId, row);
  }
  const charges = [...perCharge.values()].filter((c) => c.net > 0);
  const onCharges = Math.min(left, charges.reduce((n, c) => n + c.net, 0));
  const inCredit = left - onCharges;
  const credit = transaction.currency ? await freeCredit(tx, transaction.schoolId, transaction.studentId, transaction.currency) : 0;
  const fromCredit = Math.min(inCredit, credit);
  return { left, onCharges, inCredit, fromCredit, asMoney: fromCredit + onCharges, asCredit: onCharges, charges };
}

/**
 * Records one refund of a payment toward charges on the ledger. The caller
 * has taken the balance lock (lockBalance) and checked who, the payment's
 * status and, for CARD, already sent the refund to Stripe. The ledger rules:
 *
 * 1. Money given back (CARD, MONEY_BACK, DISPUTE_LOST, STRIPE) comes first
 *    out of the part of the payment that is still credit, then off the
 *    charges it paid, latest due first.
 * 2. A refund as CREDIT comes only off the charges it paid.
 * 3. Taking an amount off a charge: a negative ChargeAllocation for this
 *    payment (the money leaves the charge), the charge's refundedAmount goes up
 *    by the same amount (its total comes down, so it is never re-opened: what
 *    it owes is unchanged) and a CHARGE_REDUCED BalanceEntry (−).
 * 4. Money given back adds one REFUND BalanceEntry (+ the whole amount). Net
 *    effect: what was taken off charges cancels out, and what came out of
 *    credit lowers the credit. Nothing ever becomes owed.
 * 5. A refund as CREDIT adds no REFUND row: the charge came down and the money
 *    stays with the member as credit, which is then put toward their open
 *    charges as all credit is (Decision 303 item 2).
 * 6. CARD, MONEY_BACK and STRIPE also add to Transaction.refundedAmount (the
 *    Transactions page's Refunded column) and turn the row Refunded once the
 *    whole payment is; a lost dispute is the dispute handler's (Disputed).
 */
export async function recordChargeRefund(
  tx: Tx,
  input: {
    transaction: Transaction;
    kind: ChargeRefundKindValue;
    amount: number;
    notes: string | null;
    refundedById: string | null;
    stripeRefundId?: string | null;
  },
): Promise<string> {
  const { transaction: p, kind, amount } = input;
  const currency = p.currency!;
  const state = await paymentRefundable(tx, p);
  if (amount > state.left) {
    throw new ChargeRefundError('CHARGE_REFUND_TOO_MUCH', 'This is more than is left to refund on this payment.');
  }
  const money = MONEY_LEAVES.includes(kind);
  const fromCredit = money ? Math.min(amount, state.fromCredit) : 0;
  let rest = amount - fromCredit;
  if (rest > state.onCharges) {
    throw money
      ? new ChargeRefundError('CHARGE_REFUND_USED_ELSEWHERE', "Part of this payment is credit that has already paid other charges, so it can't be given back.")
      : new ChargeRefundError('CHARGE_REFUND_NOT_ON_CHARGES', 'Only the part of this payment that paid charges can be turned into credit. The rest is credit already.');
  }

  const refundId = randomUUID();
  await tx.chargeRefund.create({
    data: {
      id: refundId,
      schoolId: p.schoolId,
      studentId: p.studentId,
      transactionId: p.id,
      kind,
      amount,
      currency,
      notes: input.notes,
      refundedById: input.refundedById,
      stripeRefundId: input.stripeRefundId ?? null,
    },
  });
  const latestFirst = [...state.charges].sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime() || b.invoiceNumber - a.invoiceNumber);
  for (const c of latestFirst) {
    if (rest <= 0) break;
    const take = Math.min(rest, c.net);
    await tx.chargeAllocation.create({ data: { id: randomUUID(), schoolId: p.schoolId, studentId: p.studentId, chargeId: c.chargeId, amount: -take, transactionId: p.id, refundId } });
    await tx.charge.update({ where: { id: c.chargeId }, data: { refundedAmount: { increment: take } } });
    await tx.balanceEntry.create({ data: { id: randomUUID(), schoolId: p.schoolId, studentId: p.studentId, kind: 'CHARGE_REDUCED', amount: -take, currency, chargeId: c.chargeId, refundId } });
    rest -= take;
  }
  if (money) {
    await tx.balanceEntry.create({
      data: { id: randomUUID(), schoolId: p.schoolId, studentId: p.studentId, kind: 'REFUND', amount, currency, transactionId: p.id, refundId, recordedById: input.refundedById },
    });
  }
  if (TRANSACTION_REFUNDS.includes(kind)) {
    const total = (p.refundedAmount ?? 0) + amount;
    await tx.transaction.update({
      where: { id: p.id },
      data: { refundedAmount: total, ...(p.status === 'SUCCESSFUL' && total >= p.amount ? { status: 'REFUNDED' } : {}) },
    });
  }
  await allocate(tx, p.schoolId, p.studentId, currency, null, null);
  return refundId;
}

/** Credit the owner gives (goodwill, say): a CREDIT_GIVEN BalanceEntry with
 * its staff-only note, then put toward the member's open charges. The caller
 * has taken the balance lock. */
export async function giveCredit(tx: Tx, input: { schoolId: string; studentId: string; currency: string; amount: number; note: string; recordedById: string }): Promise<string> {
  const id = randomUUID();
  await tx.balanceEntry.create({
    data: { id, schoolId: input.schoolId, studentId: input.studentId, kind: 'CREDIT_GIVEN', amount: -input.amount, currency: input.currency, note: input.note, recordedById: input.recordedById },
  });
  await allocate(tx, input.schoolId, input.studentId, input.currency, null, null);
  return id;
}

/** The School's payment notification switches (Decision 338 item 10; the
 * refund notice, Decision 414 item 4). "New invoice" and "Charge cancelled"
 * have none: they are always sent. */
export async function chargeNoticeSwitches(db: Pick<Tx, 'school'>, schoolId: string) {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { chargeNoticeReceipt: true, chargeNoticeFailedOverdue: true, chargeNoticeDispute: true, chargeNoticeRefund: true },
  });
  return {
    receipt: school?.chargeNoticeReceipt ?? true,
    failedOverdue: school?.chargeNoticeFailedOverdue ?? true,
    dispute: school?.chargeNoticeDispute ?? true,
    refund: school?.chargeNoticeRefund ?? true,
  };
}
