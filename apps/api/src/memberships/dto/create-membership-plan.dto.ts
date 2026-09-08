import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';

export enum MembershipPlanTypeDto {
  SUBSCRIPTION = 'SUBSCRIPTION',
  CLASS_PACK = 'CLASS_PACK',
  WEEKLY_PASS = 'WEEKLY_PASS',
  FRIEND_PASS = 'FRIEND_PASS',
  TRIAL_MEMBERSHIP = 'TRIAL_MEMBERSHIP',
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

  @ApiProperty({ description: 'Minor currency unit (e.g. cents). Must be 0 for FRIEND_PASS.' })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ description: "One of the 6 supported currencies (School's own choice, no conversion applied)." })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ description: 'Computes each purchased Membership\'s expiry date at creation time. Not used by WEEKLY_PASS.' })
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

  @ApiPropertyOptional({ default: true })
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
  cancellationCharge?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  termsWaiverRequired?: boolean;
}
