import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsEnum, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { EligibilityResponseDto } from './student-rank-response.dto';

export const BOARD_COLUMNS = ['JUST_STARTING', 'GETTING_THERE', 'READY_TO_GRADE'] as const;
export type BoardColumnValue = (typeof BOARD_COLUMNS)[number];

/** Move a student to a Grading Board column by hand (Decision 128, item 13). */
export class BoardMoveDto {
  @ApiProperty({ enum: BOARD_COLUMNS })
  @IsEnum(BOARD_COLUMNS)
  column!: BoardColumnValue;
}

/** Staff add a class by hand (Decision 128 item 6, Decision 176). */
export class LogClassDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "The class type, one of the next rank's ticked types. Required when the next rank ticks any; may be left out when it ticks none (every class counts).",
  })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(100)
  classType?: string | null;
}

/** The manual Active/Inactive switch for this style (Decisions 152, 176). */
export class BoardActiveDto {
  @ApiProperty({ type: Boolean, nullable: true, description: 'true or false: set by hand. null: follow whether the student has an active membership.' })
  @ValidateIf((o: { active?: unknown }) => o.active !== null)
  @IsBoolean()
  active!: boolean | null;
}

export class GradingBoardItemDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  studentRankId!: string;

  @ApiProperty()
  currentRankId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  currentStripeId!: string | null;

  @ApiProperty({ enum: ['VERIFIED', 'UNVERIFIED'] })
  verificationStatus!: 'VERIFIED' | 'UNVERIFIED';

  @ApiProperty({ description: '"Currently attending": the manual switch when set, otherwise whether the student has an active membership (Decision 152).' })
  active!: boolean;

  @ApiProperty({ enum: ['MANUAL', 'MEMBERSHIP'] })
  activeSource!: 'MANUAL' | 'MEMBERSHIP';

  @ApiProperty()
  hasActiveMembership!: boolean;

  @ApiProperty({ description: 'The style requires skills and some for the next rank are not signed off: grading is blocked (Decision 128, item 10).' })
  hardBlocked!: boolean;

  @ApiProperty({ type: EligibilityResponseDto })
  eligibility!: EligibilityResponseDto;
}

export class GradingBoardResponseDto {
  @ApiProperty({ type: [GradingBoardItemDto], description: 'Students with a next rank in this style, highest progress first.' })
  items!: GradingBoardItemDto[];

  @ApiProperty({ description: 'Students left out by activeOnly.' })
  hiddenInactive!: number;
}

/** Bulk promote (Decision 130): each student moves up one rung, on one date. */
export class BulkPromoteDto {
  @ApiProperty()
  @IsUUID()
  disciplineId!: string;

  @ApiProperty({ type: [String], description: 'Up to 200 students (Spec 55).', maxItems: 200 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  studentIds!: string[];

  @ApiPropertyOptional({ description: 'One grading date for the whole batch, YYYY-MM-DD; it must suit every student (Decision 128, item 8). Default today.', example: '2026-03-01' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'A note for every student\'s history entry, e.g. "Spring Grading Day".' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'The flagged students ("Needs a look": skills not signed off or days short) the coach acknowledges with one tick (Decision 130). Every flagged student must be here or removed from the batch.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  acknowledgedStudentIds?: string[];

  @ApiPropertyOptional({ description: 'Check only: return what would happen, change nothing.' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class BulkPromoteStudentDto {
  @ApiProperty()
  studentId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  fromRungId?: string | null;

  @ApiPropertyOptional()
  toRungId?: string;

  @ApiProperty({ type: [String], description: 'Why this student needs a look, or why they can\'t be promoted.' })
  reasons!: string[];

  @ApiPropertyOptional({ description: 'Set on a promoted student: their history entry.' })
  promotionEventId?: string;
}

export class BulkPromoteResponseDto {
  @ApiProperty({ type: [BulkPromoteStudentDto], description: 'Nothing missing (dry run), or promoted.' })
  ready!: BulkPromoteStudentDto[];

  @ApiProperty({ type: [BulkPromoteStudentDto], description: 'Dry run: promoted only with the acknowledgement. After a real run: empty (they are in `ready`).' })
  needsAcknowledgement!: BulkPromoteStudentDto[];

  @ApiProperty({ type: [BulkPromoteStudentDto], description: 'Skipped: no next rank, blocked by the style\'s "skills required" switch, not yours to grade, or changed at the same time.' })
  cannotPromote!: BulkPromoteStudentDto[];
}

/** A style's Grading Board columns (Decisions 75, 136, 181): Getting There
 * from `gettingThere` %, Ready to Grade from `readyToGrade` %. */
export class BoardThresholdsDto {
  @ApiProperty({ minimum: 1, maximum: 98, example: 33 })
  @IsInt()
  @Min(1)
  @Max(98)
  gettingThere!: number;

  @ApiProperty({ minimum: 2, maximum: 99, example: 66, description: 'Must be above gettingThere.' })
  @IsInt()
  @Min(2)
  @Max(99)
  readyToGrade!: number;
}
