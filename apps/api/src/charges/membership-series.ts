import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient, RecurringCharge } from '@prisma/client';
import { chargeCurrency } from '../common/school-currency';
import { dayIn, dayNumber, dayStart } from '../memberships/freeze/membership-freeze';
import { addDays, dayOf, dayValue, firstIndexOnOrAfter, nextDay, occurrenceDay, schoolToday } from './recurring-schedule';

/**
 * Decision 441 item 1: a monthly plan (SUBSCRIPTION) at a School that takes
 * no cards (Decisions 437/439) is billed to the member's balance each month.
 *
 * - The first month is a cash or bank-transfer payment, as for any plan
 *   there: the member's order staff confirm, or a desk sale.
 * - The membership is then `billedToBalance`, with no Stripe Subscription,
 *   and a monthly recurring charge (Decision 412) is tied to it
 *   (`RecurringCharge.membershipId`). Its first charge is one month after the
 *   membership started, on the same day of the month (the last day of a
 *   shorter month for the 29th to 31st), in the School's time zone.
 * - Each month is then a normal charge on the balance: its own invoice, the
 *   "New invoice" notice, paid by Pix or cash at the desk, overdue and late
 *   fees as for any charge (Decision 413).
 * - The series follows the membership: no charge is made on or after the day
 *   the membership ends (cancelled, or no longer active).
 *
 * A School with a Stripe payment account (cards) is untouched: its monthly
 * plans stay card Subscriptions.
 */

type Db = Pick<PrismaClient, 'membership' | 'recurringCharge' | 'school' | '$transaction'>;
type Tx = Pick<Prisma.TransactionClient, 'recurringCharge' | 'school' | '$queryRaw'>;

/** Whether a School takes card payments in the app: a Stripe payment
 * account, the same test as the purchase and school_card_payments(). */
export function takesCards(account: { provider: string } | null | undefined): boolean {
  return account?.provider === 'STRIPE';
}

/** A paid monthly plan sold at a School with a payment account that isn't
 * Stripe: billed to the member's balance after the first month. */
export function isBalanceBilled(plan: { type: string; price: number }, account: { provider: string } | null | undefined): boolean {
  return plan.type === 'SUBSCRIPTION' && plan.price > 0 && !!account && !takesCards(account);
}

/**
 * When a balance-billed membership cancelled at `now` ends: at the start of
 * its next billing day after today, in the School's time zone, so the month
 * already charged runs out (as a card Subscription's cancel at period end).
 * A billing day that is today stays charged and the membership runs to the
 * next one.
 */
export function balanceBilledCancelAt(startDate: Date, zone: string | null | undefined, now: Date = new Date()): Date {
  const first = schoolToday(startDate, zone);
  const today = schoolToday(now, zone);
  const index = firstIndexOnOrAfter(first, 'MONTHLY', addDays(today, 1), 1);
  return dayStart(dayNumber(occurrenceDay(first, 'MONTHLY', index)), zone);
}

/**
 * Sets up the monthly series of a balance-billed membership, once: the
 * membership must be balance-billed, active, not cancelled and without one.
 * `price` and `currency` are what the member bought it at (the plan's when
 * not given). Run on the jobs connection after the membership is committed;
 * the charge-recurring job sets up any series this missed (healBalanceBilling).
 * Returns whether a series was made.
 */
export async function startBalanceBilling(
  db: Db,
  membershipId: string,
  opts: { createdById?: string | null; price?: number; currency?: string | null } = {},
): Promise<boolean> {
  const m = await db.membership.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      studentId: true,
      schoolId: true,
      billedToBalance: true,
      status: true,
      cancelAt: true,
      startDate: true,
      membershipPlan: { select: { title: true, price: true, currency: true, type: true } },
      recurringCharge: { select: { id: true } },
    },
  });
  if (!m || !m.billedToBalance || m.recurringCharge || m.status !== 'ACTIVE' || m.cancelAt) return false;
  const school = await db.school.findUnique({ where: { id: m.schoolId }, select: { timezone: true, defaultCurrency: true } });
  const price = opts.price ?? m.membershipPlan.price;
  const currency = chargeCurrency(opts.currency ?? m.membershipPlan.currency, school?.defaultCurrency);
  if (!school || !currency || !(price > 0)) return false;
  const firstDate = schoolToday(m.startDate, school.timezone);
  try {
    await db.recurringCharge.create({
      data: {
        schoolId: m.schoolId,
        studentId: m.studentId,
        membershipId: m.id,
        description: m.membershipPlan.title,
        unitAmount: price,
        currency,
        frequency: 'MONTHLY',
        firstDate: dayValue(firstDate),
        // Occurrence 0 is the first month, already paid as the order; the
        // series starts charging at occurrence 1.
        nextIndex: 1,
        nextDate: dayValue(occurrenceDay(firstDate, 'MONTHLY', 1)),
        createdById: opts.createdById ?? null,
      },
    });
    return true;
  } catch (err) {
    // Two runs at once: the unique membershipId keeps one.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
}

/** The day a balance-billed membership stops being charged on: the first of
 * its cancel day and its end day, or `today` once it is no longer active.
 * Null while it runs. */
export function membershipBillingEndDay(
  m: { status: string; cancelAt: Date | null; expiryDate: Date | null } | null,
  zone: string | null | undefined,
  today: string,
): string | null {
  if (!m || m.status !== 'ACTIVE') return today;
  const days = [m.cancelAt, m.expiryDate].filter((d): d is Date => !!d).map((d) => dayIn(d, zone));
  return days.length ? days.sort()[0] : null;
}

/** Ends a locked series so that nothing is charged on or after `endDay`: its
 * endDate becomes the day before (never before its first date), and its next
 * date is cleared when that falls after it. An earlier end is kept. */
export async function endSeriesBefore(tx: Pick<Prisma.TransactionClient, 'recurringCharge'>, row: RecurringCharge, endDay: string): Promise<void> {
  const first = dayOf(row.firstDate);
  const before = addDays(endDay, -1);
  const lastDay = before < first ? first : before;
  if (row.endDate && dayOf(row.endDate) <= lastDay) return;
  const state = {
    firstDate: first,
    frequency: row.frequency,
    endDate: lastDay,
    maxOccurrences: row.maxOccurrences,
    nextIndex: row.nextIndex,
    createdCount: row.createdCount,
  };
  const next = row.nextDate ? nextDay(state) : null;
  await tx.recurringCharge.update({ where: { id: row.id }, data: { endDate: dayValue(lastDay), nextDate: next ? dayValue(next) : null } });
}

/**
 * After a balance-billed membership is cancelled: its series ends before the
 * day the membership ends, so the screens show it ending. Best-effort: the
 * charge-recurring job makes no charge on or after that day either way.
 */
export async function endBalanceBilling(db: Db, membershipId: string, endsAt: Date, logger?: Pick<Logger, 'warn'>): Promise<void> {
  try {
    await db.$transaction(async (tx: Tx) => {
      const found = await tx.recurringCharge.findUnique({ where: { membershipId }, select: { id: true } });
      if (!found) return;
      await tx.$queryRaw`SELECT id FROM "RecurringCharge" WHERE id = ${found.id} FOR UPDATE`;
      const row = await tx.recurringCharge.findUniqueOrThrow({ where: { id: found.id } });
      const school = await tx.school.findUnique({ where: { id: row.schoolId }, select: { timezone: true } });
      await endSeriesBefore(tx, row, dayIn(endsAt, school?.timezone));
    });
  } catch (err) {
    logger?.warn(`Membership ${membershipId}: ending its monthly charges failed; the charge-recurring job stops them. ${err}`);
  }
}

/**
 * The charge-recurring job's safety net: a balance-billed membership that is
 * still running but has no series (the set-up right after the sale failed)
 * gets it now, with the same dates it would have had.
 */
export async function healBalanceBilling(db: Db, logger?: Pick<Logger, 'warn'>): Promise<number> {
  const missing = await db.membership.findMany({
    where: { billedToBalance: true, status: 'ACTIVE', cancelAt: null, recurringCharge: { is: null } },
    select: { id: true },
  });
  let made = 0;
  for (const m of missing) {
    try {
      if (await startBalanceBilling(db, m.id)) made++;
    } catch (err) {
      logger?.warn(`Membership ${m.id}: setting up its monthly charges failed; tried again on the next run. ${err}`);
    }
  }
  return made;
}
