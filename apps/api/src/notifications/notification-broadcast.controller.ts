import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { NotificationBroadcastService } from './notification-broadcast.service';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { BroadcastNotificationResponseDto } from './dto/broadcast-notification-response.dto';

/**
 * Separate controller/module from NotificationsController — see
 * NotificationBroadcastService's own header comment for why (circular-import
 * avoidance, WaiversModule precedent). Same `schools/:schoolId/...` path
 * shape WaiversController already uses for a School-Owner-gated write.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationBroadcastController {
  constructor(private readonly notificationBroadcastService: NotificationBroadcastService) {}

  @ApiCreatedResponse({ type: BroadcastNotificationResponseDto })
  @Post('schools/:schoolId/notifications/broadcast')
  broadcast(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: BroadcastNotificationDto) {
    return this.notificationBroadcastService.broadcastToSchool(user.sub, schoolId, dto);
  }
}
