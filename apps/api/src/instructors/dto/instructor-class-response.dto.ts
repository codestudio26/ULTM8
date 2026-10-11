import { ApiProperty } from '@nestjs/swagger';
import { ClassResponseDto } from '../../classes/dto/class-response.dto';

/** `ClassResponseDto` plus `enrolledCount` — the "X of Y booked" figure the
 * Instructor Detail template shows, computed server-side rather than left
 * decorative. Same definition `BookingsService.countOccupiedSeats()` already
 * established for a Class's occupancy (UPCOMING Bookings plus their
 * BookingAttendee guests) — not a new one invented here. `capacity` (on the
 * base DTO) is the "Y"; this is the "X". */
export class InstructorClassResponseDto extends ClassResponseDto {
  @ApiProperty()
  enrolledCount!: number;
}

export class InstructorClassListResponseDto {
  @ApiProperty({ type: [InstructorClassResponseDto] })
  items!: InstructorClassResponseDto[];
}
