import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RankCorrectionsService } from './rank-corrections.service';
import { CreateRankCorrectionDto, RankCorrectionDto, RankCorrectionListDto, RankCorrectionListQueryDto, ReviewRankCorrectionDto } from './dto/rank-correction.dto';

/** Backlog 3.13 (Decisions 286, 299): belt correction requests. */
@ApiTags('grading')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RankCorrectionsController {
  constructor(private readonly corrections: RankCorrectionsService) {}

  /** A student asks for their belt in one style to be corrected. */
  @ApiCreatedResponse({ type: RankCorrectionDto })
  @Post('rank-corrections')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRankCorrectionDto) {
    return this.corrections.create(user.sub, dto);
  }

  @ApiOkResponse({ type: RankCorrectionListDto })
  @Get('rank-corrections/me')
  mine(@CurrentUser() user: JwtPayload) {
    return this.corrections.mine(user.sub);
  }

  /** The requests the caller may answer at this School. */
  @ApiOkResponse({ type: RankCorrectionListDto })
  @Get('schools/:schoolId/rank-corrections')
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: RankCorrectionListQueryDto) {
    return this.corrections.list(user.sub, schoolId, query);
  }

  @ApiOkResponse({ type: RankCorrectionDto })
  @HttpCode(200)
  @Post('rank-corrections/:id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewRankCorrectionDto) {
    return this.corrections.approve(user.sub, id, dto.note ?? null);
  }

  @ApiOkResponse({ type: RankCorrectionDto })
  @HttpCode(200)
  @Post('rank-corrections/:id/reject')
  reject(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewRankCorrectionDto) {
    return this.corrections.reject(user.sub, id, dto.note ?? null);
  }
}
