import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * DELETE /waitlist/{id} query params (Phase 42). A query param, not a body —
 * unlike every other on-behalf-of consumer this session (all POST/PATCH), no
 * existing DELETE route in this codebase carries a request body, and a body
 * on DELETE is inconsistently supported across HTTP clients/proxies in
 * practice. Same purpose as CancelBookingDto.studentId (Phase 41): a
 * Guardian retry hint, used only when the caller's own context finds
 * nothing. Withdraw already supported Staff-on-behalf-of before this phase
 * (a pure status change, no credit implication) — this only adds the
 * Guardian branch, per Decision 103's own explicit "natural, low-risk
 * companion" note.
 */
export class WithdrawWaitlistQueryDto {
  @ApiPropertyOptional({ description: 'Guardian-only: if the caller has no direct visibility into this Waitlist entry, retry the lookup under this linked minor Student\'s own context.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
