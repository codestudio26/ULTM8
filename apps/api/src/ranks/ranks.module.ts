import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { QueueModule } from '../jobs/queue.module';
import { RanksController } from './ranks.controller';
import { RanksService } from './ranks.service';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { GradingPermissionsController } from './grading-permissions.controller';
import { GradingPermissionsService } from './grading-permissions.service';
import { InstructorBeltsController } from './instructor-belts.controller';
import { InstructorBeltsService } from './instructor-belts.service';
import { GradingErasureService } from './grading-erasure.service';
import { PromotionFeeController } from './promotion-fee.controller';
import { PromotionFeeService } from './promotion-fee.service';
import { RankCorrectionsController } from './rank-corrections.controller';
import { RankCorrectionsService } from './rank-corrections.service';

/**
 * Phase 10b scope only: Discipline/Rank/Skill catalog CRUD + single-Student
 * grading actions (promote/downgrade/stripe-award/skill-signoff) + StudentRank
 * reads. No bulk-grading, no readiness-bucket/progress-% computation, no
 * Booking-time rank-gating enforcement. See RanksService's and GradingService's
 * own header comments for the full scoping rationale.
 *
 * QueueModule: GradingService injects GRADING_NOTIFICATIONS_QUEUE, the same
 * @InjectQueue-from-a-plain-HTTP-service pattern BookingsService/WaiversService/
 * PaymentsService already established, to notify a Student (or a minor's
 * guardians) of a promotion/downgrade/stripe award and to check "ready to
 * grade" after each grading action (Decisions 145, 178). It goes through a job
 * rather than straight to NOTIFICATION_FANOUT_QUEUE because the recipients
 * (guardians, permitted coaches) are only readable cross-tenant.
 */
@Module({
  // GuardiansModule: GuardiansService.assertGuardianOfStudent() for Guardian
  // read access to a linked minor's grading (Decision 132).
  imports: [TenantsModule, GuardiansModule, QueueModule],
  controllers: [RanksController, GradingController, GradingPermissionsController, InstructorBeltsController, PromotionFeeController, RankCorrectionsController],
  // GradingErasureService: not called by anything yet (Decision 134 groundwork
  // only, no account-deletion endpoint exists) — exported so a future
  // account-deletion job can inject it once it's built.
  // PromotionFeeService: exported so staff-created charges (ChargesModule)
  // and the payment jobs (JobsModule) settle a promotion fee once its charge
  // is fully paid (backlog §3.6 step 6).
  providers: [RanksService, GradingService, GradingPermissionsService, InstructorBeltsService, GradingErasureService, PromotionFeeService, RankCorrectionsService],
  // GradingService: belt progress on the locked front-desk tablet's welcome card (Decision 380).
  exports: [GradingErasureService, PromotionFeeService, GradingService],
})
export class RanksModule {}
