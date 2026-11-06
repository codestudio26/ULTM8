import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../jobs/queue.module';
import { PaymentsModule } from '../payments/payments.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';

/**
 * "Delete my account": the member's request (this module) and the
 * account-erasure job (JobsModule). AuthModule for StepUpService;
 * PaymentsModule for its exported StripeClientService (no second provider
 * instance, so tests and callers that look up "the" StripeClientService keep
 * finding the shared one). Neither imports this module.
 */
@Module({
  imports: [AuthModule, QueueModule, PaymentsModule],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
