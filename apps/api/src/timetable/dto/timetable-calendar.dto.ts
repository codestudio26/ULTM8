import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { ClassStyleResponseDto } from '../../classes/dto/class-style.dto';

/** GET /schools/:schoolId/timetable/calendar query (Decision 353, T7): the
 * local calendar dates on screen, at most 62 days. */
export class TimetableCalendarQueryDto {
  @ApiProperty({ description: 'First date shown, YYYY-MM-DD.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be in YYYY-MM-DD format.' })
  from!: string;

  @ApiProperty({ description: 'Last date shown, YYYY-MM-DD.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be in YYYY-MM-DD format.' })
  to!: string;

  @ApiPropertyOptional({ description: 'Only this Branch, plus School-wide classes.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

/** One real Class on the calendar, with its local date and times. */
export class TimetableCalendarClassDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) timetableSlotId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) branchId!: string | null;
  @ApiProperty({ type: String, nullable: true }) instructorId!: string | null;
  @ApiProperty({ type: [String] }) activities!: string[];
  @ApiProperty({ type: [ClassStyleResponseDto] }) styles!: ClassStyleResponseDto[];
  @ApiProperty({ description: 'Local date of the class (YYYY-MM-DD), in its Branch\'s zone, else its School\'s, else UTC.' }) date!: string;
  @ApiProperty({ description: 'Local start time, HH:mm.' }) startTime!: string;
  @ApiProperty({ description: 'Local end time, HH:mm.' }) endTime!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Local break start, HH:mm (Decision 353, Q6).' }) breakStart!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Local break end, HH:mm.' }) breakEnd!: string | null;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty({ type: Number, nullable: true }) capacity!: number | null;
  @ApiProperty({ description: 'Seats taken: bookings that are not cancelled, plus their guests.' }) seatsTaken!: number;
  @ApiProperty({ description: 'Students waiting or offered a seat.' }) waiting!: number;
  @ApiProperty({ type: String, nullable: true }) cancelledAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) archivedAt!: string | null;
}

/** A date a slot will have a class on, not created yet (beyond 4 weeks). */
export class TimetableCalendarLaterDto {
  @ApiProperty() slotId!: string;
  @ApiProperty({ description: 'YYYY-MM-DD.' }) date!: string;
}

export class TimetableCalendarResponseDto {
  @ApiProperty({ type: [TimetableCalendarClassDto] }) classes!: TimetableCalendarClassDto[];
  @ApiProperty({ type: [TimetableCalendarLaterDto], description: 'Dates On slots reach that have no class yet because they are past the 4-week horizon.' }) later!: TimetableCalendarLaterDto[];
}
