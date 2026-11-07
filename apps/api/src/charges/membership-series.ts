import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient, RecurringCharge } from '@prisma/client';
import { chargeCurrency } from '../common/school-currency';
import { backDay, dayIn, dayNumber, dayStart, dayString, frozenDays } from '../memberships/freeze/membership-freeze';
import { CardAccount, takesCards } from '../payments/takes-cards';
import { addDays, anchorAt, dayOf, dayValue, firstIndexOnOrAfter, nextDay, occurrenceDay, schoolToday } from './recurring-schedule';

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
 * - A freeze pauses it, as it pauses a card Subscription (Decision 442 item
 *   5, syncSeriesFreezes below).
 *
 * A School that takes cards (a Stripe account Stripe says is ready, Decision
 * 442 item 2) is untouched: its monthly plans stay card Subscriptions.
 */

type Db = Pick<PrismaClient, 'membership' | 'recurringCharge' | 'school' | '$transaction'>;
type Tx = Pick<Prisma.TransactionClient, 'recurringCharge' | 'school' | '$queryRaw'>;

/** Whether a School takes card payments in the app (Decision 442 item 2: a
 * Stripe payment account that Stripe says is ready). */
export { takesCards };

/** A paid monthly plan sold at a School with a payment account that takes no
 * cards (not Stripe, or a Stripe account not ready yet, Decision 442 item 2):
 * billed to the member's balance after the first month. */
export function isBalanceBilled(plan: { type: string; price: number }, account: CardAccount | null | undefined): boolean {
  return plan.type === 'SUBSCRIPTION' && plan.price > 0 && !!account && !takesCards(account);
}

/**
 * When a balance-billed membership cancelled at `now` ends: at the start of
 * its next billing day after today, in the School's time zone, so the month
 * already charged runs out (as a card Subscription's cancel at period end).
 * A billing day that is today stays charged and the membership runs to the
 * next one.
 *
 * The billing days are the series' own (its first date, from its next
 * index) when it has one: a freeze moves them (Decision 442 item 5,
 * syncSeriesFreezes). Without a series yet, they count from the start date.
 */
export function balanceBilledCancelAt(
  startDate: Date,
  zone: string | null | undefined,
  now: Date = new Date(),
  series?: { firstDate: Date; nextIndex: number } | null,
): Date {
  const first = series ? dayOf(series.firstDate) : schoolToday(startDate, zone);
  const today = schoolToday(now, zone);
  const index = firstIndexOnOrAfter(first, 'MONTHLY', addDays(today, 1), series ? series.nextIndex : 1);
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

// ---------------------------------------------------------------------------
// Freezing (Decision 442 item 5)
// ---------------------------------------------------------------------------

type FreezeTx = Pick<Prisma.TransactionClient, 'recurringCharge' | 'membershipFreeze' | 'membership'>;

/**
 * Moves a series so that its next charge is `day` and the months after it
 * follow from there (the same day of each month), as a card Subscription's
 * billing restarts from the day its trial ends. The series' first date and
 * next index are re-anchored on that day (anchorAt; the index never goes
 * below the charges already made); its end date (if any) still holds.
 */
async function moveSeriesTo(tx: Pick<Prisma.TransactionClient, 'recurringCharge'>, row: RecurringCharge, day: string): Promise<RecurringCharge> {
  const anchor = anchorAt(day, row.frequency, row.createdCount);
  const state = {
    firstDate: anchor.firstDate,
    frequency: row.frequency,
    endDate: row.endDate ? dayOf(row.endDate) : null,
    maxOccurrences: row.maxOccurrences,
    nextIndex: anchor.index,
    createdCount: row.createdCount,
  };
  const next = nextDay(state);
  return tx.recurringCharge.update({
    where: { id: row.id },
    data: { firstDate: dayValue(anchor.firstDate), nextIndex: anchor.index, nextDate: next ? dayValue(next) : null },
  });
}

/**
 * Decision 442 item 5: freezing a monthly plan billed to the balance pauses
 * its monthly charge, as freezing a card Subscription does (Decision 404,
 * freeze-billing.ts), and the charges resume when the freeze ends. The same
 * rule as the card, on the series instead of Stripe:
 *
 * - Approved: the next charge on or after the freeze's first day moves later
 *   by the freeze's length, and the months after it follow from the new day.
 *   The member keeps the paid days the freeze took and never pays for frozen
 *   days, and no month falls inside the freeze. A month due before the first
 *   frozen day is charged as usual first; the move waits for it (as the card's
 *   waits for that renewal).
 * - Ended early: the next charge moves back by the frozen days not used
 *   (all of them when it ended before it started), never before today. A
 *   freeze ended before the move was made moves by the days it froze.
 * - A series that has ended (the membership was cancelled) is not moved.
 *
 * Runs with the series row locked (FOR UPDATE), so the charge-recurring job,
 * an approval and an early end never move it twice: each freeze's
 * billingShiftAppliedAt and billingRestoredAt (the card's own markers; a
 * balance-billed membership has no Stripe Subscription, so the card's sweep
 * never reads them) record the move, in the same transaction. Returns the row
 * as it is now.
 */
export async function syncSeriesFreezes(tx: FreezeTx, row: RecurringCharge, zone: string | null | undefined, now: Date): Promise<RecurringCharge> {
  if (!row.membershipId) return row;
  const freezes = await tx.membershipFreeze.findMany({
    where: {
      membershipId: row.membershipId,
      status: 'APPROVED',
      OR: [{ billingShiftAppliedAt: null }, { endedEarlyAt: { not: null }, billingRestoredAt: null }],
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const today = dayIn(now, zone);
  let current = row;
  for (const f of freezes) {
    if (!f.billingShiftAppliedAt) {
      const days = frozenDays(f, zone);
      const ended = !!f.endedEarlyAt;
      // Nothing frozen (ended before it started), or nothing left to charge: done.
      if (days === 0 || (!current.nextDate && !current.stoppedAt)) {
        await tx.membershipFreeze.update({ where: { id: f.id }, data: { billingShiftAppliedAt: now, ...(ended ? { billingRestoredAt: now } : {}) } });
        continue;
      }
      // A month falls before the first frozen day: it is charged first.
      if (!current.nextDate || dayOf(current.nextDate) < dayString(dayNumber(f.startsAt))) continue;
      current = await moveSeriesTo(tx, current, addDays(dayOf(current.nextDate), days));
      // Ended early before the move: it moved by the days it froze, so there is nothing to take back.
      await tx.membershipFreeze.update({ where: { id: f.id }, data: { billingShiftAppliedAt: now, ...(ended ? { billingRestoredAt: now } : {}) } });
    } else {
      const unused = dayNumber(f.endsAt) - backDay(f, zone);
      if (unused > 0 && current.nextDate) {
        const back = addDays(dayOf(current.nextDate), -unused);
        current = await moveSeriesTo(tx, current, back < today ? today : back);
      }
      await tx.membershipFreeze.update({ where: { id: f.id }, data: { billingRestoredAt: now } });
    }
  }
  return current;
}

/**
 * Applies syncSeriesFreezes to one membership's series, in its own
 * transaction with the row locked: right after a freeze is approved or ended
 * early, and from the charge-recurring job. Returns whether the series moved.
 * A membership without a series yet is left for the job (healBalanceBilling
 * sets it up, then this moves it).
 */
export async function applyBalanceFreezeBilling(db: Pick<PrismaClient, '$transaction'>, membershipId: string, now: Date = new Date()): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const found = await tx.recurringCharge.findUnique({ where: { membershipId }, select: { id: true } });
    if (!found) return false;
    await tx.$queryRaw`SELECT id FROM "RecurringCharge" WHERE id = ${found.id} FOR UPDATE`;
    const row = await tx.recurringCharge.findUniqueOrThrow({ where: { id: found.id } });
    const school = await tx.school.findUnique({ where: { id: row.schoolId }, select: { timezone: true } });
    const after = await syncSeriesFreezes(tx, row, school?.timezone, now);
    return after.firstDate.getTime() !== row.firstDate.getTime() || after.nextDate?.getTime() !== row.nextDate?.getTime();
  });
}

/**
 * The charge-recurring job's part: every balance-billed membership with an
 * approved freeze not moved yet, or ended early and not moved back yet. One
 * failure is logged and left for the next run.
 */
export async function applyDueBalanceFreezes(db: Pick<PrismaClient, '$transaction' | 'membershipFreeze'>, now: Date, logger?: Pick<Logger, 'warn'>): Promise<number> {
  const due = await db.membershipFreeze.findMany({
    where: {
      status: 'APPROVED',
      membership: { billedToBalance: true },
      OR: [{ billingShiftAppliedAt: null }, { endedEarlyAt: { not: null }, billingRestoredAt: null }],
    },
    select: { membershipId: true },
    distinct: ['membershipId'],
  });
  let moved = 0;
  for (const f of due) {
    try {
      if (await applyBalanceFreezeBilling(db, f.membershipId, now)) moved++;
    } catch (err) {
      logger?.warn(`Membership ${f.membershipId}: moving its monthly charges for a freeze failed; tried again on the next run. ${err}`);
    }
  }
  return moved;
}
