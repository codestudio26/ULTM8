import { PartialType } from '@nestjs/swagger';
import { CreateRankDto } from './create-rank.dto';

/** If `stripeTiers` is provided, it REPLACES the Rank's entire existing set (not
 * a deep merge of individual tiers) — matches this codebase's own PATCH
 * convention elsewhere (a provided field overwrites as-is). */
export class UpdateRankDto extends PartialType(CreateRankDto) {}
