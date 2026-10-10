import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateRankDto } from './create-rank.dto';

const NULLABLE_ON_UPDATE = ['secondaryColour', 'tagColour', 'coralAccent'] as const;

/**
 * If `stripeTiers` is provided, it REPLACES the Rank's entire existing set (not
 * a deep merge of individual tiers) — matches this codebase's own PATCH
 * convention elsewhere (a provided field overwrites as-is).
 *
 * FOUND PROACTIVELY (Phase 21, same fix already applied to every other
 * Update DTO with a directly-forwarded nullable field this session —
 * see UpdateBranchDto's own header comment for the full reasoning):
 * RanksService.updateRank()'s Prisma call forwards `dto.secondaryColour`
 * straight through with no ternary, and it is a nullable column on the Rank
 * model.
 *
 * Deliberately NOT widened: `order` (RanksService.updateRank()'s own
 * `assertContiguousOrder` re-validates it against this Rank's siblings —
 * whose own orders are NOT simultaneously updated — so the only value that
 * can ever pass is the Rank's own current order; there's no working
 * "reorder" path through this endpoint at all today, only a no-op "send
 * back what it already was." Not something a null-widening on this field
 * could fix — flagged as a real, separate backend gap, not silently
 * presented as reorderable), `primaryColour` (required,
 * nothing to clear), or `stripeTiers` (a whole-
 * array-replace field — an empty array `[]` already unambiguously means
 * "none," so there's no null-vs-undefined ambiguity for these to begin
 * with, the same reasoning already established for Class.activities/
 * Instructor.specializations).
 */
export class UpdateRankDto extends PartialType(OmitType(CreateRankDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  secondaryColour?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tagColour?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  coralAccent?: string | null;
}
