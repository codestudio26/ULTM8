import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

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
 *
 * Decision 308: the name is trimmed and can't be blank; class types are
 * trimmed, blanks dropped and repeats (any capitals) merged by the service.
 */
export class CreateDisciplineDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'name must not be blank' })
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: [String], description: 'e.g. "Kids Fundamentals", "Adult Sparring", "Competition Team".' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  classTypesOffered?: string[];

  // No `default:` in the Swagger metadata, so existing callers that don't send
  // it stay valid in the generated client.
  @ApiPropertyOptional({
    description: '"Skills required" switch (Decision 128, item 10). Off: grading with required skills not signed off needs a written acknowledgement. On: it is blocked. When omitted: off on a new style; kept on an existing one.',
  })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  skillsRequiredToGrade?: boolean;
}
