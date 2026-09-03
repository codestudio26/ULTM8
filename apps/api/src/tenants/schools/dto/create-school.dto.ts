import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
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
 */
export class CreateSchoolDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  activities?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  facilities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ranksToggle?: boolean;

  @ApiPropertyOptional({ description: 'One of the 4 confirmed languages — no canonical code list is confirmed anywhere yet (domain-rules §1), so this is free text, matching User.language\'s existing Phase 1 treatment.' })
  @IsOptional()
  @IsString()
  defaultLanguage?: string;

  @ApiPropertyOptional({ description: 'One of the 6 confirmed currencies — same free-text caveat as defaultLanguage.' })
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
