import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { CustomMemberFieldsController } from './custom-member-fields.controller';
import { CustomMemberFieldsService } from './custom-member-fields.service';

@Module({
  imports: [TenantsModule],
  controllers: [CustomMemberFieldsController],
  providers: [CustomMemberFieldsService],
})
export class CustomMemberFieldsModule {}
