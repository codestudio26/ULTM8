import { BadRequestException } from '@nestjs/common';
import { Membership, Prisma } from '@prisma/client';
import type { StripeClientService } from '../payments/stripe-client.service';

/**
 * Cancel a Subscription Membership at the end of its paid period (Spec 55
 * §10.2: Stripe's cancel_at_period_end, no proration, no immediate cutoff) and
 * record when it ends and who asked. The Membership stays live until then;
 * Stripe's customer.subscription.deleted later expires it and cancels the
 * Bookings it funded. Asking twice changes nothing. Decision 348.
 *
 * A plain function, not a service method, so both MembershipsService (the
 * Student, a Guardian or the owner cancelling) and RoleGrantsService (Students
 * S2: removing a Student) can call it. TenantsModule can't import
 * MembershipsModule without a cycle; it registers its own StripeClientService.
 *
 * The caller checks who may cancel and passes a `tx` under a context that can
 * read the School's PaymentAccount and update this Membership (the Student
 * themselves or the School's owner).
 */
export async function cancelSubscriptionAtPeriodEnd(
  stripeClient: Pick<StripeClientService, 'scopedClient'>,
  tx: Prisma.TransactionClient,
  membership: Pick<Membership, 'id' | 'schoolId' | 'status' | 'stripeSubscriptionId' | 'cancelAt'>,
  cancelledById: string,
): Promise<Membership> {
  if (!membership.stripeSubscriptionId) {
    throw new BadRequestException('Only a Subscription can be cancelled. Other plans end on their own.');
  }
  if (membership.status !== 'ACTIVE') {
    throw new BadRequestException('This Subscription has already ended.');
  }
  if (membership.cancelAt) {
    return tx.membership.findUniqueOrThrow({ where: { id: membership.id } });
  }
  const account = await tx.paymentAccount.findUnique({ where: { schoolId: membership.schoolId }, select: { stripeConnectedAccountId: true } });
  if (!account?.stripeConnectedAccountId) {
    throw new BadRequestException('This School has no connected Stripe account, so the Subscription can\'t be cancelled here.');
  }
  const stripe = stripeClient.scopedClient(account.stripeConnectedAccountId);
  const subscription = await stripe.subscriptions.update(membership.stripeSubscriptionId, { cancel_at_period_end: true });
  const endsAt = subscription.cancel_at ?? subscription.items?.data[0]?.current_period_end ?? null;
  return tx.membership.update({
    where: { id: membership.id },
    // Stripe always returns cancel_at once cancel_at_period_end is set; "now"
    // only guards a malformed reply so the row still reads cancelled.
    data: { cancelAt: endsAt ? new Date(endsAt * 1000) : new Date(), cancelledById },
  });
}
