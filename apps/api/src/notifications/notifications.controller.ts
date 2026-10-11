import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { NotificationsService } from './notifications.service';
import { NotificationListResponseDto, NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationCountsResponseDto } from './dto/notification-counts-response.dto';
import { RegisterDeviceTokenDto } from './dto/device-token.dto';
import { DeviceTokenResponseDto } from './dto/device-token-response.dto';

/**
 * Phase 15 scope only: read-side notifications (list/mark-read) and DeviceToken
 * registration. See NotificationsService's own header comment for what's
 * deliberately not here (the write side lives in
 * apps/api/src/jobs/notification-fanout.processor.ts, a background job, not
 * this controller) and NotificationsModule's own header comment for the full
 * phase-scoping rationale (push dispatch deferred, email delivery real).
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOkResponse({ type: NotificationListResponseDto })
  @Get('me')
  findAllForCaller(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.notificationsService.findAllForCaller(user.sub, query.cursor, query.limit);
  }

  /** v1.2 backend backlog — a true, caller-wide total/unread count (Decision
   * 204's Concept 5 finding). A static `me/counts` segment, declared before
   * the `:id/read` route below — no ordering ambiguity either way since that
   * route's second segment is the literal `read`, not a second wildcard, but
   * static routes still come first here as this controller's own convention. */
  @ApiOkResponse({ type: NotificationCountsResponseDto })
  @Get('me/counts')
  getCountsForCaller(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.getCountsForCaller(user.sub);
  }

  @ApiOkResponse({ type: NotificationResponseDto })
  @Patch(':id/read')
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.markRead(user.sub, id);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':id')
  deleteNotification(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.deleteNotification(user.sub, id);
  }

  @ApiCreatedResponse({ type: DeviceTokenResponseDto })
  @Post('device-tokens')
  registerDeviceToken(@CurrentUser() user: JwtPayload, @Body() dto: RegisterDeviceTokenDto) {
    return this.notificationsService.registerDeviceToken(user.sub, dto);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('device-tokens/:id')
  deregisterDeviceToken(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.deregisterDeviceToken(user.sub, id);
  }
}
