import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { PaymentsModule } from '../payments/payments.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

/**
 * Phase 9 scope only: MembershipPlan CRUD + purchase (Stripe one-time/Subscription,
 * Cash/Bank Pending, £0-immediate) + Student/Staff reads. No refund, credit-restore,
 * invoice download, franchise-fees, or Stripe dispute handling — see the Phase 9
 * kickoff prompt for the full scoping rationale.
 *
 * Imports PaymentsModule directly for PaymentsService.charge()/subscribe() — same
 * cross-module service-injection pattern TenantsModule's own export of SchoolsService/
 * TenantAuthorizationService already established for ClassesModule in Phase 4.
 * PaymentsModule doesn't export PaymentsService today (it's only used by its own
 * controller) — exported here for the first time, on this same import.
 */
@Module({
  imports: [TenantsModule, PaymentsModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
