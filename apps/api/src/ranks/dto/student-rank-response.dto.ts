import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StudentRankSkillStatusResponseDto {
  @ApiProperty()
  skillId!: string;

  @ApiProperty()
  status!: string;
}

/**
 * GET /students/{id}/ranks response — raw StudentRank fields. GET
 * /students/{id}/eligibility returns the same plus `eligibility` (below).
 */
export class StudentRankResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  currentRankId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  currentStripeId!: string | null;

  @ApiProperty()
  dateOfCurrentRank!: string;

  @ApiProperty()
  classesAttendedTowardCheckpoint!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Classes counted toward the next rung, per class type, e.g. {"Fundamentals": 18, "Sparring": 4} (Decisions 149, 171).',
  })
  classesAttendedByType!: Record<string, number>;

  @ApiProperty({ description: 'When counting toward the current rung began: the moment of the last rank change.' })
  countingSince!: string;

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'Grading Board Active/Inactive switch for this style; null follows membership (Decisions 152, 176).' })
  boardActiveOverride!: boolean | null;

  @ApiProperty({ enum: ['VERIFIED', 'UNVERIFIED'], description: 'UNVERIFIED: self-declared and waiting for staff (Decisions 137, 147).' })
  verificationStatus!: 'VERIFIED' | 'UNVERIFIED';

  @ApiPropertyOptional({ type: String, nullable: true })
  verifiedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Empty when verified automatically (the first rung) or the verifier\'s account was deleted.' })
  verifiedById!: string | null;

  @ApiProperty({ type: [StudentRankSkillStatusResponseDto] })
  skillStatuses!: StudentRankSkillStatusResponseDto[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class StudentRankListResponseDto {
  @ApiProperty({ type: [StudentRankResponseDto] })
  items!: StudentRankResponseDto[];
}

export class TypeProgressResponseDto {
  @ApiProperty()
  classType!: string;

  @ApiProperty()
  required!: number;

  @ApiProperty()
  counted!: number;
}

/** Readiness for the next rung, from the grading engine (roadmap Phase 2c).
 * With `hasNext` false only `hasNext` and `dataError` are set: the top of the
 * ladder, or (dataError) a rung that can't be found. */
export class EligibilityResponseDto {
  @ApiProperty()
  hasNext!: boolean;

  @ApiPropertyOptional({ description: 'The student\'s rung could not be found on the ladder (bad data), as opposed to the top of the ladder.' })
  dataError?: boolean;

  @ApiPropertyOptional({ description: 'The next rung (stripe tier id).' })
  nextRungId?: string;

  @ApiPropertyOptional({ description: 'The current rung is time-only: days are the only gate (Decision 128, item 3).' })
  timeOnly?: boolean;

  @ApiPropertyOptional()
  elapsedDays?: number;

  @ApiPropertyOptional()
  requiredDays?: number;

  @ApiPropertyOptional()
  requiredClasses?: number;

  @ApiPropertyOptional()
  countedClasses?: number;

  @ApiPropertyOptional({ type: [TypeProgressResponseDto], description: '"Each ticked type required" rungs only (Decision 149).' })
  byType?: TypeProgressResponseDto[];

  @ApiPropertyOptional()
  classesOk?: boolean;

  @ApiPropertyOptional()
  daysOk?: boolean;

  @ApiPropertyOptional()
  skillsOk?: boolean;

  @ApiPropertyOptional({ description: 'Classes, days and skills all met.' })
  eligible?: boolean;

  @ApiPropertyOptional({ type: [String] })
  requiredSkillIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Shown but optional: the next rung\'s skills when the current rung is time-only.' })
  optionalSkillIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  missingSkillIds?: string[];

  @ApiPropertyOptional({ description: '0–100: classes (days for a time-only rung). Skills and minimum days are not part of it (Decision 136).' })
  progressPercent?: number;

  @ApiPropertyOptional({ enum: ['JUST_STARTING', 'GETTING_THERE', 'READY_TO_GRADE'], description: 'Grading Board column at the default 33% / 66% (Decision 136).' })
  boardColumn?: 'JUST_STARTING' | 'GETTING_THERE' | 'READY_TO_GRADE';
}

export class StudentEligibilityResponseDto extends StudentRankResponseDto {
  @ApiProperty({ type: EligibilityResponseDto })
  eligibility!: EligibilityResponseDto;
}

export class StudentEligibilityListResponseDto {
  @ApiProperty({ type: [StudentEligibilityResponseDto] })
  items!: StudentEligibilityResponseDto[];
}

/** A self-declared belt waiting to be verified (Decisions 137, 189). */
export class PendingVerificationDto {
  @ApiProperty()
  studentRankId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  disciplineName!: string;

  @ApiProperty()
  currentRankId!: string;

  @ApiProperty({ type: String, nullable: true })
  currentStripeId!: string | null;

  @ApiProperty({ enum: ['UNVERIFIED'] })
  verificationStatus!: 'UNVERIFIED';

  @ApiProperty({ description: 'When the student declared it.' })
  declaredAt!: Date;
}

export class PendingVerificationListResponseDto {
  @ApiProperty({ type: [PendingVerificationDto] })
  items!: PendingVerificationDto[];
}
