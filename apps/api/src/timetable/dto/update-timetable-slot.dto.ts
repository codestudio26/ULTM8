import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, IsUrl, Min, MaxLength } from 'class-validator';
import { CreateTimetableSlotDto } from './create-timetable-slot.dto';

const NULLABLE_ON_UPDATE = [
  'branchId',
  'instructorId',
  'capacity',
  'description',
  'bannerUrl',
  'bookingCutoffMinutesBeforeStart',
  'qrAttendanceWindowMinutes',
  'refundCutoffHoursBeforeStart',
  'cancellationCharge',
] as const;

/**
 * FOUND ON REVIEW (Phase 17, school-portal's own edit-Timetable-slot form): the
 * fields below are explicitly widened to accept `null`, matching what
 * TimetableService.update() already does today for them — its Prisma call
 * forwards `dto.branchId`/`dto.instructorId`/`dto.capacity`/`dto.description`/
 * `dto.bannerUrl`/`dto.cancellationCharge`/`dto.bookingCutoffMinutesBeforeStart`/
 * `dto.qrAttendanceWindowMinutes`/`dto.refundCutoffHoursBeforeStart` straight
 * through as `data.<field>` (no ternary), so an explicit `null` already clears
 * the column and `undefined` already leaves it unchanged — same situation
 * InstructorsService.update()'s own comment already documents for its sibling
 * fields, and CreateClassDto/UpdateClassDto's own comment documents for Class.
 *
 * Deliberately NOT widened here: `weekday`/`startTime`/`endTime`/`title`/
 * `activities` (required — nothing to "clear", only to replace), or
 * `breakStart`/`breakEnd` (TimetableService.update() converts these via
 * `dto.X ? parseHHmm(dto.X) : undefined` — a falsy check that would swallow an
 * explicit `null` the same as an omitted field, so there is currently NO way to
 * remove an already-set break window via PATCH, not even by widening this DTO;
 * that's a separate, real, flagged gap in the service itself, not something a
 * DTO-only change can fix — left alone rather than silently half-fixed).
 */
export class UpdateTimetableSlotDto extends PartialType(OmitType(CreateTimetableSlotDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({
    enum: ['MOVE', 'CANCEL', 'KEEP'],
    description:
      'Decision 322. What to do with this slot\'s upcoming Classes that already have bookings, when the change moves them (day, start or end time, branch) or switches the slot off. ' +
      'MOVE: they follow the change and booked Students are told (not with status OFF). CANCEL: their bookings are cancelled with credit back and the Classes archived; Students are told. ' +
      'KEEP: they stay as they are. Required when such Classes exist; without it the update is refused with 409. Unbooked upcoming Classes always follow the change.',
  })
  @IsOptional()
  @IsIn(['MOVE', 'CANCEL', 'KEEP'])
  bookedClasses?: 'MOVE' | 'CANCEL' | 'KEEP';

  @ApiPropertyOptional({ description: 'Branch to scope this slot to. Pass null to clear (make it School-wide).', type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ description: 'A User holding an active INSTRUCTOR RoleGrant at this School. Pass null to unassign.', type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  instructorId?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Pass null to clear (unlimited).', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Booking cutoff, in minutes before each occurrence starts. Pass null to clear.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  bookingCutoffMinutesBeforeStart?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "QR check-in window, in minutes, from each occurrence's start. Pass null to clear." })
  @IsOptional()
  @IsInt()
  @Min(0)
  qrAttendanceWindowMinutes?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Refund/credit cutoff, in hours before each occurrence starts. Pass null to clear.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  refundCutoffHoursBeforeStart?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Minor currency unit (e.g. cents). Pass null to clear." })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationCharge?: number | null;
}
