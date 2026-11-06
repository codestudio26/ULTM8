import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../jobs/queue.module';
import { StripeClientService } from '../payments/stripe-client.service';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';

/**
 * "Delete my account": the member's request (this module) and the
 * account-erasure job (JobsModule). AuthModule for StepUpService; its own
 * StripeClientService provider, as TenantsModule registers one, so this
 * module needs no PaymentsModule edge.
 */
@Module({
  imports: [AuthModule, QueueModule],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService, StripeClientService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
