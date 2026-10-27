import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PostalAddressDto } from '../../../common/address/postal-address.dto';

/**
 * Field set per Decision 76 (docs/decisions/POST-SPEC-55-DECISION-LOG.md) — Branch
 * mirrors School's profile fields: name, address, contact phone, timezone, currency
 * override, branding. This is the product owner's own literal field list for Branch,
 * distinct from — and narrower than — School's actual full §6.1 field list (business
 * type, activities, facilities, ranksToggle, class-cancellation-policy,
 * waitlistClaimWindow, franchiseFeeSubscriptionStatus have no Branch equivalent here).
 * See the Phase 2 summary for why these two lists don't literally match despite
 * Decision 76's "mirrors School" framing, and why Branch is still built against
 * Decision 76's literal list rather than School's full one.
 *
 * schoolId is a route param (`/schools/:schoolId/branches`), not a body field.
 *
 * Length/format limits (later hardening pass): every short free-text field capped at
 * 100 chars — including timezone and currencyOverride, which the fix that added these
 * limits named only by category ("short fields") via examples in other DTOs
 * (currency/mobileNumber/contactPhone) rather than listing every field in every DTO by
 * name; treated as the same category here for consistency rather than left
 * unvalidated by omission — flagging the interpretation, not silently assuming it.
 * address at 500, logoUrl/bannerUrl capped at 2048 chars and validated as actual URLs.
 * UpdateBranchDto (PartialType(CreateBranchDto)) inherits all of these automatically.
 *
 * Decision 231 — `type`/`activities`/`facilities`/`defaultLanguage`/`description`
 * added for the Branch settings screen, mirroring Franchise's own
 * identically-named fields and validation exactly (create-franchise.dto.ts).
 */
export class CreateBranchDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name!: string;

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
  contactPhone?: string;

  @ApiPropertyOptional({ description: 'IANA timezone name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currencyOverride?: string;

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
}
