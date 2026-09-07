import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape — see school-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type` alongside `nullable: true`). Field-for-field
 * match of the TimetableSlot Prisma model. startTime/endTime/breakStart/breakEnd come
 * back as `HH:mm` strings, the same shape they're accepted in — the `@db.Time(0)`
 * storage detail stays internal to TimetableSlotsService.
 */
export class TimetableSlotResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  instructorId!: string | null;

  @ApiProperty({ enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] })
  weekday!: string;

  @ApiProperty({ example: '18:00' })
  startTime!: string;

  @ApiProperty({ example: '19:00' })
  endTime!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  breakStart!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  breakEnd!: string | null;

  @ApiProperty({ enum: ['ON', 'OFF'] })
  status!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiPropertyOptional({ type: Number, nullable: true })
  capacity!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

  @ApiProperty()
  termsWaiverRequired!: boolean;

  @ApiProperty()
  membershipInclusion!: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true })
  bookingCutoffMinutesBeforeStart!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  qrAttendanceWindowMinutes!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  refundCutoffHoursBeforeStart!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  cancellationCharge!: number | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class TimetableSlotListResponseDto {
  @ApiProperty({ type: [TimetableSlotResponseDto] })
  items!: TimetableSlotResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
