import { ApiProperty } from '@nestjs/swagger';

/** POST .../subscribe response — same "requires_payment, complete client-side via
 * Stripe Elements against clientSecret" shape MembershipsService.purchase()'s own
 * SUBSCRIPTION-type branch already returns, minus that method's Cash/Bank/£0
 * branches: platform SubscriptionPlan billing has no PaymentAccount concept and no
 * Cash/Bank-eligible path — ULTM8 is always the merchant of record, always via
 * Stripe, always through StripeClientService.platformClient() (never a tenant's own
 * Connected Account). No `outcome` discriminator field either, for the same reason —
 * there is only ever one outcome shape to return. */
export class SubscribeResponseDto {
  @ApiProperty()
  subscriptionId!: string;

  @ApiProperty({ description: 'Stripe PaymentIntent client secret — complete payment client-side via Stripe Elements.' })
  clientSecret!: string;
}
