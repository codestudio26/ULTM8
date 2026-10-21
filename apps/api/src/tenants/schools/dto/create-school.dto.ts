import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
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

/** Decision 279 — School.classCancellationPolicyWindow. */
export enum ClassCancellationPolicyWindowDto {
  BEFORE_CUTOFF = 'BEFORE_CUTOFF',
  ANY_TIME = 'ANY_TIME',
}

/** Decision 279 — School.schoolCancelledClassResolution. */
export enum SchoolCancelledClassResolutionDto {
  REFUND_ALL = 'REFUND_ALL',
  CREDIT_ALL = 'CREDIT_ALL',
  FOLLOW_POLICY = 'FOLLOW_POLICY',
}

/**
 * Field list verified directly against Spec 55 §6.1's School entity row (not
 * reverse-inferred from Decision 76's Branch description — see the Phase 2 summary).
 *
 * Deliberately excluded:
 *  - `franchiseId` — a self-service-created School is always independent (franchiseId
 *    null) at creation time. Linking a School to a Franchise is NOT a
 *    CreateSchoolDto/UpdateSchoolDto field even now that a mechanism exists (Phase
 *    16b-i, Decision 98) — it's a dedicated, single-purpose, auditable action,
 *    `POST /schools/:id/join-franchise` (SchoolsService.joinFranchise), narrowly
 *    one-way only (no leave/switch) — see that method's own header comment.
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

  @ApiPropertyOptional({ description: 'An ISO 4217 code from the Stripe-supported currency list (GET /settings/currencies, ~135 currencies) — same free-text caveat as defaultLanguage.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'IANA timezone name, e.g. Europe/London. Same field as Branch.timezone (Decisions 76, 172).' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

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

  // Decision 266 — the School-side half of "light theming post-login"
  // (apps/student's new SchoolThemeProvider). `joinCode` is NOT a field
  // here — it's server-generated at creation (SchoolsService.create()) and
  // never client-settable; see SchoolResponseDto's own comment on it.
  @ApiPropertyOptional({ description: '6-digit hex color, e.g. #1A73E8.' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'accentColor must be a 6-digit hex color, e.g. #1A73E8' })
  accentColor?: string;

  // Decision 257 — per-School footer content (apps/school-portal's own
  // richer footer). Every field independently optional; the footer hides its
  // own line/icon when a field is unset, rather than showing a placeholder.
  @ApiPropertyOptional({ description: 'Shown as a plain line in the footer\'s "Company" column — not a link.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  footerAboutUs?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  footerContactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  footerContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerFacebookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerInstagramUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerTiktokUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerYoutubeUrl?: string;

  @ApiPropertyOptional({ description: 'X (formerly Twitter).' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerTwitterUrl?: string;

  // No `default:` in the Swagger metadata on purpose: openapi-typescript would
  // then type this as required in packages/api-client and break existing
  // callers that don't send it.
  @ApiPropertyOptional({ enum: ClassCancellationPolicyDto, description: 'Defaults to MANUAL when omitted.' })
  @IsOptional()
  @IsEnum(ClassCancellationPolicyDto)
  classCancellationPolicy?: ClassCancellationPolicyDto;

  // No `default:` in the Swagger metadata, for the same reason as
  // classCancellationPolicy above — the default is documented in the
  // description instead.
  @ApiPropertyOptional({ description: 'Minutes; School-configurable waitlist claim window (default 120 — Decision 24).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  waitlistClaimWindowMinutes?: number;

  // Decision 279 — the rest of the owner's "Class cancellations" settings.
  // Defaults live in the schema and are documented in each description, same
  // reasoning as classCancellationPolicy above.
  @ApiPropertyOptional({ enum: ClassCancellationPolicyWindowDto, description: 'Whether the policy applies only before a class\'s refund cutoff (BEFORE_CUTOFF, the default) or to every cancellation (ANY_TIME).' })
  @IsOptional()
  @IsEnum(ClassCancellationPolicyWindowDto)
  classCancellationPolicyWindow?: ClassCancellationPolicyWindowDto;

  @ApiPropertyOptional({ description: 'Whether a class\'s late-cancellation fee is charged after its cutoff. Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  chargeLateCancellationFee?: boolean;

  @ApiPropertyOptional({ enum: SchoolCancelledClassResolutionDto, description: 'What booked students get back when the School cancels a whole class. Defaults to CREDIT_ALL.' })
  @IsOptional()
  @IsEnum(SchoolCancelledClassResolutionDto)
  schoolCancelledClassResolution?: SchoolCancelledClassResolutionDto;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Hours before start; the refund cutoff for a class that has none of its own. null = no cutoff (the default).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultRefundCutoffHours?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Minor-unit amount charged to a no-show\'s saved card. null = off (the default).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  noShowFee?: number | null;
}
