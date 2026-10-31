import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentAccessController } from './student-access.controller';
import { StudentAccessService } from './student-access.service';

/** App access for a new student: temporary passcodes and child invites (Decision 403). */
@Module({
  imports: [TenantsModule, GuardiansModule, NotificationsModule],
  controllers: [StudentAccessController],
  providers: [StudentAccessService],
  // Importing members adds a child the same way (DataImportsModule).
  exports: [StudentAccessService],
})
export class StudentAccessModule {}
