import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeClientService } from './stripe-client.service';

/**
 * Phase 8 scope only: PaymentAccount CRUD + Stripe Connect Express onboarding
 * (Decision 86) + webhook receiving — no checkout, no refunds, no Franchise-fee
 * automation, no SubscriptionPlan/white-label billing. See the Phase 8 kickoff
 * prompt for the full rationale on what's deliberately deferred and why.
 *
 * Imports TenantsModule for SchoolsService/TenantAuthorizationService (now including
 * the new assertFranchiseOwner), same shape as every other module. Imports
 * QueueModule directly for @InjectQueue(STRIPE_WEBHOOK_PROCESSING_QUEUE) —
 * same pattern AuthModule already established for TwilioVerifyService's own queue
 * injection, not a new convention.
 */
@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeClientService],
})
export class PaymentsModule {}
