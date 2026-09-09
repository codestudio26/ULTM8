import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { GradingService } from './grading.service';
import { GradingActionDto } from './dto/grading-action.dto';
import { StudentRankListResponseDto } from './dto/student-rank-response.dto';
import { PromotionEventListResponseDto, PromotionEventResponseDto } from './dto/promotion-event-response.dto';

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
  async findRanksForStudent(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query('schoolId') schoolId: string) {
    return { items: (await this.gradingService.findRanksForStudent(user.sub, id, schoolId)).items };
  }

  @ApiOkResponse({ type: StudentRankListResponseDto })
  @Get('students/:id/eligibility')
  async findEligibilityForStudent(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query('schoolId') schoolId: string) {
    return { items: (await this.gradingService.findEligibilityForStudent(user.sub, id, schoolId)).items };
  }

  @ApiOkResponse({ type: PromotionEventListResponseDto })
  @Get('students/:id/rank-history')
  findRankHistoryForStudent(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('schoolId') schoolId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.gradingService.findRankHistoryForStudent(user.sub, id, schoolId, cursor, limit);
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/promote')
  promote(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('disciplineId') disciplineId: string,
    @Body() dto: GradingActionDto,
  ) {
    return this.gradingService.promote(user.sub, id, disciplineId, dto);
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/downgrade')
  downgrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('disciplineId') disciplineId: string,
    @Body() dto: GradingActionDto,
  ) {
    return this.gradingService.downgrade(user.sub, id, disciplineId, dto);
  }

  @ApiOkResponse({ type: PromotionEventResponseDto })
  @Post('students/:id/ranks/:disciplineId/stripe-award')
  stripeAward(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('disciplineId') disciplineId: string,
    @Body() dto: GradingActionDto,
  ) {
    return this.gradingService.stripeAward(user.sub, id, disciplineId, dto);
  }

  @Patch('students/:id/skills/:skillId')
  cycleSkillSignOff(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('skillId') skillId: string) {
    return this.gradingService.cycleSkillSignOff(user.sub, id, skillId);
  }
}
