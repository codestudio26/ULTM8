import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { PaymentsModule } from '../payments/payments.module';
import { FranchiseFeesController } from './franchise-fees.controller';
import { FranchiseFeesService } from './franchise-fees.service';
import { FranchiseFeeBillingService } from './franchise-fee-billing.service';

/**
 * Phase 16b-ii — FranchiseFeeCharge: caller-facing read/refund endpoints
 * (FranchiseFeesService/Controller) plus the job-scoped Stripe billing
 * primitives (FranchiseFeeBillingService) the franchise-fee-usage-reporting job
 * calls directly — see that service's own header comment for why it's a
 * separate service rather than folded into PaymentsService.
 *
 * Imports TenantsModule for TenantAuthorizationService.assertFranchiseOwner
 * (the refund action's own gate) and PaymentsModule for StripeClientService
 * (now exported specifically for this module, see PaymentsModule's own
 * updated header comment).
 *
 * Exports FranchiseFeeBillingService so JobsModule can inject it directly into
 * FranchiseFeeUsageReportingProcessor, the same cross-module service-injection
 * pattern NotificationsModule already established for JobsModule's own
 * NotificationFanoutProcessor/NotificationDeliveryService.
 */
@Module({
  imports: [TenantsModule, PaymentsModule],
  controllers: [FranchiseFeesController],
  providers: [FranchiseFeesService, FranchiseFeeBillingService],
  exports: [FranchiseFeeBillingService],
})
export class FranchiseFeesModule {}
