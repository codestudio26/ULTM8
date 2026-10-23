import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PromotionFeeService } from './promotion-fee.service';
import {
  PromotionFeeRequestListResponseDto,
  PromotionFeeRequestQueryDto,
  PromotionFeeRequestResponseDto,
  PromotionFeeSettingsResponseDto,
  UpdatePromotionFeeSettingsDto,
} from './dto/promotion-fee.dto';

/** Promotion fee (Decisions 287, 297, 300, 307, 313). Paying an accepted fee
 * belongs to staff-created charges (Decision 303), not built: there is no
 * endpoint for it here. */
@ApiTags('ranks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PromotionFeeController {
  constructor(private readonly promotionFeeService: PromotionFeeService) {}

  /** The School's promotion fee switches. Any staff member may read them. */
  @ApiOkResponse({ type: PromotionFeeSettingsResponseDto })
  @Get('schools/:schoolId/promotion-fee-settings')
  getSettings(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.promotionFeeService.getSettings(user.sub, schoolId);
  }

  /** Change the switches: the School owner only (Decision 297). */
  @ApiOkResponse({ type: PromotionFeeSettingsResponseDto })
  @Put('schools/:schoolId/promotion-fee-settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: UpdatePromotionFeeSettingsDto) {
    return this.promotionFeeService.updateSettings(user.sub, schoolId, dto);
  }

  /** A School's fee requests, newest first: the owner sees all, other staff
   * those of the students they cover. */
  @ApiOkResponse({ type: PromotionFeeRequestListResponseDto })
  @Get('schools/:schoolId/promotion-fee-requests')
  listForSchool(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: PromotionFeeRequestQueryDto) {
    return this.promotionFeeService.listForSchool(user.sub, schoolId, query, query.cursor, query.limit);
  }

  /** The student's own fee requests at every School, for the student or
   * their Guardian (the student app). */
  @ApiOkResponse({ type: PromotionFeeRequestListResponseDto })
  @Get('students/:id/promotion-fee-requests')
  listForStudent(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionFeeService.listForStudent(user.sub, id);
  }

  /** The student (or their Guardian) accepts the fee. */
  @ApiOkResponse({ type: PromotionFeeRequestResponseDto })
  @Post('promotion-fee-requests/:id/accept')
  accept(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionFeeService.accept(user.sub, id);
  }

  /** The student (or their Guardian) declines the fee. */
  @ApiOkResponse({ type: PromotionFeeRequestResponseDto })
  @Post('promotion-fee-requests/:id/decline')
  decline(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionFeeService.decline(user.sub, id);
  }

  /** The owner waives the fee: a waiting promotion applies now; a declined
   * one becomes "to decide". */
  @ApiOkResponse({ type: PromotionFeeRequestResponseDto })
  @Post('promotion-fee-requests/:id/waive')
  waive(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionFeeService.waive(user.sub, id);
  }

  /** The owner cancels the fee: a promotion that never applied becomes
   * "to decide". */
  @ApiOkResponse({ type: PromotionFeeRequestResponseDto })
  @Post('promotion-fee-requests/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionFeeService.cancel(user.sub, id);
  }

  /** A coach who may promote the student (or the owner) decides not to
   * promote a "to decide" promotion. */
  @ApiOkResponse({ type: PromotionFeeRequestResponseDto })
  @Post('promotion-fee-requests/:id/dismiss')
  dismiss(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.promotionFeeService.dismiss(user.sub, id);
  }
}
