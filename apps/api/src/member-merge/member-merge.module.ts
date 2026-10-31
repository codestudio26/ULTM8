import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { MemberMergeController } from './member-merge.controller';
import { MemberMergeService } from './member-merge.service';

/** Merge duplicate members (Decision 315 item 13). */
@Module({
  imports: [TenantsModule],
  controllers: [MemberMergeController],
  providers: [MemberMergeService],
})
export class MemberMergeModule {}
