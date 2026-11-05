import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, Matches, Max, Min, ValidateIf } from 'class-validator';
import { PAYROLL_PRESETS, type PayrollPreset } from '../payroll-maths';

/** The highest rate accepted, in minor units (1,000,000.00): a typo guard. */
export const MAX_PAY_RATE = 100_000_000;

/** PUT /schools/{schoolId}/payroll/rates/{userId} (Decision 320 item 4). Both
 * rates are sent; null is blank. Both null removes the person from payroll. */
export class SetPayRateDto {
  @ApiProperty({ type: Number, nullable: true, description: "Hourly rate, in the School's currency, minor units. Null: blank." })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_PAY_RATE)
  hourlyRate!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: "Per-class rate, in the School's currency, minor units. Null: blank." })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_PAY_RATE)
  perClassRate!: number | null;
}

export class PayRateRowDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ description: "The School's name for the person (Decision 381), else their account's name." })
  name!: string;

  @ApiProperty({ type: [String], description: 'Their live staff roles at the School. Empty: no longer on the staff (their rates are kept for the classes they taught).' })
  roles!: string[];

  @ApiProperty({ type: Number, nullable: true })
  hourlyRate!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  perClassRate!: number | null;
}

/** GET /schools/{schoolId}/payroll/rates: everyone on the staff, and anyone
 * who has left but still has a rate. */
export class PayRatesResponseDto {
  @ApiProperty({ type: String, nullable: true, description: "The School's currency; null until it is set on the School page." })
  currency!: string | null;

  @ApiProperty({ type: [PayRateRowDto] })
  items!: PayRateRowDto[];
}

/** GET /schools/{schoolId}/payroll/report query. */
export class PayrollReportQueryDto {
  @ApiPropertyOptional({ enum: PAYROLL_PRESETS, default: 'LAST_30_DAYS', description: 'A preset range in the School\'s time zone, or CUSTOM with from and to.' })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(PAYROLL_PRESETS)
  preset?: PayrollPreset;

  @ApiPropertyOptional({ description: 'CUSTOM only: the first date, YYYY-MM-DD.' })
  @ValidateIf((o: PayrollReportQueryDto) => o.preset === 'CUSTOM')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be in YYYY-MM-DD format.' })
  from?: string;

  @ApiPropertyOptional({ description: 'CUSTOM only: the last date, YYYY-MM-DD.' })
  @ValidateIf((o: PayrollReportQueryDto) => o.preset === 'CUSTOM')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be in YYYY-MM-DD format.' })
  to?: string;
}

export class PayrollRowDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'False when the person is no longer on the staff.' })
  onStaff!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  hourlyRate!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  perClassRate!: number | null;

  @ApiProperty({ description: 'Classes they taught in the range.' })
  classesTaught!: number;

  @ApiProperty({ description: 'The length of those classes, in minutes.' })
  minutesTaught!: number;

  @ApiProperty({ description: 'hours × hourly rate + classes × per-class rate, minor units.' })
  pay!: number;
}

export class PayrollReportResponseDto {
  @ApiProperty({ enum: PAYROLL_PRESETS })
  preset!: PayrollPreset;

  @ApiProperty({ description: 'First date covered, YYYY-MM-DD.' })
  from!: string;

  @ApiProperty({ description: 'Last date covered, YYYY-MM-DD.' })
  to!: string;

  @ApiProperty({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty({ type: [PayrollRowDto], description: 'Everyone with a rate, by name.' })
  rows!: PayrollRowDto[];

  @ApiProperty()
  totalClasses!: number;

  @ApiProperty()
  totalMinutes!: number;

  @ApiProperty()
  totalPay!: number;
}
