import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { PlatformAdminLegalDocumentsController } from './platform-admin-legal-documents.controller';
import { LegalDocumentsAdminService } from './legal-documents-admin.service';

/**
 * Decision 171 — Platform Admin publishing of legal documents. Its own module, not
 * part of SettingsModule, for the same reason TranslationsModule is separate: it
 * imports PlatformAdminModule for the guard and audit log. Kept out of anything
 * GuardiansModule imports, because PlatformAdmin -> Payments -> Tenants ->
 * Guardians would make a cycle (see legal-policy-version.ts).
 */
@Module({
  imports: [PlatformAdminModule],
  controllers: [PlatformAdminLegalDocumentsController],
  providers: [LegalDocumentsAdminService],
})
export class LegalDocumentsAdminModule {}
