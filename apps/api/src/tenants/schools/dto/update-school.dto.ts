import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEmail, IsString, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { CreateSchoolDto } from './create-school.dto';

const NULLABLE_ON_UPDATE = [
  'mobileNumber',
  'address',
  'businessType',
  'defaultLanguage',
  'defaultCurrency',
  'timezone',
  'description',
  'logoUrl',
  'bannerUrl',
  'footerAboutUs',
  'footerContactEmail',
  'footerContactPhone',
  'footerFacebookUrl',
  'footerInstagramUrl',
  'footerTiktokUrl',
  'footerYoutubeUrl',
  'footerTwitterUrl',
] as const;

/**
 * FOUND PROACTIVELY (Phase 18, mirroring the identical fix applied to
 * UpdateBranchDto — see that file's own header comment for the full
 * reasoning): SchoolsService.update()'s Prisma call already forwards every
 * one of these fields straight through as `data.<field>` with no ternary, and
 * they're all nullable `String?` columns on the School model — so an explicit
 * `null` already clears the column and `undefined` already leaves it
 * unchanged. This DTO's type just hadn't caught up.
 *
 * Not hypothetical here either: `apps/school-portal/src/schools/SchoolPage.tsx`
 * is Phase 3's own, already-shipped School-profile edit form, and it already
 * tries to clear these fields via `value || undefined` on submit — this exact
 * bug has been live since Phase 3.
 *
 * Deliberately NOT widened: `name` (required), `activities`/`facilities`
 * (arrays — SchoolPage.tsx already sends a real, possibly-empty array via
 * `.split(',').filter(Boolean)`, never `undefined`, so there's nothing to fix
 * there), `ranksToggle`/`classCancellationPolicy`/`waitlistClaimWindowMinutes`
 * (boolean/enum/required-shaped fields with no "clear" concept).
 */
export class UpdateSchoolDto extends PartialType(OmitType(CreateSchoolDto, NULLABLE_ON_UPDATE)) {
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
  businessType?: string | null;

  @ApiPropertyOptional({ description: "One of the 4 confirmed languages — no canonical code list is confirmed anywhere yet (domain-rules §1), so this is free text, matching User.language's existing Phase 1 treatment.", type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultLanguage?: string | null;

  @ApiPropertyOptional({ description: 'An ISO 4217 code from the Stripe-supported currency list (GET /settings/currencies, ~135 currencies) — same free-text caveat as defaultLanguage.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultCurrency?: string | null;

  @ApiPropertyOptional({ description: 'IANA timezone name. Same field as Branch.timezone (Decisions 76, 172).', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string | null;

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

  // Decision 257 — per-School footer content; see CreateSchoolDto's own
  // comment on these fields. `null` clears the field — hides its own
  // line/icon on the footer, same as every other nullable field here.
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Shown as a plain line in the footer\'s "Company" column — not a link.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  footerAboutUs?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  footerContactEmail?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  footerContactPhone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerFacebookUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerInstagramUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerTiktokUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerYoutubeUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'X (formerly Twitter).' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  footerTwitterUrl?: string | null;
}
