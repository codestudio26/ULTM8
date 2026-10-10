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

  @ApiProperty({ type: [String], description: 'Class types this rung unlocks for booking, for it and every rung above (Decision 173).' })
  bookingUnlocksClassTypes!: string[];

  @ApiProperty({ enum: ['ANY_TYPE', 'EACH_TYPE'], description: 'Which classes count (Decisions 140, 149).' })
  classCountMode!: 'ANY_TYPE' | 'EACH_TYPE';

  @ApiProperty({ description: 'EACH_TYPE: [{ classType, classesRequired }] per ticked type (Decision 149).', type: 'array', items: { type: 'object', properties: { classType: { type: 'string' }, classesRequired: { type: 'integer' } } } })
  classTypeRequirements!: Array<{ classType: string; classesRequired: number }>;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: () => [StripeSegmentResponseDto] })
  stripeSegments!: StripeSegmentResponseDto[];

  @ApiPropertyOptional({ type: Number, nullable: true })
  weeklyClassCountCap!: number | null;

  @ApiProperty()
  timeOnly!: boolean;

  @ApiProperty({ type: [String], description: 'Skills required to be promoted INTO this rung.' })
  requiredSkillIds!: string[];
}

export class StripeSegmentResponseDto {
  @ApiProperty()
  count!: number;

  @ApiProperty()
  colour!: string;
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
  name!: string;

  @ApiProperty()
  primaryColour!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  secondaryColour!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  tagColour!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  coralAccent!: string | null;

  @ApiProperty()
  yearsInRankFlag!: boolean;

  @ApiProperty({ type: [RankStripeTierResponseDto] })
  stripeTiers!: RankStripeTierResponseDto[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class RankListResponseDto {
  @ApiProperty({ type: [RankResponseDto] })
  items!: RankResponseDto[];
}
