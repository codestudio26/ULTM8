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

  /** Joined from Booking.student (a User relation), not a Booking column —
   * see BookingsService.findAllForClass. */
  @ApiProperty()
  studentFirstName!: string;

  @ApiProperty()
  studentSurname!: string;

  @ApiProperty()
  classId!: string;

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
  checkInMethod!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  checkedInById!: string | null;

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
