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
import { ChargebackPatternRestrictionProcessor } from './chargeback-pattern-restriction.processor';
import { MembershipExpirySweepProcessor, MembershipExpirySweepScheduler } from './membership-expiry-sweep.processor';
import { GradingNotificationsProcessor, GradingNotificationsScheduler } from './grading-notifications.processor';

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
 *
 * Decision 111 extends StripeWebhookProcessingProcessor again, with real
 * charge.dispute.created/updated/closed handling (Decision 55's own confirmed
 * contract) — the processor now also injects NOTIFICATION_FANOUT_QUEUE directly
 * (the same cross-queue @InjectQueue pattern BookingNoShowProcessingProcessor/
 * WaiverSignatureRequestsProcessor already established) to route a dispute
 * notification to whichever School Owner/Manager or Franchise Owner is
 * financially exposed. No new module import needed for this — QueueModule
 * already registers NOTIFICATION_FANOUT_QUEUE and PaymentsModule already
 * provides StripeClientService, both from the Phase 15/16b-ii wiring above.
 *
 * Decision 112 adds ChargebackPatternRestrictionProcessor (Decision 68's own
 * confirmed job, Decision 111 Phase B) — event-triggered only, no Scheduler
 * (see that processor's own header comment for why); StripeWebhookProcessingProcessor
 * now also injects CHARGEBACK_PATTERN_RESTRICTION_QUEUE to enqueue a check the
 * instant it records a new lost dispute. No new module import needed here either
 * — QueueModule already registers the new queue (added alongside the others),
 * and the new processor's own NOTIFICATION_FANOUT_QUEUE injection is covered by
 * the same QueueModule import already in this module.
 *
 * Closes a real gap flagged since Phase 11/15: WaitlistCascadeProcessingProcessor
 * now also injects NOTIFICATION_FANOUT_QUEUE, the same cross-queue @InjectQueue
 * pattern every prior addition above already established, so a freed seat
 * actually notifies the Student (in-app + email) instead of only flipping the
 * WaitlistEntry's own status. No new module import needed — QueueModule already
 * registers NOTIFICATION_FANOUT_QUEUE from the Phase 15 wiring above.
 *
 * Decision 122 extends StripeWebhookProcessingProcessor once more, closing the
 * "same-day sweep cancels the Student's own future Bookings" half of Spec 55
 * §6.1's Membership-expiry rule (deferred since Phase 8 first wrote this file,
 * before Booking existed) — it now also injects WAITLIST_CASCADE_PROCESSING_QUEUE
 * to notify the waitlist for each seat a cancellation frees, the same
 * cross-queue @InjectQueue pattern BookingNoShowProcessingProcessor already
 * established for that exact queue. No new module import needed — QueueModule
 * already registers WAITLIST_CASCADE_PROCESSING_QUEUE (confirmed above, Phase 11).
 *
 * Closes the other half of that same gap, flagged by Decision 122's own "What
 * this does NOT resolve" note: MembershipExpirySweepProcessor/Scheduler add the
 * missing Booking-cancellation sweep for a Membership that Expires by its own
 * expiryDate passing (no Stripe event involved) — the one Membership-expiry
 * path Decision 122 explicitly left untouched. Deliberately does NOT persist
 * Membership.status for this path — Decision 26 confirms that stays
 * live-computed-only, never a scheduled batch flip; see the processor's own
 * header comment for a real bug this distinction caught before merge. Reuses
 * the exact Booking-cancellation helper Decision 122 wrote, now extracted to
 * its own file (membership-booking-cancellation.ts) so both the Stripe-driven
 * and date-based paths share one implementation. No new module import needed
 * — same PrismaJobsService/WAITLIST_CASCADE_PROCESSING_QUEUE dependencies every sweep
 * above it already uses.
 *
 * Decisions 145, 178 add GradingNotificationsProcessor/Scheduler: "ready to
 * grade" checks (queued by GradingService and AttendanceService after an
 * action, plus a daily sweep) and the routing of "you've been promoted" to the
 * student or a minor's guardians. Fans out through NOTIFICATION_FANOUT_QUEUE
 * like the others; no new module import.
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
    ChargebackPatternRestrictionProcessor,
    MembershipExpirySweepProcessor,
    MembershipExpirySweepScheduler,
    GradingNotificationsProcessor,
    GradingNotificationsScheduler,
  ],
})
export class JobsModule {}
