import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { AttendanceService } from './attendance.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { InstructorScanDto } from './dto/instructor-scan.dto';
import { EnterAttendanceCodeDto } from './dto/enter-attendance-code.dto';
import { QrTokenResponseDto } from './dto/qr-token-response.dto';
import { DeskQrLookupDto, DeskQrLookupResponseDto, GuestCheckInResponseDto } from './dto/desk-qr-lookup.dto';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';
import { DeskCheckInDto, DeskCheckInResponseDto } from './dto/desk-check-in.dto';
import { FrontDeskCheckInService } from './front-desk-check-in.service';

// Decision 235's own explicit mandate: "mandatory server-side rate limiting
// on wrong code submissions — 6 digits is brute-forceable in hours without
// it." Same shape/limit as STEP_UP_VERIFY_THROTTLE (auth.controller.ts) — an
// authenticated, sensitive-guess endpoint keyed by the caller's own `sub`,
// not a request-body field (there's no email/phone here to key on anyway).
const ENTER_CODE_THROTTLE = {
  identity: { limit: 5, ttl: 60_000, getTracker: jwtSubTracker },
};

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
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly frontDeskCheckIn: FrontDeskCheckInService,
  ) {}

  @ApiOkResponse({ type: BookingResponseDto })
  @Post('attendance/scan')
  scan(@CurrentUser() user: JwtPayload, @Body() dto: ScanAttendanceDto) {
    return this.attendanceService.scan(user.sub, dto);
  }

  /** Self-service, camera-free fallback (Decision 235) — types the 6-digit
   * code the Class-QR display screen also shows as text, instead of
   * scanning. See AttendanceService.enterCode()'s own comment for why this
   * deliberately skips the camera-consent gate scan() enforces. */
  @ApiOkResponse({ type: BookingResponseDto })
  @Throttle(ENTER_CODE_THROTTLE)
  @Post('attendance/code')
  enterCode(@CurrentUser() user: JwtPayload, @Body() dto: EnterAttendanceCodeDto) {
    return this.attendanceService.enterCode(user.sub, dto.classId, dto.code);
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

  /** Staff at the desk — check a scanned app QR once and get a five-minute
   * lookup token to check that Student in with. See
   * AttendanceService.deskQrLookup. */
  @ApiCreatedResponse({ type: DeskQrLookupResponseDto })
  @Post('schools/:schoolId/front-desk/qr-lookups')
  deskQrLookup(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: DeskQrLookupDto) {
    return this.attendanceService.deskQrLookup(user.sub, schoolId, dto.studentToken);
  }

  /** Staff at the desk — check one guest on a booking in (Decision 377). See
   * AttendanceService.checkInGuest. */
  @ApiCreatedResponse({ type: GuestCheckInResponseDto })
  @Post('bookings/:id/guests/:attendeeId/check-in')
  checkInGuest(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Param('attendeeId', ParseUUIDPipe) attendeeId: string) {
    return this.attendanceService.checkInGuest(user.sub, id, attendeeId);
  }

  /** Staff at the desk — the welcome card's confirm in one step: book where
   * needed, check in, and check in the ticked guests, all or nothing
   * (Decision 378). Always 200: `done` says whether it happened, and when it
   * didn't, the items with `ok: false` say why. See FrontDeskCheckInService. */
  @ApiOkResponse({ type: DeskCheckInResponseDto })
  @HttpCode(200)
  @Post('schools/:schoolId/front-desk/check-ins')
  deskCheckIn(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: DeskCheckInDto) {
    return this.frontDeskCheckIn.checkIn(user.sub, schoolId, dto);
  }
}
