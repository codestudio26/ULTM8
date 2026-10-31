import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { StudentAccessModule } from '../student-access/student-access.module';
import { RanksModule } from '../ranks/ranks.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DataImportsController } from './data-imports.controller';
import { DataImportsService } from './data-imports.service';

/** Spreadsheet imports (Decision 315 items 12 and 13). Each row goes through
 * the code that already does the same thing by hand: Add manually
 * (TenantsModule, StudentAccessModule), grading's promote (RanksModule) and
 * Log attendance (AttendanceModule). */
@Module({
  imports: [TenantsModule, StudentAccessModule, RanksModule, AttendanceModule, SubscriptionPlansModule, NotificationsModule],
  controllers: [DataImportsController],
  providers: [DataImportsService],
})
export class DataImportsModule {}
