import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { CreateMembershipPlanDto } from './create-membership-plan.dto';

const NULLABLE_ON_UPDATE = ['currency', 'expiryDurationDays', 'scopedClassId', 'cancellationCharge'] as const;

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
 * Deliberately NOT widened: `type`/`title`/`price`/`visible`/
 * `termsWaiverRequired` (required or cross-validated together — see
 * MembershipsService.updatePlan()'s own comment on why price/classesIncluded
 * are resolved jointly with type — nothing to "clear" on their own), or
 * `refundFeeDate` (converted via `dto.refundFeeDate ? new Date(dto.refundFeeDate)
 * : undefined` — a falsy check that would swallow an explicit null the same as
 * an omitted field, the same class of gap Class's own bookingEndAt/
 * qrAttendanceEndAt/refundFeeDate have; left alone rather than silently
 * half-fixed, same as those).
 */
export class UpdateMembershipPlanDto extends PartialType(OmitType(CreateMembershipPlanDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({ description: "One of the 6 supported currencies (School's own choice, no conversion applied). Pass null to clear.", type: String, nullable: true })
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
}
