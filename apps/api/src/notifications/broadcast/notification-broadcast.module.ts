import { Module } from '@nestjs/common';
import { TenantsModule } from '../../tenants/tenants.module';
import { QueueModule } from '../../jobs/queue.module';
import { NotificationBroadcastController } from './notification-broadcast.controller';
import { NotificationBroadcastService } from './notification-broadcast.service';

/**
 * v1.2 backend backlog ("Notifications page" — Broadcast/compose, approved
 * by the product owner). Deliberately separate from NotificationsModule —
 * see NotificationBroadcastService's own header comment for the circular-
 * import reason. Imports TenantsModule for SchoolsService/
 * TenantAuthorizationService (same shape every other School-Owner-gated
 * module already uses — see WaiversModule) and QueueModule directly for
 * @InjectQueue(NOTIFICATION_FANOUT_QUEUE), the same pattern WaiversModule
 * already established for its own queue injection.
 */
@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [NotificationBroadcastController],
  providers: [NotificationBroadcastService],
})
export class NotificationBroadcastModule {}
