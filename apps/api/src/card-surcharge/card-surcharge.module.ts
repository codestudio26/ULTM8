import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CardSurchargeController } from './card-surcharge.controller';
import { PlatformAdminCardSurchargeController } from './platform-admin-card-surcharge.controller';
import { CardSurchargeService } from './card-surcharge.service';

/** Card surcharge (backlog 3.8, Decision 406): the Platform Admin allow-list
 * and the School owner's setting. PlatformAdminModule for its guard and
 * AuditLogService, as SubscriptionPlansModule/TranslationsModule do. */
@Module({
  imports: [PlatformAdminModule, TenantsModule],
  controllers: [CardSurchargeController, PlatformAdminCardSurchargeController],
  providers: [CardSurchargeService],
})
export class CardSurchargeModule {}
