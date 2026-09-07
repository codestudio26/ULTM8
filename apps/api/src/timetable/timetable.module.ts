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
 * NOT imported by JobsModule/the class-occurrence-generation job — that job has no
 * caller to scope TimetableService's RLS-backed queries to (it's a genuine
 * cross-tenant sweep), so it queries PrismaJobsService (the ultm8_jobs role) directly
 * instead. An earlier draft of this module claimed the job reused
 * TimetableService.findOneRaw() to avoid duplicating slot-lookup logic; that was never
 * actually wired up (code review caught it as dead code with a false comment) and has
 * been removed rather than left to mislead the next reader.
 */
@Module({
  imports: [TenantsModule],
  controllers: [TimetableController],
  providers: [TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
