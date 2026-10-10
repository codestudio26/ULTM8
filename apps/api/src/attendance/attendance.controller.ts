import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { InstructorScanDto } from './dto/instructor-scan.dto';
import { QrTokenResponseDto } from './dto/qr-token-response.dto';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';

/**
 * Phase 13 built self-service QR check-in; Phase 51 (Decision 107) adds the
 * rotating-QR token mechanism self-service now verifies, plus the Instructor
 * roll-call scan Decision 71 left undesigned. No class-level route prefix —
 * same shape BookingsController already established — since these routes
 * genuinely span two path families (`/attendance/*` and `/classes/{id}/*`),
 * grouped here by feature (attendance), not by URL prefix.
 */
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

  /** Staff-only — mints the rotating Class-scoped token for the School Portal's
   * own QR display screen. */
  @ApiOkResponse({ type: QrTokenResponseDto })
  @Get('classes/:id/qr-token')
  issueClassQrToken(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.attendanceService.issueClassQrToken(user.sub, id);
  }

  /** Self-service — mints the caller's own rotating personal token, for their
   * own device to display so an Instructor can scan it during roll-call. */
  @ApiOkResponse({ type: QrTokenResponseDto })
  @Get('attendance/my-qr-token')
  issueMyQrToken(@CurrentUser() user: JwtPayload) {
    return this.attendanceService.issueMyQrToken(user.sub);
  }

  /** Staff-only — the Instructor-operated roll-call scan (Decision 71). See
   * InstructorScanDto's own comment for the scan-vs-manual distinction. */
  @ApiOkResponse({ type: BookingResponseDto })
  @Post('classes/:id/attendance-scan')
  instructorScan(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: InstructorScanDto) {
    return this.attendanceService.instructorScan(user.sub, id, dto);
  }
}
