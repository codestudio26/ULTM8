import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingResponseDto } from './booking-response.dto';

/** GET students/:id/bookings's own row shape — BookingResponseDto plus the Class's
 * title/startDate/endDate, joined in because a per-Student "Upcoming Booking" card
 * (v1.2 backend backlog, Student Detail) has nothing to show from `classId` alone.
 * A separate, larger, not-yet-scoped gap in the same backlog doc covers a School-wide
 * date-range/discipline-groupable Bookings view — this only resolves the single-
 * Student case; it is not that endpoint's shape. */
export class StudentBookingResponseDto extends BookingResponseDto {
  @ApiProperty()
  classTitle!: string;

  @ApiProperty()
  classStartDate!: string;

  @ApiProperty()
  classEndDate!: string;
}

export class StudentBookingListResponseDto {
  @ApiProperty({ type: [StudentBookingResponseDto] })
  items!: StudentBookingResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
