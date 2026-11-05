import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { WhatsNewController } from './whats-new.controller';
import { PlatformAdminWhatsNewController } from './platform-admin-whats-new.controller';
import { WhatsNewService } from './whats-new.service';

/** "What's new" (Decision 318 item 3). PlatformAdminModule for its guard and
 * AuditLogService, as CardSurchargeModule/TranslationsModule do. */
@Module({
  imports: [PlatformAdminModule],
  controllers: [WhatsNewController, PlatformAdminWhatsNewController],
  providers: [WhatsNewService],
})
export class WhatsNewModule {}
