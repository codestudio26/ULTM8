import { Prisma, PrismaClient, RecurringCharge } from '@prisma/client';
import { trialEndedUnpaid } from '../subscription-plans/subscription-gate.service';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { computeCharge, formatInvoiceNumber } from './charge-maths';
import { insertCharge, lockInvoiceNumbers } from './charge-insert';
import { MAX_OCCURRENCES_PER_RUN, dayOf, dayValue, planOccurrences, schoolToday, skipThrough, type SeriesState } from './recurring-schedule';

type Tx = Prisma.TransactionClient;

/** "120.00 BRL", as every charge notice writes money (@ultm8/i18n matches it). */
const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** Step 1's "New invoice" notice, the same text for a charge staff create and
 * a recurring charge's occurrence (Decision 412), so it is translated by the
 * same pattern. */
export function newInvoiceNotice(c: { id: string; invoiceNumber: number; description: string; grossAmount: number; currency: string; dueDate: string }) {
  return {
    key: `charge-created-${c.id}`,
    title: 'New invoice',
    body: `Invoice ${formatInvoiceNumber(c.invoiceNumber)} for ${c.description}: ${money(c.grossAmount, c.currency)}, due ${c.dueDate}.`,
    targetId: c.id,
  };
}

export type InvoiceNotice = ReturnType<typeof newInvoiceNotice>;

export interface SeriesRun {
  /** The charges made, oldest first, each with its "New invoice" notice. */
  created: InvoiceNotice[];
  /** Occurrences passed over because the School was closed or degraded on their day. */
  skipped: number;
  /** The series stopped because the student is no longer a current student. */
  studentLeft: boolean;
}

export const seriesState = (r: Pick<RecurringCharge, 'firstDate' | 'frequency' | 'endDate' | 'maxOccurrences' | 'nextIndex' | 'createdCount'>): SeriesState => ({
  firstDate: dayOf(r.firstDate),
  frequency: r.frequency,
  endDate: r.endDate ? dayOf(r.endDate) : null,
  maxOccurrences: r.maxOccurrences,
  nextIndex: r.nextIndex,
  createdCount: r.createdCount,
});

/** The series row, locked for this transaction: two runs never make the same occurrence. */
async function lockSeries(tx: Tx, id: string): Promise<RecurringCharge | null> {
  await tx.$queryRaw`SELECT id FROM "RecurringCharge" WHERE id = ${id} FOR UPDATE`;
  return tx.recurringCharge.findUnique({ where: { id } });
}

/**
 * Makes every occurrence of one recurring charge that is due on the School's
 * day (Decision 412): each a normal charge (its own invoice number, the
 * School's tax at that moment, due on its own date), one per occurrence date
 * (the Charge's unique key on series and date, and a lock on the series row,
 * so a rerun or two runs at once never double). Occurrences missed while the
 * job wasn't running are caught up, one each.
 *
 * - A School that is closed, or whose ULTM8 subscription is degraded (as
 *   SubscriptionGateService), makes no occurrences: the ones that fall due
 *   then are passed over, not made later.
 * - A student who is no longer a current student of the School: the series
 *   stops (STUDENT_LEFT) and nothing is charged.
 *
 * Each charge is put on the balance like any other, so credit pays it at once
 * and the charge-auto-pay job (6am UTC, after this one) picks it up for a
 * member who turned automatic payment on. Runs on the jobs connection.
 */
export async function runSeries(prisma: PrismaClient, seriesId: string, now: Date): Promise<SeriesRun> {
  const out: SeriesRun = { created: [], skipped: 0, studentLeft: false };
  const series = await prisma.recurringCharge.findUnique({ where: { id: seriesId } });
  if (!series || series.stoppedAt || !series.nextDate) return out;
  const school = await prisma.school.findUnique({
    where: { id: series.schoolId },
    select: { archivedAt: true, timezone: true, platformSubscriptionStatus: true, platformTrialEndsAt: true },
  });
  if (!school) return out;
  const today = schoolToday(now, school.timezone);
  if (dayOf(series.nextDate) > today) return out;

  if (school.archivedAt || school.platformSubscriptionStatus === 'CANCELED' || trialEndedUnpaid(school, now)) {
    out.skipped = await prisma.$transaction(async (tx) => {
      const row = await lockSeries(tx, seriesId);
      if (!row || row.stoppedAt || !row.nextDate) return 0;
      const skip = skipThrough(seriesState(row), today);
      await tx.recurringCharge.update({ where: { id: seriesId }, data: { nextIndex: skip.nextIndex, nextDate: skip.nextDay ? dayValue(skip.nextDay) : null } });
      return skip.nextIndex - row.nextIndex;
    });
    return out;
  }

  const current = await prisma.roleGrant.findFirst({ where: { userId: series.studentId, schoolId: series.schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
  if (!current) {
    const stopped = await prisma.recurringCharge.updateMany({
      where: { id: seriesId, stoppedAt: null },
      data: { stoppedAt: now, stoppedReason: 'STUDENT_LEFT', stoppedById: null },
    });
    out.studentLeft = stopped.count > 0;
    return out;
  }

  // One transaction per occurrence, so a failure keeps the ones already made.
  for (let n = 0; n < MAX_OCCURRENCES_PER_RUN; n++) {
    const made = await prisma.$transaction(async (tx) => {
      await lockSchoolOpen(tx, series.schoolId);
      // Lock order, as every charge write: invoice numbers, then the series,
      // then (in insertCharge) the member's balance.
      await lockInvoiceNumbers(tx, series.schoolId);
      const row = await lockSeries(tx, seriesId);
      if (!row || row.stoppedAt || !row.nextDate) return null;
      const state = seriesState(row);
      const plan = planOccurrences(state, today, 1);
      if (plan.due.length === 0) return null;
      const occurrence = plan.due[0];
      const occurrenceDate = dayValue(occurrence.day);
      const advance = (created: number) =>
        tx.recurringCharge.update({
          where: { id: seriesId },
          data: { nextIndex: plan.nextIndex, createdCount: row.createdCount + created, nextDate: plan.nextDay ? dayValue(plan.nextDay) : null },
        });
      const exists = await tx.charge.findUnique({ where: { recurringChargeId_occurrenceDate: { recurringChargeId: seriesId, occurrenceDate } }, select: { id: true } });
      if (exists) {
        await advance(1);
        return { notice: null };
      }
      // The School's tax at this moment (Decision 411), kept on the charge.
      const tax = await tx.school.findUniqueOrThrow({ where: { id: row.schoolId }, select: { taxCountry: true, taxRateBasisPoints: true, taxInclusive: true } });
      const totals = computeCharge({
        unitAmount: row.unitAmount,
        discount: row.discountType ? { type: row.discountType, value: row.discountValue! } : null,
        taxRateBasisPoints: tax.taxRateBasisPoints,
        taxInclusive: tax.taxInclusive,
      });
      const charge = await insertCharge(tx, {
        schoolId: row.schoolId,
        studentId: row.studentId,
        description: row.description,
        unitAmount: row.unitAmount,
        discountType: row.discountType,
        discountValue: row.discountValue,
        taxCountry: tax.taxCountry,
        taxRateBasisPoints: tax.taxRateBasisPoints,
        taxInclusive: tax.taxInclusive,
        totals,
        currency: row.currency,
        dueDate: occurrenceDate,
        createdById: null,
        recurring: { recurringChargeId: seriesId, occurrenceDate },
      });
      await advance(1);
      return {
        notice: newInvoiceNotice({ id: charge.id, invoiceNumber: charge.invoiceNumber, description: row.description, grossAmount: totals.grossAmount, currency: row.currency, dueDate: occurrence.day }),
      };
    });
    if (!made) break;
    if (made.notice) out.created.push(made.notice);
  }
  return out;
}
