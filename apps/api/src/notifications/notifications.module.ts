import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationDeliveryService } from './notification-delivery.service';

/**
 * Phase 15 scope only: read-side notifications, DeviceToken registration, and
 * the email-delivery client the notification-fanout job (src/jobs/) depends
 * on. See NotificationsService's own header comment for the read/write split
 * and NotificationDeliveryService's own header comment for the delivery
 * mechanics.
 *
 * `NotificationDeliveryService` is exported (not just a local provider) —
 * `JobsModule` needs it too, for `NotificationFanoutProcessor`. No
 * `TenantsModule` import needed — every operation here is self-only, no
 * School-Owner-gated write anywhere in this module.
 *
 * Deliberately NOT built this phase, flagged for a fast-follow rather than
 * silently assumed complete: push dispatch (the actual FCM/APNs send — this
 * phase only builds DeviceToken registration, not delivery), a consolidated
 * trigger catalog beyond the one wired this phase (waiver-signature-requests —
 * payment-failed, waitlist-promotion, chargeback-pattern-restriction, and
 * account-deletion each have their own "Notification samples" text in Spec 55
 * §9 but are not wired to enqueue notification-fanout yet), and any
 * notification-preferences/opt-in granularity (Spec 55 never designs one
 * beyond a blanket push/email toggle).
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationDeliveryService],
  exports: [NotificationDeliveryService],
})
export class NotificationsModule {}
