import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { BookingResponseDto } from '../bookings/dto/booking-response.dto';

// Phase 13 scope only: self-service QR check-in. See AttendanceService's own
// header comment for the full scoping rationale.
@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @ApiOkResponse({ type: BookingResponseDto })
  @Post('scan')
  scan(@CurrentUser() user: JwtPayload, @Body() dto: ScanAttendanceDto) {
    return this.attendanceService.scan(user.sub, dto);
  }
}
