import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { DeskQrLookupResponseDto } from '../attendance/dto/desk-qr-lookup.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { FrontDeskSessionsService } from './front-desk-sessions.service';
import { StudentCheckInCodesService } from './student-check-in-codes.service';
import { CheckInCodeLookupDto, FrontDeskSessionEndedDto, FrontDeskSessionListDto, FrontDeskSessionStartedDto, StaffKioskCodeDto, StartFrontDeskSessionDto } from './dto/front-desk.dto';

// Per staff member: a code is short, so wrong guesses are kept few (handover F3).
const CODE_THROTTLE = { identity: { limit: 10, ttl: 60_000, getTracker: jwtSubTracker } };

/** Staff side of locked front-desk tablets (Decision 380, handover F1, F2):
 * start one, see and end the live ones, and see or renew your own code. */
@ApiTags('front-desk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/front-desk')
export class FrontDeskSessionsController {
  constructor(
    private readonly sessions: FrontDeskSessionsService,
    private readonly checkInCodes: StudentCheckInCodesService,
  ) {}

  @ApiCreatedResponse({ type: FrontDeskSessionStartedDto })
  @Post('sessions')
  start(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: StartFrontDeskSessionDto) {
    return this.sessions.start(user.sub, schoolId, dto.branchId ?? null);
  }

  @ApiOkResponse({ type: FrontDeskSessionListDto })
  @Get('sessions')
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.sessions.listActive(user.sub, schoolId);
  }

  @ApiOkResponse({ type: FrontDeskSessionEndedDto })
  @HttpCode(200)
  @Post('sessions/:id/end')
  end(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.end(user.sub, schoolId, id);
  }

  @ApiOkResponse({ type: StaffKioskCodeDto })
  @Get('my-code')
  myCode(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.sessions.myCode(user.sub, schoolId);
  }

  @ApiOkResponse({ type: StaffKioskCodeDto })
  @HttpCode(200)
  @Post('my-code')
  newCode(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.sessions.newCode(user.sub, schoolId);
  }

  /** A Student's personal check-in code typed at the desk (Decision 384):
   * who it is, and a five-minute lookup token to check them in with. */
  @ApiOkResponse({ type: DeskQrLookupResponseDto })
  @Throttle(CODE_THROTTLE)
  @HttpCode(200)
  @Post('code-lookups')
  codeLookup(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: CheckInCodeLookupDto) {
    return this.checkInCodes.staffLookup(user.sub, schoolId, dto.code);
  }
}
