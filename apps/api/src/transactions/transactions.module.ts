import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { PaymentsModule } from '../payments/payments.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/** Phase 9 scope only: GET /schools/{id}/transactions, GET /transactions/me. See
 * TransactionsService's own header comment for what's deliberately not here.
 * PaymentsModule imported for StripeClientService (GET /transactions/{id}/invoice,
 * added later — no circular dependency: PaymentsModule never imports this one). */
@Module({
  imports: [TenantsModule, PaymentsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
