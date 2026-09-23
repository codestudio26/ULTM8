import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { WaiversController } from './waivers.controller';
import { WaiversService } from './waivers.service';
import { R2ClientService } from './r2-client.service';

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
 */
@Module({
  imports: [TenantsModule, QueueModule, GuardiansModule],
  controllers: [WaiversController],
  providers: [WaiversService, R2ClientService],
})
export class WaiversModule {}
