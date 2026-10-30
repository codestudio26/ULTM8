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
import { MembershipPlanPriceMigrationProcessor } from './membership-plan-price-migration.processor';
import { NotificationUnsnoozeSweepProcessor, NotificationUnsnoozeSweepScheduler } from './notification-unsnooze-sweep.processor';
import { EntityOffboardingPurgeProcessor, EntityOffboardingPurgeScheduler } from './entity-offboarding-purge.processor';
import { VideoProcessingPollProcessor, VideoProcessingPollScheduler } from './video-processing-poll.processor';
import { CloudflareStreamService } from '../common/video/cloudflare-stream.service';
import { TranscribeService } from '../common/video/transcribe.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { FranchiseFeeRateMigrationProcessor } from './franchise-fee-rate-migration.processor';
import { WaiverRenewalSweepProcessor, WaiverRenewalSweepScheduler } from './waiver-renewal-sweep.processor';
import { WaiverAssignmentModule } from '../waivers/waiver-assignment.module';
import { ChargeAutoPayProcessor, ChargeAutoPayScheduler } from './charge-auto-pay.processor';
import { ChargeOverdueNoticeProcessor, ChargeOverdueNoticeScheduler } from './charge-overdue-notice.processor';
import { LateFeeProcessor, LateFeeScheduler } from './late-fee.processor';
import { ChargeRecurringProcessor, ChargeRecurringScheduler } from './charge-recurring.processor';

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
 *
 * v1.2 backend backlog (Subscription price-change migrate-vs-grandfather
 * prompt) adds MembershipPlanPriceMigrationProcessor — event-triggered only,
 * no Scheduler (same shape as ChargebackPatternRestrictionProcessor's own
 * reasoning). Needs PaymentsService directly (its own
 * migrateSubscriptionToNewPrice()) — already available via the PaymentsModule
 * import above; no new module import needed.
 *
 * v1.2 backend backlog ("Notifications page" — Snooze, approved by the
 * product owner) adds NotificationUnsnoozeSweepProcessor/Scheduler — a pure
 * scheduled sweep, same shape as BookingNoShowProcessingScheduler/
 * ClassOccurrenceGenerationScheduler, needing no new module import (only
 * PrismaJobsService, already global, and its own queue, already registered
 * in QueueModule).
 *
 * Decision 226 adds EntityOffboardingPurgeProcessor/Scheduler — a pure
 * scheduled sweep for the 7 entity-level tenant-offboarding archive()
 * methods (Branch/Class/TimetableSlot/Instructor/Rank/Waiver/Lesson), same
 * shape as TenantLifecyclePurgeProcessor/Scheduler above. No new module
 * import needed — only PrismaJobsService (already global) and its own
 * queue (already registered in QueueModule).
 *
 * Decision 227/254 adds VideoProcessingPollProcessor/Scheduler — a genuinely
 * new shape in this directory, not another plain sweep (see that
 * processor's own header comment for the full state-machine account): polls
 * Cloudflare Stream/AWS Transcribe to completion for every Lesson whose
 * captionStatus is PROCESSING. Needs CloudflareStreamService and
 * TranscribeService directly — neither has its own NestJS module (same as
 * every other plain-@Injectable() vendor client in this codebase, e.g.
 * R2ClientService), so both are added as plain providers here rather than
 * imported from elsewhere; CurriculumModule separately provides
 * CloudflareStreamService for its own requestVideoUploadUrl() — Nest allows
 * the same provider class to be instantiated per-module this way, and the
 * two have no shared state to desync.
 *
 * Decision 99's own follow-up adds FranchiseFeeRateMigrationProcessor —
 * event-triggered only, no Scheduler (same shape MembershipPlanPriceMigrationProcessor
 * already established). Needs FranchiseFeeBillingService directly (its own
 * createReplacementMeteredPrice/createReplacementFlatPrice/swapSubscriptionPrice) —
 * already available via the FranchiseFeesModule import above, same as
 * FranchiseFeeUsageReportingProcessor; no new module import needed. Also injects
 * its own queue directly (@InjectQueue(FRANCHISE_FEE_RATE_MIGRATION_QUEUE)) to
 * enqueue its own deferred `deferred-swap` follow-up job — already registered in
 * QueueModule, imported above.
 *
 * Backlog §3.6 step 2 adds ChargeAutoPayProcessor/Scheduler — a daily sweep
 * charging members' due charges to their saved card (Decision 338 item 8).
 * Needs PaymentsService.chargeOffSession(), already available via the
 * PaymentsModule import; its ledger writes are the plain functions in
 * charges/charge-ledger.ts, so no ChargesModule import.
 *
 * Backlog §3.6 step 4 adds ChargeOverdueNoticeProcessor/Scheduler — a daily
 * "Payment overdue" notice, once per charge (Decision 338 item 10).
 * Backlog §3.7 adds LateFeeProcessor/Scheduler — a daily run (7am UTC, after
 * charge-auto-pay) adding one late fee to the member's balance for each
 * payment still unpaid after the School's grace days (Decision 413). Plain
 * ledger functions and the notification queue only; no new module import.
 * Backlog §3.6 step 3 adds ChargeRecurringProcessor/Scheduler — a daily run
 * (5:30am UTC, before charge-auto-pay) making recurring charges' occurrences
 * (Decision 412), with the plain functions in charges/recurring-occurrences.ts.
 */
@Module({
  imports: [AuthModule, NotificationsModule, FranchiseFeesModule, PaymentsModule, QueueModule, WaiverAssignmentModule],
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
    MembershipPlanPriceMigrationProcessor,
    NotificationUnsnoozeSweepProcessor,
    NotificationUnsnoozeSweepScheduler,
    EntityOffboardingPurgeProcessor,
    EntityOffboardingPurgeScheduler,
    VideoProcessingPollProcessor,
    VideoProcessingPollScheduler,
    CloudflareStreamService,
    TranscribeService,
    R2ClientService,
    FranchiseFeeRateMigrationProcessor,
    WaiverRenewalSweepProcessor,
    WaiverRenewalSweepScheduler,
    ChargeAutoPayProcessor,
    ChargeAutoPayScheduler,
    ChargeOverdueNoticeProcessor,
    ChargeOverdueNoticeScheduler,
    LateFeeProcessor,
    LateFeeScheduler,
    ChargeRecurringProcessor,
    ChargeRecurringScheduler,
  ],
})
export class JobsModule {}
