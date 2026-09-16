import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';

/**
 * Phase 44 scope only: Lesson CRUD (Staff/Instructor-authored, School-scoped —
 * Decision 104) linked to the existing Skill catalog. No video-upload or
 * captioning-pipeline integration yet — see CurriculumService's own header
 * comment for why (Decision 101 picked vendors, didn't build the integration;
 * no credentials provisioned in this environment).
 */
@Module({
  imports: [TenantsModule],
  controllers: [CurriculumController],
  providers: [CurriculumService],
})
export class CurriculumModule {}
