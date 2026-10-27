import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SkillResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'Position in the style\'s skill list, 0 first (Decision 309).' })
  order!: number;

  @ApiProperty({ description: 'Lessons that teach this skill (Decision 309).' })
  lessonCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class SkillListResponseDto {
  @ApiProperty({ type: [SkillResponseDto] })
  items!: SkillResponseDto[];
}
