import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

/**
 * Phase 13 scope only: self-service QR check-in (`POST /attendance/scan`). See
 * AttendanceService's own header comment for what's deliberately not here (the
 * QR code's own generation/rotation mechanism, the Instructor roll-call scan,
 * a Staff/accessibility check-in override).
 *
 * No TenantsModule import needed — this module never performs a School-Owner-
 * gated write, only a self-service action under the caller's own tenant context
 * (matching Booking's own established RLS shape).
 */
@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
