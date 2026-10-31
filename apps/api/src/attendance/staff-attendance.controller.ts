import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StaffAttendanceService } from './staff-attendance.service';
import {
  AttendanceStatsQueryDto,
  AttendanceStatsResponseDto,
  LogAttendanceDto,
  LogClassesQueryDto,
  LogClassesResponseDto,
  LoggedAttendanceResponseDto,
} from './dto/staff-attendance.dto';

/** Students → Attendance: statistics and logging past attendance
 * (Decision 317 items 3 and 4; backlog 5.6, 5.7). See StaffAttendanceService. */
@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/attendance')
export class StaffAttendanceController {
  constructor(private readonly staffAttendance: StaffAttendanceService) {}

  /** The last 30 days. Owners: the whole School; Branch Staff with "See
   * attendance statistics": their own Branches. */
  @ApiOkResponse({ type: AttendanceStatsResponseDto })
  @Get('stats')
  stats(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: AttendanceStatsQueryDto) {
    return this.staffAttendance.stats(user.sub, schoolId, query);
  }

  /** The classes on one day that attendance can be logged for. */
  @ApiOkResponse({ type: LogClassesResponseDto })
  @Get('log-classes')
  logClasses(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: LogClassesQueryDto) {
    return this.staffAttendance.logClasses(user.sub, schoolId, query.date, query.studentId);
  }

  /** Log a class a student came to, up to 30 days back. Counts like a normal
   * check-in, recorded as STAFF_LOGGED with who logged it. */
  @ApiCreatedResponse({ type: LoggedAttendanceResponseDto })
  @Post('logs')
  log(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: LogAttendanceDto) {
    return this.staffAttendance.log(user.sub, schoolId, dto);
  }
}
