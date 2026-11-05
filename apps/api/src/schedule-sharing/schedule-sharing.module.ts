import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { CalendarFeedsController, ScheduleEmbedsController, ScheduleSharingController } from './schedule-sharing.controller';
import { ScheduleSharingService } from './schedule-sharing.service';

/** Decision 319 item 4: staff calendar links and the School's schedule embed. */
@Module({
  imports: [TenantsModule],
  controllers: [ScheduleSharingController, CalendarFeedsController, ScheduleEmbedsController],
  providers: [ScheduleSharingService],
})
export class ScheduleSharingModule {}
