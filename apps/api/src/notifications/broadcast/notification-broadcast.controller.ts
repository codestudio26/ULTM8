import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { NotificationBroadcastService } from './notification-broadcast.service';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { BroadcastResponseDto } from './dto/broadcast-response.dto';

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
}
