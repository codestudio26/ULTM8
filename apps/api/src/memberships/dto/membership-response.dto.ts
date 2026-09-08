import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the Membership Prisma model. */
export class MembershipResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  membershipPlanId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  frequency!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  classesRemaining!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiryDate!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  scopedClassId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  giftedById!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class MembershipListResponseDto {
  @ApiProperty({ type: [MembershipResponseDto] })
  items!: MembershipResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}

/**
 * Response shape for POST /membership-plans/{id}/purchase — deliberately a
 * discriminated-by-`outcome` envelope rather than three separate response DTOs,
 * since the caller genuinely can't know which of the three creation-timing paths
 * (Decision 6) a given purchase will take until the service resolves the School's
 * PaymentAccount.provider and the plan's type.
 */
export class PurchaseMembershipResponseDto {
  @ApiProperty({ enum: ['requires_payment', 'pending_confirmation', 'active'] })
  outcome!: 'requires_payment' | 'pending_confirmation' | 'active';

  @ApiPropertyOptional({ description: 'Stripe PaymentIntent client secret — present only when outcome is requires_payment.' })
  clientSecret?: string;

  @ApiPropertyOptional({ type: MembershipResponseDto, description: 'Present only when outcome is active.' })
  membership?: MembershipResponseDto;

  @ApiPropertyOptional({ description: 'The created Transaction id — present for requires_payment and pending_confirmation.' })
  transactionId?: string;
}

/** GET /students/{id}/membership-status — computed signal only, never a raw row. */
export class MembershipStatusResponseDto {
  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'NONE'] })
  status!: 'ACTIVE' | 'EXPIRED' | 'NONE';
}
