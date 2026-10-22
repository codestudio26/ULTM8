import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Decision 291 — POST /classes/{id}/cancel. */
export class CancelClassDto {
  @ApiPropertyOptional({ description: 'Shown to every booked or waitlisted student, e.g. "Coach is ill".' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
