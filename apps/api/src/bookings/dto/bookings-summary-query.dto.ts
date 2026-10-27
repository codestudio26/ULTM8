import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * GET /schools/:schoolId/bookings/summary query — v1.2 backend backlog, Dashboard
 * "Bookings This Week" drill-down. `from`/`to` are both optional, but must be supplied
 * together: supplying only one is a 400 (BookingsService.getWeeklySummary), same
 * "no silently-partial range" discipline as every other paired-field validation in
 * this codebase (e.g. Booking's own overriddenById/overrideReason). Omitting both
 * defaults to the current Mon–Sun week (see booking-week.ts's own header comment for
 * why Mon–Sun, not some other boundary). A range is at most 92 days (Decision 367).
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

  /** Decision 367 (Q5) — only Classes held at this Branch. Omitted: every Class
   * at the School, School-wide ones (no Branch) included. */
  @ApiPropertyOptional({ description: 'Only Classes held at this Branch of the School.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
