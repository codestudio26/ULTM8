import { ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Additive filter on top of the platform-wide cursor/limit shape (Decision 22) —
 * added for the Check-in screen's own booking cross-reference (Track B Phase 5),
 * which needs the caller's UPCOMING Bookings specifically, not their whole history.
 *
 * FOUND ON REVIEW (code-review skill, high effort): `GET /bookings/me` has no status
 * filter and is `id`-ordered (a random UUID, cursorPaginate's own convention) — a
 * client-side "fetch one wide page, filter to UPCOMING" over the caller's ENTIRE
 * Booking history (every COMPLETED/CANCELLED/NO_SHOW row ever created, which only
 * grows) could miss a genuinely upcoming Booking for a Student with more history
 * than the page size, exactly the same class of bug this phase's own
 * FindClassesQueryDto was added to fix for Instructors. `status` is optional and a
 * no-op when omitted, so MyBookingsScreen's existing unfiltered `useMyBookings()`
 * call is unaffected.
 */
export class FindMyBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus, description: 'Only Bookings with this status.' })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}
