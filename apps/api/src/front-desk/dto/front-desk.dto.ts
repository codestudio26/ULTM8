import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';

// ---------------------------------------------------------------------------
// Staff: starting, listing and ending tablets, and their own code
// ---------------------------------------------------------------------------

export class StartFrontDeskSessionDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'The Branch this tablet is at. Required when the School has open Branches; leave out when it has none.' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;
}

export class FrontDeskSessionStartedDto {
  @ApiProperty()
  sessionId!: string;

  @ApiProperty({ description: 'For the tablet only. It reaches the /front-desk/kiosk endpoints and nothing else.' })
  sessionToken!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

export class FrontDeskSessionDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty()
  startedById!: string;

  @ApiProperty()
  startedByName!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}

export class FrontDeskSessionListDto {
  @ApiProperty({ type: [FrontDeskSessionDto] })
  items!: FrontDeskSessionDto[];
}

export class FrontDeskSessionEndedDto {
  @ApiProperty()
  ended!: boolean;
}

export class StaffKioskCodeDto {
  @ApiProperty({ description: "The caller's own code for leaving a locked tablet at this School (4 or 6 digits, the School's setting)." })
  code!: string;
}

// ---------------------------------------------------------------------------
// The tablet
// ---------------------------------------------------------------------------

export class KioskSessionInfoDto {
  @ApiProperty()
  sessionId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ description: "Check-in opens this many minutes before a Class starts (the School's setting)." })
  checkInOpensMinutesBeforeStart!: number;

  @ApiProperty({ enum: [4, 6], description: 'How many digits staff codes have here.' })
  checkInCodeDigits!: number;
}

/** "Today" as the tablet's own clock sees it. */
export class KioskTodayQueryDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  startsFrom!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  startsTo!: string;
}

export class KioskClassDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startDate!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  endDate!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  qrAttendanceEndAt!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null: no limit.' })
  capacity!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null: a whole-School Class.' })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  coachName!: string | null;

  @ApiProperty({ description: 'Booked or checked in, each with their guests.' })
  seatsTaken!: number;

  @ApiProperty({ description: 'Members and guests checked in.' })
  checkedIn!: number;
}

export class KioskRecentCheckInDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty({ description: 'The surname\'s first letter only (Decision 351).' })
  surnameInitial!: string;

  @ApiProperty()
  classTitle!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
}

export class KioskTodayDto {
  @ApiProperty({ type: [KioskClassDto] })
  classes!: KioskClassDto[];

  @ApiProperty({ type: [KioskRecentCheckInDto], description: "Today's last 10 check-ins, newest first." })
  recent!: KioskRecentCheckInDto[];
}

export class KioskStudentSearchQueryDto {
  @ApiProperty({ description: 'Two letters or more.' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  search!: string;
}

export class KioskStudentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surnameInitial!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "A child's photo only while their Guardian's camera consent is active (Decisions 57, 69)." })
  profilePhotoUrl!: string | null;
}

export class KioskStudentListDto {
  @ApiProperty({ type: [KioskStudentDto], description: 'At most 8.' })
  items!: KioskStudentDto[];

  @ApiProperty({ description: 'More matched than were returned: type more of the name.' })
  more!: boolean;
}

export class KioskGuestDto {
  @ApiProperty()
  attendeeId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Once they signed their waiver: first name and initial.' })
  name!: string | null;

  @ApiProperty({ enum: ['SIGNED', 'UNSIGNED', 'NONE'] })
  waiverStatus!: 'SIGNED' | 'UNSIGNED' | 'NONE';

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  checkedInAt!: string | null;
}

export class KioskBookingDto {
  @ApiProperty()
  classId!: string;

  @ApiProperty()
  bookingId!: string;

  @ApiProperty({ enum: ['UPCOMING', 'COMPLETED'] })
  status!: 'UPCOMING' | 'COMPLETED';

  @ApiProperty({ type: [KioskGuestDto] })
  guests!: KioskGuestDto[];
}

export class KioskWaiverToSignDto {
  @ApiProperty()
  waiverId!: string;

  @ApiProperty()
  title!: string;
}

export class KioskProgressDto {
  @ApiProperty()
  counted!: number;

  @ApiProperty()
  required!: number;

  @ApiProperty()
  percent!: number;
}

export class KioskStudentCardDto {
  @ApiProperty({ type: KioskStudentDto })
  student!: KioskStudentDto;

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'NONE'] })
  membershipStatus!: 'ACTIVE' | 'EXPIRED' | 'NONE';

  @ApiProperty()
  waiverSigned!: boolean;

  @ApiProperty({ type: [KioskWaiverToSignDto] })
  waiversToSign!: KioskWaiverToSignDto[];

  @ApiPropertyOptional({ type: KioskProgressDto, nullable: true, description: 'Classes toward the next belt, when a rank counts classes.' })
  progress!: KioskProgressDto | null;

  @ApiProperty({ type: [KioskBookingDto], description: "The student's bookings in today's Classes here." })
  bookings!: KioskBookingDto[];
}

export class KioskQrLookupResponseDto {
  @ApiProperty({ description: 'Pass to POST /front-desk/kiosk/check-ins within 5 minutes.' })
  lookupToken!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: KioskStudentDto })
  student!: KioskStudentDto;
}

export class KioskUnlockDto {
  @ApiProperty({ description: "A staff member's own code (4 or 6 digits)." })
  @IsString()
  @Length(4, 6)
  @Matches(/^\d+$/)
  staffCode!: string;
}

/** POST /front-desk/kiosk/find-me (Decisions 351, 362; handover F6). */
export class KioskFindMeDto {
  @ApiProperty({ description: 'First name and surname, as typed.' })
  @IsString()
  @Length(2, 200)
  fullName!: string;

  @ApiProperty({ description: 'YYYY-MM-DD.', example: '1990-04-21' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth!: string;
}

/** Only whether they're already a member: nothing stored is ever returned. */
export class KioskFindMeResultDto {
  @ApiProperty()
  alreadyMember!: boolean;
}

/** POST /schools/{schoolId}/front-desk/code-lookups and
 * POST /front-desk/kiosk/code-lookups (Decision 384, handover F3). */
export class CheckInCodeLookupDto {
  @ApiProperty({ description: "A Student's personal check-in code (4 or 6 digits)." })
  @IsString()
  @Length(4, 6)
  @Matches(/^\d+$/)
  code!: string;
}

/** GET/POST /schools/{schoolId}/students/{studentId}/check-in-code. */
export class StudentCheckInCodeDto {
  @ApiProperty({ description: 'The personal check-in code, typed at the front desk in place of the app QR.' })
  code!: string;
}

export class KioskUnlockedDto {
  @ApiProperty({ description: 'First name of the staff member whose code it was.' })
  unlockedBy!: string;
}
