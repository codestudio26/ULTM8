import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, MaxLength } from 'class-validator';

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
