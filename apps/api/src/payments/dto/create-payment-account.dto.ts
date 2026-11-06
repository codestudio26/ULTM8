import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';

export enum PaymentAccountProviderDto {
  STRIPE = 'STRIPE',
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

/**
 * Field list verified directly against Spec 55 §6.1's confirmed PaymentAccount row
 * (quoted, not paraphrased): "Provider (Stripe/Cash/Bank Transfer...), account title,
 * country, status (Active/De-active), mode (Live/Test), Stripe Connected Account id."
 *
 * `schoolId`/`franchiseId` are route params (`/schools/:schoolId/payment-accounts` /
 * `/franchises/:franchiseId/payment-accounts`), not body fields — same convention as
 * every other tenant-scoped Create DTO in this codebase.
 *
 * Deliberately NOT client-settable at creation, each flagged rather than silently
 * assumed:
 *  - `status` — always starts ACTIVE. Nothing confirms a caller should be able to
 *    create a pre-deactivated account.
 *  - `mode` — always starts TEST. Flipping an account to LIVE is a meaningfully
 *    higher-stakes action than creating the row (real money starts moving through
 *    it) and isn't something Spec 55 describes a confirmed mechanism for — left
 *    unbuilt entirely this phase rather than exposed as an unguarded client-settable
 *    field on create. Flagged for Architect review.
 *  - `stripeConnectedAccountId` — never client-settable, ever. Only
 *    PaymentsService.initiateConnectOnboarding() sets it, from Stripe's own
 *    accounts.create() response. Whether onboarding has completed is
 *    `stripeAccountReady` (Decision 441 item 6), set from Stripe's account by
 *    the `account.updated` webhook and the connect-status reads.
 *
 * Length limits follow the same convention CreateSchoolDto already established: short
 * free text capped at 100 chars.
 */
export class CreatePaymentAccountDto {
  @ApiProperty({ enum: PaymentAccountProviderDto })
  @IsEnum(PaymentAccountProviderDto)
  provider!: PaymentAccountProviderDto;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  accountTitle!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 country code — not validated against the actual list this phase, flagged for Architect review same as other inferred format choices.' })
  @IsString()
  @MaxLength(100)
  country!: string;
}
