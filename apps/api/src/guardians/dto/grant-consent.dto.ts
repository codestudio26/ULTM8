import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

/** POST /guardians/me/minors/{studentId}/consent body. `tier`/`policyVersion` are
 * both part of ConsentRecord's own confirmed field list (SKILL.md §14). */
export class GrantConsentDto {
  @ApiProperty({ enum: ['BASELINE', 'CAMERA'] })
  @IsEnum(['BASELINE', 'CAMERA'])
  tier!: 'BASELINE' | 'CAMERA';

  @ApiProperty({
    description:
      'The privacy notice version the Guardian was shown, as `privacy-statement@<n>` from GET /legal/privacy-statement. Must be the current version (Decision 171).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  policyVersion!: string;

  @ApiProperty({ description: 'The Guardian declares they hold parental responsibility for this minor. Must be true (Decision 172).' })
  @IsBoolean()
  @Equals(true, { message: 'parentalResponsibilityDeclared must be true: only a Guardian with parental responsibility may consent.' })
  parentalResponsibilityDeclared!: boolean;
}
