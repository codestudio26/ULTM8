import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the Transaction Prisma model. */
export class TransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  paymentAccountId!: string;

  @ApiProperty()
  membershipPlanId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  membershipId!: string | null;

  @ApiProperty()
  billingDate!: string;

  @ApiProperty()
  amount!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  paymentMethod!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  disputedAmount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  refundedAmount!: number | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class TransactionListResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  items!: TransactionResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
