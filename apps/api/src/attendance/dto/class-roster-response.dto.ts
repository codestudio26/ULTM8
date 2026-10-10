import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One booked Student on a Class's roster, for the Instructor roll-call screen
 * (Decision 71). `studentName` is denormalized here rather than left for the
 * client to resolve separately — the roster's whole purpose is a fast, glanceable
 * list of names, not ids a second round-trip would need to turn into names. */
export class ClassRosterEntryResponseDto {
  @ApiProperty()
  bookingId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  studentName!: string;

  @ApiProperty()
  status!: string;

  // Set only when this Booking was checked in via the Instructor roster (this
  // endpoint), never for a Student's own self-service scan (POST
  // /attendance/scan) — lets the UI distinguish "I checked them in" from "they
  // checked themselves in" if that's ever useful, without a second field.
  @ApiPropertyOptional({ type: String, nullable: true })
  checkedInById!: string | null;
}

export class ClassRosterResponseDto {
  @ApiProperty({ type: [ClassRosterEntryResponseDto] })
  items!: ClassRosterEntryResponseDto[];
}
