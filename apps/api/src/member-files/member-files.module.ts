import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { MemberFilesController } from './member-files.controller';
import { MemberFilesService } from './member-files.service';

/** Files on a member (backlog 5.11, Decision 315 item 9). R2ClientService is
 * listed as its own provider, as InstructorsModule and WaiversModule do. */
@Module({
  imports: [TenantsModule],
  controllers: [MemberFilesController],
  providers: [MemberFilesService, R2ClientService],
})
export class MemberFilesModule {}
