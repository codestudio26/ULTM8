import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

/**
 * Phase 11 scope: ClassesModule's booking + waitlist half. See
 * BookingsService/WaitlistService's own header comments for what's deliberately not
 * here (QR check-in/Attendance, NotificationsModule, the late-cancellation-fee CHARGE
 * mechanism) and for the Guardian-on-behalf-of chain each gained across Phase 40
 * (booking creation), Phase 41 (booking cancellation), and Phase 42 (Decision 103 —
 * waitlist join/withdraw/claim, closing the last item in that chain).
 *
 * Imports TenantsModule for TenantAuthorizationService (same shape as every other
 * module) and QueueModule directly for
 * @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) in BookingsService — same pattern
 * WaiversModule already established for its own queue injection. Imports
 * GuardiansModule (Phase 40) for GuardiansService.assertGuardianOfStudent(), used by
 * both BookingsService and (as of Phase 42) WaitlistService.
 *
 * Imports SubscriptionPlansModule (Phase 54) for SubscriptionGateService —
 * BookingsService.bookClass() is one of the three confirmed write actions Spec 55
 * §10.2's read-only degraded-portal state blocks (see that service's own updated
 * header comment). WaitlistService.claim() is ALSO gated (not join/withdraw,
 * which never create a Booking or spend a credit, domain-rules §10) — it creates
 * a real Booking directly via its own `tx.booking.create`, not by calling
 * BookingsService, so it needs its own separate `assertNotDegraded()` call rather
 * than inheriting BookingsService's.
 */
@Module({
  imports: [TenantsModule, QueueModule, GuardiansModule, SubscriptionPlansModule],
  controllers: [BookingsController, WaitlistController],
  providers: [BookingsService, WaitlistService],
})
export class BookingsModule {}
