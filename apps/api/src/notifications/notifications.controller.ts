import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { NotificationsService } from './notifications.service';
import { NotificationListResponseDto, NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationCountsResponseDto } from './dto/notification-counts-response.dto';
import { MarkAllReadResponseDto } from './dto/mark-all-read-response.dto';
import { ClearReadNotificationsResponseDto } from './dto/clear-read-notifications-response.dto';
import { RegisterDeviceTokenDto } from './dto/device-token.dto';
import { DeviceTokenResponseDto } from './dto/device-token-response.dto';
import { SnoozeNotificationDto } from './dto/snooze-notification.dto';

/**
 * Phase 15 scope: read-side notifications (list/mark-read/counts) and
 * DeviceToken registration. v1.2 backend backlog (approved by the product
 * owner) adds snooze (below), and Decision 277 adds soft delete and "Clear
 * all read" — still the caller's own notifications only, no
 * cross-user write here. See NotificationsService's own header comment for
 * what's deliberately not here (the fan-out WRITE side lives in
 * apps/api/src/jobs/notification-fanout.processor.ts, a background job, not
 * this controller — the broadcast/compose entry point that feeds it is
 * `POST /schools/:schoolId/notifications/broadcast`, a separate, School-
 * Owner-gated endpoint in NotificationBroadcastController, not here, since
 * that one is NOT self-only) and NotificationsModule's own header comment for
 * the full phase-scoping rationale (push dispatch deferred, email delivery
 * real).
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

  /** Decision 277 — "Clear all read": soft-deletes every read Notification
   * the caller has. A static `me/clear-read` segment, declared before the
   * `:id` routes below, same convention as `me/counts` above. */
  @ApiOkResponse({ type: ClearReadNotificationsResponseDto })
  @HttpCode(200)
  @Post('me/clear-read')
  clearRead(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.clearRead(user.sub);
  }

  /** Decision 355 — "Mark all read". Static segment before the `:id` routes,
   * same convention as `me/clear-read` above. */
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  @HttpCode(200)
  @Post('me/read-all')
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAllRead(user.sub);
  }

  @ApiOkResponse({ type: NotificationResponseDto })
  @Patch(':id/read')
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.markRead(user.sub, id);
  }

  /** v1.2 backend backlog — Snooze, approved by the product owner. See
   * NotificationsService.snooze's own header comment for the body shape. */
  @ApiOkResponse({ type: NotificationResponseDto })
  @Patch(':id/snooze')
  snooze(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SnoozeNotificationDto) {
    return this.notificationsService.snooze(user.sub, id, dto);
  }

  /** Decision 277 — hides one Notification (soft delete, the record is kept).
   * See NotificationsService.softDelete's own header comment. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':id')
  softDelete(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.softDelete(user.sub, id);
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
