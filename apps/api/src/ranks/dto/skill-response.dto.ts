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

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class SkillListResponseDto {
  @ApiProperty({ type: [SkillResponseDto] })
  items!: SkillResponseDto[];
}
