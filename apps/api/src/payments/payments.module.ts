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
 * Imports TenantsModule for SchoolsService/FranchisesService/TenantAuthorizationService
 * (Phase 16 adds FranchisesService — see PaymentsService.createForFranchise/
 * findForFranchise for what it's used for), same shape as every other module. Imports
 * QueueModule directly for @InjectQueue(STRIPE_WEBHOOK_PROCESSING_QUEUE) —
 * same pattern AuthModule already established for TwilioVerifyService's own queue
 * injection, not a new convention.
 *
 * Exports PaymentsService (Phase 9, first time this module exports anything) — so
 * MembershipsModule can call charge()/subscribe()/confirmTransaction() directly
 * rather than duplicating Stripe-primitive logic, same cross-module
 * service-injection pattern TenantsModule's own SchoolsService/
 * TenantAuthorizationService exports already established.
 */
@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeClientService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
