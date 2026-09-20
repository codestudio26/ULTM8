import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { PlatformAdminSubscriptionPlansController } from './platform-admin-subscription-plans.controller';
import { SubscriptionPlansService } from './subscription-plans.service';
import { SubscriptionGateService } from './subscription-gate.service';

/**
 * Phase 54 (ultm8-nestjs-module §5) — see PlatformAdminModule's own header comment
 * for why this is a genuinely separate top-level module rather than code folded
 * into PlatformAdminModule's own registration (same shape TranslationsModule
 * already established, Phase 49).
 *
 * `imports: [PlatformAdminModule]` for the same two things TranslationsModule's own
 * header comment documents (`PlatformAdminJwtAuthGuard` for `@UseGuards()`,
 * `AuditLogService` plain-injected into the service) — see that module's own
 * comment for the full DI-mechanics account, unchanged here.
 *
 * `imports: [TenantsModule]` for `SchoolsService`/`FranchisesService`/
 * `TenantAuthorizationService.assertSchoolOwner`/`assertFranchiseOwner` — the
 * subscribe/cancel flow's own ownership gates.
 *
 * `imports: [PaymentsModule]` for `StripeClientService` (specifically
 * `platformClient()`, not `scopedClient()` — see SubscriptionPlansService's own
 * header comment for why), same cross-module reuse
 * FranchiseFeesModule/PlatformAdminModule's own Slice 7 already established rather
 * than each module re-declaring its own separate Stripe-wrapper provider.
 *
 * Exports `SubscriptionGateService` — ClassesModule/BookingsModule/
 * MembershipsModule each import this module directly so their own
 * create()/bookClass()/purchase() can call `assertNotDegraded()` (see that
 * service's own header comment for exactly which three call sites and why only
 * those three).
 */
@Module({
  imports: [PlatformAdminModule, TenantsModule, PaymentsModule],
  controllers: [SubscriptionPlansController, PlatformAdminSubscriptionPlansController],
  providers: [SubscriptionPlansService, SubscriptionGateService],
  exports: [SubscriptionGateService],
})
export class SubscriptionPlansModule {}
