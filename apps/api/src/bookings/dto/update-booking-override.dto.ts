import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * PATCH /bookings/{id}/override body.
 *
 * FOUND ON REVIEW OF THE CONFIRMED ROUTE TABLE (Phase 11 kickoff prompt §1.f, not
 * silently resolved): `PATCH /bookings/{id}/override` operating on an EXISTING
 * Booking is hard to reconcile literally with SKILL.md §9's own text — an override
 * lets a rank-gate-blocked booking attempt SUCCEED, which necessarily happens at
 * CREATION time (before any Booking row exists to PATCH). Rather than force an
 * artificial "override a row that already passed every gate" semantic onto this
 * route, `BookClassDto.overrideReason` (on `POST /classes/{id}/book`) is where the
 * actual gate-bypass happens — this PATCH endpoint is scoped narrowly to what it CAN
 * honestly do on an existing row: letting Staff amend/correct the override
 * justification text after the fact (a typo fix, adding detail for an audit) on a
 * Booking that was already created via the override path. Flagged explicitly for
 * Architect confirmation — this is a genuine route-semantics gap in the confirmed
 * table (itself disclaimed as "representative, not final"), not a guess presented as
 * settled.
 */
export class UpdateBookingOverrideDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  overrideReason!: string;
}
