import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Decision 291 — one row of the staff "to resolve" list. Plan and payment
 * details are null for Branch Staff (no raw Membership/Transaction access). */
export class OpenCancellationResponseDto {
  @ApiProperty() bookingId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) attendeeId!: string | null;
  @ApiProperty() studentId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) studentName!: string | null;
  @ApiProperty() classId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) classTitle!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) classStartDate!: string | null;
  @ApiProperty() classCancelledBySchool!: boolean;
  /** The class's own banner (Decision 458 item 2: the row's class avatar); null shows its initials. */
  @ApiPropertyOptional({ type: String, nullable: true }) classBannerUrl!: string | null;
  /** The timetable slot the class came from, so every date of one slot shares an avatar colour; null for a one-off class. */
  @ApiPropertyOptional({ type: String, nullable: true }) classTimetableSlotId!: string | null;
  @ApiProperty({ enum: ['PENDING', 'REFUND_OWED'] }) resolution!: 'PENDING' | 'REFUND_OWED';
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Minor units.' }) refundAmount!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) currency!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) planTitle!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) planType!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, enum: ['STRIPE', 'CASH', 'BANK_TRANSFER'] }) paymentMethod!: 'STRIPE' | 'CASH' | 'BANK_TRANSFER' | null;
  @ApiProperty({ type: String, format: 'date-time' }) cancelledAt!: string;
}
