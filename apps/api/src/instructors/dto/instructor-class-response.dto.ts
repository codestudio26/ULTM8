import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * GET /instructors/{id}/classes (v1.2 backend backlog — "Instructor Class"
 * grid) — the real replacement for the School Portal's own client-side
 * filter-the-School's-Classes-by-instructorId workaround. Field-for-field a
 * subset of ClassResponseDto (the fields the backlog's own template actually
 * shows), PLUS `enrolledCount`: a server-computed "X of Y booked" figure the
 * client-filter workaround could never produce cheaply (the backlog's own
 * words: "no endpoint returns one cheaply; would need a per-class booking-
 * count call").
 *
 * `enrolledCount` counts every attendee across every UPCOMING Booking for
 * the Class — the SAME "Full" definition domain-rules §9 already confirms
 * ("every attendee across all Bookings, including Friend Pass guests... not
 * raw Booking count"), reused here rather than inventing a second notion of
 * "enrolled". See InstructorsService.resolveEnrolledCounts's own comment for
 * why this is computed in one batched pass across the whole page, not per-row.
 */
export class InstructorClassResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null = unlimited (domain-rules §9).' })
  capacity!: number | null;

  @ApiProperty({ description: 'Every attendee across every UPCOMING Booking for this Class — same definition as "Full" (domain-rules §9).' })
  enrolledCount!: number;
}

export class InstructorClassListResponseDto {
  @ApiProperty({ type: [InstructorClassResponseDto] })
  items!: InstructorClassResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
