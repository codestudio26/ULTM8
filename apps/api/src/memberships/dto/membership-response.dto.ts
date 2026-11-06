import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FreezeSummaryDto } from '../freeze/dto/membership-freeze.dto';

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

  @ApiProperty({
    description:
      "Decision 441 item 1: a monthly plan at a School that takes no cards. The first month was paid by Pix/bank transfer or cash; each month after it is a charge on the member's balance (a recurring charge), not a card payment.",
  })
  billedToBalance!: boolean;

  @ApiProperty({ description: 'Decision 435 item 7: bought on a plan that starts on the first check-in, and not used yet: no expiryDate until then.' })
  awaitingFirstCheckIn!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 435 item 9: the plan the member agreed to switch to when this one ends; null when it simply ends.' })
  switchToPlanId!: string | null;

  @ApiProperty()
  createdAt!: string;


  @ApiProperty()
  updatedAt!: string;
}

/** Decision 316 item 6: the signed contract's terms, shown before cancelling. */
export class MembershipContractTermsDto {
  @ApiProperty({ description: 'When the signed minimum term ends, with any freezes added (Decision 435 item 17).' })
  minimumTermEndsAt!: string;

  @ApiProperty({ description: 'Decision 435 item 16: the membership stops when the minimum term ends instead of renewing.' })
  endsAfterMinimumTerm!: boolean;

  @ApiProperty({ description: "The early-exit fee put on the balance if the membership ends before then; minor units, before the School's tax. 0 = none." })
  earlyExitFee!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;
}

/** GET /memberships/me: a row of the caller's own memberships. */
export class MyMembershipResponseDto extends MembershipResponseDto {
  @ApiPropertyOptional({ type: MembershipContractTermsDto, nullable: true, description: "Decision 316 item 6: the signed contract's minimum term and early-exit fee, when it has one." })
  contract!: MembershipContractTermsDto | null;

  @ApiProperty({ description: 'Decision 391: a Visitor\'s free visit pass (its plan is hidden from the School\'s plan list).' })
  visitPass!: boolean;

  @ApiProperty({ description: 'Decision 404: an approved freeze covers today.' })
  frozen!: boolean;

  @ApiPropertyOptional({ type: FreezeSummaryDto, nullable: true, description: 'Decision 404: the freeze in effect or still to come, else a request waiting.' })
  freeze!: FreezeSummaryDto | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 427: the plan name (null when the plan can no longer be read).' })
  planTitle!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 427: the School name (null when it can no longer be read).' })
  schoolName!: string | null;
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

  @ApiProperty({ description: 'Decision 404: an approved freeze covers today (a frozen membership stays live).' })
  frozen!: boolean;

  @ApiPropertyOptional({ type: FreezeSummaryDto, nullable: true, description: 'Decision 404: the freeze in effect or still to come, else a request waiting.' })
  freeze!: FreezeSummaryDto | null;
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

  @ApiPropertyOptional({ type: MembershipResponseDto, isArray: true, description: 'Decision 431 (MON-15): a Friend Pass gift only: every pass given (membership is the first).' })
  memberships?: MembershipResponseDto[];
}

/** GET /students/{id}/membership-status — computed signal only, never a raw row. */
export class MembershipStatusResponseDto {
  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'NONE'] })
  status!: 'ACTIVE' | 'EXPIRED' | 'NONE';
}
