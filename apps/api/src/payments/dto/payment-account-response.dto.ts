import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape — see class-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type` alongside `nullable: true`). Field-for-
 * field match of the PaymentAccount Prisma model. Never includes a raw secret key —
 * there is no such field on this model to leak (Decision, existing, §4.5/§10.4).
 */
export class PaymentAccountResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  schoolId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  franchiseId!: string | null;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  accountTitle!: string;

  @ApiProperty()
  country!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  mode!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Null until Stripe Connect onboarding is initiated (POST .../connect/onboard).' })
  stripeConnectedAccountId!: string | null;

  @ApiProperty({
    description:
      'Decision 441 item 6 — Stripe has confirmed the connected account is ready: onboarding finished (details_submitted) and it can take charges (charges_enabled). Kept current by the account.updated webhook and the connect-status read.',
  })
  stripeAccountReady!: boolean;

  @ApiProperty({
    description:
      "Decision 437 — whether Stripe can onboard this School or Franchise, so the Connect Stripe button may show. A Stripe account's own country decides (an account already connected stays available); otherwise the address country.",
  })
  connectAvailable!: boolean;

  @ApiProperty({
    description:
      'Decision 442 item 2 — whether members can pay by card: a Stripe account that is connected and that Stripe says is ready (stripeAccountReady). Until then the School takes cash, bank transfer or Pix orders, as a School without cards does.',
  })
  cardPayments!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/** GET /schools/:schoolId/card-payments (Decision 448 item 9). */
export class CardPaymentsResponseDto {
  @ApiProperty({ description: 'Whether the School has set up a payment account (any provider).' })
  hasPaymentAccount!: boolean;

  @ApiProperty({
    description:
      "Decision 442 item 2 — whether members can pay by card: a Stripe account that is connected and that Stripe says is ready. The same value as the payment account's cardPayments, for people who may not read the account itself.",
  })
  cardPayments!: boolean;
}

/** Response for POST /payment-accounts/:id/connect/onboard — the Stripe Account Link
 * URL the frontend redirects the caller to. Not a PaymentAccount field itself. */
export class ConnectOnboardingResponseDto {
  @ApiProperty({ description: 'Stripe Account Link URL — single-use, short-lived per Stripe\'s own onboarding-link semantics.' })
  onboardingUrl!: string;
}

/** GET /franchises/:franchiseId/payment-account/connect-status (Decision 407)
 * and GET /schools/:schoolId/payment-account/connect-status (Decision 441
 * item 6). */
export class ConnectStatusResponseDto {
  @ApiProperty({ enum: ['CONNECTED', 'ACTION_NEEDED', 'NOT_CONNECTED'] })
  status!: 'CONNECTED' | 'ACTION_NEEDED' | 'NOT_CONNECTED';

  @ApiProperty({
    description:
      "Decision 437 — whether Stripe can onboard this Franchise or School, so the Connect Stripe button may show. Its Stripe payment account's country decides (an account already connected stays available); with none, its address country (none set: available).",
  })
  connectAvailable!: boolean;

  @ApiProperty({ type: [String], description: 'Decision 437 — the ISO 3166-1 alpha-2 countries where Stripe Connect onboarding is allowed, for the country picker.' })
  connectCountries!: string[];
}
