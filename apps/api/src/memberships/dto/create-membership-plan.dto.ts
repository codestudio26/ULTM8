import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, MaxLength } from 'class-validator';

/** A calendar day, YYYY-MM-DD. */
export const PLAN_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The largest amount a 32-bit integer column holds. */
const MAX_MINOR_UNITS = 2147483647;

export enum MembershipPlanTypeDto {
  SUBSCRIPTION = 'SUBSCRIPTION',
  CLASS_PACK = 'CLASS_PACK',
  WEEKLY_PASS = 'WEEKLY_PASS',
  FRIEND_PASS = 'FRIEND_PASS',
  TRIAL_MEMBERSHIP = 'TRIAL_MEMBERSHIP',
}

/** Decision 259 — see MembershipPlan.newMemberBillingStrategy's own schema comment. */
export enum NewMemberBillingStrategyDto {
  FRESH_CYCLE = 'FRESH_CYCLE',
  PRORATED_TO_SHARED_CYCLE = 'PRORATED_TO_SHARED_CYCLE',
}

/**
 * Field list verified against Spec 55 §6.1's confirmed MembershipPlan row — see the
 * Phase 9 kickoff prompt for the full citation trail. schoolId is a route param
 * (`/schools/:schoolId/membership-plans`), not a body field, same convention as
 * CreateClassDto.
 *
 * Cross-field validation NOT expressible via class-validator decorators alone
 * (type=FRIEND_PASS => price=0 & classesIncluded=1; scopedClassId set =>
 * classesIncluded capped at 1; type=SUBSCRIPTION requires the School's own
 * PaymentAccount to be STRIPE-provider) is enforced in MembershipsService, not here
 * — same split ClassesService's assertValidDateRange already established for
 * cross-field checks a single-field decorator can't express.
 *
 * `expiryDurationDays` and `visible` are Developer-level inferred fields, not
 * literally named by Spec 55 (see the MembershipPlan Prisma model's own header
 * comment) — flagged here too, not just in the schema.
 */
export class CreateMembershipPlanDto {
  @ApiProperty({ enum: MembershipPlanTypeDto })
  @IsEnum(MembershipPlanTypeDto)
  type!: MembershipPlanTypeDto;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  title!: string;

  // Decision 334 (Memberships review M8): the column is a 32-bit integer; a
  // larger number used to reach the database and fail as a 500.
  @ApiProperty({ description: 'Minor currency unit (e.g. cents). Must be 0 for FRIEND_PASS.' })
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR_UNITS)
  price!: number;

  @ApiPropertyOptional({ description: "An ISO 4217 code from the Stripe-supported currency list (School's own choice, no conversion applied) — see GET /settings/currencies (Decision 241)." })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ description: 'Computes each purchased Membership\'s expiry date at creation time — used by every plan type, including WEEKLY_PASS (Decision 249; a prior version of this description incorrectly said otherwise).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiryDurationDays?: number;

  @ApiPropertyOptional({ description: 'CLASS_PACK / FRIEND_PASS credit quantity. Capped at 1 when scopedClassId is set.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  classesIncluded?: number;

  @ApiPropertyOptional({ description: 'Restricts this plan to one specific Class.' })
  @IsOptional()
  @IsUUID()
  scopedClassId?: string;

  // No `default:` in the Swagger metadata on purpose: openapi-typescript would
  // then type this as required in packages/api-client and break existing
  // callers that don't send it.
  @ApiPropertyOptional({ description: 'Defaults to true when omitted.' })
  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time.' })
  @IsOptional()
  @IsDateString()
  refundFeeDate?: string;

  @ApiPropertyOptional({ description: 'Minor currency unit.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR_UNITS)
  cancellationCharge?: number;

  // No `default:` in the Swagger metadata, for the same reason as visible
  // above.
  @ApiPropertyOptional({ description: 'Defaults to false when omitted.' })
  @IsOptional()
  @IsBoolean()
  termsWaiverRequired?: boolean;

  @ApiPropertyOptional({ description: "Decision 435 item 7: Class Pack, Weekly Pass or Trial only. The membership's days start on the member's first check-in with it, not when it is bought (needs expiryDurationDays). Defaults to false." })
  @IsOptional()
  @IsBoolean()
  startsOnFirstCheckIn?: boolean;

  @ApiPropertyOptional({ description: 'Decision 435 item 8: Class Pack, Weekly Pass or Trial only. The first day of a plan that runs on fixed dates (YYYY-MM-DD, in the School\'s time zone), with fixedEndDate, in place of expiryDurationDays. It can be bought before it starts, and after at full price, until its last day.' })
  @IsOptional()
  @Matches(PLAN_DAY_PATTERN, { message: 'fixedStartDate must be a day, YYYY-MM-DD.' })
  fixedStartDate?: string;

  @ApiPropertyOptional({ description: 'Decision 435 item 8: the last day of a plan on fixed dates (YYYY-MM-DD), on or after fixedStartDate.' })
  @IsOptional()
  @Matches(PLAN_DAY_PATTERN, { message: 'fixedEndDate must be a day, YYYY-MM-DD.' })
  fixedEndDate?: string;

  @ApiPropertyOptional({ description: "Decision 435 item 9: a Class Pack, Weekly Pass or Trial with an end can switch to this plan (one of the School's paid Class Packs, Weekly Passes or Trials, without a contract) when it ends, for a member who agrees when buying. Charged to their saved card; without one it simply ends." })
  @IsOptional()
  @IsUUID()
  switchToPlanId?: string;

  @ApiPropertyOptional({ description: "Decision 435 items 1-6: a one-off joining fee, in the plan's currency (minor units), added to a member's first-ever plan at this School (never a rejoin or a renewal), with the plan's tax and card surcharge. Paid plans only. Charged only while the School has joining fees on (School.joiningFeesEnabled). Omit for none." })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_MINOR_UNITS)
  joiningFee?: number;

  @ApiPropertyOptional({ description: 'Decision 435 item 5: whether the joining fee is refunded together with the membership payment. Defaults to false (never refunded).' })
  @IsOptional()
  @IsBoolean()
  joiningFeeRefundable?: boolean;

  @ApiPropertyOptional({ description: "One of the School's income categories (Decision 316 item 10), shown in the Transactions export." })

  @IsOptional()
  @IsUUID()
  incomeCategoryId?: string;

  @ApiPropertyOptional({ type: [String], description: 'The School\'s styles this plan covers (Decision 195).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  disciplineIds?: string[];

  @ApiPropertyOptional({ description: 'A live membership on this plan can watch the lessons of its styles (Decision 195). Defaults to on for a priced plan, off for a free one.' })
  @IsOptional()
  @IsBoolean()
  includesLessons?: boolean;

  @ApiPropertyOptional({
    enum: NewMemberBillingStrategyDto,
    description:
      'SUBSCRIPTION only (Decision 259). Defaults to FRESH_CYCLE when omitted: a new Student is charged the full price immediately and renews monthly from their own signup date. PRORATED_TO_SHARED_CYCLE: a new Student\'s first charge is prorated to the next occurrence of billingCycleAnchorDay, then renews on that fixed day every month after — requires billingCycleAnchorDay.',
  })
  @IsOptional()
  @IsEnum(NewMemberBillingStrategyDto)
  newMemberBillingStrategy?: NewMemberBillingStrategyDto;

  @ApiPropertyOptional({
    description:
      'Day of month (1-28) every new Membership on this plan is aligned to — required when newMemberBillingStrategy is PRORATED_TO_SHARED_CYCLE, rejected otherwise. Capped at 28 to sidestep every month\'s own day-count/Feb-29 edge cases entirely.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  billingCycleAnchorDay?: number;
}
