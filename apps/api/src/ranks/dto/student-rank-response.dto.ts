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
