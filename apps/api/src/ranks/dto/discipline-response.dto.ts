import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DisciplineResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  classTypesOffered!: string[];

  @ApiProperty({ description: '"Skills required" switch (Decision 128, item 10).' })
  skillsRequiredToGrade!: boolean;

  @ApiProperty({ description: 'Grading Board: "Getting There" from this % (Decisions 75, 136). Default 33.' })
  boardGettingThere!: number;

  @ApiProperty({ description: 'Grading Board: "Ready to Grade" from this % (Decisions 75, 136). Default 66.' })
  boardReadyToGrade!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Archived (retired) at (Decision 309); null while in use.' })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'On a Kids style: its Adult style (backlog 3.20, Decision 281). Null otherwise.' })
  adultDisciplineId!: string | null;

  @ApiProperty({ description: 'On a Kids style: "Ready for Adult from age" (Decision 285 item 2). Default 16.' })
  readyForAdultAge!: number;

  @ApiProperty({ enum: ['BELTS', 'LEVELS'], description: 'Ranks shown as Belts or as Levels (no belt), Decision 290.' })
  rankDisplay!: 'BELTS' | 'LEVELS';

  @ApiProperty({ description: 'Requirement tick box: classes count toward the next rank (Decision 321). Default on.' })
  requireClasses!: boolean;

  @ApiProperty({ description: 'Requirement tick box: days in rank (Decision 321). Default on.' })
  requireDaysInRank!: boolean;

  @ApiProperty({ description: 'Requirement tick box: skills (Decision 321). Default on.' })
  requireSkills!: boolean;

  @ApiProperty({ description: 'Requirement tick box: hours trained (Decision 321). Default off.' })
  requireHours!: boolean;

  @ApiProperty({ description: 'Requirement tick box: different days attended (Decision 321). Default off.' })
  requireDaysAttended!: boolean;

  @ApiProperty({ description: 'Requirement tick box: minimum age (Decision 321). Default off.' })
  requireMinimumAge!: boolean;

  @ApiProperty({ enum: ['MANUAL', 'AUTO_STRIPES', 'AUTO_ALL'], description: 'Automatic promotion (Decision 321): MANUAL (the default), AUTO_STRIPES or AUTO_ALL.' })
  promotionMode!: 'MANUAL' | 'AUTO_STRIPES' | 'AUTO_ALL';

  @ApiProperty({ description: '"Auto-assign first belt" (Decision 321): the first rung on the first check-in to a class of the style. Default off.' })
  autoAssignFirstRank!: boolean;

  @ApiProperty({ description: 'Students with a rank in this style (Decision 309).' })
  studentCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DisciplineListResponseDto {
  @ApiProperty({ type: [DisciplineResponseDto] })
  items!: DisciplineResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
