import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the MembershipPlan Prisma model — see class-response.dto.ts's
 * header comment for the nullable-field `type`+`nullable: true` convention this follows. */
export class MembershipPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  price!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  expiryDurationDays!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  classesIncluded!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  scopedClassId!: string | null;

  @ApiProperty()
  visible!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'v1.2 backend backlog — set when this plan has been archived (permanent-retirement state, distinct from visible). Null when not archived.' })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  refundFeeDate!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  cancellationCharge!: number | null;

  @ApiProperty()
  termsWaiverRequired!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The plan's income category (Decision 316 item 10), from GET /schools/{id}/income-categories." })
  incomeCategoryId!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Decision 435 items 1-6: the one-off joining fee on a member's first-ever plan at the School, in the plan's currency (minor units); null = none. Charged only while the School has joining fees on." })
  joiningFee!: number | null;

  @ApiProperty({ description: 'Decision 435 item 5: whether the joining fee is refunded together with the membership payment.' })
  joiningFeeRefundable!: boolean;

  @ApiProperty({ type: [String], description: 'The styles this plan covers (Decision 195).' })
  disciplineIds!: string[];

  @ApiProperty({ description: 'Whether a live membership on this plan can watch its styles\' lessons (Decision 195).' })
  includesLessons!: boolean;

  @ApiProperty({ description: 'SUBSCRIPTION only (Decision 259). FRESH_CYCLE: each new Student is charged in full immediately and renews monthly from their own signup date. PRORATED_TO_SHARED_CYCLE: each new Student is prorated to billingCycleAnchorDay, then renews on that fixed day.' })
  newMemberBillingStrategy!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Day of month (1-28) — set only when newMemberBillingStrategy is PRORATED_TO_SHARED_CYCLE.' })
  billingCycleAnchorDay!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 316 item 6: the contract the member signs when buying this plan; null when the plan has none. Set with PUT /membership-plans/{id}/contract.' })
  contractBody!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Subscription only: the minimum term in months.' })
  contractMinimumTermMonths!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Subscription only: the early-exit fee, minor units, before the School's tax." })
  contractEarlyExitFee!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Goes up by one each time the contract changes; null = no contract.' })
  contractVersion!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Decision 435 items 10-15: the most members this plan can have; null = no limit.' })
  memberLimit!: number | null;

  @ApiProperty({ description: "Decision 435 item 7: the membership's days start on the member's first check-in with it." })
  startsOnFirstCheckIn!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 435 item 8: the first day of a plan on fixed dates (the day at UTC midnight); null when it has none.' })
  fixedStartDate!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 435 item 8: the last day of a plan on fixed dates.' })
  fixedEndDate!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 435 item 9: the plan a member can agree, when buying, to switch to when this one ends.' })
  switchToPlanId!: string | null;

  @ApiProperty({ description: 'Decision 435 item 16: the Subscription stops when the minimum term ends instead of renewing.' })
  contractEndsAfterMinimumTerm!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class MembershipPlanListResponseDto {
  @ApiProperty({ type: [MembershipPlanResponseDto] })
  items!: MembershipPlanResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
