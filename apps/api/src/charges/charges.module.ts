import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { QueueModule } from '../jobs/queue.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { RanksModule } from '../ranks/ranks.module';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';
import { ChargeReportsController } from './charge-reports.controller';
import { ChargeReportsService } from './charge-reports.service';
import { RecurringChargesController } from './recurring-charges.controller';
import { RecurringChargesService } from './recurring-charges.service';

/** Staff-created charges and the member balance (Decisions 303, 338, 411),
 * and recurring charges (Decision 412). */
@Module({
  // RanksModule: PromotionFeeService, to settle a promotion fee once its charge
  // is fully paid (backlog §3.6 step 6).
  imports: [TenantsModule, SubscriptionPlansModule, GuardiansModule, QueueModule, PaymentsModule, AuthModule, RanksModule],
  controllers: [ChargesController, ChargeReportsController, RecurringChargesController],
  providers: [ChargesService, ChargeReportsService, RecurringChargesService],
  exports: [ChargesService],
})
export class ChargesModule {}
