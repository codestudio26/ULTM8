import { Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { NOTIFICATION_FANOUT_QUEUE, WAIVER_SIGNATURE_REQUESTS_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Why a member is asked to sign (Decision 354). */
export type WaiverNoticeReason = 'assigned' | 'reminder' | 'updated' | 'renewal' | 'adult';

export interface WaiverSignatureRequestJobData {
  waiverId: string;
  schoolId: string;
  /** Only these students; every current student when left out. */
  studentIds?: string[];
  reason?: WaiverNoticeReason;
  /** Tells repeat notices apart (see process()). */
  batchId?: string;
}

/** The notice's English text; packages/i18n/src/server/translate.ts matches
 * each shape to its translation. */
export function waiverNotice(reason: WaiverNoticeReason, school: string, waiver: string): { title: string; body: string } {
  switch (reason) {
    case 'reminder':
      return { title: 'Waiver reminder', body: `${school} reminds you to sign the waiver "${waiver}".` };
    case 'updated':
      return { title: 'Waiver updated', body: `${school} has updated the waiver "${waiver}". Please read it and sign it again.` };
    case 'renewal':
      return { title: 'Waiver renewal', body: `Your signature on the waiver "${waiver}" at ${school} has run out. Please sign it again.` };
    case 'adult':
      return { title: 'Waiver renewal', body: `You're now 18, so ${school} asks you to sign the waiver "${waiver}" yourself.` };
    default:
      return { title: 'Waiver signature requested', body: `${school} has invited you to sign the waiver "${waiver}".` };
  }
}

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

  async process(job: Job<WaiverSignatureRequestJobData>): Promise<void> {
    const { waiverId, schoolId, studentIds, reason = 'assigned', batchId } = job.data;

    const waiver = await this.prismaJobs.waiver.findUnique({
      where: { id: waiverId },
      select: { title: true, archivedAt: true, school: { select: { name: true } } },
    });
    if (!waiver) {
      this.logger.warn(`waiver-signature-requests: Waiver ${waiverId} not found — nothing to fan out.`);
      return;
    }
    // Decision 354: an archived waiver asks no one to sign it.
    if (waiver.archivedAt) {
      this.logger.log(`waiver-signature-requests: Waiver ${waiverId} is archived — no one notified.`);
      return;
    }

    // Decision 354: a job may name the students it is for (a new member, a
    // reminder, a re-sign); only those still at the School are told.
    const studentGrants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId, role: 'STUDENT', revokedAt: null, ...(studentIds ? { userId: { in: studentIds } } : {}) },
      select: { userId: true },
      distinct: ['userId'],
    });

    const { title, body } = waiverNotice(reason, waiver.school.name, waiver.title);
    if (studentGrants.length > 0) {
      await this.notificationFanoutQueue.addBulk(
        studentGrants.map((grant) => {
          // The first request for a waiver keeps its old id; later notices are
          // told apart by their batch so each one is actually sent.
          const id = batchId ? `waiver-${reason}-${batchId}-${waiverId}-${grant.userId}` : `waiver-${waiverId}-${grant.userId}`;
          return {
            name: 'notify',
            data: { notificationId: id, userId: grant.userId, title, body, type: 'WAIVER_SIGNATURE_REQUEST', schoolId, targetType: 'WAIVER', targetId: waiverId } satisfies NotificationFanoutJobData,
            opts: { jobId: id, attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } },
          };
        }),
      );
    }

    this.logger.log(`Waiver ${waiverId} (School ${schoolId}, ${reason}) — fanned out ${studentGrants.length} notification(s).`);
  }

  /** Matches OtpDeliveryProcessor's own precedent — logs loudly once a job has
   * exhausted every retry, since without this a genuine failure (Postgres/Redis
   * transiently down when this job ran) leaves the whole School's Waiver
   * fan-out silently, invisibly dropped. Retry/backoff for THIS job itself is
   * configured where it's enqueued (WaiversService.createWaiver), not here. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<WaiverSignatureRequestJobData> | undefined, error: Error) {
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
