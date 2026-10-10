import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';
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
