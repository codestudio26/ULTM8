import { NotificationsModule } from '../notifications/notifications.module';
import { PackRechargesController } from './pack-recharges.controller';
import { PackRechargesService } from './pack-recharges.service';
import { SignUpsController } from './sign-ups.controller';
import { SignUpsService } from './sign-ups.service';
import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { WaiversModule } from '../waivers/waivers.module';
import { RanksModule } from '../ranks/ranks.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { FrontDeskSessionsService } from './front-desk-sessions.service';
import { FrontDeskKioskService } from './front-desk-kiosk.service';
import { FrontDeskSessionGuard } from './front-desk-session.guard';
import { FrontDeskSessionsController } from './front-desk-sessions.controller';
import { FrontDeskKioskController } from './front-desk-kiosk.controller';
import { StudentCheckInCodesService } from './student-check-in-codes.service';
import { StudentCheckInCodesController } from './student-check-in-codes.controller';

/** Locked front-desk tablets (Decision 380, handover F1, F2) and personal
 * check-in codes (Decision 384, F3). */
@Module({
  imports: [TenantsModule, MembershipsModule, WaiversModule, RanksModule, AttendanceModule, GuardiansModule, NotificationsModule],
  controllers: [FrontDeskSessionsController, FrontDeskKioskController, StudentCheckInCodesController, SignUpsController, PackRechargesController],
  providers: [FrontDeskSessionsService, FrontDeskKioskService, FrontDeskSessionGuard, StudentCheckInCodesService, SignUpsService, PackRechargesService],
})
export class FrontDeskModule {}
