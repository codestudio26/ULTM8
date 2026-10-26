import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeModelDto } from './create-franchise.dto';
import { PostalAddressColumnsResponseDto } from '../../../common/address/postal-address.dto';

/**
 * Response shape — same convention as school-response.dto.ts (see its own header
 * comment for why every nullable field passes an explicit `type` alongside
 * `nullable: true`, and why that matters for packages/api-client generation).
 * Field-for-field match of the Franchise Prisma model (schema.prisma).
 */
export class FranchiseResponseDto extends PostalAddressColumnsResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  mobileNumber!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  type!: string | null;

  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiProperty({ type: [String] })
  facilities!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultLanguage!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultCurrency!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

  @ApiProperty({ enum: FeeModelDto })
  feeModel!: FeeModelDto;

  /** Self-service, Franchise-Owner-set — see create-franchise.dto.ts's own
   * comment for the full account (Decision 99). Not `stripeMeterId`/
   * `stripeUsagePriceId` — those are internal Stripe correlator ids with no
   * direct caller action tied to them, deliberately not exposed here. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  flatFeeAmount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  perHeadcountRate!: number | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  /** Phase 56/57 (Decision 110) — same reasoning as SchoolResponseDto's own
   * identical trio (no explicit `select` anywhere this DTO is built from, so
   * these were already returned at runtime; this just types them). */
  @ApiPropertyOptional({ type: String, nullable: true })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  purgeAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  purgedAt!: string | null;

  /**
   * Present only on the response from POST /franchises (self-service creation) — same
   * narrow, approved re-mint exception SchoolResponseDto's own `accessToken` field
   * documents (ultm8-nestjs-module §7). Absent everywhere else.
   */
  @ApiPropertyOptional({ type: String })
  accessToken?: string;
}

export class FranchiseListResponseDto {
  @ApiProperty({ type: [FranchiseResponseDto] })
  items!: FranchiseResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}

/** Decision 336 (F2) — one row of a Franchise Owner's member-School roster
 * (GET /franchises/{id}/schools). Deliberately narrow: who the member is and how
 * its franchise-fee billing stands, nothing else from the School's record. */
export class FranchiseMemberSchoolResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  businessType!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAST_DUE', 'CANCELED'], nullable: true })
  franchiseFeeSubscriptionStatus!: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Set when the School has been closed.' })
  archivedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class FranchiseMemberSchoolListResponseDto {
  @ApiProperty({ type: [FranchiseMemberSchoolResponseDto] })
  items!: FranchiseMemberSchoolResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
