import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { WAITLIST_CASCADE_PROCESSING_QUEUE, BOOKING_NO_SHOW_PROCESSING_QUEUE } from './queue.constants';

/** How often the sweep runs — SKILL.md §10 says only "set by a background job once a
 * Class's end time... passes", no number. Every 15 minutes is a Developer-level
 * choice (frequent enough that a Student's No-Show status reflects reality promptly
 * for Staff/reporting, without hammering the DB), flagged for Architect review same
 * as WEEKS_AHEAD/CRON_DAILY_AT_2AM_UTC in class-occurrence-generation.processor.ts. */
const CRON_EVERY_15_MINUTES = '*/15 * * * *';
const REPEATABLE_JOB_ID = 'booking-no-show-processing-sweep';

/**
 * Registers the booking-no-show-processing repeatable job on module init — same
 * fixed-jobId / not-awaited / bounded-retry-with-backoff pattern as
 * ClassOccurrenceGenerationScheduler (see that class's own doc comment for the full
 * reasoning, not repeated here).
 */
@Injectable()
export class BookingNoShowProcessingScheduler implements OnModuleInit {
  private readonly logger = new Logger(BookingNoShowProcessingScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(BOOKING_NO_SHOW_PROCESSING_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...BookingNoShowProcessingScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_EVERY_15_MINUTES }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable booking-no-show-processing job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable booking-no-show-processing job after all retries — ' +
        'Upcoming Bookings past their Class end time will never be marked No-Show until this succeeds.',
    );
  }
}

/**
 * Consumes the booking-no-show-processing queue (Phase 11) — SKILL.md §10's confirmed
 * job: "Booking.status gains No-Show: set by a background job once a Class's end time
 * (or QR-attendance-end time) passes with the Booking still Upcoming. This does not
 * touch StudentRank.classesAttended and does not refund/restore the spent credit."
 *
 * Trigger-timing resolution (Phase 11 kickoff prompt §4 point 1, not itself further
 * disambiguated by §10's own "or" phrasing): uses `Class.qrAttendanceEndAt` when set
 * (the more precise check-in-window signal), falling back to `Class.endDate` when
 * `qrAttendanceEndAt` is null.
 *
 * Runs via PrismaJobsService (ultm8_jobs role), NOT PrismaAppService — a genuine
 * cross-tenant sweep with no single caller, same reasoning as every other scheduled
 * job in this codebase (class-occurrence-generation, stripe-webhook-processing).
 *
 * Deliberately does NOT touch BookingAttendee, StudentRank, or any credit/Membership
 * row — a No-Show is confirmed to leave the spent credit(s) withheld exactly as they
 * were at Booking creation (no restore), and confirmed to never touch
 * StudentRank.classesAttended (that only increments via the qr-attendance-processing
 * job's own Completed transition — Phase "12", not built here).
 *
 * After flipping a Booking to No-Show, enqueues a waitlist-cascade-processing
 * 'seat-freed' job for that Class — a No-Show frees the seat exactly the way a
 * Cancellation does (SKILL.md §10: "A freed seat (from a Cancellation or a No-Show
 * alike) notifies the next Waiting entry").
 */
@Processor(BOOKING_NO_SHOW_PROCESSING_QUEUE)
export class BookingNoShowProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(BookingNoShowProcessingProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();

    const overdueUpcoming = await this.prismaJobs.booking.findMany({
      where: {
        status: 'UPCOMING',
        class: {
          OR: [
            { qrAttendanceEndAt: { not: null, lt: now } },
            { qrAttendanceEndAt: null, endDate: { lt: now } },
          ],
        },
      },
      select: { id: true, classId: true },
    });

    let marked = 0;
    // FOUND ON REVIEW: deduping by classId into a Set and enqueueing only ONE
    // seat-freed job per Class silently under-cascaded — notifyNextWaitingEntry()
    // only ever notifies a single next Waiting entry per job, so a Class with N
    // simultaneous no-shows in one sweep (the common case: Bookings for the same
    // Class share the same endDate/qrAttendanceEndAt cutoff, and this sweep runs
    // every 15 minutes) only ever offered 1 of the N freed seats to the waitlist,
    // silently stranding the other N-1. Fixed by enqueueing one seat-freed job PER
    // no-showed Booking, not deduped by Class — matching how the sweep-expired path
    // in WaitlistCascadeProcessingProcessor already correctly handles N
    // simultaneously-expired claims in the same Class (one notifyNextWaitingEntry
    // call per expired entry, never deduped).
    const affectedClassIds: string[] = [];

    for (const booking of overdueUpcoming) {
      // updateMany + a status='UPCOMING' guard, not a bare update — the same
      // optimistic-concurrency shape this codebase established for StudentRank
      // (Phase 10b): if the Student (or Staff, via override) cancelled this exact
      // Booking in the window between the findMany read above and this write, the
      // guard makes this a silent no-op for that row instead of clobbering a
      // Cancellation with a No-Show.
      const result = await this.prismaJobs.booking.updateMany({
        where: { id: booking.id, status: 'UPCOMING' },
        data: { status: 'NO_SHOW' },
      });
      if (result.count > 0) {
        marked += 1;
        affectedClassIds.push(booking.classId);
      }
    }

    for (const classId of affectedClassIds) {
      try {
        await this.waitlistCascadeQueue.add('seat-freed', { classId });
      } catch (err) {
        this.logger.error(`Failed to enqueue waitlist-cascade-processing for Class ${classId} after a No-Show`, err as Error);
      }
    }

    this.logger.log(`booking-no-show-processing: ${marked} Booking(s) marked No-Show, ${affectedClassIds.length} seat-freed job(s) enqueued.`);
  }
}
