import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from './queue.module';
import { OtpDeliveryProcessor } from './otp-delivery.processor';
import { ClassOccurrenceGenerationProcessor, ClassOccurrenceGenerationScheduler } from './class-occurrence-generation.processor';
import { StripeWebhookProcessingProcessor } from './stripe-webhook-processing.processor';
import { WaiverSignatureRequestsProcessor } from './waiver-signature-requests.processor';
import { BookingNoShowProcessingProcessor, BookingNoShowProcessingScheduler } from './booking-no-show-processing.processor';
import { WaitlistCascadeProcessingProcessor, WaitlistCascadeProcessingScheduler } from './waitlist-cascade-processing.processor';

/**
 * Hosts every BullMQ consumer/scheduler in the codebase. Imports AuthModule for
 * TwilioVerifyService (OtpDeliveryProcessor calls its sendOtpNow()) and QueueModule
 * for the queues themselves/@InjectQueue support. StripeWebhookProcessingProcessor
 * (Phase 8) needs no extra module import beyond PrismaAppService, which is global.
 * WaiverSignatureRequestsProcessor (Phase 10) needs no Prisma access at all this
 * phase — it's a log-only stub (see its own header comment).
 *
 * Phase 11 adds two more: BookingNoShowProcessingProcessor/Scheduler (a pure
 * scheduled sweep) and WaitlistCascadeProcessingProcessor/Scheduler (a scheduled
 * sweep PLUS an event-triggered job enqueued by BookingsModule — see that
 * processor's own header comment). BookingNoShowProcessingProcessor injects
 * WAITLIST_CASCADE_PROCESSING_QUEUE directly (via @InjectQueue), which is why
 * QueueModule must already register both queues before this module resolves either
 * processor — confirmed true, both are registered in the same QueueModule.
 */
@Module({
  imports: [AuthModule, QueueModule],
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
  ],
})
export class JobsModule {}
