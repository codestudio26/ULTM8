import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { WaiversController } from './waivers.controller';
import { WaiversService } from './waivers.service';
import { GuestWaiverLinksController, GuestWaiversController } from './guest-waivers.controller';
import { GuestWaiversService } from './guest-waivers.service';
import { WaiverAssignmentModule } from './waiver-assignment.module';
import { R2ClientService } from '../common/object-storage/r2-client.service';

/**
 * Phase 10 scope: Waiver CRUD + Student self-signing + Student's own read. Phase
 * 34 added drawn-signature capture (R2ClientService, see its own header comment)
 * on top of that same scope. Phase 37 added Guardian-on-behalf-of signing (see
 * WaiversService's own header comment) — still no Booking-time enforcement.
 *
 * Imports TenantsModule for SchoolsService/TenantAuthorizationService, same shape
 * as every other module. Imports QueueModule directly for
 * @InjectQueue(WAIVER_SIGNATURE_REQUESTS_QUEUE) — same pattern PaymentsModule
 * already established for its own webhook queue injection. Imports
 * GuardiansModule (Phase 37) for GuardiansService.assertGuardianOfStudent().
 *
 * Imports WaiverAssignmentModule (v1.2 backend backlog — the Unsigned-row-at-
 * assignment-time gap) so createWaiver() can write an Unsigned row for every
 * Student already active at the School — see WaiverAssignmentService's own
 * header comment for why this one small piece lives in its own module instead
 * of as a method here.
 *
 * GuestWaiversService (Waivers Q9): guests on a booking sign by a shared link.
 */
@Module({
  imports: [TenantsModule, QueueModule, GuardiansModule, WaiverAssignmentModule],
  controllers: [WaiversController, GuestWaiversController, GuestWaiverLinksController],
  providers: [WaiversService, GuestWaiversService, R2ClientService],
  // The locked front-desk tablet's welcome card (FrontDeskModule, Decision 380).
  exports: [WaiversService, GuestWaiversService],
})
export class WaiversModule {}
