import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { StudentTagsController } from './student-tags.controller';
import { StudentTagsService } from './student-tags.service';

@Module({
  imports: [TenantsModule],
  controllers: [StudentTagsController],
  providers: [StudentTagsService],
})
export class StudentTagsModule {}
