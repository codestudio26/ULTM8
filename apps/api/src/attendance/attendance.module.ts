import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

/**
 * Phase 13 scope: self-service QR check-in (`POST /attendance/scan`). Phase 17
 * scope: the Instructor roll-call roster (`GET /classes/{id}/roster`, `POST`/
 * `DELETE /classes/{id}/attendance-scan`). See AttendanceService's own header
 * comment for the full rationale on both.
 *
 * TenantsModule import added in Phase 17 for TenantAuthorizationService
 * (assertStaffAtSchool) — the roster endpoints are genuine Staff-gated writes,
 * unlike Phase 13's self-service-only scope this module originally shipped
 * with.
 */
@Module({
  imports: [TenantsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
