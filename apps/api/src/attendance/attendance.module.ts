import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { QrTokenService } from './qr-token.service';

/**
 * Phase 13 built self-service-only, no TenantsModule import needed (a pure
 * self-service action under the caller's own tenant context, nothing
 * School-Owner-gated). Phase 51 (Decision 107) adds Staff-gated routes — the
 * Class QR-token mint and the Instructor roll-call scan both need
 * TenantAuthorizationService — so this module imports TenantsModule for the
 * first time, same shape ClassesModule/InstructorsModule already use.
 */
@Module({
  imports: [TenantsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, QrTokenService],
})
export class AttendanceModule {}
