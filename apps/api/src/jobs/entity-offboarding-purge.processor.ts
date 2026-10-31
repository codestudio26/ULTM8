import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { ENTITY_OFFBOARDING_PURGE_QUEUE } from './queue.constants';
import { REJECTED_SIGN_UP_DAYS } from '../front-desk/sign-up-rules';
import { branchHasHistory, countBranchDependents, describeBranchDependents, hasBranchDependents } from '../tenants/branches/branch-dependents';
import { eraseMemberFiles } from '../member-files/member-file-erasure';

/** Same daily cadence as tenant-lifecycle-purge's own sweep (Decision 110) —
 * purgeAt is date-granular (90 days out), not a tight real-time window. See
 * that scheduler's own doc comment for the full reasoning, not repeated
 * here. A different time of day (4am, not 3am) only so the two daily sweeps
 * don't contend for the same Postgres connection slot at the exact same
 * instant — a minor, not load-bearing, choice. */
const CRON_DAILY_AT_4AM_UTC = '0 4 * * *';
const REPEATABLE_JOB_ID = 'entity-offboarding-purge-sweep';

/** Same fixed-jobId / not-awaited / bounded-retry-with-backoff registration
 * pattern as every other scheduler in this directory — see
 * BookingNoShowProcessingScheduler's own doc comment for the full reasoning. */
@Injectable()
export class EntityOffboardingPurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(EntityOffboardingPurgeScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(ENTITY_OFFBOARDING_PURGE_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...EntityOffboardingPurgeScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_4AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable entity-offboarding-purge job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable entity-offboarding-purge job after all retries — ' +
        'archived Branches/Classes/TimetableSlots/Instructors/Ranks/Lessons past their 90-day retention ' +
        'window will never be purged until this succeeds.',
    );
  }
}

function isForeignKeyRestrictError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

/**
 * Consumes the entity-offboarding-purge queue (Decision 226) — the second
 * half of the entity-level tenant-offboarding lifecycle the 7 entities'
 * archive() methods start (BranchesService, ClassesService, TimetableService,
 * InstructorsService, RanksService, WaiversService, CurriculumService). Same
 * overall shape as TenantLifecyclePurgeProcessor (Decision 110) — finds every
 * row whose purgeAt has elapsed with no reversal (purgedAt still null) — but
 * scoped to these 7 entities, School-Owner-gated at the archive end rather
 * than Platform-Admin-gated, and with no anonymize-in-place fallback: a
 * FK-restrict here is simply logged and skipped (retried on the next day's
 * sweep forever, same as a registration failure above never giving up) —
 * these 7 entities carry no PII-redaction requirement comparable to School/
 * Franchise's own close-account flow, so there is nothing to anonymize into.
 *
 * WAIVER (THE TEMPLATE ROW) IS THE ONE DELIBERATE EXCEPTION — NEVER PURGED,
 * AT ANY purgeAt, REGARDLESS OF WHETHER IT HAS ANY WaiverSignature: mirrors
 * Decision 110's own School-level purge job, which already refuses to
 * hard-delete a School that still owns Waiver rows. This job finds Waiver
 * rows whose purgeAt has elapsed (so the School Portal's own UI can still
 * show an accurate countdown/overdue state if it chooses to), logs each one
 * explicitly, and does NOT delete it — not a silently-caught exception, an
 * intentional, named skip. WaiverSignature.waiverId is also independently
 * `ON DELETE RESTRICT` (verified in this phase's migration review), so even
 * an attempted delete would fail the instant any signature exists — but a
 * Waiver with ZERO signatures would otherwise delete cleanly, which is
 * exactly the case this explicit skip exists to prevent (archiving only
 * blocks on an EXISTING signature; nothing stops a new one being assigned
 * during the 90-day window, and a legal document is not something this job
 * will ever risk deleting out from under a signature race).
 *
 * WAIVERSIGNATURE (THE PER-STUDENT SIGNED RECORD) IS A SEPARATE, NEWER
 * SWEEP — Decision 269 (16 Oct 2026) set the first real retention numbers for
 * this exact row, closing the "pending real legal input" gap the Waiver
 * comment above still otherwise describes. Computed DYNAMICALLY at sweep
 * time (20261116000000_waiver_signature_retention_purge), not from a
 * persisted purgeAt — there was never an archivedAt/purgeAt/purgedAt trio on
 * this table to begin with, and a dynamically-derived eligibility can never
 * go stale against a later policy change the way a persisted one could:
 *   - A Guardian-signed signature (`signedById !== studentId` — the model's
 *     own documented minor-signing path) is treated as a minor's waiver:
 *     eligible once the signing Student turns 18 + 6 more years. A null
 *     `dateOfBirth` means this can never be computed safely — skipped and
 *     logged for manual review, never guessed. Decision 354 (W16): never
 *     while the Student is still enrolled, and not before 7 years after
 *     they left — the later of the two dates. A paper signature (no
 *     signedById) counts as a minor's when the Student was under 18 on the
 *     date signed.
 *   - A self-signed signature is treated as an adult's: eligible 7 years
 *     after the Student's most recent revoked STUDENT RoleGrant at that
 *     School ("departure"). A Student still actively enrolled (an
 *     unrevoked STUDENT grant exists) or with no RoleGrant history at all
 *     is never eligible — there is no departure to measure from.
 * UNSIGNED/PENDING rows (no real signature ever captured) are excluded
 * entirely — Decision 269 is about retaining what was actually signed, not
 * assignment-tracking placeholders.
 *
 * TRANSACTION IS DELIBERATELY NOT TOUCHED ANYWHERE IN THIS FILE: Decision
 * 261 (14 Oct 2026, predates 268) already confirmed Transaction is never
 * deletable, the same permanent-retention treatment as Membership —
 * Decision 269's "7 years" framing for Transaction is a compliance
 * retention FLOOR, not a purge trigger, and does not override 261.
 *
 * RANK NEEDS MORE THAN A PLAIN DELETE-AND-CATCH-P2003: unlike every other
 * entity here, two of Rank's three "is this safe to remove" conditions
 * (Decision 198's deleteRank(), reused verbatim by RanksService.
 * archiveRank()) are NOT DB-enforced RESTRICTs — PromotionEvent.fromRankId/
 * toRankId are `ON DELETE SET NULL` and InstructorBelt.rankId/stripeTierId
 * are `ON DELETE CASCADE` (verified in this phase's migration review). A
 * plain `rank.delete()` would succeed at the DB level in both cases while
 * silently destroying grading-history Rank linkage or an instructor's
 * declared belt — exactly what Decision 198 already refuses to do
 * interactively. This job re-derives the same three checks
 * (holders/history/declared) immediately before attempting delete, treating
 * a block here exactly like a FK-restrict elsewhere: logged and skipped,
 * retried next sweep (a new StudentRank/PromotionEvent/InstructorBelt row
 * could in principle be created against an already-archived Rank during the
 * 90-day window — this job does not trust the archive-time check to still
 * hold true 90 days later, the same discipline TenantLifecyclePurgeProcessor
 * already applies by re-deriving Waiver/billing-history state at purge time
 * rather than trusting School.archivedAt alone).
 *
 * Only StudentRank.currentRankId is a real DB RESTRICT among Rank's own FKs
 * (verified) — so even without this extra check, *some* protection exists;
 * this closes the gap for the other two, which the DB alone would not catch.
 *
 * Runs via PrismaJobsService (ultm8_jobs role) — a genuine cross-tenant
 * sweep with no single caller, same reasoning as every other scheduled job
 * in this codebase. No child-table grants are needed for Rank's own
 * RankStripeTier/RankStripeTierRequiredSkill or Lesson's own LessonSkill/
 * LessonContent — all four are real `ON DELETE CASCADE` FKs (verified), and
 * this schema's own established behavior (documented identically on
 * TenantLifecyclePurgeProcessor's own header comment, re-confirmed here) is
 * that a role with DELETE-grant+policy ONLY on the parent table still
 * triggers every child's CASCADE, even with zero grants on the child
 * tables themselves.
 */
/** Minors' retention threshold (Decision 269): age of majority, plus this
 * many further years before a Guardian-signed WaiverSignature is eligible. */
const MINOR_WAIVER_SIGNATURE_RETENTION_YEARS_AFTER_MAJORITY = 6;
const AGE_OF_MAJORITY_YEARS = 18;
/** Adult retention threshold (Decision 269): years after departure (the
 * Student's most recent revoked STUDENT RoleGrant at that School) before a
 * self-signed WaiverSignature is eligible. */
const ADULT_WAIVER_SIGNATURE_RETENTION_YEARS_AFTER_DEPARTURE = 7;

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

@Processor(ENTITY_OFFBOARDING_PURGE_QUEUE)
export class EntityOffboardingPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(EntityOffboardingPurgeProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly r2Client: R2ClientService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    let deleted = 0;
    let skipped = 0;
    let waiversSkipped = 0;

    const branchOutcome = await this.sweepBranches(now);
    deleted += branchOutcome.deleted;
    skipped += branchOutcome.skipped;
    deleted += await this.sweepSimple('class', now);
    deleted += await this.sweepSimple('timetableSlot', now);
    deleted += await this.sweepSimple('instructor', now);
    deleted += await this.sweepSimple('lesson', now);

    const rankOutcome = await this.sweepRanks(now);
    deleted += rankOutcome.deleted;
    skipped += rankOutcome.skipped;

    waiversSkipped += await this.sweepWaivers(now);

    const signatureOutcome = await this.sweepWaiverSignatures(now);
    deleted += signatureOutcome.deleted;
    skipped += signatureOutcome.skipped;

    deleted += await this.sweepGuestWaiverSignatures(now);
    deleted += await this.sweepRejectedSignUps(now);

    // Backlog 5.11 (Decision 315 item 9): files on a member are erased with
    // the account. Deleting the account sets their studentId to null; the
    // stored file goes here, then the row.
    const memberFiles = await eraseMemberFiles(this.prismaJobs, this.r2Client, this.logger, { studentId: null });
    deleted += memberFiles.deleted;
    skipped += memberFiles.failed;

    this.logger.log(
      `entity-offboarding-purge: ${deleted} hard-deleted, ${skipped} skipped (FK-restrict, blocked, or not yet retention-eligible), ` +
        `${waiversSkipped} Waiver row(s) past purgeAt deliberately left un-purged (legal-record exception).`,
    );
  }

  /** Branch's own sweep (Decision 293). Every FK pointing at Branch is
   * CASCADE or SET NULL, never RESTRICT, so a plain delete always succeeds:
   * anything attached after archiving (a home-branch Student, a staff role,
   * a coach invite, a Class) would be silently deleted or detached. Rechecks
   * BranchesService.close()'s own dependents rule right before deleting,
   * the same way sweepRanks() does, and leaves the Branch archived if it
   * fails. Decision 330 (fix 7): a Branch with history (past classes, slots,
   * Instructor profiles or roles) is never deleted; its purgeAt is cleared so
   * it stops coming back. */
  private async sweepBranches(now: Date): Promise<{ deleted: number; skipped: number }> {
    const due = await this.prismaJobs.branch.findMany({ where: { purgeAt: { lte: now }, purgedAt: null }, select: { id: true } });
    let deleted = 0;
    let skipped = 0;
    for (const { id } of due) {
      try {
        const counts = await countBranchDependents(this.prismaJobs, id);
        if (hasBranchDependents(counts)) {
          this.logger.warn(
            `entity-offboarding-purge: branch ${id} is no longer safe to remove ` +
              `(${describeBranchDependents(counts).join(', ')}) — left archived, will retry.`,
          );
          skipped += 1;
          continue;
        }
        if (await branchHasHistory(this.prismaJobs, id)) {
          await this.prismaJobs.branch.update({ where: { id }, data: { purgeAt: null } });
          this.logger.log(`entity-offboarding-purge: branch ${id} has history — kept closed, never purged.`);
          skipped += 1;
          continue;
        }
        await this.prismaJobs.branch.delete({ where: { id } });
        deleted += 1;
      } catch (err) {
        this.logger.error(`entity-offboarding-purge: failed to purge branch ${id}`, err as Error);
      }
    }
    return { deleted, skipped };
  }

  /** Shared sweep for the 4 entities with nothing beyond a plain
   * DELETE-and-catch-P2003 (Class, TimetableSlot, Instructor, Lesson) — Rank and Waiver each need their own method (see this file's
   * own header comment for why). Typed loosely (`any`-ish via a narrow
   * model-name union) since these 4 share an identical purgeAt/purgedAt/id
   * shape and identical delete-by-id call, and Prisma's own per-model client
   * types don't factor into one common interface cleanly enough to avoid it
   * — contained entirely inside this one private method, never exposed. */
  private async sweepSimple(
    model: 'class' | 'timetableSlot' | 'instructor' | 'lesson',
    now: Date,
  ): Promise<number> {
    const client = this.prismaJobs[model] as unknown as {
      findMany: (args: { where: unknown; select: unknown }) => Promise<Array<{ id: string }>>;
      delete: (args: { where: { id: string } }) => Promise<unknown>;
    };
    const due = await client.findMany({ where: { purgeAt: { lte: now }, purgedAt: null }, select: { id: true } });
    let deleted = 0;
    for (const { id } of due) {
      try {
        await client.delete({ where: { id } });
        deleted += 1;
      } catch (err) {
        if (isForeignKeyRestrictError(err)) {
          this.logger.warn(`entity-offboarding-purge: ${model} ${id} is still referenced elsewhere (FK-restrict) — left archived, will retry.`);
          continue;
        }
        this.logger.error(`entity-offboarding-purge: failed to purge ${model} ${id}`, err as Error);
      }
    }
    return deleted;
  }

  /** Rank's own sweep — see this file's own header comment for why a plain
   * delete-and-catch is not sufficient here. */
  private async sweepRanks(now: Date): Promise<{ deleted: number; skipped: number }> {
    const due = await this.prismaJobs.rank.findMany({
      where: { purgeAt: { lte: now }, purgedAt: null },
      select: { id: true, stripeTiers: { select: { id: true } } },
    });
    let deleted = 0;
    let skipped = 0;
    for (const rank of due) {
      const tierIds = rank.stripeTiers.map((t) => t.id);
      try {
        const [holders, history, declared] = await Promise.all([
          this.prismaJobs.studentRank.count({ where: { OR: [{ currentRankId: rank.id }, { currentStripeId: { in: tierIds } }] } }),
          this.prismaJobs.promotionEvent.count({
            where: { OR: [{ fromRankId: rank.id }, { toRankId: rank.id }, { fromStripeTierId: { in: tierIds } }, { toStripeTierId: { in: tierIds } }] },
          }),
          this.prismaJobs.instructorBelt.count({ where: { OR: [{ rankId: rank.id }, { stripeTierId: { in: tierIds } }] } }),
        ]);
        if (holders > 0 || history > 0 || declared > 0) {
          this.logger.warn(
            `entity-offboarding-purge: rank ${rank.id} is no longer safe to remove ` +
              `(holders=${holders}, history=${history}, declared=${declared}) — left archived, will retry.`,
          );
          skipped += 1;
          continue;
        }
        await this.prismaJobs.rank.delete({ where: { id: rank.id } });
        deleted += 1;
      } catch (err) {
        if (isForeignKeyRestrictError(err)) {
          this.logger.warn(`entity-offboarding-purge: rank ${rank.id} is still referenced elsewhere (FK-restrict) — left archived, will retry.`);
          skipped += 1;
          continue;
        }
        this.logger.error(`entity-offboarding-purge: failed to purge rank ${rank.id}`, err as Error);
      }
    }
    return { deleted, skipped };
  }

  /** Waiver is NEVER purged — see this file's own header comment. This just
   * finds and logs the rows past purgeAt, so the omission is visible in logs
   * rather than a silent, unexplained no-op. */
  private async sweepWaivers(now: Date): Promise<number> {
    const due = await this.prismaJobs.waiver.findMany({ where: { purgeAt: { lte: now }, purgedAt: null }, select: { id: true } });
    for (const { id } of due) {
      this.logger.log(
        `entity-offboarding-purge: waiver ${id} is past its purgeAt but will NOT be purged — ` +
          'Waiver is a legal-record exception (Decision 110/226), archived indefinitely instead.',
      );
    }
    return due.length;
  }

  /** WaiverSignature's own sweep (Decision 269) — see this file's own header
   * comment for the full retention rules. Only actually-signed rows are
   * considered (UNSIGNED/PENDING assignment placeholders have no signature
   * to retain and are left alone). */
  private async sweepWaiverSignatures(now: Date): Promise<{ deleted: number; skipped: number }> {
    const signatures = await this.prismaJobs.waiverSignature.findMany({
      where: { status: { in: ['SIGNED', 'EXPIRED'] }, OR: [{ signedById: { not: null } }, { method: 'PAPER' }] },
      select: { id: true, studentId: true, signedById: true, schoolId: true, signatureImageKey: true, method: true, signedDate: true },
    });

    let deleted = 0;
    let skipped = 0;
    for (const sig of signatures) {
      // Decision 354 (W16): no signature is purged while its Student is
      // still enrolled at that School, whoever signed it.
      const stillEnrolled = await this.prismaJobs.roleGrant.count({
        where: { userId: sig.studentId, schoolId: sig.schoolId, role: 'STUDENT', revokedAt: null },
      });
      if (stillEnrolled > 0) {
        skipped += 1;
        continue;
      }
      const mostRecentDeparture = await this.prismaJobs.roleGrant.findFirst({
        where: { userId: sig.studentId, schoolId: sig.schoolId, role: 'STUDENT', revokedAt: { not: null } },
        orderBy: { revokedAt: 'desc' },
        select: { revokedAt: true },
      });
      const student = await this.prismaJobs.user.findUnique({ where: { id: sig.studentId }, select: { dateOfBirth: true } });
      const guardianSigned =
        sig.method === 'PAPER'
          ? !!student?.dateOfBirth && !!sig.signedDate && addYears(student.dateOfBirth, AGE_OF_MAJORITY_YEARS) > sig.signedDate
          : sig.signedById !== sig.studentId;
      let eligible: boolean;

      if (guardianSigned) {
        if (!student?.dateOfBirth) {
          this.logger.warn(
            `entity-offboarding-purge: WaiverSignature ${sig.id} is a Guardian-signed (minor's) waiver with no Student dateOfBirth on file — ` +
              'cannot compute the age-of-majority+6yr threshold; left in place, will retry once dateOfBirth is known.',
          );
          skipped += 1;
          continue;
        }
        // A minor who was never enrolled (signed for, never joined) has no
        // departure; the age rule alone applies.
        const pastMajority = addYears(student.dateOfBirth, AGE_OF_MAJORITY_YEARS + MINOR_WAIVER_SIGNATURE_RETENTION_YEARS_AFTER_MAJORITY) <= now;
        const pastDeparture =
          !mostRecentDeparture?.revokedAt || addYears(mostRecentDeparture.revokedAt, ADULT_WAIVER_SIGNATURE_RETENTION_YEARS_AFTER_DEPARTURE) <= now;
        eligible = pastMajority && pastDeparture;
      } else {
        if (!mostRecentDeparture?.revokedAt) {
          // No STUDENT RoleGrant history at all for this signer at this School — no
          // departure signal to measure retention from. Left in place rather than
          // guessed; a data-integrity oddity worth surfacing if it ever recurs, not
          // the expected case.
          skipped += 1;
          continue;
        }
        eligible = addYears(mostRecentDeparture.revokedAt, ADULT_WAIVER_SIGNATURE_RETENTION_YEARS_AFTER_DEPARTURE) <= now;
      }

      if (!eligible) {
        skipped += 1;
        continue;
      }

      try {
        // The drawn image goes first: if that fails the row stays and the
        // next sweep tries both again, so no image is left without a record.
        if (sig.signatureImageKey) {
          if (this.r2Client.isConfigured()) {
            await this.r2Client.deleteObject(sig.signatureImageKey);
          } else {
            this.logger.warn(`entity-offboarding-purge: R2 is not configured, so the image of WaiverSignature ${sig.id} was not deleted.`);
          }
        }
        await this.prismaJobs.waiverSignature.delete({ where: { id: sig.id } });
        deleted += 1;
      } catch (err) {
        this.logger.error(`entity-offboarding-purge: failed to purge WaiverSignature ${sig.id}`, err as Error);
      }
    }
    return { deleted, skipped };
  }

  /** Decision 362 (and 392): a rejected sign-up is kept 30 days, so staff can
   * still approve it, then deleted with what the person typed. */
  private async sweepRejectedSignUps(now: Date): Promise<number> {
    const result = await this.prismaJobs.signUp.deleteMany({
      where: { status: 'REJECTED', rejectedAt: { lte: new Date(now.getTime() - REJECTED_SIGN_UP_DAYS * 24 * 60 * 60 * 1000) } },
    });
    return result.count;
  }

  /** Guest waiver signatures (Waivers Q9), kept like a student who has left
   * (Decision 354, W16): 7 years after the class, and for a guest under 18
   * until they turn 24 (18 + 6) if that's later. For a guest who was 18 or
   * over at the class, 24 comes before class + 7 years, so both dates having
   * passed is the whole rule. */
  private async sweepGuestWaiverSignatures(now: Date): Promise<number> {
    const sevenYearsAgo = new Date(now);
    sevenYearsAgo.setUTCFullYear(sevenYearsAgo.getUTCFullYear() - 7);
    const born24YearsAgo = new Date(now);
    born24YearsAgo.setUTCFullYear(born24YearsAgo.getUTCFullYear() - 24);
    const result = await this.prismaJobs.guestWaiverSignature.deleteMany({
      where: { classStartsAt: { lte: sevenYearsAgo }, guestDateOfBirth: { lte: born24YearsAgo } },
    });
    return result.count;
  }
}
