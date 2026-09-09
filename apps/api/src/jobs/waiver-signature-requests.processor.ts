import { Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { NOTIFICATION_FANOUT_QUEUE, WAIVER_SIGNATURE_REQUESTS_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/**
 * Consumes the `waiver-signature-requests` queue (Phase 10) — Spec 55 §9's
 * confirmed job: "Waiver assigned to a student... waiverSchool status list
 * (Pending/Signed/Unsigned/Expired) and Notification samples ('...has invited you
 * to sign the following waiver')." Enqueued by WaiversService.createWaiver() —
 * "assignment" is read structurally this phase (Waiver.schoolId), so this fires
 * once per Waiver created for a School, not per-Student — see WaiversService's own
 * comment and the Phase 10 kickoff prompt §2.1/§2.3 for the full reasoning trail.
 *
 * Phase 15 — NotificationsModule now exists, so this is real, not a log-only
 * stub: enumerates every active STUDENT RoleGrant at the Waiver's School (via
 * PrismaJobsService — RoleGrant is already granted to ultm8_jobs, Phase 12)
 * and enqueues one `notification-fanout` job per distinct Student, using the
 * confirmed sample text verbatim.
 *
 * A MAJOR, PRE-EXISTING GAP THIS PHASE'S OWN CODE REVIEW SURFACED, NOT FIXED
 * HERE — flagged prominently rather than silently worked around: no endpoint
 * anywhere in this codebase actually creates a `STUDENT` RoleGrant (grepped
 * every `roleGrant.create` call site to confirm — only SCHOOL_OWNER_MANAGER,
 * via self-service School creation, and INSTRUCTOR/BRANCH_STAFF, via
 * RoleGrantsService's invite flow, are ever granted through the real API).
 * Every e2e spec across every phase that exercises Student-gated behavior
 * (Booking, Attendance, Ranks, Waivers, Memberships, and this one) seeds a
 * STUDENT RoleGrant directly with a superuser Prisma client, bypassing the
 * app entirely — meaning in a real deployment today, this processor's own
 * `studentGrants` query would always return empty, since no real Student can
 * currently come to hold that role at all. This predates Phase 15 and isn't
 * this phase's to fix (a "join/enroll at a School as a Student" flow is a
 * real, undesigned feature of its own) — surfaced here because this is the
 * first phase whose own correctness actually depends on that gap closing to
 * do anything in production, not just in tests. See Decision 95's own note
 * and the project roadmap.
 *
 * Per-Student, distinct-by-userId granularity (not one bulk job) matches
 * `booking-no-show-processing.processor.ts`'s own "FOUND ON REVIEW" precedent
 * — deduping fan-out into fewer jobs silently under-delivers. `addBulk`
 * (rather than N sequential `.add()` calls) is what changed on review: same
 * per-recipient job granularity, one pipelined Redis call instead of N
 * round-trips. Each job's `jobId` is derived deterministically from
 * (waiverId, userId) — BullMQ's own dedup-by-jobId means a retried
 * `waiver-signature-requests` attempt (see `onFailed`/`attempts` below) can
 * safely re-run this whole method without double-enqueueing any Student
 * already queued by an earlier attempt.
 */
@Processor(WAIVER_SIGNATURE_REQUESTS_QUEUE)
export class WaiverSignatureRequestsProcessor extends WorkerHost {
  private readonly logger = new Logger(WaiverSignatureRequestsProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ waiverId: string; schoolId: string }>): Promise<void> {
    const { waiverId, schoolId } = job.data;

    const waiver = await this.prismaJobs.waiver.findUnique({ where: { id: waiverId }, select: { title: true } });
    if (!waiver) {
      // A genuine race (the Waiver was deleted between enqueue and processing) —
      // nothing to notify students about. Waivers has no delete endpoint today,
      // so this is dormant, not reachable — guarded anyway rather than assumed.
      this.logger.warn(`waiver-signature-requests: Waiver ${waiverId} not found — nothing to fan out.`);
      return;
    }

    const studentGrants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId, role: 'STUDENT', revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });

    if (studentGrants.length > 0) {
      await this.notificationFanoutQueue.addBulk(
        studentGrants.map((grant) => ({
          name: 'notify',
          data: {
            notificationId: `waiver-${waiverId}-${grant.userId}`,
            userId: grant.userId,
            title: 'Waiver signature requested',
            // Spec 55 §9's own confirmed sample text, verbatim.
            body: `${waiver.title} has invited you to sign the following waiver.`,
            type: 'WAIVER_SIGNATURE_REQUEST',
          } satisfies NotificationFanoutJobData,
          opts: {
            jobId: `waiver-${waiverId}-${grant.userId}`,
            attempts: 3,
            backoff: { type: 'exponential' as const, delay: 5000 },
          },
        })),
      );
    }

    this.logger.log(`Waiver ${waiverId} (School ${schoolId}) — fanned out ${studentGrants.length} notification(s).`);
  }

  /** Matches OtpDeliveryProcessor's own precedent — logs loudly once a job has
   * exhausted every retry, since without this a genuine failure (Postgres/Redis
   * transiently down when this job ran) leaves the whole School's Waiver
   * fan-out silently, invisibly dropped. Retry/backoff for THIS job itself is
   * configured where it's enqueued (WaiversService.createWaiver), not here. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<{ waiverId: string; schoolId: string }> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `waiver-signature-requests: permanently failed after ${attemptsMade} attempt(s) for Waiver ${job.data.waiverId} (School ${job.data.schoolId}) — no Student at this School was notified.`,
        error,
      );
    }
  }
}
