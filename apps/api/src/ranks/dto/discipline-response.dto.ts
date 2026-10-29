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
