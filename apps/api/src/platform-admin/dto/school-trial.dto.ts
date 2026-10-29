import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/** Backlog 3.14: how many days to start, or to add to, a School's free trial. */
export class SchoolTrialDaysDto {
  @ApiProperty({ minimum: 1, maximum: 365, description: 'Days. Start: the trial ends this many days from now. Extend: added to the current end (or to now, if it has ended).' })
  @IsInt()
  @Min(1)
  @Max(365)
  days!: number;
}

export class SchoolTrialResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  platformTrialStartedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  platformTrialEndsAt!: Date;
}
