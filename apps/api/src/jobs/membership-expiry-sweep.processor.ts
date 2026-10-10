import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { MEMBERSHIP_EXPIRY_SWEEP_QUEUE, WAITLIST_CASCADE_PROCESSING_QUEUE } from './queue.constants';
import { cancelFutureBookingsFundedByExpiredMembership } from './membership-booking-cancellation';

/** Same cadence as BookingNoShowProcessingScheduler's own sweep — frequent
 * enough that a Student's stale Bookings against a long-expired Membership
 * clear out promptly, without hammering the DB. Developer-level choice,
 * flagged for Architect review same as every other CRON_* constant in this
 * directory. */
const CRON_EVERY_15_MINUTES = '*/15 * * * *';
const REPEATABLE_JOB_ID = 'membership-expiry-sweep';

/**
 * Registers the membership-expiry-sweep repeatable job on module init — same
 * fixed-jobId / not-awaited / bounded-retry-with-backoff pattern as every
 * other scheduler in this directory (see BookingNoShowProcessingScheduler's
 * own doc comment for the full reasoning, not repeated here).
 */
@Injectable()
export class MembershipExpirySweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(MembershipExpirySweepScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(MEMBERSHIP_EXPIRY_SWEEP_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...MembershipExpirySweepScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_EVERY_15_MINUTES }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable membership-expiry-sweep job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable membership-expiry-sweep job after all retries — ' +
        'a Student\'s stale future Bookings, still funded by a Membership that already expired ' +
        'by date, will never be cancelled until this succeeds.',
    );
  }
}

/**
 * Consumes the membership-expiry-sweep queue — closes the gap Decision 122's
 * own "What this does NOT resolve" note flagged by name: a Membership whose
 * EXPIRED-by-date is confirmed [CONFIRMED] by Decision 26 to be purely a
 * live-computed predicate — "evaluated at every access/booking check against
 * the stored expiry date, not a scheduled batch flip" (see the
 * 20260912000000_memberships_transactions_module migration's own KNOWN
 * LIMITATION comment, and MembershipsService.getMembershipStatus(), which
 * computes this same predicate live for its one caller but never persists
 * it) — never had its Student's own future Bookings swept the way the
 * Stripe-driven force-Expiry paths already are (Decision 122).
 *
 * FOUND ON REVIEW, before merge: an earlier draft of this job persisted
 * Membership.status = EXPIRED to make that sweep possible. That is exactly
 * the "scheduled batch flip" Decision 26 prohibits, and it wasn't inert —
 * franchise-fee-usage-reporting.processor.ts's countActiveStudents() reads
 * status: 'ACTIVE' directly to compute a Franchise's monthly per-headcount
 * bill (Decision 54); flipping it would have silently dropped any Student
 * whose Class Pack/Weekly Pass merely expired-by-date since the last report,
 * an undiscussed side effect in direct tension with a named, confirmed
 * decision. Fixed: this job now NEVER reads or writes Membership.status.
 * Status stays exactly what Decision 26 already says it must stay — ACTIVE
 * in storage, forever, for this path — and every existing consumer of that
 * column (franchise-fee billing, BookingsService/WaitlistService's own
 * membership-selection reads) is completely unaffected by this job's
 * existence.
 *
 * What this job actually does: finds every ACTIVE Membership whose
 * `expiryDate` has passed (the identical live-computed predicate
 * getMembershipStatus() already uses, read-only, never persisted) and not yet
 * swept (`bookingCancellationSweptAt` still null — this job's OWN private
 * bookkeeping column, carrying no ACTIVE/EXPIRED meaning at all; see its own
 * schema comment), cancels the Student's own still-UPCOMING Bookings it was
 * funding (reusing the identical cancelFutureBookingsFundedByExpiredMembership()
 * helper Decision 122 already wrote, now shared rather than duplicated — see
 * that file's own header comment), and stamps `bookingCancellationSweptAt` so
 * the next run doesn't re-scan it. Scope is intentionally the mirror of the
 * Stripe-driven paths otherwise: no refund, no notification beyond the
 * existing waitlist-cascade 'seat-freed' cascade every other freed-seat path
 * in this codebase already triggers.
 *
 * Runs via PrismaJobsService (ultm8_jobs role) — same reasoning as every other
 * scheduled/cross-tenant job in this codebase; that role already holds
 * unrestricted SELECT/UPDATE on Membership (granted for stripe-webhook-processing,
 * Phase 9 — covers the new column too, an ADD COLUMN on an already-granted
 * table) and SELECT/UPDATE on Booking (granted for the Phase 11 no-show
 * sweep) — no new grant needed for this addition.
 *
 * Each overdue Membership is swept inside its OWN `$transaction` — not one big
 * transaction for the whole sweep — so one Membership's failure (or a losing
 * optimistic-concurrency race against a concurrent run of this same sweep)
 * can't roll back every other Membership this sweep already handled.
 *
 * One 'seat-freed' job is enqueued PER freed Class (not deduped across
 * Memberships/Bookings) — the same bug BookingNoShowProcessingProcessor's own
 * review comment already flagged and fixed for its own sweep: deduping would
 * silently under-cascade a Class with multiple simultaneously-freed seats,
 * since notifyNextWaitingEntry() only ever notifies one next Waiting entry per
 * job.
 */
@Processor(MEMBERSHIP_EXPIRY_SWEEP_QUEUE)
export class MembershipExpirySweepProcessor extends WorkerHost {
  private readonly logger = new Logger(MembershipExpirySweepProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();

    // status: 'ACTIVE' here is a READ against the same live-computed
    // predicate getMembershipStatus() uses — never written back (see this
    // class's own header comment). bookingCancellationSweptAt: null excludes
    // whatever this job already handled on a prior run, so a Membership
    // that's been expired-by-date for months isn't re-scanned forever.
    const overdue = await this.prismaJobs.membership.findMany({
      where: { status: 'ACTIVE', expiryDate: { not: null, lt: now }, bookingCancellationSweptAt: null },
      select: { id: true },
    });

    let swept = 0;
    const freedClassIds: string[] = [];

    for (const { id: membershipId } of overdue) {
      try {
        const { won, classIds } = await this.prismaJobs.$transaction(async (tx) => {
          // Optimistic-concurrency guard, same shape as every other
          // status-transition in this codebase — if a previous, still-
          // finishing run of this same sweep already stamped this Membership
          // between the read above and this write, this is a silent no-op
          // for that row rather than double-sweeping its Bookings. Guards on
          // bookingCancellationSweptAt, NOT status — status is never written
          // by this job at all.
          const result = await tx.membership.updateMany({
            where: { id: membershipId, bookingCancellationSweptAt: null },
            data: { bookingCancellationSweptAt: now },
          });
          if (result.count === 0) return { won: false, classIds: [] as string[] };
          const classIds = await cancelFutureBookingsFundedByExpiredMembership(tx, membershipId, this.logger);
          return { won: true, classIds };
        });
        if (won) {
          swept += 1;
        }
        freedClassIds.push(...classIds);
      } catch (err) {
        this.logger.error(`membership-expiry-sweep: failed to sweep Membership ${membershipId}`, err as Error);
      }
    }

    for (const classId of freedClassIds) {
      try {
        await this.waitlistCascadeQueue.add('seat-freed', { classId });
      } catch (err) {
        this.logger.error(`Failed to enqueue waitlist-cascade-processing for Class ${classId} after a date-based Membership expiry`, err as Error);
      }
    }

    this.logger.log(`membership-expiry-sweep: ${overdue.length} overdue Membership(s) found, ${swept} swept, ${freedClassIds.length} seat-freed job(s) enqueued.`);
  }
}
