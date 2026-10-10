import { ApiProperty } from '@nestjs/swagger';

/** POST .../subscription/cancel response — Spec 55 §10.2's confirmed
 * `cancel_at_period_end` behavior (no proration, no immediate cutoff): the
 * subscription stays Active in Stripe (and in this platform's own
 * `platformSubscriptionStatus`, unchanged here — only flipped to CANCELED later by
 * stripe-webhook-processing's `customer.subscription.deleted` handler once Stripe
 * actually ends the period) through `cancelsAt`. */
export class CancelSubscriptionResponseDto {
  @ApiProperty({ description: 'ISO timestamp of when the current paid period ends and access actually degrades.' })
  cancelsAt!: string;
}
