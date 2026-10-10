import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { InstructorCheckInDto } from './dto/instructor-check-in.dto';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { ClassRosterResponseDto } from './dto/class-roster-response.dto';

// Phase 13 scope: self-service QR check-in. Phase 17 scope: the Instructor
// roll-call roster. See AttendanceService's own header comment for the full
// scoping rationale on both. `@Controller()` with explicit per-route paths,
// same convention BookingsController already uses for mixing `attendance/`
// and `classes/:id/` paths in one controller rather than splitting by prefix.
@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @ApiOkResponse({ type: BookingResponseDto })
  @Post('attendance/scan')
  scan(@CurrentUser() user: JwtPayload, @Body() dto: ScanAttendanceDto) {
    return this.attendanceService.scan(user.sub, dto);
  }

  @ApiOkResponse({ type: ClassRosterResponseDto })
  @Get('classes/:id/roster')
  getRoster(@CurrentUser() user: JwtPayload, @Param('id') classId: string) {
    return this.attendanceService.getClassRoster(user.sub, classId);
  }

  @ApiOkResponse({ type: BookingResponseDto })
  @Post('classes/:id/attendance-scan')
  instructorCheckIn(@CurrentUser() user: JwtPayload, @Param('id') classId: string, @Body() dto: InstructorCheckInDto) {
    return this.attendanceService.instructorCheckIn(user.sub, classId, dto);
  }

  @ApiOkResponse({ type: BookingResponseDto })
  @Delete('classes/:id/attendance-scan/:studentId')
  undoInstructorCheckIn(@CurrentUser() user: JwtPayload, @Param('id') classId: string, @Param('studentId') studentId: string) {
    return this.attendanceService.undoInstructorCheckIn(user.sub, classId, studentId);
  }
}
