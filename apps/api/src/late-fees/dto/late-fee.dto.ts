import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_BASIS_POINTS, MAX_CHARGE_MINOR } from '../../charges/charge-maths';
import { LATE_FEE_MAX_GRACE_DAYS } from '../late-fee-maths';

export const LATE_FEE_TYPES = ['FIXED', 'PERCENT'] as const;
export type LateFeeTypeValue = (typeof LATE_FEE_TYPES)[number];

/** A School's late-fee setting, as its owner sees it (Decision 413). */
export class LateFeeSettingsDto {
  @ApiProperty({ description: 'Off by default.' })
  enabled!: boolean;

  @ApiProperty({ enum: LATE_FEE_TYPES })
  type!: LateFeeTypeValue;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "FIXED: the fee in minor units of the School's currency. Kept while off." })
  fixedAmount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'PERCENT: hundredths of a percent of what is still owed (250 = 2.5%), 1 to 10000. Kept while off.' })
  percentBps!: number | null;

  @ApiProperty({ description: 'Days after the due date before a late fee is added, 0 to 30. Default 3.' })
  graceDays!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The School's currency, for a fixed fee. Null until it is set on the School page." })
  currency!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'When the owner last confirmed late fees are legal where the School operates.' })
  confirmedAt!: Date | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When late fees were last switched on. Only a payment whose grace period ends on or after that day gets a late fee.',
  })
  enabledAt!: Date | null;
}

export class UpdateLateFeeSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: LATE_FEE_TYPES })
  @IsIn(LATE_FEE_TYPES)
  type!: LateFeeTypeValue;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "FIXED: minor units of the School's currency, more than 0. Required to switch a fixed fee on." })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  fixedAmount?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'PERCENT: hundredths of a percent (250 = 2.5%), 1 to 10000. Required to switch a % fee on.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BASIS_POINTS)
  percentBps?: number | null;

  @ApiProperty({ minimum: 0, maximum: LATE_FEE_MAX_GRACE_DAYS })
  @IsInt()
  @Min(0)
  @Max(LATE_FEE_MAX_GRACE_DAYS)
  graceDays!: number;

  @ApiPropertyOptional({ description: '"I confirm late fees are legal where my School operates." Required (true) to switch late fees on, or to save them while on.' })
  @IsOptional()
  @IsBoolean()
  legalConfirmed?: boolean;
}
