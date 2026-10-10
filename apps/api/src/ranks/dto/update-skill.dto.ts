import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateSkillDto } from './create-skill.dto';

/**
 * FOUND PROACTIVELY (Phase 20, mirroring the identical fix already applied to
 * Class/Instructor/TimetableSlot/MembershipPlan/Branch/School — see
 * UpdateBranchDto's own header comment for the full reasoning): RanksService.
 * updateSkill()'s Prisma call already forwards `dto.description` straight
 * through as `data.description` with no ternary, and it's a nullable
 * `String?` column on the Skill model — so an explicit `null` already clears
 * it and `undefined` already leaves it unchanged. Widened here before this
 * phase's own Skill edit form needed it, rather than waiting to rediscover
 * the gap via review a sixth time.
 *
 * Deliberately NOT widened: `name` (required — nothing to "clear").
 */
export class UpdateSkillDto extends PartialType(OmitType(CreateSkillDto, ['description'] as const)) {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}
