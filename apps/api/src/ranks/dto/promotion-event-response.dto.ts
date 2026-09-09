import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PromotionEventResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentRankId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  performedById!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  fromRankId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  toRankId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  fromStripeTierId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  toStripeTierId!: string | null;

  @ApiProperty()
  acknowledgedWithoutSkillSignoff!: boolean;

  @ApiProperty()
  createdAt!: string;
}

export class PromotionEventListResponseDto {
  @ApiProperty({ type: [PromotionEventResponseDto] })
  items!: PromotionEventResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
