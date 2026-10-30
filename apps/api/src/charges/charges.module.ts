import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { QueueModule } from '../jobs/queue.module';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';

/** Staff-created charges and the member balance (Decisions 303, 338, 411). */
@Module({
  imports: [TenantsModule, SubscriptionPlansModule, GuardiansModule, QueueModule],
  controllers: [ChargesController],
  providers: [ChargesService],
  exports: [ChargesService],
})
export class ChargesModule {}
