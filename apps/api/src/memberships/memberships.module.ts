import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { PaymentsModule } from '../payments/payments.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

/**
 * Phase 9 scope: MembershipPlan CRUD + purchase (Stripe one-time/Subscription,
 * Cash/Bank Pending, £0-immediate) + Student/Staff reads. No refund, credit-restore,
 * invoice download, franchise-fees, or Stripe dispute handling — see the Phase 9
 * kickoff prompt for the full scoping rationale. Phase 39 added Guardian-on-behalf-of
 * purchasing — see MembershipsService.purchase()'s own header comment.
 *
 * Imports PaymentsModule directly for PaymentsService.charge()/subscribe() — same
 * cross-module service-injection pattern TenantsModule's own export of SchoolsService/
 * TenantAuthorizationService already established for ClassesModule in Phase 4.
 * PaymentsModule doesn't export PaymentsService today (it's only used by its own
 * controller) — exported here for the first time, on this same import.
 *
 * Imports GuardiansModule (Phase 39) directly for GuardiansService.
 * assertGuardianOfStudent() — TenantsModule imports GuardiansModule too but doesn't
 * export GuardiansService, so this needs its own import, same as WaiversModule's.
 *
 * Imports SubscriptionPlansModule (Phase 54) for SubscriptionGateService —
 * MembershipsService.purchase() is one of the three confirmed write actions Spec 55
 * §10.2's read-only degraded-portal state blocks (see that service's own updated
 * header comment). The £0-immediate/Friend-Pass and Cash/Bank Pending paths are
 * gated too, not just the Stripe path — all three are still "a new payment" in the
 * confirmed sense, a Membership/Transaction row created either way.
 */
@Module({
  imports: [TenantsModule, PaymentsModule, GuardiansModule, SubscriptionPlansModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
