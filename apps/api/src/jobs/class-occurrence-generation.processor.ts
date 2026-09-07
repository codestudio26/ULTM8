import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
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
 */
@Injectable()
export class ClassOccurrenceGenerationScheduler implements OnModuleInit {
  private readonly logger = new Logger(ClassOccurrenceGenerationScheduler.name);

  constructor(@InjectQueue(CLASS_OCCURRENCE_GENERATION_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    this.queue
      .add('run', {}, { repeat: { pattern: CRON_DAILY_AT_2AM_UTC }, jobId: REPEATABLE_JOB_ID })
      .catch((err) => this.logger.error('Failed to register the repeatable class-occurrence-generation job', err));
  }
}

/**
 * Consumes the class-occurrence-generation queue (Phase 5) — materializes bookable
 * Class rows from active TimetableSlots, Spec 55 §9's confirmed job. Runs via
 * PrismaJobsService (ultm8_jobs role), NOT PrismaAppService — this is a genuine
 * cross-tenant sweep with no single caller, unlike every other write path in this
 * codebase; see the migration's own header comment for why a dedicated role exists
 * for this rather than reusing ultm8_app or bypassing RLS outright.
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
      const daysUntilTarget = (targetWeekday - now.weekday + 7) % 7;

      for (let weekIndex = 0; weekIndex < WEEKS_AHEAD; weekIndex++) {
        const occurrenceLocalDate = now.plus({ days: daysUntilTarget + 7 * weekIndex }).startOf('day');

        const startDate = this.combineDateAndTime(occurrenceLocalDate, slot.startTime, timezone);
        const endDate = this.combineDateAndTime(occurrenceLocalDate, slot.endTime, timezone);
        const occurrenceDate = occurrenceLocalDate.toJSDate();

        try {
          await this.prismaJobs.class.create({
            data: {
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
              bookingEndAt: slot.bookingCutoffMinutesBeforeStart
                ? new Date(startDate.getTime() - slot.bookingCutoffMinutesBeforeStart * 60_000)
                : undefined,
              qrAttendanceEndAt: slot.qrAttendanceWindowMinutes
                ? new Date(startDate.getTime() + slot.qrAttendanceWindowMinutes * 60_000)
                : undefined,
              refundFeeDate: slot.refundCutoffHoursBeforeStart
                ? new Date(startDate.getTime() - slot.refundCutoffHoursBeforeStart * 3_600_000)
                : undefined,
              cancellationCharge: slot.cancellationCharge,
              termsWaiverRequired: slot.termsWaiverRequired,
              membershipInclusion: slot.membershipInclusion,
            },
          });
          created++;
        } catch (err) {
          // P2002 = unique constraint violation on (timetableSlotId, occurrenceDate) —
          // this occurrence already exists from a prior run. Expected and harmless;
          // anything else re-throws.
          if ((err as { code?: string }).code === 'P2002') {
            skippedExisting++;
            continue;
          }
          throw err;
        }
      }
    }

    this.logger.log(`class-occurrence-generation: ${created} created, ${skippedExisting} already existed.`);
  }

  /** Combines a local calendar date with a `@db.Time(0)` value (itself stored against
   * the epoch date, 1970-01-01 UTC — see TimetableService's own parseHHmm/formatHHmm)
   * into the correct UTC instant for that specific occurrence, in the given timezone. */
  private combineDateAndTime(localDate: DateTime, time: Date, timezone: string): Date {
    return DateTime.fromObject(
      {
        year: localDate.year,
        month: localDate.month,
        day: localDate.day,
        hour: time.getUTCHours(),
        minute: time.getUTCMinutes(),
      },
      { zone: timezone },
    )
      .toUTC()
      .toJSDate();
  }
}
