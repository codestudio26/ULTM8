import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * FOUND DURING BUILD: Spec 55's own confirmed RanksModule endpoint table nests
 * Rank CRUD under `/styles/{id}/ranks`, but never actually names an endpoint for
 * creating the Style/Discipline itself — a real gap, not something to silently
 * work around. CRUD /schools/{id}/disciplines is a Developer-level addition,
 * genuinely necessary for this module to function at all (there's no other way a
 * School gets its first Discipline to hang Ranks off of), flagged the same way
 * TimetableSlot's own template fields were in Phase 5. Field list verified
 * against skills/ultm8-domain-rules/SKILL.md §4 (quoted): "name, class types
 * offered."
 */
export class CreateDisciplineDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: [String], description: 'e.g. "Kids Fundamentals", "Adult Sparring", "Competition Team".' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  classTypesOffered?: string[];
}
