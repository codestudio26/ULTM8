import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/**
 * GET /schools/:schoolId/bookings/summary query — v1.2 backend backlog, Dashboard
 * "Bookings This Week" drill-down. Both fields are optional, but must be supplied
 * together: supplying only one is a 400 (BookingsService.getWeeklySummary), same
 * "no silently-partial range" discipline as every other paired-field validation in
 * this codebase (e.g. Booking's own overriddenById/overrideReason). Omitting both
 * defaults to the current Mon–Sun week (see booking-week.ts's own header comment for
 * why Mon–Sun, not some other boundary).
 */
export class BookingsSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive range start, YYYY-MM-DD. Defaults to the current week\'s Monday when both from/to are omitted.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive range end, YYYY-MM-DD. Defaults to the current week\'s Sunday when both from/to are omitted.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
