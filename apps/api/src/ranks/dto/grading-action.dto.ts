import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

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
}
