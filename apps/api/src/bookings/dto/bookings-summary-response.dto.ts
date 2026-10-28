import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /schools/:schoolId/bookings/summary — v1.2 backend backlog, Dashboard
 * "Bookings This Week" drill-down, reworked by Decision 367 (Dashboard review,
 * 27 Oct 2026):
 *
 *  1. Every count below leaves cancelled Bookings out; they're reported on their
 *     own as `cancelledBookings` (Q1).
 *  2. The per-activity breakdown groups by the Class's Styles, by each Style's
 *     current name (Q3, following up Decision 224). A Class with no Styles falls
 *     back to its free-text `activities` tags; one with neither is `activity: null`
 *     (the portal shows it as "No style").
 *  3. A Booking whose Class lists several Styles counts once in EACH Style's row
 *     (so a day's `activities[].totalBookings` summed can exceed its own
 *     `totalBookings`), but exactly once in every day-level/overall total.
 *  4. Days are the Class's own local days: its Branch's time zone, else the
 *     School's, else UTC (D3) — the same rule the Classes page uses.
 */
export class BookingsSummaryActivityDto {
  @ApiProperty({ type: String, nullable: true, description: 'The Style name (or, for a Class with no Styles, its free-text activity tag) this row is for; null for a Class with neither.' })
  activity!: string | null;

  @ApiProperty()
  totalBookings!: number;

  /** Of totalBookings, how many currently sit in BookingStatus.UPCOMING. */
  @ApiProperty()
  upcomingBookings!: number;
}

/** Decision 367 (Q4) — one Class held that day, busy or not. */
export class BookingsSummaryClassDto {
  @ApiProperty()
  classId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startDate!: Date;

  @ApiProperty({ description: 'The IANA time zone the Class runs in (Branch, else School, else UTC).' })
  timeZone!: string;

  @ApiProperty({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'null = unlimited.' })
  capacity!: number | null;

  /** Bookings that aren't cancelled. */
  @ApiProperty()
  bookedCount!: number;

  @ApiProperty()
  cancelledCount!: number;

  /** The School cancelled the whole Class (Decision 291). */
  @ApiProperty()
  cancelled!: boolean;
}

export class BookingsSummaryDayDto {
  @ApiProperty({ description: 'YYYY-MM-DD, the Classes\' own local calendar day.' })
  date!: string;

  @ApiProperty()
  totalBookings!: number;

  @ApiProperty()
  upcomingBookings!: number;

  @ApiProperty()
  cancelledBookings!: number;

  @ApiProperty({ type: [BookingsSummaryActivityDto] })
  activities!: BookingsSummaryActivityDto[];

  @ApiProperty({ type: [BookingsSummaryClassDto] })
  classes!: BookingsSummaryClassDto[];
}

export class BookingsSummaryResponseDto {
  @ApiProperty({ description: 'Inclusive range start actually used, YYYY-MM-DD.' })
  from!: string;

  @ApiProperty({ description: 'Inclusive range end actually used, YYYY-MM-DD.' })
  to!: string;

  @ApiProperty({ type: String, nullable: true, description: 'The Branch filter applied, if any.' })
  branchId!: string | null;

  /** Every Booking that isn't cancelled whose Class falls in [from, to] — the
   * Dashboard's "Bookings this week" figure. */
  @ApiProperty()
  totalBookings!: number;

  /** Of totalBookings, how many currently sit in BookingStatus.UPCOMING. */
  @ApiProperty()
  upcomingBookings!: number;

  /** Cancelled Bookings in the range, reported apart (Q1). */
  @ApiProperty()
  cancelledBookings!: number;

  /** Attendance card "Present" (Spec 55 §2.1, Q2): Bookings checked in (COMPLETED). */
  @ApiProperty()
  attendedBookings!: number;

  /** Attendance card "Absent" (Spec 55 §2.1, Q2): Bookings marked NO_SHOW. */
  @ApiProperty()
  noShowBookings!: number;

  /** One entry per day in [from, to], in order, including a day with zero
   * Bookings — never a sparse array a caller has to fill gaps in themselves. */
  @ApiProperty({ type: [BookingsSummaryDayDto] })
  days!: BookingsSummaryDayDto[];
}
