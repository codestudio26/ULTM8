import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Decision 374 — the School Portal Dashboard's own reads (Active students,
 * setup checklist, birthdays). Bookings figures stay in BookingsModule. */
@Module({
  imports: [TenantsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
