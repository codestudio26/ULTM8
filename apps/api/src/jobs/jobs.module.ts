import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from './queue.module';
import { OtpDeliveryProcessor } from './otp-delivery.processor';
import { ClassOccurrenceGenerationProcessor, ClassOccurrenceGenerationScheduler } from './class-occurrence-generation.processor';
import { StripeWebhookProcessingProcessor } from './stripe-webhook-processing.processor';

/**
 * Hosts every BullMQ consumer/scheduler in the codebase. Imports AuthModule for
 * TwilioVerifyService (OtpDeliveryProcessor calls its sendOtpNow()) and QueueModule
 * for the queues themselves/@InjectQueue support. StripeWebhookProcessingProcessor
 * (Phase 8) needs no extra module import beyond PrismaAppService, which is global.
 */
@Module({
  imports: [AuthModule, QueueModule],
  providers: [
    OtpDeliveryProcessor,
    ClassOccurrenceGenerationProcessor,
    ClassOccurrenceGenerationScheduler,
    StripeWebhookProcessingProcessor,
  ],
})
export class JobsModule {}
