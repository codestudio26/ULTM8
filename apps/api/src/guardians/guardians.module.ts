import { Module } from '@nestjs/common';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

/**
 * Phase 12 scope: Guardian linking a minor Student + two-tier ConsentRecord
 * grant/withdraw. See GuardiansService's own header comment for what's
 * deliberately still not here (on-behalf-of payments/bookings/enrollment,
 * age-13 limited login, a consent-management UI) and what Phase 37 added
 * (waiver-signing, via the exported assertGuardianOfStudent() below).
 *
 * No TenantsModule import needed — unlike every other module, GuardianLink/
 * ConsentRecord are platform-scoped, not School-scoped, so
 * TenantAuthorizationService's School/Branch-authorization helpers don't apply
 * here at all.
 *
 * Exports GuardiansService (Phase 37) so other modules can inject it for
 * assertGuardianOfStudent() — first consumer: WaiversModule.
 */
@Module({
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
