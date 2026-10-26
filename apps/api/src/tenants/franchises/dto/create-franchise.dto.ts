import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min, MaxLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { LANGUAGES } from '../../../settings/constants/languages';
import { CURRENCIES } from '../../../settings/constants/currencies';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Decision 336 (F21) — the same lists GET /settings/languages and
 * /settings/currencies serve the form's pickers from. */
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);
import { PostalAddressDto } from '../../../common/address/postal-address.dto';

/** Postgres INTEGER's own ceiling (2^31-1) — the actual backing column type for
 * Franchise.flatFeeAmount/perHeadcountRate (schema.prisma). A first draft of
 * these fields (Phase 16b-i) shipped with no upper bound at all, which code
 * review caught before those fields were reverted entirely for an unrelated
 * reason (rate-setting authority, Decision 98/99) — carried forward now that
 * they're back, so a client can never send a value the DB would reject with an
 * unhandled integer-out-of-range error instead of a clean 400. */
const POSTGRES_INTEGER_MAX = 2147483647;

/**
 * Mirrors the confirmed Franchise.feeModel enum (schema.prisma `FeeModel`) — Flat or
 * Per-Headcount, Franchise-configurable (domain-rules §2, confirmed: "a Franchise may
 * charge its own member Schools a franchise fee via Franchise.feeModel"). Defaults to
 * FLAT, matching the schema column's own `@default(FLAT)` — this DTO only needs to
 * accept an explicit override, Prisma applies the default when omitted.
 */
export enum FeeModelDto {
  FLAT = 'FLAT',
  PER_HEADCOUNT = 'PER_HEADCOUNT',
}

/**
 * Field list mirrors CreateSchoolDto's own shape and limits exactly (create-school.dto.ts's
 * header comment) — same source (ultm8-domain-rules §2/§3/§6.1, Spec 55 §6.1's Franchise
 * entity row) and the same schema.prisma model this DTO is verified field-for-field
 * against (Phase 1's Franchise model, unchanged since).
 *
 * Deliberately excluded (mirrors CreateSchoolDto's own exclusions list):
 *  - No `franchiseId`-equivalent — Franchise sits at the top of the hierarchy, nothing
 *    to link it to.
 *  - No School-only fields (`businessType`, `ranksToggle`, `classCancellationPolicy`,
 *    `waitlistClaimWindowMinutes`) — those aren't columns on the Franchise model at all,
 *    verified directly against schema.prisma before writing this, not assumed by
 *    analogy to School.
 *
 * `type` mirrors School's own free-text `businessType` field shape (short text,
 * 100-char cap) — Franchise's schema column is literally named `type`, not
 * `businessType`; kept as-is rather than renamed, so the DTO reads the same as the
 * schema it's verified against.
 *
 * Same length/format limits as CreateSchoolDto (short free-text capped at 100,
 * longer free text at 500, URLs at 2048 and validated, array fields capped at 20
 * elements) — one convention, not re-derived per model.
 */
export class CreateFranchiseDto {
  // Decision 336 (F10) — trimmed, and a name of only spaces is rejected.
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: "Franchise name can't be empty." })
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mobileNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** Decision 276 — the structured, country-aware address. When sent it takes
   * precedence over `address`, which the API then rebuilds from it; `null`
   * clears the address. See common/address/postal-address.dto.ts. */
  @ApiPropertyOptional({ type: () => PostalAddressDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PostalAddressDto)
  postalAddress?: PostalAddressDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  activities?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  facilities?: string[];

  @ApiPropertyOptional({ description: 'One of the 4 confirmed languages — free text, matching School.defaultLanguage\'s existing treatment (no canonical code list confirmed anywhere yet, domain-rules §1).' })
  @IsOptional()
  @IsString()
  @IsIn(LANGUAGE_CODES, { message: 'defaultLanguage must be one of the supported language codes.' })
  @MaxLength(100)
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'An ISO 4217 code from the Stripe-supported currency list (GET /settings/currencies, ~135 currencies) — same free-text caveat as defaultLanguage.' })
  @IsOptional()
  @IsString()
  @IsIn(CURRENCY_CODES, { message: 'defaultCurrency must be one of the supported currency codes.' })
  @MaxLength(100)
  defaultCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string;

  // No `default:` in the Swagger metadata on purpose: openapi-typescript would
  // then type this as required in packages/api-client and break existing
  // callers that don't send it.
  @ApiPropertyOptional({ enum: FeeModelDto, description: 'Defaults to FLAT when omitted.' })
  @IsOptional()
  @IsEnum(FeeModelDto)
  feeModel?: FeeModelDto;

  /**
   * Self-service — resolved directly with the product owner (Decision 99): the
   * Franchise Owner sets their own rate, same pattern MembershipPlan.price
   * already uses for School->Student pricing. Minor-unit Int (e.g. cents), same
   * convention as every other money field in this schema. Independently
   * settable regardless of which feeModel is currently active — see
   * schema.prisma's own Franchise.flatFeeAmount comment for why (a Franchise can
   * exist, and even have Schools join it, before its billing rate is
   * configured; the franchise-fee-usage-reporting job simply skips a Franchise
   * that isn't fully configured yet rather than erroring).
   */
  @ApiPropertyOptional({ description: 'Minor-unit (e.g. cents). Only meaningful when feeModel=FLAT; independently settable regardless.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  flatFeeAmount?: number;

  /** Same shape/reasoning as flatFeeAmount above, for the Per-Headcount case —
   * the per-active-student minor-unit rate charged monthly. */
  @ApiPropertyOptional({ description: 'Minor-unit (e.g. cents) per active Student per month. Only meaningful when feeModel=PER_HEADCOUNT; independently settable regardless.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  perHeadcountRate?: number;
}
