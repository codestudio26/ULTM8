import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/**
 * GET /timetable/:id/occurrence query — Timetable page redesign (click-to-book).
 * `date` is deliberately a strict `YYYY-MM-DD` match, not `@IsDateString()` (the
 * looser convention `BookingsSummaryQueryDto.from/to` use) — this value is combined
 * directly with `T00:00:00.000Z` in `TimetableService.findOccurrence()` to match
 * `Class.occurrenceDate`'s own `@db.Date` storage convention (see
 * class-occurrence-generation.processor.ts's own comment on building that column from
 * a local calendar date, not an instant), so an unexpected format here would silently
 * look up the wrong date rather than erroring loudly.
 */
export class TimetableOccurrenceQueryDto {
  @ApiProperty({ description: 'The occurrence\'s calendar date, YYYY-MM-DD, matching Class.occurrenceDate.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format.' })
  date!: string;
}
