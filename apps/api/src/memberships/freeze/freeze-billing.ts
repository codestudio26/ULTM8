import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { StripeClientService } from '../../payments/stripe-client.service';
import { backDay, dayIn, dayNumber, dayStart } from './membership-freeze';

/**
 * Decision 404: a card Subscription is paused for the freeze, so nothing is
 * charged while frozen, and billing restarts when it ends, so the member never
 * pays for frozen days.
 *
 * How: the Subscription's next charge moves later by the freeze's length.
 * Stripe's trial_end is set to the end of the period already paid for plus
 * the frozen days, with proration_behavior 'none': no invoice is made until
 * then and no credit or charge for the switch, so the member keeps the paid
 * days they hadn't used and is next charged once those run out after the
 * freeze. Ending early moves trial_end back by the days not frozen (never
 * earlier than a minute from now); ended before it started, that is all of
 * them, so trial_end goes back to the paid period's end.
 *
 * When (Decision 409): as soon as the freeze is approved, when no renewal
 * falls before its first day (the period already paid for runs to the
 * freeze's start or later). Moving trial_end early changes nothing for the
 * member before the freeze: our own Membership, not Stripe's status, decides
 * access. Otherwise a renewal is due first, so the shift waits for it: the
 * invoice.paid webhook of that renewal applies it
 * (StripeWebhookProcessingProcessor), and the 15-minute sweep applies it on
 * the start day at the latest. Before Decision 409 the shift waited for the
 * start day, so a renewal on the first frozen day could be charged.
 *
 * Stripe may raise a £0 invoice for the switch; the renewal ledger skips
 * £0 invoices (recordMembershipRenewal).
 *
 * Each value sent is worked out once and saved on the freeze before Stripe is
 * called (shiftedTrialEnd, restoredTrialEnd). Setting trial_end to a fixed
 * time is harmless to repeat, so a retry, a second job run, or a request and
 * the job together never shift twice; the Stripe idempotency key carries the
 * value too. billingShiftAppliedAt / billingRestoredAt say Stripe took it.
 *
 * A membership paid in cash or by bank (no stripeSubscriptionId) has nothing to
 * shift. Runs on the jobs connection: the request paths call it after their
 * own checks, and so do the renewal webhook and the 15-minute membership
 * sweep.
 *
 * Not checked against a live Stripe account; unit- and e2e-tested with stubs.
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
 * Moves the Subscription's next charge later by the freeze's length. Returns
 * whether Stripe was updated now. Before the freeze starts, only when the
 * period already paid for runs to the freeze's first day or later (no renewal
 * falls before it); from the first day on, always. Nothing happens for a
 * freeze already shifted, ended early (before it started, or before the
 * shift ever ran), over, or on a membership without a card Subscription.
 */
export async function applyFreezeBillingShift(db: Db, stripeClient: Stripe, freezeId: string, now: Date = new Date()): Promise<boolean> {
  const freeze = await freezeWithSubscription(db, freezeId);
  const subscriptionId = freeze?.membership.stripeSubscriptionId;
  if (!freeze || !subscriptionId || freeze.status !== 'APPROVED' || freeze.billingShiftAppliedAt || freeze.endedEarlyAt) return false;
  const zone = freeze.school.timezone;
  const today = dayNumber(dayIn(now, zone));
  if (backDay(freeze, zone) <= today) return false;
  const started = dayNumber(freeze.startsAt) <= today;
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
    // A renewal falls before the freeze's first day: wait for it (the
    // renewal's invoice.paid, or the sweep on the start day).
    if (!started && until < Math.floor(dayStart(dayNumber(freeze.startsAt), zone).getTime() / 1000)) return false;
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
 * by the frozen days not used, never earlier than a minute from now. Ended
 * before it started (the shift may have gone to Stripe at approval, Decision
 * 409), every day is unused, so the charge goes back to the paid period's
 * end it had before the shift. Nothing to do when the shift never reached
 * Stripe (a renewal was still due first, or a cash membership). A request
 * declined or withdrawn was never approved, so it was never shifted.
 *
 * The days are taken off the Subscription's next charge as Stripe has it
 * now, not off this freeze's own shiftedTrialEnd: since shifts can go to
 * Stripe at approval, a second freeze on the same membership, approved
 * later for earlier dates, may have been added on top of this one, and
 * starting from shiftedTrialEnd would drop its days. With one freeze the
 * two are the same. Worked out once and saved (restoredTrialEnd) before
 * Stripe is called, so a retry never takes the days off twice.
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
  if (!target) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const until = paidUntil(subscription, Math.floor(now.getTime() / 1000));
    if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired' || until === null) {
      // Nothing left to bill: record it so the sweep stops trying.
      await db.membershipFreeze.updateMany({ where: { id: freeze.id, billingRestoredAt: null }, data: { billingRestoredAt: now } });
      return false;
    }
    const unused = dayNumber(freeze.endsAt) - backDay(freeze, freeze.school.timezone);
    // Saved once: a second caller reads this value instead of working out a new one.
    await db.membershipFreeze.updateMany({
      where: { id: freeze.id, restoredTrialEnd: null },
      data: { restoredTrialEnd: new Date((until - unused * DAY_S) * 1000) },
    });
    target = (await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id }, select: { restoredTrialEnd: true } })).restoredTrialEnd!;
  }
  const trialEnd = Math.floor(Math.max(target.getTime(), now.getTime() + 60_000) / 1000);
  await stripe.subscriptions.update(
    subscriptionId,
    { trial_end: trialEnd, proration_behavior: 'none' },
    { idempotencyKey: `membership-freeze-restore-${freeze.id}-${trialEnd}` },
  );
  await db.membershipFreeze.updateMany({ where: { id: freeze.id, billingRestoredAt: null }, data: { billingRestoredAt: now } });
  return true;
}

/**
 * Decision 409: a Membership Subscription's renewal was just paid
 * (StripeWebhookProcessingProcessor, invoice.paid). Shifts the approved
 * freezes on it that were waiting for that renewal; one that still has a
 * renewal before its start keeps waiting. Returns how many were shifted. A
 * failure is logged and left for the next renewal or the sweep.
 */
export async function applyFreezeBillingAfterRenewal(
  db: Db,
  stripeClient: Stripe,
  logger: Pick<Logger, 'error'>,
  membershipId: string,
  now: Date = new Date(),
): Promise<number> {
  const waiting = await db.membershipFreeze.findMany({
    where: { membershipId, status: 'APPROVED', billingShiftAppliedAt: null, endedEarlyAt: null, endsAt: { gt: new Date(now.getTime() - DAY_S * 1000) } },
    select: { id: true },
    orderBy: { startsAt: 'asc' },
  });
  let applied = 0;
  for (const f of waiting) {
    try {
      if (await applyFreezeBillingShift(db, stripeClient, f.id, now)) applied += 1;
    } catch (err) {
      logger.error(`membership freeze ${f.id}: moving the Subscription's next charge after its renewal failed; the sweep tries again.`, err as Error);
    }
  }
  return applied;
}

/**
 * The sweep's part (MembershipExpirySweepProcessor, every 15 minutes), the
 * backup to the approval and the renewal webhook: shifts the Subscriptions of
 * approved freezes not shifted yet that start within a day, and retries an
 * early end whose Stripe call failed. One failure is logged and left for
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
