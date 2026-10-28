import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { WaiversModule } from '../waivers/waivers.module';
import { RanksModule } from '../ranks/ranks.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { FrontDeskSessionsService } from './front-desk-sessions.service';
import { FrontDeskKioskService } from './front-desk-kiosk.service';
import { FrontDeskSessionGuard } from './front-desk-session.guard';
import { FrontDeskSessionsController } from './front-desk-sessions.controller';
import { FrontDeskKioskController } from './front-desk-kiosk.controller';

/** Locked front-desk tablets (Decision 380, handover F1, F2). */
@Module({
  imports: [TenantsModule, MembershipsModule, WaiversModule, RanksModule, AttendanceModule],
  controllers: [FrontDeskSessionsController, FrontDeskKioskController],
  providers: [FrontDeskSessionsService, FrontDeskKioskService, FrontDeskSessionGuard],
})
export class FrontDeskModule {}
