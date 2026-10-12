import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /schools/:schoolId/bookings/summary — v1.2 backend backlog, Dashboard
 * "Bookings This Week" drill-down. See BookingsService.getWeeklySummary's own header
 * comment for the full account of the two judgment calls baked into this shape:
 *
 *  1. Grouping "by discipline" actually groups by the raw `Class.activities` string
 *     tags (Decision 90's bridge, same convention ClassesQueryDto's own `activities`
 *     filter already established) — NOT the canonical `Discipline`/`styles` FK
 *     (Decision 152/173). A Class with no tags at all falls into the sentinel
 *     `"Unspecified"` bucket rather than silently vanishing from the breakdown.
 *  2. A Booking whose Class carries more than one activities tag counts once in
 *     EACH tag's bucket (so `activities[].totalBookings` summed over a day can
 *     exceed that day's own `totalBookings`) — but counts exactly once in the day's
 *     own `totalBookings`/`upcomingBookings`, and exactly once in the response's
 *     overall `totalBookings`/`upcomingBookings`. This is a deliberate fan-out
 *     attribution choice, not a bug — see the PR description for the reasoning.
 */
export class BookingsSummaryActivityDto {
  @ApiProperty({ description: 'The raw Class.activities tag this bucket is for, or "Unspecified" for a Class with no tags.' })
  activity!: string;

  @ApiProperty()
  totalBookings!: number;

  /** Of totalBookings, how many currently sit in BookingStatus.UPCOMING. */
  @ApiProperty()
  upcomingBookings!: number;
}

export class BookingsSummaryDayDto {
  @ApiProperty({ description: 'YYYY-MM-DD, the School\'s own local calendar day.' })
  date!: string;

  @ApiProperty()
  totalBookings!: number;

  @ApiProperty()
  upcomingBookings!: number;

  @ApiProperty({ type: [BookingsSummaryActivityDto] })
  activities!: BookingsSummaryActivityDto[];
}

export class BookingsSummaryResponseDto {
  @ApiProperty({ description: 'Inclusive range start actually used, YYYY-MM-DD.' })
  from!: string;

  @ApiProperty({ description: 'Inclusive range end actually used, YYYY-MM-DD.' })
  to!: string;

  /** Every Booking (any status) whose Class.startDate falls in [from, to] — the
   * Dashboard's "Bookings this week" figure. */
  @ApiProperty()
  totalBookings!: number;

  /** Of totalBookings, how many currently sit in BookingStatus.UPCOMING — the
   * Dashboard's "upcoming" figure. */
  @ApiProperty()
  upcomingBookings!: number;

  /** One entry per day in [from, to], in order, including a day with zero
   * Bookings — never a sparse array a caller has to fill gaps in themselves. */
  @ApiProperty({ type: [BookingsSummaryDayDto] })
  days!: BookingsSummaryDayDto[];
}
