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

  @ApiProperty({ description: 'PROMOTION, DOWNGRADE, STRIPE_AWARD, BULK_PROMOTION, BULK_STRIPE_AWARD, or ADJUSTMENT (a correction; the rank does not change).' })
  type!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Who graded. Empty when that account has been deleted: show "Former instructor" (Decision 141).' })
  performedById!: string | null;

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

  @ApiProperty({ description: 'The grading date shown on the history; may be earlier than createdAt (Decision 128, item 8).' })
  effectiveDate!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Downgrade reason (Decision 128, item 11).' })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Note written by the system, e.g. a rank-date correction.' })
  systemNote!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'The grader\'s own note.' })
  note!: string | null;

  @ApiProperty({ description: 'Rungs skipped by this grade (Decision 128, item 7).' })
  rungsSkipped!: number;

  @ApiProperty({ type: Number, nullable: true, description: '"Starting classes" entered when grading (Decision 128, item 9).' })
  startingClasses!: number | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'number' },
    nullable: true,
    description: 'Starting classes per type, when the new next rung counts each type separately (Decision 174).',
  })
  startingClassesByType!: Record<string, number> | null;

  @ApiProperty({ type: String, nullable: true, description: 'Set when the entry has been voided (Decision 129).' })
  voidedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  voidedById!: string | null;

  @ApiProperty({ type: String, nullable: true })
  voidReason!: string | null;

  @ApiProperty({ description: 'When the entry was written (audit timestamp).' })
  createdAt!: string;
}

export class PromotionEventListResponseDto {
  @ApiProperty({ type: [PromotionEventResponseDto] })
  items!: PromotionEventResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
