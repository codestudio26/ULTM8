import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Field list verified against skills/ultm8-domain-rules/SKILL.md §5's confirmed
 * Skill row: "name, description." disciplineId is a route param. */
export class CreateSkillDto {
  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
