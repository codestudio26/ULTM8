import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from './queue.module';
import { OtpDeliveryProcessor } from './otp-delivery.processor';
import { ClassOccurrenceGenerationProcessor, ClassOccurrenceGenerationScheduler } from './class-occurrence-generation.processor';

/**
 * Phase 5 — hosts every BullMQ consumer/scheduler in the codebase. Imports AuthModule
 * for TwilioVerifyService (OtpDeliveryProcessor calls its sendOtpNow()) and
 * QueueModule for the queues themselves/@InjectQueue support.
 */
@Module({
  imports: [AuthModule, QueueModule],
  providers: [OtpDeliveryProcessor, ClassOccurrenceGenerationProcessor, ClassOccurrenceGenerationScheduler],
})
export class JobsModule {}
