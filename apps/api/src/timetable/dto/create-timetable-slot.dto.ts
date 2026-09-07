import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * Field list per the Phase 5 kickoff prompt — confirmed six (Spec 55 §6.1, quoted
 * there): weekday, startTime, endTime, breakStart, breakEnd, status. Everything else
 * below is a Developer-level template-field addition resolved with the product owner
 * during Phase 5 scoping (record as a Decision, same pattern as Decisions 82-84) —
 * TimetableSlot's confirmed fields give the class-occurrence-generation job nothing it
 * needs to actually build a Class (no title, no activities, no capacity), so
 * TimetableSlot carries template copies of those fields instead.
 *
 * schoolId is a route param (`/schools/:schoolId/timetable`), not a body field — same
 * convention as CreateBranchDto/CreateClassDto.
 *
 * CRITICAL: every field shared with CreateClassDto (title, activities, capacity,
 * description, bannerUrl, termsWaiverRequired, membershipInclusion,
 * cancellationCharge) carries the IDENTICAL validation constraints as CreateClassDto's
 * own — same MaxLength/ArrayMinSize/ArrayMaxSize/Min values. If the two drift, a
 * TimetableSlot that passes its own (looser) validation can still fail deep inside the
 * class-occurrence-generation job when it tries to create the actual Class — a runtime
 * failure in a background job, not a clean 400 at the point someone made the mistake.
 * Keep both files' constraints in sync; this comment is the cross-reference so a
 * future edit to one doesn't silently orphan the other.
 *
 * instructorId is validated in TimetableSlotsService (not here) against RoleGrant
 * directly, via the same TenantAuthorizationService.assertValidInstructor Phase 4's
 * ClassesService uses — an Instructor here means a User holding an active INSTRUCTOR
 * RoleGrant at this School, not a separate Instructor table (domain-rules §6.1). Spec
 * 55 marks the TimetableSlot->Instructor relation itself as "inferred," not confirmed
 * the way the six core fields are — same caution Class's own instructorId got.
 *
 * startTime/endTime/breakStart/breakEnd are `HH:mm` strings at this layer (validated
 * against a 24-hour-clock pattern), converted to a `Date` for the `@db.Time(0)` column
 * in TimetableSlotsService — see its header comment for that conversion.
 */
export class CreateTimetableSlotDto {
  @ApiPropertyOptional({ description: 'Branch to scope this slot to. Omit for a School-wide slot.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'A User holding an active INSTRUCTOR RoleGrant at this School.' })
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  @ApiProperty({ enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] })
  @IsEnum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])
  weekday!: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

  @ApiProperty({ description: '24-hour clock, HH:mm.', example: '18:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm, 24-hour clock' })
  startTime!: string;

  @ApiProperty({ description: '24-hour clock, HH:mm.', example: '19:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm, 24-hour clock' })
  endTime!: string;

  @ApiPropertyOptional({ description: '24-hour clock, HH:mm.' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'breakStart must be HH:mm, 24-hour clock' })
  breakStart?: string;

  @ApiPropertyOptional({ description: '24-hour clock, HH:mm.' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'breakEnd must be HH:mm, 24-hour clock' })
  breakEnd?: string;

  @ApiPropertyOptional({ enum: ['ON', 'OFF'], default: 'ON' })
  @IsOptional()
  @IsEnum(['ON', 'OFF'])
  status?: 'ON' | 'OFF';

  // --- Template fields — MUST mirror CreateClassDto's constraints exactly. ---

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  title!: string;

  @ApiProperty({ type: [String], description: 'At least one activity/discipline this slot covers.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  activities!: string[];

  @ApiPropertyOptional({ description: 'Nullable/omitted = unlimited.', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  termsWaiverRequired?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Opts generated Classes into general-membership access. Default is opt-out (a ticket is required).' })
  @IsOptional()
  @IsBoolean()
  membershipInclusion?: boolean;

  // --- Durations, not absolute dates — resolved per-occurrence by the job. ---

  @ApiPropertyOptional({ description: 'Booking cutoff, in minutes before each occurrence starts.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  bookingCutoffMinutesBeforeStart?: number;

  @ApiPropertyOptional({ description: 'QR check-in window, in minutes, from each occurrence\'s start.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  qrAttendanceWindowMinutes?: number;

  @ApiPropertyOptional({ description: 'Refund/credit cutoff, in hours before each occurrence starts.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  refundCutoffHoursBeforeStart?: number;

  @ApiPropertyOptional({ description: "Minor currency unit (e.g. cents), in the School/Branch's own currency." })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationCharge?: number;
}
