import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { CLASS_OCCURRENCE_GENERATION_QUEUE } from './queue.constants';
import { buildSlotOccurrences, withoutClosedDates } from '../timetable/slot-occurrences';

/** How far ahead the job generates occurrences, and how often it runs — Spec 55 says
 * only "on a rolling schedule", no number. This default is a Developer-level choice,
 * flagged for Architect review and intended to be recorded as a Decision once
 * confirmed, same pattern as Decisions 82-84. */
const CRON_DAILY_AT_2AM_UTC = '0 2 * * *';
const REPEATABLE_JOB_ID = 'class-occurrence-generation-daily';


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
 * Timezone (Decision 172): the slot's Branch.timezone, else its School.timezone,
 * else UTC (a School that hasn't set one yet). Occurrence dates are computed by
 * advancing in LOCAL calendar days within the resolved IANA zone (via luxon, which
 * handles DST correctly)
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
    // Only slots that are On, not archived, at a School that isn't closed and not on
    // an archived Branch (Decision 332, T1, T2): archiving a slot took its Classes
    // off the schedule, and this run used to put them back every night.
    const activeSlots = await this.prismaJobs.timetableSlot.findMany({
      where: { status: 'ON', archivedAt: null, school: { archivedAt: null }, OR: [{ branchId: null }, { branch: { archivedAt: null } }] },
      include: { branch: { select: { timezone: true } }, school: { select: { timezone: true } } },
    });

    // Closed dates are skipped (Decision 319 §3, Decision 353 Q8). Only closures
    // that haven't ended matter; a day's slack covers every zone.
    const closures = await this.prismaJobs.closure.findMany({
      where: { endDate: { gte: new Date(Date.now() - 86_400_000) } },
      select: { schoolId: true, branchId: true, startDate: true, endDate: true },
    });

    let created = 0;
    let skippedExisting = 0;

    for (const slot of activeSlots) {
      // The slot's own Branch timezone wins, then its School's, else UTC.
      const timezone = slot.branch?.timezone ?? slot.school.timezone ?? 'UTC';
      // Shared with slot edits (Decision 322): timetable/slot-occurrences.ts.
      const { branch: _branch, school: _school, ...slotRow } = slot;
      const occurrences = withoutClosedDates(
        buildSlotOccurrences(slotRow, timezone),
        closures.filter((c) => c.schoolId === slot.schoolId),
        slot.branchId,
      );

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

}
