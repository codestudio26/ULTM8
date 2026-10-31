import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { RostersController } from './rosters.controller';
import { RostersService } from './rosters.service';

@Module({
  imports: [TenantsModule],
  controllers: [RostersController],
  providers: [RostersService],
})
export class RostersModule {}
