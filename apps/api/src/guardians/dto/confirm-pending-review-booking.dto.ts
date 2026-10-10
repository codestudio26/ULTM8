import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** PATCH /guardians/me/bookings-pending-review/{bookingId}/confirm body
 * (Decision 123). Required, unlike CancelBookingDto's own optional studentId
 * hint — the Guardian's own context never has direct visibility into Booking
 * at all (Decision 92), so this is the only way confirmPendingReviewBooking()
 * can resolve which linked minor's context to look under; the client already
 * has it from GET /guardians/me/bookings-pending-review's own response. */
export class ConfirmPendingReviewBookingDto {
  @ApiProperty({ description: 'The linked minor Student this pending-review Booking belongs to.' })
  @IsUUID()
  studentId!: string;
}
