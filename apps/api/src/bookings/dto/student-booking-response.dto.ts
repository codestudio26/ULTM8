import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingAttendeeResponseDto } from './booking-response.dto';

/**
 * GET /students/{id}/bookings (v1.2 backend backlog — Student Detail's
 * "Upcoming Booking") — a real per-Student, School-scoped Booking read for a
 * Staff viewer. Before this, the only per-Class read (`GET
 * classes/{id}/bookings`) would have needed an N+1 call per Class to answer
 * "what's this Student's next booking" (the backlog's own words).
 *
 * Field-for-field BookingResponseDto, minus studentFirstName/studentSurname
 * (the caller already has `studentId` from the URL, so resolving it a second
 * time here would be redundant — unlike BookingResponseDto's own per-Class
 * roster read, which has no other way to know whose Booking each row is),
 * PLUS the Class fields a "which Class, and when" display actually needs
 * (`classTitle`/`classStartDate`/`classEndDate`) — Booking itself derives
 * its class date/time via the `classId` relation rather than storing a
 * snapshot (see Booking's own schema comment), so a caller showing "Upcoming
 * Booking" needs these joined on, not a second round-trip to GET
 * /classes/{id}.
 */
export class StudentBookingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  classId!: string;

  @ApiProperty()
  classTitle!: string;

  @ApiProperty()
  classStartDate!: string;

  @ApiProperty()
  classEndDate!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  sourceMembershipId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  overriddenById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  overrideReason!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  checkInMethod!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  refundResolution!: string | null;

  @ApiProperty({ type: [BookingAttendeeResponseDto] })
  attendees!: BookingAttendeeResponseDto[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class StudentBookingListResponseDto {
  @ApiProperty({ type: [StudentBookingResponseDto] })
  items!: StudentBookingResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
