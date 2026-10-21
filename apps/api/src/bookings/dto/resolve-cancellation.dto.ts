import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/** Decision 279 — what staff decide for one seat in the "to resolve" list. */
export enum ResolveCancellationAction {
  REFUND = 'REFUND',
  CREDIT = 'CREDIT',
  KEEP = 'KEEP',
  MARK_PAID = 'MARK_PAID',
}

export class ResolveCancellationDto {
  @ApiProperty({ enum: ResolveCancellationAction, description: 'REFUND and MARK_PAID are School Owner/Manager only.' })
  @IsEnum(ResolveCancellationAction)
  action!: ResolveCancellationAction;

  @ApiPropertyOptional({ description: 'A guest seat on this booking; omit for the Student\'s own seat.' })
  @IsOptional()
  @IsUUID()
  attendeeId?: string;
}
