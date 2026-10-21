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

  // Decision 279 — see Booking's own fields of the same names.
  @ApiPropertyOptional({ type: Number, nullable: true })
  refundAmount!: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
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

  // Decision 234 — a sibling of refundResolution, not a replacement. See
  // CancellationChargeOutcome's own schema.prisma comment for the value set/null
  // case.
  @ApiPropertyOptional({ type: String, nullable: true })
  cancellationChargeOutcome!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  cancellationChargeAmount!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  stripeCancellationPaymentIntentId!: string | null;

  // Decision 279 — the money side of a refund (refundResolution
  // MONEY_REFUNDED/REFUND_OWED/PENDING) and the no-show fee.
  @ApiPropertyOptional({ type: Number, nullable: true })
  refundAmount!: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  noShowFeeOutcome!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  noShowFeeAmount!: number | null;

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
