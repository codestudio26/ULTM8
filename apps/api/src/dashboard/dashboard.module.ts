import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';

/** Decision 374 — the School Portal Dashboard's own reads (Active students,
 * setup checklist, birthdays), and Students → Growth (backlog 5.8), which
 * counts Active the same way. Bookings figures stay in BookingsModule. */
@Module({
  imports: [TenantsModule],
  controllers: [DashboardController, GrowthController],
  providers: [DashboardService, GrowthService],
})
export class DashboardModule {}
