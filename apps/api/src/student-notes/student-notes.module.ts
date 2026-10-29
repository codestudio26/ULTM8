import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { StudentNotesController } from './student-notes.controller';
import { StudentNotesService } from './student-notes.service';

@Module({
  imports: [TenantsModule, GuardiansModule],
  controllers: [StudentNotesController],
  providers: [StudentNotesService],
})
export class StudentNotesModule {}
