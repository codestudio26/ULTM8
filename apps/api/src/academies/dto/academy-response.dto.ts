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
] as const) {}

export class AcademyClassDto extends PickType(ClassResponseDto, [
  'id',
  'schoolId',
  'title',
  'activities',
  'bannerUrl',
  'description',
  'startDate',
  'endDate',
  'capacity',
] as const) {}

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
export class AcademyDetailDto extends AcademySummaryDto {
  @ApiProperty({ type: [AcademyMembershipPlanDto] })
  membershipPlans!: AcademyMembershipPlanDto[];

  @ApiProperty({ type: [AcademyClassDto] })
  upcomingClasses!: AcademyClassDto[];
}
