import { Logger } from '@nestjs/common';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { StripeClientService } from '../payments/stripe-client.service';

/**
 * Decision 364 — closing a School stops what it is still being charged for, and
 * what its Students are still being charged by it: every Subscription
 * Membership at the School and the School's own ULTM8 platform subscription.
 * Both end the way Spec 55 §10.2 confirms for any cancellation: Stripe's
 * cancel_at_period_end, no proration, no immediate cutoff. A Membership gets
 * the same `cancelAt` its own Cancel button writes (Decision 348); Stripe's
 * customer.subscription.deleted then expires it at the end of the paid period.
 *
 * Shared by the Platform Admin close (TenantLifecycleService) and a School
 * Owner closing their own School. Runs on the jobs connection after the close
 * has committed, and best-effort: a Stripe failure is logged loudly, never a
 * reason to undo the close (same as stopFranchiseFeeBilling).
 */
export async function stopSchoolBilling(
  prismaJobs: PrismaJobsService,
  stripeClient: StripeClientService,
  logger: Logger,
  schoolId: string,
  cancelledById: string | null,
): Promise<void> {
  const memberships = await prismaJobs.membership.findMany({
    where: { schoolId, status: 'ACTIVE', stripeSubscriptionId: { not: null }, cancelAt: null },
    select: { id: true, stripeSubscriptionId: true },
  });
  // A Subscription bought but not paid yet has no Membership (Decision 6), only
  // its Pending (or failed, still payable) Transaction. A closed School takes
  // no purchases (Decision 334 §8), so the unpaid Subscription is cancelled
  // now; Stripe voids its first invoice and payment_intent.canceled fails the
  // Transaction. A payment that still gets through is refunded by the webhook.
  // Stripe itself expires a first invoice left unpaid for 23 hours, so older
  // rows have nothing left to cancel.
  const unpaid = await prismaJobs.transaction.findMany({
    where: {
      schoolId,
      kind: 'MEMBERSHIP',
      status: { in: ['PENDING', 'FAILED'] },
      stripeSubscriptionId: { not: null },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, stripeSubscriptionId: true },
  });
  if (memberships.length > 0 || unpaid.length > 0) {
    const account = await prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { stripeConnectedAccountId: true } });
    if (!account?.stripeConnectedAccountId) {
      logger.error(`School ${schoolId} closed with ${memberships.length + unpaid.length} Subscription(s) but no connected Stripe account; cancel them in Stripe by hand.`);
    } else {
      const stripe = stripeClient.scopedClient(account.stripeConnectedAccountId);
      for (const t of unpaid) {
        try {
          await stripe.subscriptions.cancel(t.stripeSubscriptionId as string);
        } catch (err) {
          logger.error(`School ${schoolId} closed: failed to cancel unpaid Subscription ${t.stripeSubscriptionId} (Transaction ${t.id}).`, err as Error);
        }
      }
      for (const m of memberships) {
        try {
          const subscription = await stripe.subscriptions.update(m.stripeSubscriptionId as string, { cancel_at_period_end: true });
          const endsAt = subscription.cancel_at ?? subscription.items?.data[0]?.current_period_end ?? null;
          await prismaJobs.membership.update({
            where: { id: m.id },
            data: { cancelAt: endsAt ? new Date(endsAt * 1000) : new Date(), cancelledById },
          });
        } catch (err) {
          logger.error(`School ${schoolId} closed: failed to cancel Subscription ${m.stripeSubscriptionId} (Membership ${m.id}).`, err as Error);
        }
      }
    }
  }
  await stopPlatformSubscription(prismaJobs, stripeClient, logger, { schoolId });
}

/** Decision 364 — the closed School's or Franchise's own ULTM8 platform
 * subscription ends at the end of its paid period (Spec 55 §10.2). The
 * webhook flips platformSubscriptionStatus to CANCELED when Stripe ends it. */
export async function stopPlatformSubscription(
  prismaJobs: PrismaJobsService,
  stripeClient: StripeClientService,
  logger: Logger,
  where: { schoolId: string } | { franchiseId: string },
): Promise<void> {
  const row =
    'schoolId' in where
      ? await prismaJobs.school.findUnique({ where: { id: where.schoolId }, select: { stripePlatformSubscriptionId: true, platformSubscriptionStatus: true } })
      : await prismaJobs.franchise.findUnique({ where: { id: where.franchiseId }, select: { stripePlatformSubscriptionId: true, platformSubscriptionStatus: true } });
  if (!row?.stripePlatformSubscriptionId || row.platformSubscriptionStatus === 'CANCELED') return;
  try {
    await stripeClient.platformClient().subscriptions.update(row.stripePlatformSubscriptionId, { cancel_at_period_end: true });
  } catch (err) {
    logger.error(`Closed tenant ${JSON.stringify(where)}: failed to cancel platform subscription ${row.stripePlatformSubscriptionId}.`, err as Error);
  }
}
