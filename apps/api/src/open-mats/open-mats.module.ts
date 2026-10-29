import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { QueueModule } from '../jobs/queue.module';
import { OpenMatsController } from './open-mats.controller';
import { OpenMatsService } from './open-mats.service';

/** Unplanned open mat sessions (Decision 386, front-desk handover F10). */
@Module({ imports: [TenantsModule, SubscriptionPlansModule, QueueModule], controllers: [OpenMatsController], providers: [OpenMatsService] })
export class OpenMatsModule {}
