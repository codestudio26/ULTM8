import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

/** POST /guardians/me/minors/{studentId}/consent body. `tier`/`policyVersion` are
 * both part of ConsentRecord's own confirmed field list (SKILL.md §14). */
export class GrantConsentDto {
  @ApiProperty({ enum: ['BASELINE', 'CAMERA'] })
  @IsEnum(['BASELINE', 'CAMERA'])
  tier!: 'BASELINE' | 'CAMERA';

  @ApiProperty({ description: 'The specific privacy-notice/data-practice description version being consented to.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  policyVersion!: string;
}
