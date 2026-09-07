import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

/**
 * Phase 5 scope: TimetableSlot CRUD only (no delete) — see the Phase 5 kickoff prompt
 * for the full rationale, including the three items deliberately deferred (the
 * class-occurrence-generation job's platform-SubscriptionPlan skip condition,
 * LoginAttemptTracker's separate Redis gap, the job's exact cadence).
 *
 * Imports TenantsModule for SchoolsService (the 404-existence check) and
 * TenantAuthorizationService (the School-Owner-Manager write gate, plus the
 * branch/instructor validators moved here from ClassesService in this same phase) —
 * same import shape as ClassesModule.
 *
 * The class-occurrence-generation job itself (src/jobs/) imports this module for
 * TimetableService.findOneRaw() rather than duplicating slot-lookup logic.
 */
@Module({
  imports: [TenantsModule],
  controllers: [TimetableController],
  providers: [TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
