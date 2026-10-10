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
  controllers: [RanksController, GradingController, GradingPermissionsController, InstructorBeltsController],
  providers: [RanksService, GradingService, GradingPermissionsService, InstructorBeltsService],
})
export class RanksModule {}
