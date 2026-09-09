import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

/**
 * Phase 11 scope only: ClassesModule's booking + waitlist half. See
 * BookingsService/WaitlistService's own header comments for what's deliberately not
 * here (QR check-in/Attendance, NotificationsModule, the late-cancellation-fee CHARGE
 * mechanism).
 *
 * Imports TenantsModule for TenantAuthorizationService (same shape as every other
 * module) and QueueModule directly for
 * @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) in BookingsService — same pattern
 * WaiversModule already established for its own queue injection.
 */
@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [BookingsController, WaitlistController],
  providers: [BookingsService, WaitlistService],
})
export class BookingsModule {}
