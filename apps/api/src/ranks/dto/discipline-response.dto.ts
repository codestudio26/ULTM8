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
