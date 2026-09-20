import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /classes/{id}/waitlist body (Phase 42 — this route had no body at all
 * before now). Decision 103 extended WaitlistService's originally self-only
 * join/claim to both Staff and Guardian on-behalf-of, the same on-behalf-of
 * shape BookClassDto (Phase 11/40) already established: omitted/equal-to-
 * caller means an ordinary self-join; naming someone else means Staff or a
 * Guardian joining for a linked minor. See WaitlistService.joinWaitlist()'s
 * own header comment for how the two are distinguished.
 */
export class JoinWaitlistDto {
  @ApiPropertyOptional({ description: 'Join on behalf of this Student instead of the caller — Staff, or a Guardian for a linked minor.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
