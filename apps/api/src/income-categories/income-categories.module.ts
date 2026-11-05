import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { IncomeCategoriesController } from './income-categories.controller';
import { IncomeCategoriesService } from './income-categories.service';

@Module({
  imports: [TenantsModule],
  controllers: [IncomeCategoriesController],
  providers: [IncomeCategoriesService],
  exports: [IncomeCategoriesService],
})
export class IncomeCategoriesModule {}
