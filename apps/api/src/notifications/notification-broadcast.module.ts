import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { NotificationBroadcastController } from './notification-broadcast.controller';
import { NotificationBroadcastService } from './notification-broadcast.service';

/**
 * v1.2 backend backlog's "Compose/broadcast a message to Students" gap
 * (Decision 230) — a sibling of NotificationsModule, not an addition to it.
 * NotificationsModule is already imported BY TenantsModule (for
 * CoachInvitesService's invite email), so importing TenantsModule back into
 * NotificationsModule for TenantAuthorizationService/SchoolsService would be
 * circular. This module follows WaiversModule's own already-established
 * pattern instead: import TenantsModule + QueueModule directly, and is never
 * itself imported by TenantsModule.
 */
@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [NotificationBroadcastController],
  providers: [NotificationBroadcastService],
})
export class NotificationBroadcastModule {}
