import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Same convention as every other response DTO in this codebase (see
 * school-response.dto.ts's own header comment for why every nullable field
 * passes an explicit `type` alongside `nullable: true`). Field-for-field match
 * of the FranchiseFeeCharge Prisma model (schema.prisma). */
export class FranchiseFeeChargeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  franchiseId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  franchisePaymentAccountId!: string;

  @ApiProperty()
  billingPeriodStart!: string;

  @ApiProperty()
  billingPeriodEnd!: string;

  @ApiProperty({ enum: ['FLAT', 'PER_HEADCOUNT'] })
  feeBasisSnapshot!: 'FLAT' | 'PER_HEADCOUNT';

  @ApiProperty()
  amount!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  activeStudentCountSnapshot!: number | null;

  @ApiProperty({ enum: ['SUCCESSFUL', 'PENDING', 'FAILED', 'REFUNDED', 'DISPUTED'] })
  status!: 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'DISPUTED';

  @ApiPropertyOptional({ type: String, nullable: true })
  stripeInvoiceId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  stripeSubscriptionId!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  refundedAmount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  disputedAmount!: number | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class FranchiseFeeChargeListResponseDto {
  @ApiProperty({ type: [FranchiseFeeChargeResponseDto] })
  items!: FranchiseFeeChargeResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
