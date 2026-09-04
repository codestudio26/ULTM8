import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Mirrors the confirmed School.classCancellationPolicy enum (schema.prisma /
 * migration.sql `ClassCancellationPolicy`) — Manual (default) / Auto-Refund /
 * Auto-Credit, School-configurable (domain-rules §7, confirmed 25 Aug 2026).
 */
export enum ClassCancellationPolicyDto {
  MANUAL = 'MANUAL',
  AUTO_REFUND = 'AUTO_REFUND',
  AUTO_CREDIT = 'AUTO_CREDIT',
}

/**
 * Field list verified directly against Spec 55 §6.1's School entity row (not
 * reverse-inferred from Decision 76's Branch description — see the Phase 2 summary).
 *
 * Deliberately excluded:
 *  - `franchiseId` — a self-service-created School is always independent (franchiseId
 *    null) in this phase. Linking a School to a Franchise has no confirmed mechanism
 *    or authorization rule of its own, and Franchise CRUD is explicitly out of scope
 *    this phase — flagged, not built.
 *  - `franchiseFeeSubscriptionStatus` — system-synced from the Franchise-fee Stripe
 *    Subscription via webhook (Spec §6.1), never client-settable; only ever appears in
 *    read responses, and only meaningful once a School has a Franchise (see above).
 *
 * Length/format limits (added in a later hardening pass, not part of the original
 * field-list confirmation above): short free-text fields capped at 100 chars, longer
 * free text (address/description) at 500, URLs capped at 2048 chars and validated as
 * actual URLs, and activities/facilities capped at 20 elements each — an unbounded
 * array of short strings isn't covered by a per-element length limit alone. UpdateSchoolDto
 * (PartialType(CreateSchoolDto)) inherits all of these automatically, so the two can't
 * drift apart.
 */
export class CreateSchoolDto {
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
  businessType?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ranksToggle?: boolean;

  @ApiPropertyOptional({ description: 'One of the 4 confirmed languages — no canonical code list is confirmed anywhere yet (domain-rules §1), so this is free text, matching User.language\'s existing Phase 1 treatment.' })
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

  @ApiPropertyOptional({ enum: ClassCancellationPolicyDto, default: ClassCancellationPolicyDto.MANUAL })
  @IsOptional()
  @IsEnum(ClassCancellationPolicyDto)
  classCancellationPolicy?: ClassCancellationPolicyDto;

  @ApiPropertyOptional({ default: 120, description: 'Minutes; School-configurable waitlist claim window (default 120 — Decision 24).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  waitlistClaimWindowMinutes?: number;
}
