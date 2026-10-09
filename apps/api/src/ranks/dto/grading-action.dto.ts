import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Shared body for promote/downgrade/stripe-award. `acknowledgeWithoutSkillSignoff`
 * — Spec 55 §5 (quoted): "grading is permitted even when a required skill isn't
 * yet signed off, but only behind an explicit, always-recorded written
 * acknowledgement flag." Required (true) when the target checkpoint has
 * unsigned-off required Skills; the service rejects (400) otherwise rather than
 * silently promoting past a gate with no record of the override.
 *
 * studentId/disciplineId are route params. Promotion always moves to the NEXT
 * Rank in the discipline's ordered ladder (by `order`) from the Student's current
 * one — not a caller-specified target — since Ranks are a strict ordered ladder
 * and "promotion" has no other well-defined meaning within it. This is an
 * inferred reading (Spec 55 doesn't spell out whether the target Rank is
 * caller-specified or ladder-implied) — flagged, not asserted as settled.
 */
export class GradingActionDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  acknowledgeWithoutSkillSignoff?: boolean;

  @ApiPropertyOptional({ description: 'The grader\'s own note on this history entry (Decision 128, item 11).' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Downgrade: a written reason is required (Decision 128, item 11). */
export class DowngradeActionDto extends GradingActionDto {
  @ApiProperty({ description: 'Why the student is being moved down. Required.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'reason must contain text' })
  @MaxLength(1000)
  reason!: string;
}

/** Void a history entry: hidden from the normal history, never deleted, and the
 * student's current rank is unchanged (Decision 129). */
export class VoidPromotionEventDto {
  @ApiProperty({ description: 'Why this entry is being voided. Required.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'reason must contain text' })
  @MaxLength(1000)
  reason!: string;
}

/** Correct the date a student reached their current rung (Decisions 153, 166). */
export class EditRankDateDto {
  @ApiProperty({ description: 'The corrected date, as YYYY-MM-DD. Not in the future, and not before the student\'s previous grading on their history (Decision 166).', example: '2026-03-01' })
  @IsISO8601({ strict: true })
  @MaxLength(10)
  date!: string;

  @ApiPropertyOptional({ description: 'An optional note for the history entry.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
