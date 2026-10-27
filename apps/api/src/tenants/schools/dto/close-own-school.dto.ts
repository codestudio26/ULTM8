import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Decision 364 — a School Owner closing their own School re-types its name,
 * and proves their passcode through POST /auth/step-up/verify (sent as the
 * X-Step-Up-Token header). */
export class CloseOwnSchoolDto {
  @ApiProperty({ description: "Must exactly match the School's current name." })
  @IsString()
  @MinLength(1)
  confirmName!: string;
}

export class CloseOwnSchoolResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  archivedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the School is deleted for good (90 days after closing).' })
  purgeAt!: Date;
}
