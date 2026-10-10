import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { GradingService } from './grading.service';
import { DeclareRankDto, DowngradeActionDto, EditRankDateDto, GradingActionDto, VerifyRankDto, VoidPromotionEventDto } from './dto/grading-action.dto';
import { StudentEligibilityListResponseDto, StudentRankListResponseDto } from './dto/student-rank-response.dto';
import { PromotionEventListResponseDto, PromotionEventResponseDto } from './dto/promotion-event-response.dto';
import { BoardActiveDto, BoardMoveDto, BoardThresholdsDto, BulkPromoteDto, BulkPromoteResponseDto, GradingBoardResponseDto, LogClassDto } from './dto/grading-board.dto';
import { DisciplineResponseDto } from './dto/discipline-response.dto';
import { Throttle } from '@nestjs/throttler';

// StudentRank reads + grading actions. `schoolId` is a required query param on
// every read below — same reasoning GET /students/{id}/membership-status needed
// one in Phase 9 (a Student's StudentRank rows are School-scoped, and without it
// this can't know which School's data to read).
@ApiTags('ranks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class GradingController {
  constructor(private readonly gradingService: GradingService) {}

  // FOUND ON REVIEW: unlike rank-history below, these two intentionally don't
  // expose cursor/limit or a nextCursor in their response — a Student's
  // StudentRank rows are bounded by the number of Disciplines they train in
  // (one row per Discipline, §5), not an unbounded, ever-growing log the way
  // PromotionEvent history is. cursorPaginate is still used internally purely
  // for its query-shaping helpers, not because pagination is meaningful here.
  @ApiOkResponse({ type: StudentRankListResponseDto })
  @Get('students/:id/ranks')
  async findRanksForStudent(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Query('schoolId') schoolId: string) {
    return { items: (await this.gradingService.findRanksForStudent(user.sub, id, schoolId)).items };
  }

  @ApiOkResponse({ type: StudentEligibilityListResponseDto })
  @Get('students/:id/eligibility')
  findEligibilityForStudent(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Query('schoolId') schoolId: string) {
    return this.gradingService.findEligibilityForStudent(user.sub, id, schoolId);
  }

  @ApiOkResponse({ type: PromotionEventListResponseDto })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor from the previous page.' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'includeVoided', required: false, type: Boolean, description: 'Staff only: also return voided entries (Decision 129).' })
  @Get('students/:id/rank-history')
  findRankHistoryForStudent(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('schoolId') schoolId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
    @Query('includeVoided') includeVoided?: string,
  ) {
    return this.gradingService.findRankHistoryForStudent(user.sub, id, schoolId, cursor, limit, includeVoided === 'true');
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/rank-history/:eventId/void')
  voidPromotionEvent(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: VoidPromotionEventDto,
  ) {
    return this.gradingService.voidPromotionEvent(user.sub, id, schoolId, eventId, dto);
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Patch('students/:id/ranks/:disciplineId/rank-date')
  editRankDate(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: EditRankDateDto,
  ) {
    return this.gradingService.editRankDate(user.sub, id, disciplineId, dto);
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/promote')
  promote(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: GradingActionDto,
  ) {
    return this.gradingService.promote(user.sub, id, disciplineId, dto);
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/downgrade')
  downgrade(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: DowngradeActionDto,
  ) {
    return this.gradingService.downgrade(user.sub, id, disciplineId, dto);
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/stripe-award')
  stripeAward(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: GradingActionDto,
  ) {
    return this.gradingService.stripeAward(user.sub, id, disciplineId, dto);
  }

  @Patch('students/:id/skills/:skillId')
  cycleSkillSignOff(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Param('skillId', ParseUUIDPipe) skillId: string) {
    return this.gradingService.cycleSkillSignOff(user.sub, id, skillId);
  }

  /** The student (or their guardian) declares their current rung when joining
   * (Decision 137). UNVERIFIED unless it is the style's first rung (Decision 147). */
  @Post('students/:id/ranks/:disciplineId/declare')
  declareRank(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: DeclareRankDto,
  ) {
    return this.gradingService.declareRank(user.sub, id, disciplineId, dto);
  }

  /** Staff with grading permission verify a self-declared rank, optionally
   * correcting it (Decision 147). */
  @Post('students/:id/ranks/:disciplineId/verify')
  verifyRank(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: VerifyRankDto,
  ) {
    return this.gradingService.verifyRank(user.sub, id, disciplineId, dto);
  }

  /** Owner only for now: ranks waiting to be verified (Decision 137, item 4). */
  @ApiOkResponse({ type: StudentRankListResponseDto })
  @Get('schools/:schoolId/rank-verifications')
  findPendingVerifications(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.gradingService.findPendingVerifications(user.sub, schoolId);
  }

  /** The Grading Board for one style (roadmap Phase 3b): every student with a
   * next rank, highest progress first. Owner: every student; other staff: the
   * students of their own branches (Decision 168). */
  @ApiOkResponse({ type: GradingBoardResponseDto })
  @ApiQuery({ name: 'disciplineId', required: true })
  @ApiQuery({ name: 'search', required: false, description: 'Part of the student\'s name.' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean, description: '"Currently attending only" (Decision 152).' })
  @Get('schools/:schoolId/grading-board')
  getGradingBoard(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Query('disciplineId') disciplineId: string,
    @Query('search') search?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.gradingService.getGradingBoard(user.sub, schoolId, disciplineId, { search, activeOnly: activeOnly === 'true' });
  }

  @ApiOkResponse({ type: DisciplineResponseDto, description: 'The style, with its new board columns.' })
  @Put('disciplines/:id/board-thresholds')
  setBoardThresholds(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BoardThresholdsDto) {
    return this.gradingService.setBoardThresholds(user.sub, id, dto);
  }

  /** Drag on the Grading Board (Decision 128 item 13, Decision 174). */
  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/board-move')
  moveOnBoard(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Param('disciplineId', ParseUUIDPipe) disciplineId: string, @Body() dto: BoardMoveDto) {
    return this.gradingService.moveOnBoard(user.sub, id, disciplineId, dto);
  }

  /** "Log a class" (Decision 128 item 6, Decision 176). */
  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/log-class')
  logClass(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Param('disciplineId', ParseUUIDPipe) disciplineId: string, @Body() dto: LogClassDto) {
    return this.gradingService.logClass(user.sub, id, disciplineId, dto);
  }

  /** The manual Active/Inactive switch for this style (Decisions 152, 176). */
  @Put('students/:id/ranks/:disciplineId/board-active')
  setBoardActive(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Param('disciplineId', ParseUUIDPipe) disciplineId: string, @Body() dto: BoardActiveDto) {
    return this.gradingService.setBoardActive(user.sub, id, disciplineId, dto);
  }

  /** Bulk promote (roadmap Phase 3c, Decision 130): up to 200 students, one
   * rung each, on one date. Use dryRun first for the "Needs a look" list.
   * Rate-limited tighter than the default: each call can write 200 grades. */
  @ApiOkResponse({ type: BulkPromoteResponseDto })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('schools/:schoolId/grading/bulk-promote')
  bulkPromote(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: BulkPromoteDto) {
    return this.gradingService.bulkPromote(user.sub, schoolId, dto);
  }
}
