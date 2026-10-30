import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { LateFeesController } from './late-fees.controller';
import { LateFeesService } from './late-fees.service';

/** Late fees (v1.3 backlog §3.7, Decision 413): the School owner's setting.
 * The daily job that adds the fees lives in JobsModule (LateFeeProcessor). */
@Module({
  imports: [TenantsModule],
  controllers: [LateFeesController],
  providers: [LateFeesService],
})
export class LateFeesModule {}
