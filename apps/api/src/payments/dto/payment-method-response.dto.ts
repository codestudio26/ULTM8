import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** POST .../payment-methods/setup-session response — a hosted Stripe Checkout
 * URL (mode: 'setup'), not a clientSecret — see PaymentsService.createSetupSession's
 * own header comment for why this is hosted rather than an embedded SDK. */
export class SetupSessionResponseDto {
  @ApiProperty()
  checkoutUrl!: string;
}

/** GET .../payment-methods/me response. brand/last4 are fetched live from Stripe,
 * never persisted locally — undefined whenever hasSavedPaymentMethod is false, or
 * whenever the saved payment method isn't a card. */
export class PaymentMethodResponseDto {
  @ApiProperty()
  hasSavedPaymentMethod!: boolean;

  @ApiPropertyOptional()
  brand?: string;

  @ApiPropertyOptional()
  last4?: string;
}
