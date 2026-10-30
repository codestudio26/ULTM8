import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const PROMOTION_FEE_STATUSES = ['PENDING', 'ACCEPTED', 'PAID', 'DECLINED', 'WAIVED', 'CANCELLED'] as const;
export type PromotionFeeStatusValue = (typeof PROMOTION_FEE_STATUSES)[number];

/** The School-wide promotion fee switches (Decisions 287, 300, 307). Owner only (Decision 297). */
export class UpdatePromotionFeeSettingsDto {
  @ApiPropertyOptional({ description: 'Promotion fee on or off (off by default). Off: grades have no price, prices are not returned, and no fee is asked.' })
  @IsOptional()
  @IsBoolean()
  promotionFeeEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      '"Allow grading before the fee is paid" (off by default). On: a priced promotion applies at once and the fee request waits. Off: the promotion waits ("Waiting for fee") until the fee is paid or waived.',
  })
  @IsOptional()
  @IsBoolean()
  gradeBeforeFeePaid?: boolean;
}

export class PromotionFeeSettingsResponseDto {
  @ApiProperty()
  promotionFeeEnabled!: boolean;

  @ApiProperty({ description: '"Allow grading before the fee is paid".' })
  gradeBeforeFeePaid!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The School\'s currency (School.defaultCurrency): prices are minor units of it.' })
  currency!: string | null;
}

export class PromotionFeeRequestQueryDto {
  @ApiPropertyOptional({ enum: PROMOTION_FEE_STATUSES })
  @IsOptional()
  @IsEnum(PROMOTION_FEE_STATUSES)
  status?: PromotionFeeStatusValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  disciplineId?: string;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PromotionFeeRequestResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ description: 'Student app list only: the School\'s name.' })
  schoolName?: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiPropertyOptional({ description: 'Student app list only: the style\'s name.' })
  disciplineName?: string;

  @ApiProperty({ description: 'The rung the grade moves the student to.' })
  toRungId!: string;

  @ApiProperty()
  toRungName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The rung the student was on when graded.' })
  expectedCurrentRungId!: string | null;

  @ApiProperty({ description: 'Minor units of `currency`.' })
  amountMinor!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty({ enum: PROMOTION_FEE_STATUSES })
  status!: PromotionFeeStatusValue;

  @ApiProperty({ description: 'The promotion waits for this fee (it applies once paid or waived). False when it applied at grading.' })
  promotionWaits!: boolean;

  @ApiProperty({ description: 'The promotion has applied (at grading, or once paid or waived).' })
  promotionApplied!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The history entry of the promotion, once applied.' })
  promotionEventId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The grading date the coach chose (YYYY-MM-DD), for a promotion that waits or is "to decide".' })
  gradingDate!: string | null;

  @ApiProperty({ description: 'Open "to decide": the owner waived or cancelled the fee and a coach decides whether to promote (Decision 307). Promoting to toRungId makes no new fee request.' })
  toDecide!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  toDecideAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, enum: ['PROMOTED', 'DISMISSED'] })
  toDecideResolution!: 'PROMOTED' | 'DISMISSED' | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  acceptedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  declinedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  paidAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  waivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  cancelledAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({
    type: () => PromotionFeeChargeSummaryDto,
    nullable: true,
    description: 'Backlog §3.6 step 6 (Decision 303 item 5): the charge made when the fee was accepted, paid as any charge is. Null before it is accepted.',
  })
  charge!: PromotionFeeChargeSummaryDto | null;

  @ApiPropertyOptional({
    type: () => PromotionFeeTaxPreviewDto,
    nullable: true,
    description: "PENDING only: what accepting would charge with the School's tax settings today (Decision 411). The charge keeps the tax of the day it is made.",
  })
  taxPreview!: PromotionFeeTaxPreviewDto | null;
}

/** Backlog §3.6 step 6: the charge of an accepted promotion fee. */
export class PromotionFeeChargeSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '#0000012' })
  invoiceLabel!: string;

  @ApiProperty({ enum: ['OPEN', 'PART_PAID', 'PAID', 'CANCELLED'] })
  status!: 'OPEN' | 'PART_PAID' | 'PAID' | 'CANCELLED';

  @ApiProperty({ description: 'Price excluding tax (minor units).' })
  netAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty({ description: 'Price including tax: what is owed in all.' })
  grossAmount!: number;

  @ApiProperty()
  taxRateBasisPoints!: number;

  @ApiProperty()
  taxInclusive!: boolean;

  @ApiProperty()
  paidAmount!: number;

  @ApiProperty({ description: 'Still to pay (0 when paid or cancelled).' })
  owedAmount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ example: '2026-10-30' })
  dueDate!: string;
}

/** Backlog §3.6 step 6: a pending fee's tax, before it is accepted. */
export class PromotionFeeTaxPreviewDto {
  @ApiProperty()
  netAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty()
  grossAmount!: number;

  @ApiProperty()
  taxRateBasisPoints!: number;

  @ApiProperty()
  taxInclusive!: boolean;

  @ApiProperty()
  currency!: string;
}

export class PromotionFeeRequestListResponseDto {
  @ApiProperty({ type: [PromotionFeeRequestResponseDto] })
  items!: PromotionFeeRequestResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor?: string | null;
}
