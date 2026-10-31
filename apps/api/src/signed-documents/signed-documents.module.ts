import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { QueueModule } from '../jobs/queue.module';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { SignedDocumentsExportController } from './signed-documents-export.controller';
import { SignedDocumentsExportService } from './signed-documents-export.service';

/** Export all signed documents (Decision 315 item 13). R2ClientService is
 * listed as its own provider, as MemberFilesModule does. */
@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [SignedDocumentsExportController],
  providers: [SignedDocumentsExportService, R2ClientService],
})
export class SignedDocumentsModule {}
