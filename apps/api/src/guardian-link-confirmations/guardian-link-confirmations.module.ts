import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { GuardianLinkConfirmationsController } from './guardian-link-confirmations.controller';
import { GuardianLinkConfirmationsService } from './guardian-link-confirmations.service';

/**
 * Decision 172 — School confirmation of Guardian links. Separate from
 * GuardiansModule because it needs TenantAuthorizationService (TenantsModule), and
 * TenantsModule already imports GuardiansModule: importing it back would be a
 * cycle. Nothing imports this module except AppModule.
 */
@Module({
  imports: [TenantsModule],
  controllers: [GuardianLinkConfirmationsController],
  providers: [GuardianLinkConfirmationsService],
})
export class GuardianLinkConfirmationsModule {}
