import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * One RankStripeTier, nested inline under CreateRankDto/UpdateRankDto — no
 * separate stripe-tier endpoint is confirmed anywhere in Spec 55's own §7 table
 * (only Rank CRUD itself: "POST/PATCH/DELETE /styles/{id}/ranks/{rankId}"), so
 * stripe tiers are managed as part of the Rank payload, not independently.
 * Field list verified against skills/ultm8-domain-rules/SKILL.md §5 (quoted):
 * "its own count, its own colour, its own classes-required and minimum-days-in-
 * rank thresholds, and its own eligibleClassTypes list."
 */
export class RankStripeTierInputDto {
  @ApiProperty({ description: 'Position within this Rank\'s stripe ladder — must be unique and contiguous (enforced in the service layer, §5).' })
  @IsInt()
  @Min(0)
  order!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  count!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  colour!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  classesRequired?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumDaysInRank?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  eligibleClassTypes?: string[];
}

/**
 * Field list verified against skills/ultm8-domain-rules/SKILL.md §5's confirmed
 * Rank row: "primary belt colour and an optional secondary colour..., a weekly
 * class-count cap, a set of required Skills, and a years-in-rank flag." disciplineId
 * is a route param (`/styles/:disciplineId/ranks`), not a body field.
 *
 * `stripeTiers` requires at least one tier — Spec 55's own examples (§5: "White
 * might have 4 tiers and Blue only 2") never show a zero-tier Rank; StudentRank's
 * own currentStripeId being nullable is a defensive edge-case allowance, not an
 * invitation to actually create Ranks with none.
 */
export class CreateRankDto {
  @ApiProperty({ description: 'Position in the discipline\'s ordered ladder — must be unique and contiguous (enforced in the service layer, §5).' })
  @IsInt()
  @Min(0)
  order!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  primaryColour!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  secondaryColour?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  weeklyClassCountCap?: number;

  @ApiPropertyOptional({ default: false, description: 'Black Belt and above — see the schema\'s own comment on why this is a boolean only, no numeric threshold.' })
  @IsOptional()
  @IsBoolean()
  yearsInRankFlag?: boolean;

  @ApiProperty({ type: [RankStripeTierInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RankStripeTierInputDto)
  stripeTiers!: RankStripeTierInputDto[];

  @ApiPropertyOptional({ type: [String], description: 'Skill ids required at this Rank, alongside classes-required/time-in-rank/stripe requirements.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  requiredSkillIds?: string[];
}
