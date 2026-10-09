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
        'a Membership past its own expiryDate will never be Expired, and its Student\'s stale future ' +
        'Bookings will never be cancelled, until this succeeds.',
    );
  }
}

/**
 * Consumes the membership-expiry-sweep queue — closes the gap Decision 122's
 * own "What this does NOT resolve" note flagged by name: Spec 55 §6.1/Decision
 * 26 confirm Membership.status expiry-by-date is "a live-computed predicate
 * evaluated at every access/booking check against the stored expiry date, not
 * a scheduled batch flip" (see the 20260912000000_memberships_transactions_module
 * migration's own KNOWN LIMITATION comment, and MembershipsService.getMembershipStatus(),
 * which computes this same predicate live for its one caller but never persists
 * it). That's still true and unchanged by this job for the ACTIVE/EXPIRED
 * status Students/Staff are shown — this job does not touch that live-computed
 * read path or its contract.
 *
 * What WAS missing, and is what this job actually fixes: nothing in the
 * codebase ever persisted the EXPIRED flip for a date-based expiry, so nothing
 * ever cancelled the Student's own future Bookings still funded by that
 * Membership — the exact "same-day sweep cancels the Student's own future
 * Bookings" half of Spec 55 §6.1's rule Decision 122 already built for the
 * Stripe-driven force-Expiry paths (subscription cancellation, lost dispute),
 * left undone here. This job is that same rule, applied to the date-based
 * path, reusing the identical cancelFutureBookingsFundedByExpiredMembership()
 * helper Decision 122 already wrote (now shared, not duplicated — see that
 * file's own header comment) so the WITHHELD-not-REFUNDED/guest-seat-scope
 * reasoning stays in exactly one place.
 *
 * Persisting Membership.status = EXPIRED here (rather than leaving it live-
 * computed-only forever) is a deliberate, narrow addition: it's what makes a
 * funded Booking's cancellation possible at all — nothing can react to an
 * expiry that only ever exists as an ephemeral return value of one read
 * method. Scope is intentionally the mirror of the Stripe-driven paths: only
 * flips status and cancels Bookings, no refund, no notification beyond the
 * existing waitlist-cascade 'seat-freed' cascade every other freed-seat path
 * in this codebase already triggers.
 *
 * Runs via PrismaJobsService (ultm8_jobs role) — same reasoning as every other
 * scheduled/cross-tenant job in this codebase; that role already holds
 * unrestricted SELECT/UPDATE on Membership (granted for stripe-webhook-processing,
 * Phase 9) and SELECT/UPDATE on Booking (granted for the Phase 11 no-show
 * sweep) — no new grant needed for this addition.
 *
 * Each overdue Membership is flipped + swept inside its OWN `$transaction` —
 * not one big transaction for the whole sweep — so one Membership's failure
 * (or a losing optimistic-concurrency race against a concurrent Stripe webhook
 * force-Expiring the same row) can't roll back every other Membership this
 * sweep already handled.
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

    const overdue = await this.prismaJobs.membership.findMany({
      where: { status: 'ACTIVE', expiryDate: { not: null, lt: now } },
      select: { id: true },
    });

    let expired = 0;
    const freedClassIds: string[] = [];

    for (const { id: membershipId } of overdue) {
      try {
        const { flipped, classIds } = await this.prismaJobs.$transaction(async (tx) => {
          // Optimistic-concurrency guard, same shape as every other
          // status-transition in this codebase — if a concurrent Stripe
          // webhook (or a previous, still-finishing run of this same sweep)
          // already force-Expired this Membership between the read above and
          // this write, this is a silent no-op for that row rather than
          // double-sweeping its Bookings.
          const result = await tx.membership.updateMany({ where: { id: membershipId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
          if (result.count === 0) return { flipped: false, classIds: [] as string[] };
          const classIds = await cancelFutureBookingsFundedByExpiredMembership(tx, membershipId, this.logger);
          return { flipped: true, classIds };
        });
        // `flipped` tracks the status transition itself (this run actually won
        // the ACTIVE->EXPIRED race) — independent of whether that Membership
        // happened to be funding any still-UPCOMING Booking. A Membership with
        // nothing to cancel still counts as a real Expiry here.
        if (flipped) {
          expired += 1;
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

    this.logger.log(`membership-expiry-sweep: ${overdue.length} overdue Membership(s) found, ${expired} Expired, ${freedClassIds.length} seat-freed job(s) enqueued.`);
  }
}
