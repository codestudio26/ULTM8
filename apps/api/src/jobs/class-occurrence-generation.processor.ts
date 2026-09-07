import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { CLASS_OCCURRENCE_GENERATION_QUEUE } from './queue.constants';

/** How far ahead the job generates occurrences, and how often it runs — Spec 55 says
 * only "on a rolling schedule", no number. This default is a Developer-level choice,
 * flagged for Architect review and intended to be recorded as a Decision once
 * confirmed, same pattern as Decisions 82-84. */
const WEEKS_AHEAD = 4;
const CRON_DAILY_AT_2AM_UTC = '0 2 * * *';
const REPEATABLE_JOB_ID = 'class-occurrence-generation-daily';

const WEEKDAY_TO_LUXON: Record<string, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

/**
 * Registers the class-occurrence-generation repeatable job on module init, with a
 * FIXED job id — without one, multiple `apps/api` instances would each register their
 * own copy of the same repeatable schedule. Uses BullMQ's long-standing `repeat` +
 * `jobId` API (not a newer helper this prompt couldn't verify the exact signature of
 * without network access to BullMQ's docs) — BullMQ computes a deterministic
 * repeatable-job key from the repeat options themselves, so calling `.add` with the
 * same pattern + jobId on every instance's startup is idempotent by construction, not
 * just "probably fine."
 *
 * Deliberately NOT awaited in onModuleInit — `queue.add()` is a real Redis command
 * (unlike @InjectQueue's own Queue construction, which is synchronous and doesn't
 * touch the network), and with `lazyConnect: true` plus ioredis's default indefinite
 * retry strategy, awaiting it here would block NestJS's own `app.init()`/`app.listen()`
 * from ever resolving whenever Redis isn't reachable — found by e2e tests actually
 * hanging in exactly that environment, not a theoretical concern. Fire-and-forget with
 * a logged catch instead, matching this codebase's established "warn and let the app
 * boot without an unreachable dependency, don't block startup on it" convention
 * (PrismaAppService, TwilioVerifyService).
 *
 * Retries registration a bounded number of times with backoff before giving up —
 * code review flagged the original single-attempt version as a silent, permanent
 * failure mode if Redis is merely slow to come up at boot (a real, common case: a
 * Redis container that hasn't finished starting yet when apps/api does) rather than
 * genuinely unreachable. This doesn't solve the "Redis is misconfigured forever"
 * case — nothing short of a real health-check/alerting subsystem would, and that's
 * out of scope here — but it turns "briefly slow at startup" from a permanent failure
 * into a self-healing one, which is the common case worth handling now.
 */
@Injectable()
export class ClassOccurrenceGenerationScheduler implements OnModuleInit {
  private readonly logger = new Logger(ClassOccurrenceGenerationScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(CLASS_OCCURRENCE_GENERATION_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    // Not awaited — see the class doc comment above for why blocking app bootstrap on
    // this is the exact bug already found and fixed once this phase.
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...ClassOccurrenceGenerationScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('run', {}, { repeat: { pattern: CRON_DAILY_AT_2AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable class-occurrence-generation job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable class-occurrence-generation job after all retries — ' +
        'no bookable Class occurrences will be generated until this succeeds (app restart or Redis becoming reachable).',
    );
  }
}

/**
 * Consumes the class-occurrence-generation queue (Phase 5) — materializes bookable
 * Class rows from active TimetableSlots, Spec 55 §9's confirmed job. Runs via
 * PrismaJobsService (ultm8_jobs role), NOT PrismaAppService — this is a genuine
 * cross-tenant sweep with no single caller, unlike every other write path in this
 * codebase; see the migration's own header comment for why a dedicated role exists
 * for this rather than reusing ultm8_app or bypassing RLS outright (flagged there for
 * Architect review as a real trade-off, not re-litigated here).
 *
 * Deliberately deferred (see the Phase 5 kickoff prompt, not silently dropped):
 *  - Skipping a School whose platform SubscriptionPlan is in the read-only degraded
 *    state (Spec 55 §9/§10.2) — SubscriptionPlansModule doesn't exist yet.
 *  - Any Class already materialized is never mutated/cancelled if its source
 *    TimetableSlot is later edited (status flip, instructor/time change) — Spec 55
 *    doesn't say what should happen, and retroactively touching rows a Student may
 *    already hold real Bookings against is the wrong default to guess at.
 *
 * Timezone: uses Branch.timezone when the slot is Branch-scoped. School itself has no
 * confirmed timezone field anywhere in this schema, so a School-wide slot
 * (branchId null) falls back to UTC — a reasonable-minimum default, NOT a confirmed
 * answer; flagged prominently here and in the kickoff prompt for a real product
 * decision (add School.timezone, or a different resolution) before this is trusted for
 * a School-wide slot outside UTC. Occurrence dates are computed by advancing in LOCAL
 * calendar days within the resolved IANA zone (via luxon, which handles DST correctly)
 * and converting the resulting local wall-clock time to UTC per-occurrence — never by
 * adding a fixed 7x24-hour duration to a UTC instant, which would silently drift by an
 * hour across a DST boundary.
 *
 * Writes are batched with `createMany({ skipDuplicates: true })` **per slot** (not
 * globally across the whole run) — code review caught that Postgres's
 * `ON CONFLICT DO NOTHING` only suppresses the unique-constraint conflict; any OTHER
 * error (e.g. a concurrently-deleted School/Branch causing an FK violation) aborts and
 * rolls back the entire `createMany` statement, not just the offending row. Chunking
 * per slot bounds the blast radius of that to one slot's `WEEKS_AHEAD` rows instead of
 * every active TimetableSlot's rows platform-wide.
 */
@Processor(CLASS_OCCURRENCE_GENERATION_QUEUE)
export class ClassOccurrenceGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ClassOccurrenceGenerationProcessor.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const activeSlots = await this.prismaJobs.timetableSlot.findMany({
      where: { status: 'ON' },
      include: { branch: { select: { timezone: true } } },
    });

    let created = 0;
    let skippedExisting = 0;

    for (const slot of activeSlots) {
      const timezone = slot.branch?.timezone ?? 'UTC';
      const targetWeekday = WEEKDAY_TO_LUXON[slot.weekday];
      const now = DateTime.now().setZone(timezone);
      let daysUntilTarget = (targetWeekday - now.weekday + 7) % 7;

      // If today IS the target weekday but this slot's startTime has already passed
      // in local time, the next real occurrence is next week, not "today" in the
      // past — code review caught this: a fixed 02:00 UTC cron is already afternoon/
      // evening local time for timezones far enough ahead of UTC.
      if (daysUntilTarget === 0) {
        const todayAtStart = now.set({
          hour: slot.startTime.getUTCHours(),
          minute: slot.startTime.getUTCMinutes(),
          second: 0,
          millisecond: 0,
        });
        if (todayAtStart <= now) {
          daysUntilTarget = 7;
        }
      }

      const occurrences: Prisma.ClassCreateManyInput[] = [];
      for (let weekIndex = 0; weekIndex < WEEKS_AHEAD; weekIndex++) {
        const occurrenceLocalDate = now.plus({ days: daysUntilTarget + 7 * weekIndex }).startOf('day');

        const startDate = this.combineDateAndTime(occurrenceLocalDate, slot.startTime);
        const endDate = this.combineDateAndTime(occurrenceLocalDate, slot.endTime);
        // The DATE (not instant) this occurrence falls on, for the @db.Date
        // occurrenceDate column — built directly from occurrenceLocalDate's own
        // year/month/day at UTC, NOT via occurrenceLocalDate.toJSDate() (which
        // preserves the local-midnight INSTANT, silently landing on the previous UTC
        // calendar day for any timezone ahead of UTC — a real bug code review caught,
        // confirmed reachable for e.g. Asia/Tokyo, Pacific/Auckland).
        const occurrenceDate = DateTime.utc(
          occurrenceLocalDate.year,
          occurrenceLocalDate.month,
          occurrenceLocalDate.day,
        ).toJSDate();

        occurrences.push({
          id: randomUUID(),
          schoolId: slot.schoolId,
          branchId: slot.branchId,
          instructorId: slot.instructorId,
          timetableSlotId: slot.id,
          occurrenceDate,
          title: slot.title,
          activities: slot.activities,
          bannerUrl: slot.bannerUrl,
          description: slot.description,
          startDate,
          endDate,
          capacity: slot.capacity,
          // `!= null`, not truthy — 0 is a valid, meaningful value for all three
          // (e.g. bookingCutoffMinutesBeforeStart: 0 means "bookable right up to
          // start", not "no cutoff at all"). A truthy check silently treated 0 the
          // same as unset, producing the OPPOSITE of the intended restriction — a
          // real bug code review caught.
          bookingEndAt:
            slot.bookingCutoffMinutesBeforeStart != null
              ? new Date(startDate.getTime() - slot.bookingCutoffMinutesBeforeStart * 60_000)
              : undefined,
          qrAttendanceEndAt:
            slot.qrAttendanceWindowMinutes != null
              ? new Date(startDate.getTime() + slot.qrAttendanceWindowMinutes * 60_000)
              : undefined,
          refundFeeDate:
            slot.refundCutoffHoursBeforeStart != null
              ? new Date(startDate.getTime() - slot.refundCutoffHoursBeforeStart * 3_600_000)
              : undefined,
          cancellationCharge: slot.cancellationCharge,
          termsWaiverRequired: slot.termsWaiverRequired,
          membershipInclusion: slot.membershipInclusion,
        });
      }

      try {
        const result = await this.prismaJobs.class.createMany({ data: occurrences, skipDuplicates: true });
        created += result.count;
        skippedExisting += occurrences.length - result.count;
      } catch (err) {
        // Anything reaching here is NOT a duplicate-occurrence conflict —
        // skipDuplicates already absorbs those silently. A real error (e.g. an FK
        // violation from a concurrently-deleted School/Branch) rolls back this one
        // slot's whole batch; log and move on to the next slot rather than aborting
        // the entire run over one bad slot.
        this.logger.error(`Failed to materialize occurrences for TimetableSlot ${slot.id}`, err as Error);
      }
    }

    this.logger.log(`class-occurrence-generation: ${created} created, ${skippedExisting} already existed.`);
  }

  /** Combines a local calendar date with a `@db.Time(0)` value (itself stored against
   * the epoch date, 1970-01-01 UTC — see TimetableService's own parseHHmm/formatHHmm)
   * into the correct UTC instant for that specific occurrence. Takes the timezone from
   * `localDate` itself (its own luxon zone) rather than a separate parameter — `.set()`
   * on an already-zoned DateTime keeps that zone, so there's no separate value that
   * could silently diverge from it. */
  private combineDateAndTime(localDate: DateTime, time: Date): Date {
    return localDate
      .set({ hour: time.getUTCHours(), minute: time.getUTCMinutes(), second: 0, millisecond: 0 })
      .toUTC()
      .toJSDate();
  }
}
