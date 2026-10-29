import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StudentCheckInCodesService } from './student-check-in-codes.service';
import { StudentCheckInCodeDto } from './dto/front-desk.dto';

/** A Student's personal check-in code (Decision 384, handover F3). */
@ApiTags('front-desk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/students/:studentId/check-in-code')
export class StudentCheckInCodesController {
  constructor(private readonly checkInCodes: StudentCheckInCodesService) {}

  /** The Student, their Guardian, or staff who cover them. */
  @ApiOkResponse({ type: StudentCheckInCodeDto })
  @Get()
  get(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.checkInCodes.get(user.sub, schoolId, studentId);
  }

  /** Staff issue a new code; the old one stops working. */
  @ApiOkResponse({ type: StudentCheckInCodeDto })
  @HttpCode(200)
  @Post()
  renew(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.checkInCodes.renew(user.sub, schoolId, studentId);
  }
}
