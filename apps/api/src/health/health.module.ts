import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { HealthController } from './health.controller';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_FANOUT_QUEUE })],
  controllers: [HealthController],
})
export class HealthModule {}
