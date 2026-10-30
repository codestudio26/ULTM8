import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SignUpsService } from './sign-ups.service';
import { KioskSignUpCreatedDto, KioskSignUpDto } from './dto/sign-up.dto';
import { PackRechargesService } from './pack-recharges.service';
import { CreatePackRechargeDto, PackRechargeDto, PackRechargeStatusDto } from './dto/pack-recharge.dto';
import { Throttle } from '@nestjs/throttler';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { DeskQrLookupDto } from '../attendance/dto/desk-qr-lookup.dto';
import { DeskCheckInDto, DeskCheckInResponseDto } from '../attendance/dto/desk-check-in.dto';
import { AllowWhileLocked, FrontDeskSession, FrontDeskSessionGuard } from './front-desk-session.guard';
import { FrontDeskSessionContext, FrontDeskSessionsService } from './front-desk-sessions.service';
import { FrontDeskKioskService } from './front-desk-kiosk.service';
import {
  CheckInCodeLookupDto,
  KioskFindMeDto,
  KioskFindMeResultDto,
  KioskQrLookupResponseDto,
  KioskSessionInfoDto,
  KioskStudentCardDto,
  KioskStudentListDto,
  KioskStudentSearchQueryDto,
  KioskTodayDto,
  KioskTodayQueryDto,
  KioskUnlockDto,
  KioskUnlockedDto,
  KioskResumedDto,
} from './dto/front-desk.dto';

// Per session: the tablet's token buckets as `front-desk:<sessionId>` (handover F1, F2).
const UNLOCK_THROTTLE = { identity: { limit: 5, ttl: 60_000, getTracker: jwtSubTracker } };
// A code is short, so wrong guesses are kept few (handover F3: per device).
const CODE_THROTTLE = { identity: { limit: 10, ttl: 60_000, getTracker: jwtSubTracker } };
// Find me answers only yes or no, but is still kept to a few tries (Decision 362).
const FIND_ME_THROTTLE = { identity: { limit: 10, ttl: 60_000, getTracker: jwtSubTracker } };
// Decision 392: a sign-up is a few a minute at most from one tablet.
const SIGN_UP_THROTTLE = { identity: { limit: 5, ttl: 60_000, getTracker: jwtSubTracker } };
const SEARCH_THROTTLE = { identity: { limit: 30, ttl: 60_000, getTracker: jwtSubTracker } };

/**
 * The locked front-desk tablet (Decision 380, handover F1, F2). Only a
 * front-desk session token reaches these, and it reaches nothing else.
 */
@ApiTags('front-desk')
@ApiBearerAuth()
@UseGuards(FrontDeskSessionGuard)
@Controller('front-desk/kiosk')
export class FrontDeskKioskController {
  constructor(
    private readonly kiosk: FrontDeskKioskService,
    private readonly sessions: FrontDeskSessionsService,
    private readonly signUps: SignUpsService,
    private readonly recharges: PackRechargesService,
  ) {}

  /** Decision 392 (handover F5): a sign-up waiting for staff approval. */
  @ApiCreatedResponse({ type: KioskSignUpCreatedDto })
  @Throttle(SIGN_UP_THROTTLE)
  @Post('sign-ups')
  signUp(@FrontDeskSession() session: FrontDeskSessionContext, @Body() dto: KioskSignUpDto) {
    return this.signUps.submitFromKiosk(session, dto);
  }

  /** Decision 393 (handover F8): a used-up Class Pack, found by QR or code. */
  @ApiCreatedResponse({ type: PackRechargeDto })
  @Post('pack-recharges')
  createRecharge(@FrontDeskSession() s: FrontDeskSessionContext, @Body() dto: CreatePackRechargeDto) {
    return this.recharges.create(s.startedById, s.schoolId, dto, { sessionId: s.id, branchId: s.branchId });
  }

  @ApiOkResponse({ type: PackRechargeStatusDto })
  @Get('pack-recharges/:id')
  rechargeStatus(@FrontDeskSession() s: FrontDeskSessionContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.recharges.status(s.startedById, s.schoolId, id, { sessionId: s.id, branchId: s.branchId });
  }

  @ApiOkResponse({ type: DeskCheckInResponseDto })
  @HttpCode(200)
  @Post('pack-recharges/:id/complete')
  completeRecharge(@FrontDeskSession() s: FrontDeskSessionContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.recharges.complete(s.startedById, s.schoolId, id, { sessionId: s.id, branchId: s.branchId });
  }

  @ApiOkResponse({ type: KioskSessionInfoDto })
  @AllowWhileLocked()
  @Get('session')
  info(@FrontDeskSession() session: FrontDeskSessionContext) {
    return this.kiosk.info(session);
  }

  @ApiOkResponse({ type: KioskTodayDto })
  @Get('today')
  today(@FrontDeskSession() session: FrontDeskSessionContext, @Query() query: KioskTodayQueryDto) {
    return this.kiosk.today(session, query);
  }

  @ApiOkResponse({ type: KioskStudentListDto })
  @Throttle(SEARCH_THROTTLE)
  @Get('students')
  search(@FrontDeskSession() session: FrontDeskSessionContext, @Query() query: KioskStudentSearchQueryDto) {
    return this.kiosk.searchStudents(session, query.search);
  }

  @ApiOkResponse({ type: KioskStudentCardDto })
  @Get('students/:id/card')
  card(@FrontDeskSession() session: FrontDeskSessionContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: KioskTodayQueryDto) {
    return this.kiosk.studentCard(session, id, query);
  }

  @ApiOkResponse({ type: KioskQrLookupResponseDto })
  @HttpCode(200)
  @Post('qr-lookups')
  qrLookup(@FrontDeskSession() session: FrontDeskSessionContext, @Body() dto: DeskQrLookupDto) {
    return this.kiosk.qrLookup(session, dto.studentToken);
  }

  @ApiOkResponse({ type: KioskQrLookupResponseDto })
  @Throttle(CODE_THROTTLE)
  @HttpCode(200)
  @Post('code-lookups')
  codeLookup(@FrontDeskSession() session: FrontDeskSessionContext, @Body() dto: CheckInCodeLookupDto) {
    return this.kiosk.codeLookup(session, dto.code);
  }

  @ApiOkResponse({ type: KioskFindMeResultDto })
  @Throttle(FIND_ME_THROTTLE)
  @HttpCode(200)
  @Post('find-me')
  findMe(@FrontDeskSession() session: FrontDeskSessionContext, @Body() dto: KioskFindMeDto) {
    return this.kiosk.findMe(session, dto.fullName, dto.dateOfBirth);
  }

  @ApiOkResponse({ type: DeskCheckInResponseDto })
  @HttpCode(200)
  @Post('check-ins')
  checkIn(@FrontDeskSession() session: FrontDeskSessionContext, @Body() dto: DeskCheckInDto) {
    return this.kiosk.checkIn(session, dto);
  }

  /** A staff member's own code ends the session (Decision 320). */
  @ApiOkResponse({ type: KioskUnlockedDto })
  @Throttle(UNLOCK_THROTTLE)
  @AllowWhileLocked()
  @HttpCode(200)
  @Post('unlock')
  unlock(@FrontDeskSession() session: FrontDeskSessionContext, @Body() dto: KioskUnlockDto) {
    return this.sessions.unlock(session, dto.staffCode);
  }

  /** A staff member's own code lets a tablet locked by wrong member codes
   * carry on (Decision 417). */
  @ApiOkResponse({ type: KioskResumedDto })
  @Throttle(UNLOCK_THROTTLE)
  @AllowWhileLocked()
  @HttpCode(200)
  @Post('resume')
  resume(@FrontDeskSession() session: FrontDeskSessionContext, @Body() dto: KioskUnlockDto) {
    return this.sessions.resume(session, dto.staffCode);
  }
}
