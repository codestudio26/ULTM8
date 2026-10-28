import { Module } from '@nestjs/common';
import { QueueModule } from '../jobs/queue.module';
import { HealthController } from './health.controller';

// QueueModule (not a registerQueue of its own) so the health check reuses the
// existing notification-fanout Queue and its shared Redis connection.
@Module({
  imports: [QueueModule],
  controllers: [HealthController],
})
export class HealthModule {}
