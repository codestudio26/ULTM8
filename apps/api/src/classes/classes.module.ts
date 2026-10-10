import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';

/**
 * Phase 4 scope only: Class CRUD (no delete, no booking, no waitlist, no
 * TimetableSlot materialization) — see the Phase 4 kickoff prompt for the full
 * rationale on what's deliberately deferred and why.
 *
 * Imports TenantsModule for SchoolsService (the 404-existence check every create/list
 * call makes) and TenantAuthorizationService (the School-Owner-Manager write gate) —
 * both now exported from TenantsModule (see its own header comment for why that export
 * didn't exist before this module needed it).
 *
 * Imports SubscriptionPlansModule (Phase 54) for SubscriptionGateService —
 * ClassesService.create() is one of the three confirmed write actions Spec 55
 * §10.2's read-only degraded-portal state blocks (see that service's own updated
 * header comment).
 */
@Module({
  imports: [TenantsModule, SubscriptionPlansModule],
  controllers: [ClassesController],
  providers: [ClassesService],
})
export class ClassesModule {}
