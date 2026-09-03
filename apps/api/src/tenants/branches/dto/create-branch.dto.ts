import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

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
 */
export class CreateBranchDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({ description: 'IANA timezone name.' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currencyOverride?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bannerUrl?: string;
}
