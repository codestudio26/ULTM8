import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, IsEnum, MaxLength } from 'class-validator';
import { CreateFranchiseDto } from './create-franchise.dto';

const NULLABLE_ON_UPDATE = ['mobileNumber', 'address', 'type', 'defaultLanguage', 'defaultCurrency', 'description', 'logoUrl', 'bannerUrl'] as const;

/**
 * Decision 99's own follow-up, resolved directly with the product owner: a real
 * rate-migration mechanism, replacing FranchisesService.update()'s former outright
 * rejection once franchise-fee billing has started for at least one School. Mirrors
 * `MembershipPlanPriceChangeStrategyDto`'s identical "two named strategies, required
 * only when a real decision is needed" shape (update-membership-plan.dto.ts) — the
 * caller picks which Stripe-mechanics tradeoff applies.
 *
 * MIGRATE_NEXT_CYCLE: the new rate takes effect starting each affected School's own
 * next billing period; the already-committed current period keeps billing at the
 * OLD rate. MIGRATE_IMMEDIATE: the new rate takes effect right now — for FLAT this
 * means a real prorated invoice for the remaining days of the current period
 * (`proration_behavior: 'always_invoice'`); for PER_HEADCOUNT it re-rates the ENTIRE
 * current period's already-accrued usage, not just the days remaining, since Stripe
 * always bills a metered item's whole period at whichever Price is attached when the
 * invoice generates — a genuine Stripe constraint, not a choice. See
 * franchise-fee-rate-migration.processor.ts's own header comment for the full
 * Stripe-mechanics account (verified directly against the installed SDK before
 * building, not assumed).
 */
export enum FranchiseFeeRateChangeStrategyDto {
  MIGRATE_NEXT_CYCLE = 'MIGRATE_NEXT_CYCLE',
  MIGRATE_IMMEDIATE = 'MIGRATE_IMMEDIATE',
}

/**
 * FOUND PROACTIVELY (Phase 23, mirroring the identical fix already applied to
 * UpdateSchoolDto/UpdateBranchDto — see UpdateSchoolDto's own header comment
 * for the full reasoning): FranchisesService.update() already forwards every
 * one of these fields straight through as `data.<field>` with no ternary
 * (franchises.service.ts), and they're all nullable `String?` columns on the
 * Franchise model (schema.prisma), so an explicit `null` already clears the
 * column and `undefined` already leaves it unchanged at the Prisma layer.
 * This DTO's type just hadn't caught up — a bare `PartialType(CreateFranchiseDto)`
 * before this fix, same shape the bug had in every other Update DTO this
 * pattern was found in.
 *
 * No live frontend consumer existed for this yet (Franchise had no
 * school-portal UI at all before this phase), so unlike the School/Branch
 * instance of this bug, this one was caught before it ever shipped broken —
 * closed here as part of building that UI for the first time, not as a
 * separate fix.
 *
 * Deliberately NOT widened: `name` (required), `activities`/`facilities`
 * (arrays — same reasoning as CreateFranchiseDto's own array fields, a client
 * sends a real, possibly-empty array, never undefined-as-clear), `feeModel`
 * (enum, no "clear" concept), and `flatFeeAmount`/`perHeadcountRate`
 * (deliberately out of scope — clearing a configured fee rate back to
 * "unconfigured" interacts with FranchisesService.update()'s own
 * schoolsAlreadyBilling/Stripe-Price-immutability guard, which has no
 * confirmed design for that case).
 *
 * CORRECTED ON REVIEW: a first draft of this comment claimed "there is
 * nothing forcing that decision here" because the school-portal form never
 * sends an explicit `null` for these two fields — but `@IsOptional()` treats
 * an explicit `null` exactly like an omitted field and skips
 * `@IsInt()`/`@Min()`/`@Max()` entirely, so nothing at THIS layer actually
 * stopped a raw HTTP client from sending `null` and silently clearing a
 * configured rate. FranchisesService.update() now explicitly rejects an
 * explicit `null` on either field with a BadRequestException — see that
 * method's own comment — closing the gap this DTO's typing alone could not.
 *
 * UPDATED (Decision 99's own follow-up, resolved): "no confirmed design for
 * that case" above refers only to CLEARING a configured rate back to null —
 * unchanged, still out of scope. CHANGING an already-configured rate once
 * billing has started is now resolved: `feeRateChangeStrategy` below.
 */
export class UpdateFranchiseDto extends PartialType(OmitType(CreateFranchiseDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mobileNumber?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string | null;

  @ApiPropertyOptional({ description: 'One of the 4 confirmed languages — free text, matching School.defaultLanguage\'s existing treatment (no canonical code list confirmed anywhere yet, domain-rules §1).', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultLanguage?: string | null;

  @ApiPropertyOptional({ description: 'An ISO 4217 code from the Stripe-supported currency list (GET /settings/currencies, ~135 currencies) — same free-text caveat as defaultLanguage.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultCurrency?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  logoUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string | null;

  @ApiPropertyOptional({
    enum: FranchiseFeeRateChangeStrategyDto,
    description:
      'Required only when flatFeeAmount/perHeadcountRate is being changed AND at least one School under this Franchise already has a standing franchise-fee Stripe Subscription — omit otherwise (FranchisesService.update() 400s if it\'s missing when needed, or sent when not).',
  })
  @IsOptional()
  @IsEnum(FranchiseFeeRateChangeStrategyDto)
  feeRateChangeStrategy?: FranchiseFeeRateChangeStrategyDto;
}
