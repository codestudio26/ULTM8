import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [TenantsModule],
  controllers: [PayrollController],
  providers: [PayrollService],
})
export class PayrollModule {}
