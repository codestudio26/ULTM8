import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from './queue.constants';

/** How often the claim-deadline sweep runs — same Developer-level-choice caveat as
 * booking-no-show-processing's own CRON constant; a shorter interval here since a
 * missed/late claim-deadline expiry directly delays the next Waiting Student's own
 * chance at the freed seat. */
const CRON_EVERY_5_MINUTES = '*/5 * * * *';
const REPEATABLE_JOB_ID = 'waitlist-cascade-processing-sweep';

/**
 * Registers the waitlist-cascade-processing repeatable SWEEP job on module init —
 * same fixed-jobId / not-awaited / bounded-retry-with-backoff pattern as
 * ClassOccurrenceGenerationScheduler/BookingNoShowProcessingScheduler. This scheduler
 * only registers the recurring 'sweep-expired' job; the event-triggered 'seat-freed'
 * job (see the processor's own doc comment) is enqueued ad hoc by BookingsService and
 * BookingNoShowProcessingProcessor, not from here.
 */
@Injectable()
export class WaitlistCascadeProcessingScheduler implements OnModuleInit {
  private readonly logger = new Logger(WaitlistCascadeProcessingScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...WaitlistCascadeProcessingScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep-expired', {}, { repeat: { pattern: CRON_EVERY_5_MINUTES }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable waitlist-cascade-processing sweep (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable waitlist-cascade-processing sweep after all retries — ' +
        'an unclaimed WaitlistEntry will never expire/cascade to the next position until this succeeds.',
    );
  }
}

/**
 * Consumes the waitlist-cascade-processing queue (Phase 11) — SKILL.md §10's
 * confirmed rule: "A freed seat (from a Cancellation or a No-Show alike) notifies the
 * next Waiting entry. An unclaimed window cascades to the next person in position
 * order." Handles two distinct job names on the same queue:
 *
 *  - `seat-freed` ({ classId }) — event-triggered by BookingsService.cancel() and by
 *    BookingNoShowProcessingProcessor after a No-Show; notifies the next Waiting
 *    entry for that Class, if any.
 *  - `sweep-expired` ({}) — the recurring scheduled sweep (see
 *    WaitlistCascadeProcessingScheduler above); finds every Notified entry whose
 *    claimByDeadline has passed, expires it, and cascades to the next Waiting entry
 *    for that same Class — the same "notify next" logic `seat-freed` uses, since an
 *    expired claim frees the seat exactly the way a Cancellation/No-Show does.
 *
 * Runs via PrismaJobsService (ultm8_jobs role) — same reasoning as every other
 * scheduled/cross-tenant job in this codebase.
 *
 * Never creates a Booking or draws a credit itself — only flips WaitlistEntry.status
 * to NOTIFIED/EXPIRED and sets notifiedAt/claimByDeadline. Turning a Notified entry
 * into a real Booking happens exclusively via the caller-initiated
 * `POST /waitlist/{id}/claim` endpoint (WaitlistService.claim()), which re-runs the
 * rank/capacity checks at claim time (kickoff prompt §1.d) — this job has no
 * authority to create Bookings on a Student's behalf.
 */
@Processor(WAITLIST_CASCADE_PROCESSING_QUEUE)
export class WaitlistCascadeProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(WaitlistCascadeProcessingProcessor.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {
    super();
  }

  async process(job: Job<{ classId?: string }>): Promise<void> {
    if (job.name === 'seat-freed') {
      const { classId } = job.data;
      if (!classId) {
        this.logger.warn('seat-freed job received with no classId — skipping.');
        return;
      }
      const notified = await this.notifyNextWaitingEntry(classId);
      this.logger.log(`waitlist-cascade-processing (seat-freed, Class ${classId}): ${notified ? 'notified next entry' : 'no Waiting entry to notify'}.`);
      return;
    }

    if (job.name === 'sweep-expired') {
      const now = new Date();
      const overdueNotified = await this.prismaJobs.waitlistEntry.findMany({
        where: { status: 'NOTIFIED', claimByDeadline: { lt: now } },
        select: { id: true, classId: true },
      });

      let expired = 0;
      let cascaded = 0;
      for (const entry of overdueNotified) {
        // Same optimistic-concurrency guard shape as booking-no-show-processing —
        // if the Student claimed in the window between the read above and this
        // write, this is a silent no-op for that row rather than expiring a claim
        // that already succeeded.
        const result = await this.prismaJobs.waitlistEntry.updateMany({
          where: { id: entry.id, status: 'NOTIFIED' },
          data: { status: 'EXPIRED' },
        });
        if (result.count > 0) {
          expired += 1;
          if (await this.notifyNextWaitingEntry(entry.classId)) {
            cascaded += 1;
          }
        }
      }
      this.logger.log(`waitlist-cascade-processing (sweep-expired): ${expired} entry(ies) expired, ${cascaded} cascaded to a next entry.`);
      return;
    }

    this.logger.warn(`Unrecognized waitlist-cascade-processing job name: ${job.name}`);
  }

  /** Finds the lowest-`position` Waiting entry for `classId` and flips it to
   * Notified, computing `claimByDeadline` from the School's own
   * `waitlistClaimWindowMinutes`, capped by the Class's own `startDate` (SKILL.md
   * §10, quoted). Returns whether an entry was actually notified. Uses `findFirst`
   * ordered by `position` + an `updateMany` guard (status still WAITING) rather than
   * a bare `update` — the same TOCTOU-avoidance shape as everywhere else in this
   * codebase; if a concurrent run already claimed this position, the guard makes
   * this a no-op instead of double-notifying. */
  private async notifyNextWaitingEntry(classId: string): Promise<boolean> {
    const next = await this.prismaJobs.waitlistEntry.findFirst({
      where: { classId, status: 'WAITING' },
      orderBy: { position: 'asc' },
      include: { class: { select: { startDate: true, school: { select: { waitlistClaimWindowMinutes: true } } } } },
    });
    if (!next) return false;

    const now = new Date();
    const windowDeadline = new Date(now.getTime() + next.class.school.waitlistClaimWindowMinutes * 60_000);
    const claimByDeadline = windowDeadline < next.class.startDate ? windowDeadline : next.class.startDate;

    const result = await this.prismaJobs.waitlistEntry.updateMany({
      where: { id: next.id, status: 'WAITING' },
      data: { status: 'NOTIFIED', notifiedAt: now, claimByDeadline },
    });
    return result.count > 0;
  }
}
