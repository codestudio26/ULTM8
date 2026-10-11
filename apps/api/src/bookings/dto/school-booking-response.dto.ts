import { ApiProperty } from '@nestjs/swagger';

/**
 * `GET /schools/:schoolId/bookings` response shape — deliberately narrower
 * than BookingResponseDto (no attendees/override/check-in detail): this
 * view's only job is the day/discipline drill-down the Dashboard's own
 * "Bookings This Week" card needs, not full Booking detail (clicking a
 * session in the UI reuses the already-shipped `GET classes/:id/bookings`
 * roster for that). `classTitle`/`classStartDate`/`classEndDate`/
 * `activities` are joined from the related Class — see
 * BookingsService.findAllForSchool's own header comment for why a Booking
 * carries no date of its own.
 */
export class SchoolBookingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  studentFirstName!: string;

  @ApiProperty()
  studentSurname!: string;

  @ApiProperty()
  classId!: string;

  @ApiProperty()
  classTitle!: string;

  @ApiProperty()
  classStartDate!: string;

  @ApiProperty()
  classEndDate!: string;

  /** Raw `Class.activities` strings — ships against these directly rather
   * than a canonical Discipline FK, same call Decision 224 already made for
   * the Dashboard drill-down's own day×discipline grouping (Decision 90's
   * Discipline-FK reconciliation is still open, separate work). */
  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiProperty()
  status!: string;
}

export class SchoolBookingListResponseDto {
  @ApiProperty({ type: [SchoolBookingResponseDto] })
  items!: SchoolBookingResponseDto[];
}
