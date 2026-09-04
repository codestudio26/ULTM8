import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
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
 */
@Module({
  imports: [TenantsModule],
  controllers: [ClassesController],
  providers: [ClassesService],
})
export class ClassesModule {}
