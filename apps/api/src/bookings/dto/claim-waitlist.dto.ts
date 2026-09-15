import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /waitlist/{id}/claim body (Phase 42 — this route had no body at all
 * before now). Same Decision-103 on-behalf-of shape as JoinWaitlistDto —
 * claiming immediately spends a Membership credit and creates a real
 * Booking, the identical risk profile Guardian-on-behalf-of Booking
 * creation (Phase 40) already carries; see WaitlistService.claim()'s own
 * header comment for the full account.
 */
export class ClaimWaitlistDto {
  @ApiPropertyOptional({ description: 'Claim on behalf of this Student instead of the caller — Staff, or a Guardian for a linked minor.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
