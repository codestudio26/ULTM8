import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { WaiversController } from './waivers.controller';
import { WaiversService } from './waivers.service';

/**
 * Phase 10 scope only: Waiver CRUD + Student self-signing + Student's own read.
 * See WaiversService's own header comment for what's deliberately not here.
 *
 * Imports TenantsModule for SchoolsService/TenantAuthorizationService, same shape
 * as every other module. Imports QueueModule directly for
 * @InjectQueue(WAIVER_SIGNATURE_REQUESTS_QUEUE) — same pattern PaymentsModule
 * already established for its own webhook queue injection.
 */
@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [WaiversController],
  providers: [WaiversService],
})
export class WaiversModule {}
