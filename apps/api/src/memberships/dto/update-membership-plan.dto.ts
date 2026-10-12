import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { CreateMembershipPlanDto } from './create-membership-plan.dto';

const NULLABLE_ON_UPDATE = ['currency', 'expiryDurationDays', 'scopedClassId', 'cancellationCharge', 'refundFeeDate'] as const;

/** v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
 * prompt. MembershipsService.updatePlan() requires exactly one of these
 * whenever a SUBSCRIPTION plan's price is actually changing AND it already
 * has at least one active Stripe-backed subscriber — see that method's own
 * header comment for the full decision tree, including why a brand-new plan
 * with zero subscribers needs no choice at all. */
export enum MembershipPlanPriceChangeStrategyDto {
  MIGRATE = 'MIGRATE',
  GRANDFATHER = 'GRANDFATHER',
}

/**
 * FOUND PROACTIVELY (Phase 18, before school-portal's own edit-MembershipPlan
 * form needed it): the same gap Phase 17's review caught and fixed for
 * UpdateClassDto/UpdateInstructorDto/UpdateTimetableSlotDto (see those files'
 * own header comments for the full reasoning) exists here too —
 * MembershipsService.updatePlan()'s Prisma call already forwards
 * `dto.currency`/`dto.expiryDurationDays`/`dto.scopedClassId`/
 * `dto.cancellationCharge` straight through as `data.<field>` with no ternary,
 * so an explicit `null` already clears the column and `undefined` already
 * leaves it unchanged — the DTO's type annotation just hadn't caught up.
 * Widened proactively here rather than waiting to rediscover the identical
 * bug a second time via review.
 *
 * `refundFeeDate` widened too (Decision 209): it used to sit in the
 * deliberately-NOT-widened list because `MembershipsService.updatePlan()`
 * converted it via `dto.refundFeeDate ? new Date(dto.refundFeeDate) :
 * undefined` — a falsy check that swallowed an explicit `null` the same as
 * an omitted field. Fixed at the source (that ternary now distinguishes
 * `undefined` from `null` from a real string) rather than left as a second
 * instance of the same gap Class's own bookingEndAt/qrAttendanceEndAt still
 * have — those remain their own, separate, unfixed gap.
 *
 * Deliberately NOT widened: `type`/`title`/`price`/`visible`/
 * `termsWaiverRequired` (required or cross-validated together — see
 * MembershipsService.updatePlan()'s own comment on why price/classesIncluded
 * are resolved jointly with type — nothing to "clear" on their own).
 */
export class UpdateMembershipPlanDto extends PartialType(OmitType(CreateMembershipPlanDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({ description: "An ISO 4217 code from the Stripe-supported currency list (School's own choice, no conversion applied) — see GET /settings/currencies (Decision 241). Pass null to clear.", type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Computes each purchased Membership's expiry date at creation time. Pass null to clear." })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiryDurationDays?: number | null;

  @ApiPropertyOptional({ description: 'Restricts this plan to one specific Class. Pass null to clear (unrestrict).', type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  scopedClassId?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Minor currency unit. Pass null to clear.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationCharge?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISO 8601 date-time. Pass null to clear.' })
  @IsOptional()
  @IsDateString()
  refundFeeDate?: string | null;

  @ApiPropertyOptional({
    enum: MembershipPlanPriceChangeStrategyDto,
    description:
      'Required only when editing a SUBSCRIPTION plan whose price is actually changing AND it already has at least one active Stripe-backed subscriber. MIGRATE moves every existing subscriber to the new price (no proration, applied at their next billing cycle); GRANDFATHER leaves existing subscribers on their original price and applies the new price to new signups only. Rejected (400) if required and omitted.',
  })
  @IsOptional()
  @IsEnum(MembershipPlanPriceChangeStrategyDto)
  priceChangeStrategy?: MembershipPlanPriceChangeStrategyDto;
}
