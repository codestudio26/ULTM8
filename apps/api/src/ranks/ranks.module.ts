import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { RanksController } from './ranks.controller';
import { RanksService } from './ranks.service';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';

/**
 * Phase 10b scope only: Discipline/Rank/Skill catalog CRUD + single-Student
 * grading actions (promote/downgrade/stripe-award/skill-signoff) + StudentRank
 * reads. No bulk-grading, no readiness-bucket/progress-% computation, no
 * Booking-time rank-gating enforcement. See RanksService's and GradingService's
 * own header comments for the full scoping rationale.
 */
@Module({
  imports: [TenantsModule],
  controllers: [RanksController, GradingController],
  providers: [RanksService, GradingService],
})
export class RanksModule {}
