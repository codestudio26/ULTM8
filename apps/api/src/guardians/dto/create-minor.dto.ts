import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';
import { GenderField, type Gender } from '../../common/decorators/gender-field.decorator';

/**
 * POST /guardians/me/minors body. SKILL.md §14's own parenthetical for a linked
 * minor Student profile is "(name, DOB, rank)" — `rank` is deliberately NOT an
 * input field here: it's StudentRank data populated later by Staff grading
 * actions (RanksModule, Phase 10b), not something a Guardian supplies at
 * creation. Only the two genuinely creation-time fields are accepted, plus
 * `gender` (optional, matches the base User field's own optionality elsewhere in
 * this schema).
 */
export class CreateMinorDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  surname!: string;

  @ApiProperty({ description: 'ISO 8601 date, no time component.' })
  @IsDateString()
  dateOfBirth!: string;

  @GenderField()
  gender?: Gender | null;
}
