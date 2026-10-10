import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * POST /classes/{id}/book body.
 *
 * `studentId`/`overrideReason` together implement the rank-gate override (SKILL.md
 * §9, confirmed): "An Instructor/Staff member can override per Booking (overriddenBy
 * + overrideReason, always recorded)." A Student can never self-override — the
 * service asserts the CALLER is Staff whenever `overrideReason` is present. Both are
 * omitted for the ordinary Student self-service path, which is the overwhelmingly
 * common case.
 *
 * `studentId` naming someone other than the caller means either a Staff member
 * booking on a Student's behalf (the original Phase 11 shape), or — as of Phase 40 —
 * a Guardian booking for a linked minor (BookingsService.bookClass()'s own comment
 * for how the two are distinguished; a Guardian may never also supply
 * `overrideReason` — only Staff can override).
 *
 * `attendeeMembershipIds` is the `whoJoinYou` list (SKILL.md §10) — one Membership id
 * PER GUEST beyond the Student themselves, each funding that guest's own seat. Empty/
 * omitted means a solo booking.
 */
export class BookClassDto {
  @ApiPropertyOptional({ description: 'Book on behalf of this Student instead of the caller — Staff (with optional overrideReason), or a Guardian for a linked minor.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'One Membership id per guest beyond the Student themselves (whoJoinYou) — each guest\'s own valid Membership or School-gifted Friend Pass.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attendeeMembershipIds?: string[];

  @ApiPropertyOptional({ description: 'Staff-only — bypasses the rank-eligibility gate for this Booking only, always recorded.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}
