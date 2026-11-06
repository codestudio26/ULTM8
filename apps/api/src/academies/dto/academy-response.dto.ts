import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { SchoolResponseDto } from '../../tenants/schools/dto/school-response.dto';
import { MembershipPlanResponseDto } from '../../memberships/dto/membership-plan-response.dto';
import { ClassResponseDto } from '../../classes/dto/class-response.dto';
import { TimetableSlotResponseDto } from '../../timetable/dto/timetable-slot-response.dto';

/**
 * Curated, discovery-appropriate subsets of each entity's own full response DTO —
 * derived via `PickType` (the same `@nestjs/swagger` mapped-types convention this
 * codebase already uses for `UpdateXDto extends PartialType(...)`), not a hand-copied
 * field list. This keeps every field's `@ApiProperty`/nullability declaration as a
 * single source of truth on the entity's own DTO — if `SchoolResponseDto` etc. ever
 * change, these stay in sync automatically instead of silently drifting.
 *
 * The excluded fields are deliberately NOT picked here (Developer-level curation
 * choice — see the Phase 14 kickoff prompt §3 and Decision 94, flagged for Architect
 * review rather than treated as settled): School.mobileNumber/businessType/
 * ranksToggle/classCancellationPolicy/waitlistClaimWindowMinutes/
 * franchiseFeeSubscriptionStatus; Class.instructorId/branchId/bookingEndAt/
 * qrAttendanceEndAt/refundFeeDate/cancellationCharge/termsWaiverRequired/
 * membershipInclusion; MembershipPlan.refundFeeDate/cancellationCharge/
 * termsWaiverRequired/scopedClassId; TimetableSlot.instructorId/branchId/
 * termsWaiverRequired/membershipInclusion/bookingCutoffMinutesBeforeStart/
 * qrAttendanceWindowMinutes/refundCutoffHoursBeforeStart/cancellationCharge.
 *
 * These are enforced TWICE, not just here: the Phase 14 migration's own
 * column-level Postgres GRANTs restrict the `ultm8_discovery` role to exactly the
 * same field lists at the database layer — if AcademiesService's own `select`
 * clauses (which must match these lists) ever drift from that GRANT, the query
 * fails with a permission error rather than silently leaking a column. See
 * AcademiesService's own header comment and the migration SQL.
 */
export class AcademySummaryDto extends PickType(SchoolResponseDto, [
  'id',
  'franchiseId',
  'name',
  'address',
  'activities',
  'facilities',
  'defaultLanguage',
  'defaultCurrency',
  'description',
  'logoUrl',
  'bannerUrl',
] as const) {}

export class AcademyListResponseDto {
  @ApiProperty({ type: [AcademySummaryDto] })
  items!: AcademySummaryDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}

export class AcademyMembershipPlanDto extends PickType(MembershipPlanResponseDto, [
  'id',
  'schoolId',
  'type',
  'title',
  'price',
  'currency',
  'expiryDurationDays',
  'classesIncluded',
  'visible',
  'contractVersion',
  'startsOnFirstCheckIn',
  'fixedStartDate',
  'fixedEndDate',
  'switchToPlanId',
  'joiningFee',
  'joiningFeeRefundable',
  'memberLimit',
] as const) {

  /** Decision 406: shown before the member pays. */
  @ApiProperty({ description: "The card surcharge added to price when this plan is paid by card, in the same minor units. 0 when none (always 0 for a Friend Pass). For a Subscription, the surcharge on each monthly payment." })
  cardSurchargeAmount!: number;
}

export class AcademyClassDto extends PickType(ClassResponseDto, [
  'id',
  'schoolId',
  'title',
  'activities',
  'bannerUrl',
  'description',
  'startDate',
  'endDate',
  'breakStartAt',
  'breakEndAt',
  'capacity',
  // Decision 432 item 14: who can book.
  'audience',
  'minAge',
  'maxAge',
] as const) {
  /** Decision 427 (Student portal review SP6). */
  @ApiPropertyOptional({ type: String, nullable: true, description: "The IANA time zone the class runs on (its Branch's, else its School's); null when neither is set. Show the class's times on this clock." })
  timezone!: string | null;
}

export class AcademyTimetableSlotDto extends PickType(TimetableSlotResponseDto, [
  'id',
  'schoolId',
  'weekday',
  'startTime',
  'endTime',
  'breakStart',
  'breakEnd',
  'status',
  'title',
  'activities',
  'capacity',
  'description',
  'bannerUrl',
] as const) {}

export class AcademyTimetableListResponseDto {
  @ApiProperty({ type: [AcademyTimetableSlotDto] })
  items!: AcademyTimetableSlotDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}

/**
 * `GET /academies/:id` — the summary fields above, plus the School's currently
 * VISIBLE MembershipPlans (bounded, see MEMBERSHIP_PLANS_LIMIT in the service) and a
 * bounded window of upcoming Classes. "Read-optimized view over Tenants/Classes/
 * Memberships" (nestjs-module SKILL.md §5) read as: combine catalog data a
 * prospective Student would need to decide whether to join, not the School's full
 * administrative record.
 */
/** A branch as shown to anyone browsing the School: name only (Decision 209). */
export class AcademyBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class AcademyDetailDto extends AcademySummaryDto {
  @ApiProperty({ description: 'Decision 315 item 10: joining asks for medical information (optional, with consent).' })
  medicalInfoEnabled!: boolean;

  @ApiProperty({ description: 'Decision 318 item 7: a Guardian may add their child to this School in the app.' })
  memberAppAddFamily!: boolean;

  @ApiProperty({
    description:
      'Decision 437: the School takes card payments in the app (it has a Stripe payment account). When false, members pay by cash or bank transfer at the School and staff confirm it.',
  })
  cardPayments!: boolean;

  @ApiProperty({ description: "Decision 437: the School's country is Brazil, so the app mentions Pix with cash and bank transfer." })
  inBrazil!: boolean;

  @ApiProperty({ type: [AcademyBranchDto], description: 'The School\'s branches, for choosing a home branch when joining (Decision 209). Empty for a School with no branches.' })
  branches!: AcademyBranchDto[];

  @ApiProperty({ type: [AcademyMembershipPlanDto] })
  membershipPlans!: AcademyMembershipPlanDto[];

  @ApiProperty({ type: [AcademyClassDto] })
  upcomingClasses!: AcademyClassDto[];
}
