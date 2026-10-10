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

/**
 * Phase 10b scope only: Discipline/Rank/Skill catalog CRUD + single-Student
 * grading actions (promote/downgrade/stripe-award/skill-signoff) + StudentRank
 * reads. No bulk-grading, no readiness-bucket/progress-% computation, no
 * Booking-time rank-gating enforcement. See RanksService's and GradingService's
 * own header comments for the full scoping rationale.
 *
 * QueueModule: closes a real gap found while auditing the user-journey gap
 * inventory — GradingService now injects NOTIFICATION_FANOUT_QUEUE directly to
 * notify a Student of a promotion/downgrade/stripe award, the same
 * @InjectQueue-from-a-plain-HTTP-service pattern BookingsService/WaiversService/
 * PaymentsService already established (each injects its own job queue
 * directly, not via an intermediate module) — see GradingService's own
 * promotion-notification comment for why this goes straight to
 * NOTIFICATION_FANOUT_QUEUE rather than through an intermediate job queue the
 * way WaiverSignatureRequestsProcessor does (that processor does real
 * cross-tenant enumeration work; grading already knows its one recipient
 * synchronously, so there's no extra step to defer to a job for).
 */
@Module({
  // GuardiansModule: GuardiansService.assertGuardianOfStudent() for Guardian
  // read access to a linked minor's grading (Decision 132).
  imports: [TenantsModule, GuardiansModule, QueueModule],
  controllers: [RanksController, GradingController, GradingPermissionsController],
  providers: [RanksService, GradingService, GradingPermissionsService],
})
export class RanksModule {}
