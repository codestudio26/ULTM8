import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { InstructorsController } from './instructors.controller';
import { InstructorsService } from './instructors.service';

/**
 * Phase 6 scope only: Instructor profile CRUD (no delete, no attendance-scan, no
 * booking-override) — see the Phase 6 kickoff prompt for the full rationale on what's
 * deliberately deferred and why. Decision 1/230/217/218 (Instructor "Add Manually" +
 * the four missing fields) added on top of that same scope.
 *
 * Imports TenantsModule for SchoolsService (the 404-existence check every create/list
 * call makes) and TenantAuthorizationService (the School-Owner-Manager write gate and
 * the assertValidInstructor/assertBranchBelongsToSchool checks) — same shape as
 * ClassesModule/TimetableModule. Imports NotificationsModule for
 * NotificationDeliveryService (the temp-passcode email, same pattern
 * CoachInvitesService already established). R2ClientService is listed as its own
 * provider here, not imported from WaiversModule — see that service's own header
 * comment for why each consuming module registers it independently.
 */
@Module({
  imports: [TenantsModule, NotificationsModule],
  controllers: [InstructorsController],
  providers: [InstructorsService, R2ClientService],
})
export class InstructorsModule {}
