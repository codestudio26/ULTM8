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

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Subscription only: set once the Student or the owner cancels; the date the paid period ends.' })
  cancelAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  cancelledById!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/** GET /memberships/me: a row of the caller's own memberships. */
export class MyMembershipResponseDto extends MembershipResponseDto {
  @ApiProperty({ description: 'Decision 391: a Visitor\'s free visit pass (its plan is hidden from the School\'s plan list).' })
  visitPass!: boolean;
}

export class MyMembershipListResponseDto {
  @ApiProperty({ type: [MyMembershipResponseDto] })
  items!: MyMembershipResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
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
  @ApiProperty({ enum: ['requires_payment', 'requires_checkout', 'pending_confirmation', 'active'] })
  outcome!: 'requires_payment' | 'requires_checkout' | 'pending_confirmation' | 'active';

  @ApiPropertyOptional({ description: 'Stripe PaymentIntent client secret — present only when outcome is requires_payment.' })
  clientSecret?: string;

  @ApiPropertyOptional({
    description:
      'Hosted Stripe Checkout Session URL (Decision 243, Track B Slice 4b) — present only when outcome is requires_checkout. Open in the device browser (expo-web-browser); confirmation arrives asynchronously via the payment_intent.succeeded webhook, same as requires_payment.',
  })
  checkoutUrl?: string;

  @ApiPropertyOptional({ type: MembershipResponseDto, description: 'Present only when outcome is active.' })
  membership?: MembershipResponseDto;

  @ApiPropertyOptional({ description: 'The created Transaction id — present for requires_payment, requires_checkout, pending_confirmation, and an active outcome reached via payWithSavedCard (Decision 236).' })
  transactionId?: string;
}

/** One row of a Student's Memberships at a School, for the owner (Decision 348). */
export class StudentMembershipResponseDto extends MembershipResponseDto {
  @ApiProperty()
  planTitle!: string;

  @ApiProperty()
  planType!: string;

  @ApiProperty({ description: 'In effect now: Active, not past its expiry date, and not a used-up pack.' })
  live!: boolean;
}

export class StudentMembershipListResponseDto {
  @ApiProperty({ type: [StudentMembershipResponseDto] })
  items!: StudentMembershipResponseDto[];
}

/** One current member of a plan, for the owner (Decision 348). */
export class PlanMemberResponseDto {
  @ApiProperty()
  membershipId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  startDate!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiryDate!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  classesRemaining!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  cancelAt!: string | null;

  @ApiProperty({ description: 'True when the owner gave it (a Friend Pass).' })
  gifted!: boolean;
}

export class PlanMemberListResponseDto {
  @ApiProperty({ type: [PlanMemberResponseDto] })
  items!: PlanMemberResponseDto[];
}

/** POST .../memberships/sell and .../gift. */
export class DeskMembershipResponseDto {
  @ApiProperty({ type: MembershipResponseDto })
  membership!: MembershipResponseDto;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The Successful Transaction recorded for a paid sale; null for a £0 plan or a Friend Pass.' })
  transactionId!: string | null;
}

/** GET /students/{id}/membership-status — computed signal only, never a raw row. */
export class MembershipStatusResponseDto {
  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'NONE'] })
  status!: 'ACTIVE' | 'EXPIRED' | 'NONE';
}
