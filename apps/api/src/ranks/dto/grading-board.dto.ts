import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsEnum, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
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

  /** Hours trained (Decisions 301 item 5, 306): a record only, never part of
   * the grading %. Send `classId` OR `minutes`, not both. */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The class the student trained in, for hours trained: its scheduled length is logged. A class at this School that lists this style. Leave out to send `minutes` instead.',
  })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null)
  @IsUUID()
  classId?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 600,
    description: 'Minutes trained, for hours trained, when no class is picked. Default 60. Hours never change the grading %.',
  })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(600)
  minutes?: number | null;
}

/** "Open mat counts toward hours" (Grading → Settings; Decisions 301 item 6, 306). */
export class OpenMatHoursSettingDto {
  @ApiProperty({ description: 'When off (the default), open mat time is recorded but not added to students\' hours trained. Hours never change the grading %.' })
  @IsBoolean()
  openMatCountsTowardHours!: boolean;
}

/** The manual Active/Inactive switch for this style (Decisions 152, 176). */
export class BoardActiveDto {
  @ApiProperty({ type: Boolean, nullable: true, description: 'true or false: set by hand. null: follow whether the student has an active membership.' })
  @ValidateIf((o: { active?: unknown }) => o.active !== null)
  @IsBoolean()
  active!: boolean | null;
}

/** The promotion fee shown on a board card (Decisions 300, 307). */
export class BoardFeeRequestDto {
  @ApiProperty({ description: 'The fee request (use it to waive or cancel, or to dismiss a "to decide").' })
  id!: string;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'PAID', 'DECLINED', 'WAIVED', 'CANCELLED'] })
  status!: 'PENDING' | 'ACCEPTED' | 'PAID' | 'DECLINED' | 'WAIVED' | 'CANCELLED';

  @ApiProperty({ description: 'The rung the grade moves the student to. For "to decide", the planned grade the Promote window starts on.' })
  toRungId!: string;

  @ApiProperty()
  toRungName!: string;

  @ApiProperty({ description: 'Minor units of `currency`.' })
  amountMinor!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The School\'s currency when the request was made.' })
  currency!: string | null;

  @ApiProperty({ description: 'The promotion has already applied ("Allow grading before the fee is paid" was on).' })
  promotionApplied!: boolean;

  @ApiProperty({ description: '"To decide" only: promoting to toRungId makes no new fee request (Decision 307).' })
  feeFree!: boolean;
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

  @ApiProperty({
    description:
      'Owner only: the School has branches and this student has no home branch yet, so no branch coach sees them. The board shows them under "No branch" until the owner assigns one (Decision 148.2). Always false for other staff.',
  })
  noHomeBranch!: boolean;

  @ApiPropertyOptional({
    enum: ['waiting', 'declined', 'toDecide'],
    nullable: true,
    description:
      'Promotion fee (Decisions 300, 307): "waiting" — the promotion waits for its fee ("Waiting for fee"); "declined" — the fee was declined ("Fee declined"); "toDecide" — the owner waived or cancelled the fee and a coach decides whether to promote. Null otherwise.',
  })
  feeStatus!: 'waiting' | 'declined' | 'toDecide' | null;

  @ApiPropertyOptional({ type: BoardFeeRequestDto, nullable: true, description: 'The request behind feeStatus.' })
  feeRequest!: BoardFeeRequestDto | null;

  @ApiProperty({ description: 'Backlog 3.20: on a Kids style, the student has reached "Ready for Adult from age" ("Ready for Adult program" tag). Always false on other styles.' })
  readyForAdult!: boolean;
}

export class GradingBoardResponseDto {
  @ApiProperty({ type: [GradingBoardItemDto], description: 'Students with a next rank in this style, highest progress first.' })
  items!: GradingBoardItemDto[];

  @ApiProperty({ description: 'Students left out by activeOnly.' })
  hiddenInactive!: number;

  @ApiProperty({ description: 'Students on the top rank of this style (shown as a count, not as cards: there is no next rank to work toward). Follows the same search and active filters as items.' })
  atTopRank!: number;
}

/** The rung a student was on when the batch was checked (Decision 284). */
export class BulkExpectedRungDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiProperty({ description: 'The student\'s rung in the dry run (its fromRungId).' })
  @IsUUID()
  rungId!: string;
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

  @ApiPropertyOptional({
    type: () => [BulkExpectedRungDto],
    description:
      'Each student\'s rung from the dry run (Decision 284). A listed student who is no longer on it is skipped, not promoted again, so a batch can be sent again safely after a failure.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkExpectedRungDto)
  expected?: BulkExpectedRungDto[];
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

  @ApiPropertyOptional({ description: 'Set when the grade made a promotion fee request (Decision 300 item 6: one per student).' })
  feeRequestId?: string;
}

export class BulkPromoteResponseDto {
  @ApiProperty({ type: [BulkPromoteStudentDto], description: 'Nothing missing (dry run), or promoted.' })
  ready!: BulkPromoteStudentDto[];

  @ApiProperty({ type: [BulkPromoteStudentDto], description: 'Dry run: promoted only with the acknowledgement. After a real run: empty (they are in `ready`).' })
  needsAcknowledgement!: BulkPromoteStudentDto[];

  @ApiProperty({ type: [BulkPromoteStudentDto], description: 'Skipped: no next rank, blocked by the style\'s "skills required" switch, not yours to grade, changed at the same time, or a promotion already waiting for its fee.' })
  cannotPromote!: BulkPromoteStudentDto[];

  // Optional in the schema so existing portal callers keep compiling; the API always sends it.
  @ApiPropertyOptional({
    type: [BulkPromoteStudentDto],
    description: 'Not promoted yet: their grade is priced and "Allow grading before the fee is paid" is off, so each waits for their fee request (feeRequestId) to be paid or waived (Decision 300). Always sent; empty on a dry run.',
  })
  waitingForFee?: BulkPromoteStudentDto[];
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
