import { Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { CHARGEBACK_PATTERN_RESTRICTION_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { ChargebackPatternRestrictionJobData } from './chargeback-pattern-restriction.types';
import { NotificationFanoutJobData } from './notification-fanout.types';

/**
 * Decision 68's own confirmed text (skills/ultm8-domain-rules/SKILL.md §9): "The
 * specific threshold count is a business/implementation parameter that is not
 * stated anywhere in the confirmed material — do not invent or infer a number."
 * Set to 2 by direct product-owner decision, not invented here (Decision 111) —
 * the job is named "chargeback-*pattern*-restriction," and a single lost dispute
 * is as likely a genuinely fraudulent card or an honest billing dispute as it is
 * abuse; two is the "second strike" a pattern actually implies.
 */
const LOST_DISPUTE_THRESHOLD = 2;

/**
 * Consumes the `chargeback-pattern-restriction` queue (Decision 68/112) — counts a
 * Student's lost Stripe disputes and, once the confirmed threshold is exceeded,
 * restricts them to Cash/Bank Transfer payment methods only
 * (`MembershipsService.purchase()`'s own gate reads `User.paymentRestrictedAt`) and
 * notifies every School they currently hold an active STUDENT RoleGrant at.
 *
 * Event-triggered, not a periodic sweep — enqueued by
 * `stripe-webhook-processing.processor.ts` the instant it records a NEW lost dispute
 * (`Transaction.disputeLostAt`), same shape `WaitlistCascadeProcessingProcessor`'s
 * own `seat-freed` job already establishes for "react to an event, no Scheduler
 * needed." See Decision 112's own reasoning for why a periodic sweep would need
 * extra bookkeeping this shape doesn't.
 *
 * Runs via `PrismaJobsService` (`ultm8_jobs` role) — see this phase's migration for
 * the additive column-scoped SELECT/UPDATE grant on `User.paymentRestrictedAt`
 * (Transaction/RoleGrant were already whole-table-granted to this role).
 *
 * No explicit `$transaction` wrapper — unlike stripe-webhook-processing's own
 * dedup-critical shape, this job's only atomicity requirement is the single
 * `updateMany({ where: { paymentRestrictedAt: null } })` guard below, which is
 * already atomic as one statement: two concurrent checks for the same Student (two
 * disputes resolving lost in close succession, each enqueueing its own check) can
 * both read a count past the threshold, but only one's `updateMany` actually
 * matches — the same optimistic-concurrency idiom this codebase already uses
 * throughout (Booking capacity, Membership status flips), not a new pattern.
 */
@Processor(CHARGEBACK_PATTERN_RESTRICTION_QUEUE)
export class ChargebackPatternRestrictionProcessor extends WorkerHost {
  private readonly logger = new Logger(ChargebackPatternRestrictionProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ChargebackPatternRestrictionJobData>): Promise<void> {
    const { studentId } = job.data;

    const lostDisputeCount = await this.prismaJobs.transaction.count({ where: { studentId, disputeLostAt: { not: null } } });
    if (lostDisputeCount < LOST_DISPUTE_THRESHOLD) {
      return;
    }

    // Idempotent — a Student's 3rd/4th/... lost dispute re-triggers this same check,
    // finds paymentRestrictedAt already set, and correctly no-ops below (no repeat
    // notification for every subsequent lost dispute past the first crossing).
    const result = await this.prismaJobs.user.updateMany({
      where: { id: studentId, paymentRestrictedAt: null },
      data: { paymentRestrictedAt: new Date() },
    });
    if (result.count === 0) {
      return;
    }
    this.logger.warn(
      `Student ${studentId} restricted to Cash/Bank Transfer payment methods only — ${lostDisputeCount} lost Stripe dispute(s), threshold ${LOST_DISPUTE_THRESHOLD} (Decision 68/112).`,
    );

    // Decision 68's own confirmed scope: "across every School the Student holds a
    // RoleGrant at"; "The Student's current School(s) are notified." STUDENT
    // specifically — this restriction only ever matters at a School where they
    // actually hold that role.
    const studentGrants = await this.prismaJobs.roleGrant.findMany({
      where: { userId: studentId, role: 'STUDENT', revokedAt: null },
      select: { schoolId: true },
      distinct: ['schoolId'],
    });
    const schoolIds = studentGrants.map((grant) => grant.schoolId).filter((id): id is string => id !== null);
    if (schoolIds.length === 0) {
      this.logger.warn(`Student ${studentId} restricted but holds no active STUDENT RoleGrant at any School — no School to notify.`);
      return;
    }

    const ownerGrants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId: { in: schoolIds }, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (ownerGrants.length === 0) {
      return;
    }

    await this.notificationFanoutQueue.addBulk(
      ownerGrants.map((grant) => ({
        name: 'notify',
        data: {
          notificationId: `chargeback-restriction-${studentId}-${grant.userId}`,
          userId: grant.userId,
          title: 'Student payment-restricted',
          body: 'A Student at your School has been restricted to Cash/Bank Transfer payment methods only, following a pattern of lost Stripe disputes.',
          type: 'CHARGEBACK_PATTERN_RESTRICTION',
        } satisfies NotificationFanoutJobData,
        opts: {
          jobId: `chargeback-restriction-${studentId}-${grant.userId}`,
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 5000 },
        },
      })),
    );
  }

  /** Matches WaiverSignatureRequestsProcessor's own precedent — a payment
   * restriction that should have been applied silently missing is a real security/
   * fraud-prevention gap, not a benign miss, so this stays a loud alarm rather than
   * the log-only failure handling this file's simpler sweep-job siblings use. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<ChargebackPatternRestrictionJobData> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `chargeback-pattern-restriction permanently failed after ${attemptsMade} attempt(s) for Student ${job.data?.studentId} — a payment restriction that should have been checked/applied may be missing.`,
        error,
      );
    }
  }
}
