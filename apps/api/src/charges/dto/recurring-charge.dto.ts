import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { MAX_CHARGE_MINOR } from '../charge-maths';
import { MAX_RECURRING_OCCURRENCES, RECURRING_FREQUENCIES, type RecurringFrequency } from '../recurring-schedule';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const present = (_o: unknown, v: unknown) => v !== null && v !== undefined;

export const RECURRING_CHARGE_STATUSES = ['ACTIVE', 'STOPPED', 'ENDED'] as const;
export type RecurringChargeStatus = (typeof RECURRING_CHARGE_STATUSES)[number];

/** POST /schools/{schoolId}/students/{studentId}/recurring-charges (Decision 412). */
export class CreateRecurringChargeDto {
  @ApiProperty({ maxLength: 200, example: 'Private lesson' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @ApiProperty({ description: "The price of each charge in minor units of the School's currency, as the School prices (with or without tax).", minimum: 1, maximum: MAX_CHARGE_MINOR })
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  amount!: number;

  @ApiPropertyOptional({ enum: ['PERCENT', 'FIXED'], nullable: true })
  @ValidateIf(present)
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED' | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'PERCENT: hundredths of a percent (1250 = 12.5%). FIXED: minor units. Required with discountType.' })
  @ValidateIf((o: CreateRecurringChargeDto) => !!o.discountType)
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  discountValue?: number | null;

  @ApiProperty({ enum: RECURRING_FREQUENCIES, enumName: 'RecurringChargeFrequency' })
  @IsIn(RECURRING_FREQUENCIES)
  frequency!: RecurringFrequency;

  @ApiProperty({ example: '2026-11-15', description: "The first charge's date (YYYY-MM-DD), today or later in the School's time zone. Each charge is due on its own date." })
  @Matches(DAY, { message: 'firstDate must be a date like 2026-11-15.' })
  @IsISO8601({ strict: true }, { message: 'firstDate must be a date like 2026-11-15.' })
  firstDate!: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: '2027-06-30', description: 'Optional: no charge after this day. Not with maxOccurrences.' })
  @ValidateIf(present)
  @Matches(DAY, { message: 'endDate must be a date like 2026-11-15.' })
  @IsISO8601({ strict: true }, { message: 'endDate must be a date like 2026-11-15.' })
  endDate?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 1, maximum: MAX_RECURRING_OCCURRENCES, description: 'Optional: the number of payments. Not with endDate. Neither: until stopped.' })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(MAX_RECURRING_OCCURRENCES)
  maxOccurrences?: number | null;

  @ApiPropertyOptional({ default: false, description: '"No tax on this item (0% or exempt)" (Decision 414 item 5): every charge of the series is made with no tax. Off by default.' })
  @IsOptional()
  @IsBoolean()
  taxExempt?: boolean;
}

export class RecurringChargeEstimateDto {
  @ApiProperty({ description: 'Price ex. tax of each charge at the School tax rate today. Each charge uses the rate on its own day.' })
  netAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty({ description: 'Price inc. tax of each charge at the School tax rate today.' })
  grossAmount!: number;

  @ApiProperty({ description: 'The School tax rate today, hundredths of a percent; 0 for a series with no tax.' })
  taxRateBasisPoints!: number;
}

export class RecurringChargeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: 'The price as typed, before the discount.' })
  unitAmount!: number;

  @ApiPropertyOptional({ enum: ['PERCENT', 'FIXED'], nullable: true })
  discountType!: 'PERCENT' | 'FIXED' | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  discountValue!: number | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: '"No tax on this item (0% or exempt)" (Decision 414 item 5): each charge is made with no tax.' })
  taxExempt!: boolean;

  @ApiProperty({ enum: RECURRING_FREQUENCIES, enumName: 'RecurringChargeFrequency' })
  frequency!: RecurringFrequency;

  @ApiProperty({ example: '2026-11-15' })
  firstDate!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  endDate!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The number of payments, when the series has one.' })
  maxOccurrences!: number | null;

  @ApiProperty({ description: 'Charges made so far.' })
  createdCount!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The next charge date; null once stopped or ended.' })
  nextDate!: string | null;

  @ApiProperty({ enum: RECURRING_CHARGE_STATUSES, enumName: 'RecurringChargeStatus', description: 'ACTIVE; STOPPED (by staff, or because the student left); ENDED (its end date passed or all its payments were made).' })
  status!: RecurringChargeStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  stoppedAt!: string | null;

  @ApiPropertyOptional({ enum: ['STAFF', 'STUDENT_LEFT'], enumName: 'RecurringChargeStopReason', nullable: true })
  stoppedReason!: 'STAFF' | 'STUDENT_LEFT' | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  stoppedByName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  createdByName!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: RecurringChargeEstimateDto })
  estimate!: RecurringChargeEstimateDto;
}

export class RecurringChargeAbilitiesDto {
  @ApiProperty({ description: 'Set up a recurring charge: the owner and staff with "Can create charges".' })
  create!: boolean;

  @ApiProperty({ description: 'Stop one: the same people.' })
  stop!: boolean;

  @ApiProperty({ description: 'Restart a stopped one: the owner and staff with access to payments (Decision 338 item 2).' })
  restart!: boolean;
}

/** GET /schools/{schoolId}/students/{studentId}/recurring-charges. */
export class StudentRecurringChargesResponseDto {
  @ApiProperty({ type: [RecurringChargeResponseDto], description: 'Active first (next date first), then stopped, then ended.' })
  items!: RecurringChargeResponseDto[];

  @ApiProperty({ type: RecurringChargeAbilitiesDto })
  can!: RecurringChargeAbilitiesDto;
}

export class MemberRecurringChargeDto extends RecurringChargeResponseDto {
  @ApiProperty()
  schoolName!: string;
}

/** GET /students/{id}/recurring-charges: the member's (or Guardian's) view. */
export class MemberRecurringChargesResponseDto {
  @ApiProperty({ type: [MemberRecurringChargeDto] })
  items!: MemberRecurringChargeDto[];
}
