import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { PushNotificationService } from './push-notification.service';

/**
 * Phase 15 scope only: read-side notifications, DeviceToken registration, and
 * the email-delivery client the notification-fanout job (src/jobs/) depends
 * on. See NotificationsService's own header comment for the read/write split
 * and NotificationDeliveryService's own header comment for the delivery
 * mechanics.
 *
 * `NotificationDeliveryService`/`PushNotificationService` are exported (not
 * just local providers) — `JobsModule` needs both too, for
 * `NotificationFanoutProcessor`. No `TenantsModule` import needed — every
 * operation here is self-only, no School-Owner-gated write anywhere in this
 * module. v1.2 backend backlog's Snooze (approved by the product owner) stays
 * self-only too (`PATCH /notifications/:id/snooze`, below) — the
 * School-Owner-gated Broadcast/compose endpoint this phase also adds lives in
 * the separate `NotificationBroadcastModule` instead, precisely because it
 * ISN'T self-only and needs `TenantsModule` — see that module's own header
 * comment for why importing it here would be circular.
 *
 * Push dispatch (Decision 223/264) is now wired via `PushNotificationService`
 * — see that service's own header comment for why it's still non-functional
 * without real FCM credentials. Deliberately still NOT built, flagged for a
 * fast-follow rather than silently assumed complete: a consolidated trigger
 * catalog beyond the one wired this phase (waiver-signature-requests —
 * payment-failed, waitlist-promotion, chargeback-pattern-restriction, and
 * account-deletion each have their own "Notification samples" text in Spec 55
 * §9 but are not wired to enqueue notification-fanout yet), any
 * notification-preferences/opt-in granularity (Spec 55 never designs one
 * beyond a blanket push/email toggle), and the delivery-rate/read-within-24h
 * push metrics Decision 223 explicitly deferred until SEND is real.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationDeliveryService, PushNotificationService],
  exports: [NotificationDeliveryService, PushNotificationService],
})
export class NotificationsModule {}
