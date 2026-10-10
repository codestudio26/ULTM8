import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * PATCH /bookings/{id}/cancel body (Phase 41 — this route had no body at all
 * before now). Unlike BookClassDto's `studentId` (present from Phase 11 —
 * Staff already needed to NAME who they were booking for, since no Booking
 * row exists yet to read it off), a Staff caller cancelling an EXISTING
 * Booking never needed this: Booking's own broad Staff-read RLS policy
 * (`booking_staff_read`) already lets any Staff role see the row directly by
 * `bookingId` alone, so BookingsService.cancelBooking() could always resolve
 * `existing.studentId` itself, with no field for the caller to supply.
 *
 * A Guardian caller has no such visibility — GuardianLink carries no School
 * RoleGrant for that broad policy to recognize (Decision 92), the same
 * problem every other Guardian-on-behalf-of consumer this codebase has
 * already solved. `studentId` here is that hint: cancelBooking() retries its
 * lookup under this Student's own tenant context ONLY when the caller's own
 * context found nothing at all — a self-booking Student or an ordinary Staff
 * caller never needs to supply it, and its presence changes nothing for
 * them. The eventual authorization check is always keyed off the BOOKING's
 * own real `studentId` once found (via GuardianServices.
 * assertGuardianOfStudent()), never trusted from this field directly.
 */
export class CancelBookingDto {
  @ApiPropertyOptional({
    description:
      'Guardian-only: if the caller has no direct visibility into this Booking, retry the lookup under this linked minor Student\'s own context.',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
