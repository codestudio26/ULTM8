import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { WAITLIST_CASCADE_PROCESSING_QUEUE, BOOKING_NO_SHOW_PROCESSING_QUEUE } from './queue.constants';
import { NoSavedPaymentMethodError, PaymentsService } from '../payments/payments.service';
import { chargeCurrency } from '../common/school-currency';
import { CARD_ACCOUNT_SELECT, takesCards } from '../payments/takes-cards';
import { settleNoShowFee } from '../payments/off-session-attempts';

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
    private readonly paymentsService: PaymentsService,
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
      select: { id: true, classId: true, studentId: true, schoolId: true, sourceMembershipId: true, class: { select: { branchId: true } } },
    });
    // Decision 291 — each School's no-show fee (Booking has no School relation),
    // or, Decision 292, the class's Branch's own when that Branch overrides it.
    const schools = await this.prismaJobs.school.findMany({
      where: { id: { in: [...new Set(overdueUpcoming.map((b) => b.schoolId))] } },
      select: { id: true, noShowFee: true },
    });
    const noShowFeeBySchool = new Map(schools.map((sc) => [sc.id, sc.noShowFee]));
    const branchIds = [...new Set(overdueUpcoming.map((b) => b.class.branchId).filter((id): id is string => id !== null))];
    const overridingBranches = await this.prismaJobs.branch.findMany({
      where: { id: { in: branchIds }, cancellationSettingsOverride: true },
      select: { id: true, noShowFee: true },
    });
    const noShowFeeByBranch = new Map(overridingBranches.map((br) => [br.id, br.noShowFee]));
    const noShowFeeFor = (booking: (typeof overdueUpcoming)[number]) =>
      booking.class.branchId && noShowFeeByBranch.has(booking.class.branchId)
        ? noShowFeeByBranch.get(booking.class.branchId)
        : noShowFeeBySchool.get(booking.schoolId);

    let marked = 0;
    const toCharge: Array<{ booking: (typeof overdueUpcoming)[number]; fee: number }> = [];
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
        const fee = noShowFeeFor(booking);
        if (fee !== null && fee !== undefined && fee > 0) toCharge.push({ booking, fee });
      }
    }

    // Decision 291 — the School's optional no-show fee, charged to the
    // Student's saved card exactly like Decision 234's late-cancellation fee:
    // only after the status flip committed, never blocking it, outcome recorded
    // on the Booking. Only a booking this run actually flipped is charged, so a
    // re-run can't charge twice.
    for (const { booking, fee } of toCharge) {
      await this.chargeNoShowFee(booking, fee);
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

  private async chargeNoShowFee(
    booking: { id: string; studentId: string; schoolId: string; sourceMembershipId: string | null },
    amount: number,
  ): Promise<void> {
    // The fee is a School (or Branch) amount, so it is in the School's
    // currency (Decisions 414/416; Decision 431 MON-5), never US dollars by
    // default. No currency set: nothing is charged, and the log says why.
    const school = await this.prismaJobs.school.findUnique({ where: { id: booking.schoolId }, select: { defaultCurrency: true } });
    const currency = chargeCurrency(null, school?.defaultCurrency);
    if (!currency) {
      this.logger.error(`No-show fee failed for Booking ${booking.id} (Student ${booking.studentId}, School ${booking.schoolId}): the School has no currency set.`);
      await this.prismaJobs.booking.update({ where: { id: booking.id }, data: { noShowFeeOutcome: 'FAILED', noShowFeeAmount: amount, stripeNoShowPaymentIntentId: null } });
      return;
    }
    // Decision 447 item 4 (as Decision 446 item 5 for late-cancellation
    // fees): when a card can be tried, the attempt is written first: the
    // Booking's noShowFeeAmount, with no outcome yet. The PaymentIntent
    // carries the Booking's id (metadata and idempotency key), so a fee Stripe
    // took is never lost if this stops before the outcome is saved: Stripe's
    // webhook, or charge-auto-pay's stale-attempt sweep, saves it from what
    // Stripe says (settleNoShowFee()). A no-show fee has no ledger row, so the
    // Booking is the record, as before.
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId: booking.schoolId }, select: CARD_ACCOUNT_SELECT });
    const saved = account && takesCards(account)
      ? await this.prismaJobs.studentPaymentMethod.findUnique({ where: { studentId_schoolId: { studentId: booking.studentId, schoolId: booking.schoolId } }, select: { id: true } })
      : null;
    // A card can't be tried (no saved card, or the School takes no cards):
    // chargeOffSession() says so, and the outcome is saved as before.
    const tagged = saved ? (await this.prismaJobs.booking.updateMany({ where: { id: booking.id, noShowFeeAmount: null, noShowFeeOutcome: null }, data: { noShowFeeAmount: amount } })).count > 0 : false;
    if (saved && !tagged) return; // another run made the attempt

    let answer: { succeeded: boolean; paymentIntentId: string | null };
    try {
      const charge = tagged
        ? await this.paymentsService.chargeOffSession(booking.studentId, booking.schoolId, amount, currency, 'No-show fee', `no-show-fee-${booking.id}`, 0, { noShowBookingId: booking.id })
        : await this.paymentsService.chargeOffSession(booking.studentId, booking.schoolId, amount, currency, 'No-show fee');
      answer = { succeeded: charge.succeeded, paymentIntentId: charge.paymentIntentId || null };
    } catch (err) {
      if (err instanceof NoSavedPaymentMethodError) {
        // Nothing was tried (no default card on the Customer, or the
        // School's account not ready).
        await this.prismaJobs.booking.updateMany({
          where: { id: booking.id, noShowFeeOutcome: null },
          data: { noShowFeeOutcome: 'NO_SAVED_PAYMENT_METHOD', noShowFeeAmount: amount, stripeNoShowPaymentIntentId: null },
        });
        return;
      }
      this.logger.error(`No-show fee failed for Booking ${booking.id} (Student ${booking.studentId}, School ${booking.schoolId}).`, err as Error);
      // With the attempt written, Stripe may still have charged the card: no
      // outcome yet, for Stripe's webhook or the stale-attempt sweep.
      if (tagged) return;
      answer = { succeeded: false, paymentIntentId: null };
    }
    if (tagged) {
      await this.prismaJobs.$transaction((tx) => settleNoShowFee(tx, booking.id, answer.paymentIntentId, answer.succeeded));
    } else {
      await this.prismaJobs.booking.update({
        where: { id: booking.id },
        data: { noShowFeeOutcome: answer.succeeded ? 'CHARGED' : 'FAILED', noShowFeeAmount: amount, stripeNoShowPaymentIntentId: answer.paymentIntentId },
      });
    }
  }
}
