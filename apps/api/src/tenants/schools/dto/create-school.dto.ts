import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PostalAddressDto } from '../../../common/address/postal-address.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** School Settings review (S5, S10) — a footer social link must be a full web
 * address. Without `require_protocol` "instagram.com/x" passed, and the footer
 * then linked to a page inside the portal. One plain message for every link. */
export const FOOTER_URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };
export const FOOTER_URL_MESSAGE = 'Social links must be full web addresses starting with https://.';
export const FOOTER_EMAIL_MESSAGE = 'Enter a valid contact email address.';

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

/** Decision 291 — School.classCancellationPolicyWindow. */
export enum ClassCancellationPolicyWindowDto {
  BEFORE_CUTOFF = 'BEFORE_CUTOFF',
  ANY_TIME = 'ANY_TIME',
}

/** Decision 291 — School.schoolCancelledClassResolution. */
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
  // School Settings review (S9) — trimmed, and a name of only spaces is rejected.
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: "School name can't be empty." })
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
  @IsEmail({}, { message: FOOTER_EMAIL_MESSAGE })
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
  @IsUrl(FOOTER_URL_OPTIONS, { message: FOOTER_URL_MESSAGE })
  footerFacebookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(FOOTER_URL_OPTIONS, { message: FOOTER_URL_MESSAGE })
  footerInstagramUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(FOOTER_URL_OPTIONS, { message: FOOTER_URL_MESSAGE })
  footerTiktokUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(FOOTER_URL_OPTIONS, { message: FOOTER_URL_MESSAGE })
  footerYoutubeUrl?: string;

  @ApiPropertyOptional({ description: 'X (formerly Twitter).' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(FOOTER_URL_OPTIONS, { message: FOOTER_URL_MESSAGE })
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
  @ApiPropertyOptional({ description: 'Minutes; School-configurable waitlist claim window (default 60 — Decision 24, lowered from 120 by Decision 279).' })
  @IsOptional()
  // School Settings review (S8) — a plain message instead of the field name.
  @IsInt({ message: 'The waitlist claim window must be a whole number of minutes, at least 1.' })
  @Min(1, { message: 'The waitlist claim window must be a whole number of minutes, at least 1.' })
  waitlistClaimWindowMinutes?: number;

  // Decision 291 — the rest of the owner's "Class cancellations" settings.
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

  @ApiPropertyOptional({ description: 'Minutes before a Class starts that check-in opens (default 30). Check-in closes at the Class\'s check-in end time, or its end.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  checkInOpensMinutesBeforeStart?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Decision 391: days a Visitor\'s visit pass lasts. No default; null turns visit passes off.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  visitorPeriodDays?: number | null;

  @ApiPropertyOptional({ description: 'Decision 404: the most days a membership can be frozen in any 12 months (1-365, default 90).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  freezeMaxDaysPer12Months?: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Decision 404: a one-off fee for freezing a membership, in minor units of the School's currency, charged when a freeze is approved. null = no fee (the default)." })
  @IsOptional()
  @IsInt()
  @Min(1)
  freezeFeeAmount?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'GB', description: "Decision 411: the country the School is in, for its tax (ISO 3166-1 alpha-2). Picking it pre-fills the rate from GET /tax-rates; the School can change the rate. null clears it." })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^[A-Z]{2}$/, { message: 'taxCountry must be a two-letter country code.' })
  taxCountry?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, description: "Decision 411: the School's one tax rate on charges, in hundredths of a percent (2000 = 20%; 0 = no tax). Each charge keeps the rate it was created with." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  taxRateBasisPoints?: number;

  @ApiPropertyOptional({ description: "Decision 411: true = the School's prices include tax; false = tax is added on top." })
  @IsOptional()
  @IsBoolean()
  taxInclusive?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: "Decision 338 item 6: the School's tax ID, shown on its invoices and receipts. Empty or null clears it." })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(50)
  taxId?: string | null;

  @ApiPropertyOptional({ description: 'Decision 338 item 1: staff must type a reason when cancelling a charge (default on).' })
  @IsOptional()
  @IsBoolean()
  chargeCancelReasonRequired?: boolean;

  @ApiPropertyOptional({ description: 'Decision 338 item 3: the owner must type notes when refunding a payment toward charges (default on). Notes are for staff only.' })
  @IsOptional()
  @IsBoolean()
  chargeRefundNotesRequired?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300, description: "Decision 338 item 6: the School's address on its invoices and receipts in the app. Empty or null clears it." })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(300)
  receiptAddress?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000, description: 'Decision 338 item 6: how to pay (bank details, Pix key…), on its invoices in the app. Empty or null clears it.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  receiptPaymentInstructions?: string | null;

  @ApiPropertyOptional({ description: 'Decision 338 item 10: send the member a receipt for each payment toward charges (default on).' })
  @IsOptional()
  @IsBoolean()
  chargeNoticeReceipt?: boolean;

  @ApiPropertyOptional({ description: 'Decision 338 item 10: tell the member when an automatic payment fails or a charge becomes overdue (default on).' })
  @IsOptional()
  @IsBoolean()
  chargeNoticeFailedOverdue?: boolean;

  @ApiPropertyOptional({ description: 'Decision 338 item 10: tell the member about a dispute on their card payment toward charges (default on).' })
  @IsOptional()
  @IsBoolean()
  chargeNoticeDispute?: boolean;

  @ApiPropertyOptional({ description: 'Decision 338 item 10: remind the member 3 days before a charge is due (default on).' })
  @IsOptional()
  @IsBoolean()
  chargeNoticeDueReminder?: boolean;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description: 'Decision 392 (Decision 315 item 6): the "How did you hear about us?" choices, in order (1 to 30, each up to 60 characters, no repeats). null goes back to the starting list.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique((v: string) => (typeof v === 'string' ? v.trim().toLowerCase() : v))
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  heardFromOptions?: string[] | null;

  @ApiPropertyOptional({ enum: [4, 6], description: 'Length of the check-in codes ULTM8 generates here: staff kiosk codes (Decision 320) and members\' personal codes (Decision 315). Default 4. Codes already issued keep their length.' })
  @IsOptional()
  @IsIn([4, 6])
  checkInCodeDigits?: number;

  @ApiPropertyOptional({
    enum: ['NO_REFUND_ONCE_STARTED', 'REFUND_UNTIL_END', 'ALWAYS_REFUND'],
    description: 'What cancelling a Booking after its Class has started gives back, when the Class has no refund cut-off of its own. Default NO_REFUND_ONCE_STARTED. Under the first two, a Class that has ended can no longer be cancelled.',
  })
  @IsOptional()
  @IsEnum(['NO_REFUND_ONCE_STARTED', 'REFUND_UNTIL_END', 'ALWAYS_REFUND'])
  lateCancelRefundPolicy?: 'NO_REFUND_ONCE_STARTED' | 'REFUND_UNTIL_END' | 'ALWAYS_REFUND';

  @ApiPropertyOptional({ description: 'Lets Branch Staff record a cash or bank transfer payment taken at the desk (Decision 347). Default false.' })
  @IsOptional()
  @IsBoolean()
  branchStaffCanRecordPayments?: boolean;

  @ApiPropertyOptional({ enum: ['MONDAY', 'SUNDAY'], description: 'First day of the Timetable\'s week (Decision 319 §4). Default MONDAY.' })
  @IsOptional()
  @IsEnum(['MONDAY', 'SUNDAY'])
  weekStartsOn?: 'MONDAY' | 'SUNDAY';

  @ApiPropertyOptional({ enum: ['LIST', 'GRID'], description: 'The layout the Timetable opens in (Decision 319 §4). Default LIST.' })
  @IsOptional()
  @IsEnum(['LIST', 'GRID'])
  timetableDefaultLayout?: 'LIST' | 'GRID';
}
