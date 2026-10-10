import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Upper bound on any starting class number (input sanity, not a grading rule). */
export const MAX_STARTING_CLASSES = 10_000;

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

  @ApiPropertyOptional({
    description: 'The rung (stripe tier id) to move to. Promote: any higher rung, so rungs can be skipped (Decision 128, item 7); default the next rung. Downgrade: any lower rung; default the rung just below (Decision 185). Not used by stripe award.',
  })
  @IsOptional()
  @IsUUID()
  targetRungId?: string;

  @ApiPropertyOptional({
    description:
      'The rung (stripe tier id) the student is on as the grader sees it, or null for no rank yet. When sent, the change is refused (409) if the student has moved since, so two coaches can\'t both grade the same step (Decision 185).',
    nullable: true,
    type: String,
  })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null)
  @IsUUID()
  expectedCurrentRungId?: string | null;

  @ApiPropertyOptional({
    description: 'Back-dated grading date, YYYY-MM-DD in the student\'s local time: not in the future, not before the current rank date (Decision 128, item 8). Default today. Promote and stripe award only.',
    example: '2026-03-01',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Starting classes toward the new next rung (Decision 128, item 9), when it counts any ticked type. Promote and stripe award only.', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STARTING_CLASSES)
  startingClasses?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 0 },
    description: 'Starting classes per type, when the new next rung counts each type separately (Decision 174), e.g. {"Fundamentals": 5, "Sparring": 2}.',
  })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsObject()
  startingClassesByType?: Record<string, number>;
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

/** A student's own current rung, declared when joining (Decision 137). */
export class DeclareRankDto {
  @ApiProperty({ description: 'The belt (Rank) of this style.' })
  @IsUUID()
  rankId!: string;

  @ApiProperty({ description: 'The rung (stripe tier) of that belt.' })
  @IsUUID()
  stripeTierId!: string;
}

/** Verify a self-declared rank, optionally correcting it to the right rung
 * (Decision 147). Send rankId and stripeTierId together to correct it. */
export class VerifyRankDto {
  @ApiPropertyOptional({ description: 'To correct the rank: the right belt. Send with stripeTierId.' })
  @IsOptional()
  @IsUUID()
  rankId?: string;

  @ApiPropertyOptional({ description: 'To correct the rank: the right rung of that belt. Send with rankId.' })
  @IsOptional()
  @IsUUID()
  stripeTierId?: string;

  @ApiPropertyOptional({ description: 'An optional note for the history.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
