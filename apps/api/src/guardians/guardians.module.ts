import { Module } from '@nestjs/common';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

/**
 * Phase 12 scope only: Guardian linking a minor Student + two-tier ConsentRecord
 * grant/withdraw. See GuardiansService's own header comment for what's
 * deliberately not here (on-behalf-of payments/waivers/bookings, age-13 limited
 * login, a consent-management UI).
 *
 * No TenantsModule import needed — unlike every other module, GuardianLink/
 * ConsentRecord are platform-scoped, not School-scoped, so
 * TenantAuthorizationService's School/Branch-authorization helpers don't apply
 * here at all.
 */
@Module({
  controllers: [GuardiansController],
  providers: [GuardiansService],
})
export class GuardiansModule {}
