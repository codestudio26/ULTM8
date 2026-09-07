import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { InstructorsController } from './instructors.controller';
import { InstructorsService } from './instructors.service';

/**
 * Phase 6 scope only: Instructor profile CRUD (no delete, no attendance-scan, no
 * booking-override) — see the Phase 6 kickoff prompt for the full rationale on what's
 * deliberately deferred and why.
 *
 * Imports TenantsModule for SchoolsService (the 404-existence check every create/list
 * call makes) and TenantAuthorizationService (the School-Owner-Manager write gate and
 * the assertValidInstructor/assertBranchBelongsToSchool checks) — same shape as
 * ClassesModule/TimetableModule.
 */
@Module({
  imports: [TenantsModule],
  controllers: [InstructorsController],
  providers: [InstructorsService],
})
export class InstructorsModule {}
