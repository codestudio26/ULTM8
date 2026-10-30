import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { allocate, lockBalance } from './charge-ledger';
import { ChargeTotals } from './charge-maths';

type Tx = Prisma.TransactionClient;

export interface NewCharge {
  schoolId: string;
  studentId: string;
  description: string;
  unitAmount: number;
  discountType: 'PERCENT' | 'FIXED' | null;
  discountValue: number | null;
  /** The School's tax settings now (Decision 411), kept on the charge. */
  taxCountry: string | null;
  taxRateBasisPoints: number;
  taxInclusive: boolean;
  totals: ChargeTotals;
  currency: string;
  dueDate: Date;
  createdById: string | null;
  /** A recurring charge's occurrence (Decision 412). */
  recurring?: { recurringChargeId: string; occurrenceDate: Date };
  /** A late fee (Decision 413): what it is for, and how it was worked out. */
  lateFee?: Pick<
    Prisma.ChargeUncheckedCreateInput,
    'lateFeeForChargeId' | 'lateFeeForTransactionId' | 'lateFeeOverdueAmount' | 'lateFeePercentBps'
  >;
  /** An accepted promotion fee (Decision 303 item 5): the request it is for. */
  promotionFeeRequestId?: string;
}

/**
 * The School's invoice numbers, one writer at a time. Always taken before the
 * member's balance lock (lockBalance), by every path, so two paths never wait
 * on each other the other way round. Advisory locks stack within a
 * transaction, so taking it again in insertCharge() is harmless.
 */
export async function lockInvoiceNumbers(tx: Tx, schoolId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`charge-invoice:${schoolId}`}, 0))`;
}

/**
 * Inserts one charge, puts it on the member's balance, and uses any credit on
 * it straight away (Decision 303 item 2). Shared by a charge staff create
 * (ChargesService.create, step 1), each occurrence of a recurring charge
 * (step 3), each late fee (Decision 413) and each accepted promotion fee
 * (step 6), so all get an invoice number the same way. Runs inside the
 * caller's transaction, on the jobs connection, after the caller's checks.
 *
 * Invoice numbers: one at a time per School, under a per-School lock inside
 * the transaction that inserts the charge, so they never repeat or skip
 * (Decision 338 item 4).
 */
export async function insertCharge(tx: Tx, c: NewCharge): Promise<{ id: string; invoiceNumber: number }> {
  await lockInvoiceNumbers(tx, c.schoolId);
  await lockBalance(tx, c.schoolId, c.studentId);
  const last = await tx.charge.aggregate({ where: { schoolId: c.schoolId }, _max: { invoiceNumber: true } });
  const id = randomUUID();
  const invoiceNumber = (last._max.invoiceNumber ?? 0) + 1;
  await tx.charge.create({
    data: {
      id,
      schoolId: c.schoolId,
      studentId: c.studentId,
      invoiceNumber,
      description: c.description,
      unitAmount: c.unitAmount,
      discountType: c.discountType,
      discountValue: c.discountType ? c.discountValue : null,
      discountAmount: c.totals.discountAmount,
      taxCountry: c.taxCountry,
      taxRateBasisPoints: c.taxRateBasisPoints,
      taxInclusive: c.taxInclusive,
      netAmount: c.totals.netAmount,
      taxAmount: c.totals.taxAmount,
      grossAmount: c.totals.grossAmount,
      currency: c.currency,
      dueDate: c.dueDate,
      createdById: c.createdById,
      recurringChargeId: c.recurring?.recurringChargeId ?? null,
      occurrenceDate: c.recurring?.occurrenceDate ?? null,
      ...c.lateFee,
      promotionFeeRequestId: c.promotionFeeRequestId ?? null,
    },
  });
  await tx.balanceEntry.create({ data: { id: randomUUID(), schoolId: c.schoolId, studentId: c.studentId, kind: 'CHARGE', amount: c.totals.grossAmount, currency: c.currency, chargeId: id } });
  // Credit already on the balance pays this charge straight away.
  await allocate(tx, c.schoolId, c.studentId, c.currency, null, null);
  return { id, invoiceNumber };
}
