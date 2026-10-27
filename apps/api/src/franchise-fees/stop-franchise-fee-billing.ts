import { Logger } from '@nestjs/common';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { FRANCHISE_FEE_FINAL_CANCEL } from './franchise-fee-cancel';

/**
 * Decision 337 (F16) — when a School, or the Franchise it belongs to, is closed,
 * each affected franchise-fee subscription is cancelled with a final invoice
 * (FRANCHISE_FEE_FINAL_CANCEL) and the School's columns cleared. Shared by the
 * Platform Admin close (TenantLifecycleService) and a Franchise Owner closing
 * their own Franchise (Decision 352).
 *
 * Runs on the jobs connection, after the close has committed, and best-effort:
 * a Stripe failure is logged loudly, never a reason to undo the close. The
 * monthly job also skips closed Schools and Franchises, so a subscription left
 * behind by a failure here is not reported further usage.
 */
export async function stopFranchiseFeeBilling(
  prismaJobs: PrismaJobsService,
  stripeClient: StripeClientService,
  logger: Logger,
  where: { schoolId: string } | { franchiseId: string },
): Promise<void> {
  const schools = await prismaJobs.school.findMany({
    where: {
      ...('schoolId' in where ? { id: where.schoolId } : { franchiseId: where.franchiseId }),
      stripeFranchiseFeeSubscriptionId: { not: null },
    },
    select: { id: true, stripeFranchiseFeeSubscriptionId: true, franchise: { select: { id: true, paymentAccount: true } } },
  });
  for (const school of schools) {
    const subscriptionId = school.stripeFranchiseFeeSubscriptionId!;
    const account = school.franchise?.paymentAccount;
    try {
      if (account?.provider === 'STRIPE' && account.stripeConnectedAccountId) {
        await stripeClient.scopedClient(account.stripeConnectedAccountId).subscriptions.cancel(subscriptionId, FRANCHISE_FEE_FINAL_CANCEL);
      }
      await prismaJobs.school.updateMany({
        where: { id: school.id, stripeFranchiseFeeSubscriptionId: subscriptionId },
        data: { stripeFranchiseFeeSubscriptionId: null, franchiseFeeSubscriptionStatus: 'CANCELED' },
      });
    } catch (err) {
      logger.error(
        `School ${school.id} was closed (or its Franchise ${school.franchise?.id} was), but cancelling its franchise-fee subscription (${subscriptionId}) failed — it may need manual cancellation.`,
        err as Error,
      );
    }
  }
}

/** Decision 352 — a closed Franchise can't accept anyone, so its open join
 * requests are cancelled when it closes. */
export async function cancelOpenJoinRequests(prismaJobs: PrismaJobsService, franchiseId: string): Promise<void> {
  await prismaJobs.franchiseJoinRequest.updateMany({
    where: { franchiseId, status: 'PENDING' },
    data: { status: 'CANCELLED', decidedAt: new Date() },
  });
}
