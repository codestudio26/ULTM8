import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FranchiseFeesModule } from '../franchise-fees/franchise-fees.module';
import { PaymentsModule } from '../payments/payments.module';
import { QueueModule } from './queue.module';
import { OtpDeliveryProcessor } from './otp-delivery.processor';
import { ClassOccurrenceGenerationProcessor, ClassOccurrenceGenerationScheduler } from './class-occurrence-generation.processor';
import { StripeWebhookProcessingProcessor } from './stripe-webhook-processing.processor';
import { WaiverSignatureRequestsProcessor } from './waiver-signature-requests.processor';
import { BookingNoShowProcessingProcessor, BookingNoShowProcessingScheduler } from './booking-no-show-processing.processor';
import { WaitlistCascadeProcessingProcessor, WaitlistCascadeProcessingScheduler } from './waitlist-cascade-processing.processor';
import { NotificationFanoutProcessor } from './notification-fanout.processor';
import { FranchiseFeeUsageReportingProcessor, FranchiseFeeUsageReportingScheduler } from './franchise-fee-usage-reporting.processor';
import { TenantLifecyclePurgeProcessor, TenantLifecyclePurgeScheduler } from './tenant-lifecycle-purge.processor';

/**
 * Hosts every BullMQ consumer/scheduler in the codebase. Imports AuthModule for
 * TwilioVerifyService (OtpDeliveryProcessor calls its sendOtpNow()) and QueueModule
 * for the queues themselves/@InjectQueue support. StripeWebhookProcessingProcessor
 * (Phase 8) needs no extra module import beyond PrismaAppService, which is global.
 *
 * Phase 11 adds two more: BookingNoShowProcessingProcessor/Scheduler (a pure
 * scheduled sweep) and WaitlistCascadeProcessingProcessor/Scheduler (a scheduled
 * sweep PLUS an event-triggered job enqueued by BookingsModule — see that
 * processor's own header comment). BookingNoShowProcessingProcessor injects
 * WAITLIST_CASCADE_PROCESSING_QUEUE directly (via @InjectQueue), which is why
 * QueueModule must already register both queues before this module resolves either
 * processor — confirmed true, both are registered in the same QueueModule.
 *
 * Phase 15 adds NotificationFanoutProcessor (the actual notification-write +
 * email-delivery consumer) and rewires WaiverSignatureRequestsProcessor — no
 * longer a log-only stub, it now injects NOTIFICATION_FANOUT_QUEUE directly to
 * fan out real notifications, the same @InjectQueue pattern
 * BookingNoShowProcessingProcessor already established for cross-queue
 * enqueueing. Imports NotificationsModule for NotificationDeliveryService
 * (NotificationFanoutProcessor's own dependency).
 *
 * Phase 16b-ii adds FranchiseFeeUsageReportingProcessor/Scheduler (a scheduled
 * sweep, same shape as ClassOccurrenceGenerationScheduler/BookingNoShowProcessingScheduler)
 * and extends StripeWebhookProcessingProcessor with real invoice.paid/
 * invoice.payment_failed handling — which needs StripeClientService directly
 * for the first time in this file (every earlier handler only ever matched an
 * id against a stored correlator column; these two must call back into Stripe
 * to fetch the full Invoice), hence the new PaymentsModule import. Imports
 * FranchiseFeesModule for FranchiseFeeBillingService (the new processor's own
 * Stripe-primitives dependency).
 *
 * Phase 56 adds TenantLifecyclePurgeProcessor/Scheduler (Decision 110) — a
 * pure scheduled sweep, same shape as ClassOccurrenceGenerationScheduler/
 * BookingNoShowProcessingScheduler, needing no new module import (only
 * PrismaJobsService, already global).
 */
@Module({
  imports: [AuthModule, NotificationsModule, FranchiseFeesModule, PaymentsModule, QueueModule],
  providers: [
    OtpDeliveryProcessor,
    ClassOccurrenceGenerationProcessor,
    ClassOccurrenceGenerationScheduler,
    StripeWebhookProcessingProcessor,
    WaiverSignatureRequestsProcessor,
    BookingNoShowProcessingProcessor,
    BookingNoShowProcessingScheduler,
    WaitlistCascadeProcessingProcessor,
    WaitlistCascadeProcessingScheduler,
    NotificationFanoutProcessor,
    FranchiseFeeUsageReportingProcessor,
    FranchiseFeeUsageReportingScheduler,
    TenantLifecyclePurgeProcessor,
    TenantLifecyclePurgeScheduler,
  ],
})
export class JobsModule {}
