import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { StripeClientService } from '../../payments/stripe-client.service';
import { backDay, dayIn, dayNumber } from './membership-freeze';

/**
 * Decision 404: a card Subscription is paused for the freeze, so nothing is
 * charged while frozen, and billing restarts when it ends, so the member never
 * pays for frozen days.
 *
 * How: once the freeze has started, the Subscription's next charge moves later
 * by the freeze's length. Stripe's trial_end is set to the end of the period
 * already paid for plus the frozen days, with proration_behavior 'none': no
 * invoice is made until then and no credit or charge for the switch, so the
 * member keeps the paid days they hadn't used and is next charged once those
 * run out after the freeze. Ending early moves trial_end back by the days not
 * frozen (never earlier than a minute from now).
 *
 * Each value sent is worked out once and saved on the freeze before Stripe is
 * called (shiftedTrialEnd, restoredTrialEnd). Setting trial_end to a fixed
 * time is harmless to repeat, so a retry, a second job run, or a request and
 * the job together never shift twice; the Stripe idempotency key carries the
 * value too. billingShiftAppliedAt / billingRestoredAt say Stripe took it.
 *
 * A membership paid in cash or by bank (no stripeSubscriptionId) has nothing to
 * shift. Runs on the jobs connection: the request paths call it after their
 * own checks, and so does the 15-minute membership sweep for freezes that
 * start on a later day.
 */

type Db = Pick<PrismaClient, 'membershipFreeze' | 'paymentAccount' | 'school'>;
type Stripe = Pick<StripeClientService, 'scopedClient'>;

const DAY_S = 24 * 60 * 60;

/** The time the paid period ends: the trial's end when one is running (a
 * freeze already moved it), else the first item's current_period_end. */
function paidUntil(subscription: { trial_end: number | null; items?: { data: Array<{ current_period_end?: number }> } }, nowS: number): number | null {
  const periodEnd = subscription.items?.data[0]?.current_period_end ?? null;
  const trialEnd = subscription.trial_end && subscription.trial_end > nowS ? subscription.trial_end : null;
  if (periodEnd === null) return trialEnd;
  return trialEnd !== null && trialEnd > periodEnd ? trialEnd : periodEnd;
}

async function freezeWithSubscription(db: Db, freezeId: string) {
  return db.membershipFreeze.findUnique({
    where: { id: freezeId },
    include: { membership: { select: { stripeSubscriptionId: true, status: true } }, school: { select: { timezone: true } } },
  });
}

async function connectedAccount(db: Db, schoolId: string): Promise<string | null> {
  const account = await db.paymentAccount.findUnique({ where: { schoolId }, select: { stripeConnectedAccountId: true, provider: true } });
  return account?.provider === 'STRIPE' ? account.stripeConnectedAccountId : null;
}

/**
 * Moves the Subscription's next charge later by the freeze's length, once the
 * freeze has started. Returns whether Stripe was updated now. Nothing happens
 * for a freeze not started, already shifted, ended before it started, or on a
 * membership without a card Subscription.
 */
export async function applyFreezeBillingShift(db: Db, stripeClient: Stripe, freezeId: string, now: Date = new Date()): Promise<boolean> {
  const freeze = await freezeWithSubscription(db, freezeId);
  const subscriptionId = freeze?.membership.stripeSubscriptionId;
  if (!freeze || !subscriptionId || freeze.status !== 'APPROVED' || freeze.billingShiftAppliedAt) return false;
  const today = dayNumber(dayIn(now, freeze.school.timezone));
  if (dayNumber(freeze.startsAt) > today || backDay(freeze, freeze.school.timezone) <= today) return false;
  const accountId = await connectedAccount(db, freeze.schoolId);
  if (!accountId) return false;
  const stripe = stripeClient.scopedClient(accountId);

  let target = freeze.shiftedTrialEnd;
  if (!target) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const nowS = Math.floor(now.getTime() / 1000);
    const until = paidUntil(subscription, nowS);
    if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired' || until === null) {
      // Nothing left to bill: record it so the sweep stops trying.
      await db.membershipFreeze.updateMany({ where: { id: freeze.id, billingShiftAppliedAt: null }, data: { billingShiftAppliedAt: now } });
      return false;
    }
    const days = dayNumber(freeze.endsAt) - dayNumber(freeze.startsAt);
    // Saved once: a second caller reads this value instead of working out a new one.
    await db.membershipFreeze.updateMany({
      where: { id: freeze.id, shiftedTrialEnd: null },
      data: { shiftedTrialEnd: new Date((until + days * DAY_S) * 1000) },
    });
    target = (await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id }, select: { shiftedTrialEnd: true } })).shiftedTrialEnd!;
  }
  const trialEnd = Math.floor(target.getTime() / 1000);
  await stripe.subscriptions.update(
    subscriptionId,
    { trial_end: trialEnd, proration_behavior: 'none' },
    { idempotencyKey: `membership-freeze-shift-${freeze.id}-${trialEnd}` },
  );
  await db.membershipFreeze.updateMany({ where: { id: freeze.id, billingShiftAppliedAt: null }, data: { billingShiftAppliedAt: now } });
  return true;
}

/**
 * A freeze ended early: billing restarts that day. Moves the next charge back
 * by the frozen days not used. Nothing to do when the shift never reached
 * Stripe (the freeze hadn't started, or a cash membership).
 */
export async function restoreFreezeBilling(db: Db, stripeClient: Stripe, freezeId: string, now: Date = new Date()): Promise<boolean> {
  const freeze = await freezeWithSubscription(db, freezeId);
  const subscriptionId = freeze?.membership.stripeSubscriptionId;
  if (!freeze || !subscriptionId || !freeze.endedEarlyAt || !freeze.billingShiftAppliedAt || !freeze.shiftedTrialEnd || freeze.billingRestoredAt) {
    return false;
  }
  const accountId = await connectedAccount(db, freeze.schoolId);
  if (!accountId) return false;
  const stripe = stripeClient.scopedClient(accountId);

  let target = freeze.restoredTrialEnd;
  const soonest = now.getTime() + 60_000;
  if (!target || target.getTime() < soonest) {
    const unused = dayNumber(freeze.endsAt) - backDay(freeze, freeze.school.timezone);
    const moved = freeze.shiftedTrialEnd.getTime() - unused * DAY_S * 1000;
    target = new Date(Math.max(moved, soonest));
    await db.membershipFreeze.update({ where: { id: freeze.id }, data: { restoredTrialEnd: target } });
  }
  const trialEnd = Math.floor(target.getTime() / 1000);
  await stripe.subscriptions.update(
    subscriptionId,
    { trial_end: trialEnd, proration_behavior: 'none' },
    { idempotencyKey: `membership-freeze-restore-${freeze.id}-${trialEnd}` },
  );
  await db.membershipFreeze.updateMany({ where: { id: freeze.id, billingRestoredAt: null }, data: { billingRestoredAt: now } });
  return true;
}

/**
 * The sweep's part (MembershipExpirySweepProcessor, every 15 minutes): shifts
 * the Subscriptions of approved freezes that have started since, and retries
 * an early end whose Stripe call failed. One failure is logged and left for
 * the next run; it never stops the others.
 */
export async function applyDueFreezeBilling(db: Db, stripeClient: Stripe, logger: Logger, now: Date = new Date()): Promise<number> {
  // A day ahead of UTC covers every time zone; applyFreezeBillingShift checks the School's own day.
  const horizon = new Date(now.getTime() + DAY_S * 1000);
  const due = await db.membershipFreeze.findMany({
    where: {
      status: 'APPROVED',
      OR: [
        { billingShiftAppliedAt: null, endedEarlyAt: null, startsAt: { lte: horizon }, endsAt: { gt: new Date(now.getTime() - DAY_S * 1000) } },
        { billingShiftAppliedAt: { not: null }, endedEarlyAt: { not: null }, billingRestoredAt: null },
      ],
      membership: { stripeSubscriptionId: { not: null } },
    },
    select: { id: true, endedEarlyAt: true },
  });
  let applied = 0;
  for (const f of due) {
    try {
      const done = f.endedEarlyAt ? await restoreFreezeBilling(db, stripeClient, f.id, now) : await applyFreezeBillingShift(db, stripeClient, f.id, now);
      if (done) applied += 1;
    } catch (err) {
      logger.error(`membership freeze ${f.id}: moving the Subscription's next charge failed; the next sweep tries again.`, err as Error);
    }
  }
  return applied;
}
