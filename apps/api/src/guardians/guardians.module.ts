import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
 * BookingsModule/BookingsService+WaitlistService (Phase 40/41/42), plus
 * assertBookingDelegationActive() (Decision 123, same consumer list entry
 * point: BookingsController).
 *
 * Decision 123 — a second, independent `JwtModule.register(...)` (same secret/
 * options AuthModule's own registration uses) so GuardiansService can sign a
 * Kid-Mode token directly, without importing AuthModule — AuthModule already
 * doesn't import GuardiansModule, but adding that edge here would create one
 * the moment this module needed anything back from Auth; NestJS supports
 * multiple modules independently registering the same dynamic module, so this
 * costs nothing and keeps the dependency graph one-directional, matching this
 * module's own existing "one-directional, not a cycle" note above.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
    }),
  ],
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
