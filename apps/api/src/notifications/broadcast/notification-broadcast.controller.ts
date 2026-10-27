import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { NotificationBroadcastService } from './notification-broadcast.service';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { BroadcastResponseDto } from './dto/broadcast-response.dto';
import { SentBroadcastListResponseDto } from './dto/sent-broadcast-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** v1.2 backend backlog ("Notifications page" — Broadcast/compose, approved
 * by the product owner). See NotificationBroadcastService's own header
 * comment for why this is a separate controller/module rather than folded
 * into NotificationsController. */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/notifications')
export class NotificationBroadcastController {
  constructor(private readonly broadcastService: NotificationBroadcastService) {}

  @ApiCreatedResponse({ type: BroadcastResponseDto })
  @Post('broadcast')
  broadcast(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: BroadcastNotificationDto) {
    return this.broadcastService.broadcast(user.sub, schoolId, dto);
  }

  /** Decision 363 — the School's sent broadcasts, newest first. Owner only. */
  @ApiOkResponse({ type: SentBroadcastListResponseDto })
  @Get('broadcasts')
  findSent(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Query() query: PaginationQueryDto) {
    return this.broadcastService.findSentForSchool(user.sub, schoolId, query.cursor, query.limit);
  }
}
