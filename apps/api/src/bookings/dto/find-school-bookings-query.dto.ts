import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

/**
 * `GET /schools/:schoolId/bookings?from=&to=` — the v1.2 backend backlog's
 * Dashboard "Bookings This Week" drill-down gap. `from`/`to` are inclusive,
 * ISO 8601 dates, filtered against the related Class's own `startDate` — a
 * Booking has no date of its own (see BookingsService.findAllForSchool's
 * own header comment).
 */
export class FindSchoolBookingsQueryDto {
  @ApiProperty({ description: 'Inclusive start of the date range (ISO 8601 date).' })
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Inclusive end of the date range (ISO 8601 date).' })
  @IsDateString()
  to!: string;
}
