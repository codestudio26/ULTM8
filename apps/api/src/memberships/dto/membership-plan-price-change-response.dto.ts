import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
 * prompt. Field-for-field match of the MembershipPlanPriceChange Prisma
 * model, same convention MembershipPlanResponseDto's own header comment
 * establishes. Read-only — there is no create/update endpoint for this
 * resource; rows are only ever written by MembershipsService.updatePlan()
 * and MembershipPlanPriceMigrationProcessor. */
export class MembershipPlanPriceChangeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  membershipPlanId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty({ enum: ['MIGRATE', 'GRANDFATHER'] })
  decision!: string;

  @ApiProperty()
  oldPrice!: number;

  @ApiProperty()
  newPrice!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  oldCurrency!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  newCurrency!: string | null;

  @ApiProperty()
  decidedById!: string;

  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] })
  status!: string;

  @ApiProperty()
  affectedMembershipCount!: number;

  @ApiProperty()
  migratedCount!: number;

  @ApiProperty()
  failedCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  completedAt!: string | null;
}

export class MembershipPlanPriceChangeListResponseDto {
  @ApiProperty({ type: [MembershipPlanPriceChangeResponseDto] })
  items!: MembershipPlanPriceChangeResponseDto[];
}
