import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GenderField, type Gender } from '../../common/decorators/gender-field.decorator';
import { IsBirthDate } from '../../common/decorators/is-birth-date.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * POST /guardians/me/minors body. SKILL.md §14's own parenthetical for a linked
 * minor Student profile is "(name, DOB, rank)" — `rank` is deliberately NOT an
 * input field here: it's StudentRank data populated later by Staff grading
 * actions (RanksModule, Phase 10b), not something a Guardian supplies at
 * creation. Only the two genuinely creation-time fields are accepted, plus
 * `gender` (optional, matches the base User field's own optionality elsewhere in
 * this schema).
 *
 * Decision 429 item 3 (FAM-3): the same rules as the owner's Add a child
 * (ChildDetailsDto, Decision 341): names trimmed, not blank, at most 100
 * characters; a real date of birth (no 30 February, not in the future, not
 * over 120 years ago). GuardiansService.createMinor refuses an adult.
 */
export class CreateMinorDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "First name can't be blank." })
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "Surname can't be blank." })
  @MaxLength(100)
  surname!: string;

  @ApiProperty({ description: 'YYYY-MM-DD. The child must be under 18.' })
  @IsDateString()
  @IsBirthDate()
  dateOfBirth!: string;

  @GenderField()
  gender?: Gender | null;

  @ApiPropertyOptional({
    description:
      "Decision 429 item 9: the version of the privacy notice the parent agreed to when they ticked consent while adding the child. Records BASELINE consent; without it the child is 'consent pending' (no booking or check-in) until a parent gives it.",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  consentPolicyVersion?: string;
}
