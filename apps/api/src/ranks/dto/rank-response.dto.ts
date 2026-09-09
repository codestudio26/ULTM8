import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RankStripeTierResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  order!: number;

  @ApiProperty()
  count!: number;

  @ApiProperty()
  colour!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  classesRequired!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  minimumDaysInRank!: number | null;

  @ApiProperty({ type: [String] })
  eligibleClassTypes!: string[];
}

export class RankResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  order!: number;

  @ApiProperty()
  primaryColour!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  secondaryColour!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  weeklyClassCountCap!: number | null;

  @ApiProperty()
  yearsInRankFlag!: boolean;

  @ApiProperty({ type: [RankStripeTierResponseDto] })
  stripeTiers!: RankStripeTierResponseDto[];

  @ApiProperty({ type: [String], description: 'Required Skill ids.' })
  requiredSkillIds!: string[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class RankListResponseDto {
  @ApiProperty({ type: [RankResponseDto] })
  items!: RankResponseDto[];
}
