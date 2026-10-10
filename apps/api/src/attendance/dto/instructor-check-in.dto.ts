import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** POST /classes/{id}/attendance-scan body — the Instructor roll-call check-in
 * (Decision 71). Despite the endpoint's name (fixed by Spec 55's own
 * InstructorsModule endpoint list), this is a plain roster tap, not a literal QR
 * scan — see AttendanceService's own header comment for why. Takes `studentId`,
 * not a `bookingId`: unlike the self-service scan (where the Student already
 * knows their own bookingId from "My Bookings"), the Instructor's roster is
 * keyed by Student, and the server resolves the matching UPCOMING Booking for
 * this Class itself. */
export class InstructorCheckInDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;
}
