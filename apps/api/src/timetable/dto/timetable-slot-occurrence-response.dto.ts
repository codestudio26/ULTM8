import { ApiProperty } from '@nestjs/swagger';

/**
 * `GET /timetable/:id/occurrences/:date` response -- the v1.2 backend
 * backlog's Timetable "Book" action gap. Resolves a TimetableSlot
 * occurrence (the recurring weekly template, rendered by the Timetable
 * page) to the already-materialized bookable `Class` row for that date,
 * so the caller can then call the existing `POST /classes/:id/book` (self)
 * or Staff-on-behalf-of booking flow with a real `classId` -- see
 * TimetableService.resolveOccurrence's own header comment for why this
 * lookup, not a new booking endpoint, closes the gap.
 */
export class TimetableSlotOccurrenceResponseDto {
  @ApiProperty()
  classId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;
}
