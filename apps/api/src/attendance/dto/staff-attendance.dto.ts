import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID, Matches } from 'class-validator';

/** GET /schools/{schoolId}/attendance/stats (Decision 317 item 3, backlog 5.6). */
export class AttendanceStatsQueryDto {
  @ApiPropertyOptional({ description: "Only this Branch. Staff may only name one of their own Branches." })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ default: false, description: 'Leave out Trial, Visitor (visit pass) and Friend Pass check-ins. They count by default.' })
  @IsOptional()
  // "false" is a non-empty string, which @Type(() => Boolean) reads as true.
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  excludePasses?: boolean;
}

export class AttendanceStatsResponseDto {
  @ApiProperty({ description: "First day counted (YYYY-MM-DD, the School's time zone): 29 days before today." })
  from!: string;

  @ApiProperty({ description: "Today (YYYY-MM-DD, the School's time zone). Classes count once they have started." })
  to!: string;

  @ApiProperty({ description: "The School's time zone the days are in (UTC when the School has none)." })
  timeZone!: string;

  @ApiProperty({ type: [String], nullable: true, description: 'The Branches counted; null means the whole School.' })
  branchIds!: string[] | null;

  @ApiProperty({ description: 'Whether Trial, Visitor and Friend Pass check-ins were left out.' })
  excludePasses!: boolean;

  @ApiProperty({ description: "Check-ins: members' classes checked in (or logged), plus guests checked in on a Friend Pass." })
  checkIns!: number;

  @ApiProperty({ description: 'Of checkIns, guests checked in on a Friend Pass.' })
  guestCheckIns!: number;

  @ApiProperty({ description: 'Of checkIns, attendance staff logged afterwards (STAFF_LOGGED).' })
  loggedCheckIns!: number;

  @ApiProperty({ description: 'Classes with at least one check-in.' })
  classes!: number;

  @ApiProperty({ description: 'Different members with at least one check-in (guests have no account and are not counted).' })
  students!: number;

  @ApiProperty({ description: 'checkIns / classes, to one decimal (0 when no class had a check-in).' })
  studentsPerClass!: number;

  @ApiProperty({ description: "Members' check-ins / students, to one decimal (0 when nobody checked in)." })
  classesPerStudent!: number;
}

/** GET /schools/{schoolId}/attendance/log-classes (Decision 317 item 4, backlog 5.7). */
export class LogClassesQueryDto {
  @ApiPropertyOptional({ description: "The day (YYYY-MM-DD, the School's time zone), today or up to 30 days back. Today when left out." })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ description: 'Marks the Classes this student has already attended.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class LogClassItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty({ description: 'The student named in the query has already attended (checked in or logged).' })
  attended!: boolean;
}

export class LogClassesResponseDto {
  @ApiProperty({ description: 'The earliest day attendance can be logged for (YYYY-MM-DD): 30 days before today.' })
  earliestDay!: string;

  @ApiProperty({ description: "Today (YYYY-MM-DD, the School's time zone)." })
  today!: string;

  @ApiProperty({ description: 'The day listed (YYYY-MM-DD).' })
  date!: string;

  @ApiProperty({ description: "The School's time zone the days are in (UTC when the School has none)." })
  timeZone!: string;

  @ApiProperty({ type: [LogClassItemDto], description: "Classes on that day that have started, aren't cancelled or archived, at the caller's Branches." })
  items!: LogClassItemDto[];
}

/** POST /schools/{schoolId}/attendance/logs (Decision 317 item 4, backlog 5.7). */
export class LogAttendanceDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiProperty({ description: 'A Class that started in the last 30 days (from the start of that day, School time).' })
  @IsUUID()
  classId!: string;
}

export class LoggedAttendanceResponseDto {
  @ApiProperty()
  bookingId!: string;

  @ApiProperty()
  classId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty({ enum: ['STAFF_LOGGED'] })
  checkInMethod!: 'STAFF_LOGGED';

  @ApiProperty({ description: 'Who logged it.' })
  checkedInById!: string;

  @ApiProperty({
    enum: ['BOOKED', 'UPCOMING', 'NO_SHOW'],
    description:
      'BOOKED: a new booking was made, paid for like any staff booking (a Class Pack credit when that is what pays). UPCOMING: their booking was still open and is now checked in. NO_SHOW: their booking had been marked No-Show and is now checked in; it was already paid for, so nothing more is used.',
  })
  from!: 'BOOKED' | 'UPCOMING' | 'NO_SHOW';
}
