import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

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
  @ApiProperty()
  @IsString()
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
  @MaxLength(100)
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'One of the 6 confirmed currencies — same free-text caveat as defaultLanguage.' })
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ enum: FeeModelDto, default: FeeModelDto.FLAT })
  @IsOptional()
  @IsEnum(FeeModelDto)
  feeModel?: FeeModelDto;

  // No flatFeeAmount/perHeadcountRate field — deliberately deferred, not omitted by
  // oversight. See schema.prisma's own Franchise model comment for the full account
  // (Decision 98's "Franchise fee-rate fields" section): a first draft added these
  // here, code review flagged that the actual rate-setting authority is real,
  // undecided business logic, not a routine gap-fill, and it was reverted pending
  // the user's own input at Phase 16b-ii's kickoff.
}
