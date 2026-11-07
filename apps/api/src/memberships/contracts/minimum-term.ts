import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import type { StripeClientService } from '../../payments/stripe-client.service';
import { dayIn, dayNumber, frozenDays, type FreezeDates } from '../freeze/membership-freeze';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead of the end of the minimum term the sweep sets a "ends after
 * the minimum term" Subscription to stop: far enough that the member's
 * 7-day "membership ends" reminder (Decision 317 item 7, which reads
 * Membership.cancelAt) is sent, with two days to spare for time zones and a
 * missed run.
 */
export const TERM_END_LEAD_DAYS = 10;

/** The day the minimum term ends with no freeze: the Membership's start plus
 * the signed number of whole months (calendar months, UTC). */
export function minimumTermEndsAt(startDate: Date, months: number): Date {
  return DateTime.fromJSDate(startDate, { zone: 'utc' }).plus({ months }).toJSDate();
}

/**
 * Decision 435 item 17: a freeze pushes the end of the minimum term back by
 * the freeze's length, as it already moves a fixed-term membership's end
 * date (Decision 404: approval adds the whole freeze, ending early takes the
 * unused days back off). Every approved freeze that starts before the term
 * ends (as pushed by the freezes before it) adds the days it actually freezes;
 * a freeze starting after the term has ended changes nothing.
 */
export function minimumTermEndsAtWithFreezes(
  startDate: Date,
  months: number,
  freezes: FreezeDates[],
  zone: string | null | undefined,
): Date {
  let end = minimumTermEndsAt(startDate, months);
  const approved = freezes.filter((f) => f.status === 'APPROVED').sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const f of approved) {
    if (dayNumber(f.startsAt) >= dayNumber(dayIn(end, zone))) continue;
    end = new Date(end.getTime() + frozenDays(f, zone) * DAY_MS);
  }
  return end;
}

type Db = Pick<PrismaClient, 'planContractSignature' | 'transaction' | 'membership' | 'membershipFreeze' | 'school' | 'paymentAccount' | '$transaction'>;
type Stripe = Pick<StripeClientService, 'scopedClient'>;

/** The Membership a used signature bought: linked directly (a free plan) or
 * through its order. */
export async function membershipIdForSignature(db: Pick<Db, 'transaction'>, sig: { membershipId: string | null; transactionId: string | null }): Promise<string | null> {
  if (sig.membershipId) return sig.membershipId;
  if (!sig.transactionId) return null;
  const order = await db.transaction.findUnique({ where: { id: sig.transactionId }, select: { membershipId: true } });
  return order?.membershipId ?? null;
}

/** A Membership's minimum-term end with its freezes, on the jobs connection. */
export async function termEndForMembership(
  db: Pick<Db, 'membershipFreeze' | 'school'>,
  membership: { id: string; schoolId: string; startDate: Date },
  months: number,
): Promise<Date> {
  const [freezes, school] = await Promise.all([
    db.membershipFreeze.findMany({
      where: { membershipId: membership.id, status: 'APPROVED' },
      select: { status: true, startsAt: true, endsAt: true, endedEarlyAt: true },
    }),
    db.school.findUnique({ where: { id: membership.schoolId }, select: { timezone: true } }),
  ]);
  return minimumTermEndsAtWithFreezes(membership.startDate, months, freezes, school?.timezone);
}

/** A checkout that never made a Membership in this long is given up on. */
const UNUSED_ORDER_GIVE_UP_DAYS = 30;

/**
 * Decision 435 item 16: a Subscription signed with "ends after the minimum
 * term" stops on the day the term ends (freezes added, item 17) instead of
 * renewing. Run by the 15-minute membership sweep: once the term end is
 * TERM_END_LEAD_DAYS away or less, Stripe's cancel_at is set to it (no
 * proration) and Membership.cancelAt records it, exactly as a cancelled
 * Subscription is recorded (cancelledById stays null: nobody cancelled it).
 * From then on the membership reads "ends on …", the member's reminder is
 * sent, it can't be frozen (as any membership set to end), and the early-exit
 * fee is never due (it ends at the term). Stripe's customer.subscription.deleted
 * ends it on the day as for any cancelled Subscription.
 *
 * Done once per signature (termEndHandledAt), also when nothing is left to
 * stop: the membership already ended, or was cancelled earlier. The
 * membership row is locked as cancel-subscription.ts locks it, so a member
 * cancelling at the same moment and the sweep never both call Stripe.
 * One failure is logged and left for the next run.
 *
 * Not checked against a live Stripe account; e2e-tested with a stub.
 */
export async function applyDueMinimumTermEnds(db: Db, stripeClient: Stripe, logger: Pick<Logger, 'error'>, now: Date = new Date()): Promise<number> {
  const due = await db.planContractSignature.findMany({
    where: { endsAfterMinimumTerm: true, termEndHandledAt: null, usedAt: { not: null }, minimumTermMonths: { not: null } },
    select: { id: true, membershipId: true, transactionId: true, minimumTermMonths: true, signedAt: true },
  });
  let stopped = 0;
  for (const sig of due) {
    try {
      const membershipId = await membershipIdForSignature(db, sig);
      if (!membershipId) {
        if (now.getTime() - sig.signedAt.getTime() > UNUSED_ORDER_GIVE_UP_DAYS * DAY_MS) await markHandled(db, sig.id, now);
        continue;
      }
      const membership = await db.membership.findUnique({
        where: { id: membershipId },
        select: { id: true, schoolId: true, startDate: true, status: true, cancelAt: true, stripeSubscriptionId: true, billedToBalance: true },
      });
      if (!membership || membership.status !== 'ACTIVE' || membership.cancelAt || (!membership.stripeSubscriptionId && !membership.billedToBalance)) {
        await markHandled(db, sig.id, now);
        continue;
      }
      const termEnd = await termEndForMembership(db, membership, sig.minimumTermMonths!);
      if (termEnd.getTime() - now.getTime() > TERM_END_LEAD_DAYS * DAY_MS) continue;
      const done = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${membership.id} FOR UPDATE`;
        const current = await tx.membership.findUniqueOrThrow({ where: { id: membership.id }, select: { status: true, cancelAt: true } });
        if (current.status === 'ACTIVE' && !current.cancelAt && membership.billedToBalance) {
          // Decision 441 item 1: a monthly plan billed to the balance has no
          // Stripe Subscription. It ends at the term's end (its expiryDate
          // too, as a cancelled one), and its series makes no charge from
          // that day (charge-recurring follows the membership).
          const endsAt = termEnd > now ? termEnd : now;
          await tx.membership.update({ where: { id: membership.id }, data: { cancelAt: endsAt, expiryDate: endsAt } });
        } else if (current.status === 'ACTIVE' && !current.cancelAt) {
          const account = await tx.paymentAccount.findUnique({ where: { schoolId: membership.schoolId }, select: { stripeConnectedAccountId: true } });
          if (!account?.stripeConnectedAccountId) throw new Error(`School ${membership.schoolId} has no connected Stripe account`);
          // Stripe needs a cancel_at in the future: a term end already passed
          // (the sweep was down) stops it in a minute.
          const cancelAtS = Math.max(Math.floor(termEnd.getTime() / 1000), Math.floor(now.getTime() / 1000) + 60);
          await stripeClient
            .scopedClient(account.stripeConnectedAccountId)
            .subscriptions.update(
              membership.stripeSubscriptionId!,
              { cancel_at: cancelAtS, proration_behavior: 'none' },
              { idempotencyKey: `membership-minimum-term-end-${membership.id}-${cancelAtS}` },
            );
          await tx.membership.update({ where: { id: membership.id }, data: { cancelAt: new Date(cancelAtS * 1000) } });
        }
        await tx.planContractSignature.update({ where: { id: sig.id }, data: { termEndHandledAt: now } });
        return current.status === 'ACTIVE' && !current.cancelAt;
      });
      if (done) stopped += 1;
    } catch (err) {
      logger.error(`plan contract ${sig.id}: setting the Subscription to stop at the end of the minimum term failed; the next sweep tries again.`, err as Error);
    }
  }
  return stopped;
}

async function markHandled(db: Pick<Db, 'planContractSignature'>, id: string, now: Date) {
  await db.planContractSignature.update({ where: { id }, data: { termEndHandledAt: now } });
}
