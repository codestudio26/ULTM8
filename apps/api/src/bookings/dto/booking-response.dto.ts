import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BookingAttendeeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  membershipId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  refundResolution!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  resolvedById!: string | null;
}

export class BookingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  classId!: string;

  // Denormalized from the Booking's own Class relation (classId is a required FK,
  // never null, so these are always resolvable — every Booking-returning endpoint
  // populates them, not just GET /bookings/me). Added so MyBookingsScreen can show
  // what/when a Booking is for without a second round-trip per row; previously this
  // DTO carried only the raw classId.
  @ApiProperty()
  classTitle!: string;

  @ApiProperty()
  classStartDate!: string;

  @ApiProperty()
  classEndDate!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  sourceMembershipId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  overriddenById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  overrideReason!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  refundResolution!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  resolvedById!: string | null;

  @ApiProperty({ type: [BookingAttendeeResponseDto] })
  attendees!: BookingAttendeeResponseDto[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class BookingListResponseDto {
  @ApiProperty({ type: [BookingResponseDto] })
  items!: BookingResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
