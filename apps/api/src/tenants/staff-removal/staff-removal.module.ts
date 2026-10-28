import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants.module';
import { BookingsModule } from '../../bookings/bookings.module';
import { StaffRemovalController } from './staff-removal.controller';
import { StaffRemovalService } from './staff-removal.service';

/**
 * "Remove from School" with its choice for the classes the person teaches
 * (Decision 361 follow-up). Separate from TenantsModule for the same reason
 * NotificationBroadcastModule is separate from NotificationsModule: it needs
 * BookingsModule's CancellationService, and BookingsModule already imports
 * TenantsModule, so the reverse edge would be circular. Imported by nothing.
 */
@Module({
  imports: [TenantsModule, BookingsModule],
  controllers: [StaffRemovalController],
  providers: [StaffRemovalService],
})
export class StaffRemovalModule {}
