import { Module } from '@nestjs/common';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

/**
 * Phase 12 scope: Guardian linking a minor Student + two-tier ConsentRecord
 * grant/withdraw. See GuardiansService's own header comment for what's
 * deliberately still not here (age-13 limited login, a consent-management UI)
 * and what Phase 37-42 each added (waiver-signing, School enrollment,
 * Membership purchase, Booking creation/cancellation, Waitlist join/withdraw/
 * claim — all via the exported assertGuardianOfStudent() below). This closes
 * the entire originally-deferred Guardian-on-behalf-of chain.
 *
 * No TenantsModule import needed — unlike every other module, GuardianLink/
 * ConsentRecord are platform-scoped, not School-scoped, so
 * TenantAuthorizationService's School/Branch-authorization helpers don't apply
 * here at all. (TenantsModule, MembershipsModule, and BookingsModule all import
 * THIS module, as of Phase 38/39/40, for the reverse reason — each needs
 * assertGuardianOfStudent() — which is one-directional and not a cycle.)
 *
 * Exports GuardiansService so other modules can inject it for
 * assertGuardianOfStudent() — consumers: WaiversModule (Phase 37),
 * TenantsModule/SchoolsService (Phase 38), MembershipsModule (Phase 39),
 * BookingsModule/BookingsService+WaitlistService (Phase 40/41/42).
 */
@Module({
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
