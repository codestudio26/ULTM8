import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { QrTokenService } from './qr-token.service';
import { FrontDeskCheckInService } from './front-desk-check-in.service';
import { CheckInRulesController } from './check-in-rules.controller';
import { CheckInRulesService } from './check-in-rules.service';
import { BookingsModule } from '../bookings/bookings.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';

/**
 * Phase 13 built self-service-only, no TenantsModule import needed (a pure
 * self-service action under the caller's own tenant context, nothing
 * School-Owner-gated). Phase 51 (Decision 107) adds Staff-gated routes — the
 * Class QR-token mint and the Instructor roll-call scan both need
 * TenantAuthorizationService — so this module imports TenantsModule for the
 * first time, same shape ClassesModule/InstructorsModule already use.
 * QueueModule: a check-in queues a "ready to grade" check (Decision 178).
 * BookingsModule and SubscriptionPlansModule: the front desk's one-step
 * check-in books where needed, with a staff booking's gates (Decision 378).
 * Check-in rules (Decision 394): Settings, and the checks every check-in runs.
 */
@Module({
  imports: [TenantsModule, QueueModule, BookingsModule, SubscriptionPlansModule],
  controllers: [AttendanceController, CheckInRulesController],
  providers: [AttendanceService, QrTokenService, FrontDeskCheckInService, CheckInRulesService],
  // The locked front-desk tablet (FrontDeskModule, Decision 380) checks in through these.
  exports: [AttendanceService, FrontDeskCheckInService, QrTokenService],
})
export class AttendanceModule {}
