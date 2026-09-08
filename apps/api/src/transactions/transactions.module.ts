import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/** Phase 9 scope only: GET /schools/{id}/transactions. See TransactionsService's own
 * header comment for what's deliberately not here. */
@Module({
  imports: [TenantsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
