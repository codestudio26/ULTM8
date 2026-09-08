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

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/** Response for POST /payment-accounts/:id/connect/onboard — the Stripe Account Link
 * URL the frontend redirects the caller to. Not a PaymentAccount field itself. */
export class ConnectOnboardingResponseDto {
  @ApiProperty({ description: 'Stripe Account Link URL — single-use, short-lived per Stripe\'s own onboarding-link semantics.' })
  onboardingUrl!: string;
}
