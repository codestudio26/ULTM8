import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StudentRankSkillStatusResponseDto {
  @ApiProperty()
  skillId!: string;

  @ApiProperty()
  status!: string;
}

/**
 * GET /students/{id}/ranks and GET /students/{id}/eligibility response — raw
 * StudentRank fields only. Deliberately NO readiness bucket or progress %
 * (Decision 75 — the formula/thresholds are School-configurable with no
 * confirmed configuration schema yet; see StudentRank's own Prisma model
 * comment). A future phase adds those once Decision 75's own follow-up lands.
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
