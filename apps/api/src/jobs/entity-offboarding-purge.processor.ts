import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma, WaiverPurgeRule } from '@prisma/client';
import { decideGuestSignatureRetention, decideMemberSignatureRetention, waiverRetentionPolicyFor } from '../waivers/waiver-retention';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { ENTITY_OFFBOARDING_PURGE_QUEUE } from './queue.constants';
import { REJECTED_SIGN_UP_DAYS } from '../front-desk/sign-up-rules';
import { branchHasHistory, countBranchDependents, describeBranchDependents, hasBranchDependents } from '../tenants/branches/branch-dependents';
import { eraseMemberFiles } from '../member-files/member-file-erasure';
import { eraseSignedDocumentExports } from '../signed-documents/signed-documents-erasure';
import { deleteMedicalInfoOfLeavers } from '../medical-info/medical-info-erasure';

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
 * WAIVER (THE TEMPLATE ROW) IS THE ONE DELIBERATE EXCEPTION — NEVER PURGED
 * BY THIS JOB, AT ANY purgeAt, REGARDLESS OF WHETHER IT HAS ANY
 * WaiverSignature: this job finds Waiver rows whose purgeAt has elapsed (so
 * the School Portal's own UI can still show an accurate countdown/overdue
 * state if it chooses to), logs each one explicitly, and does NOT delete it —
 * not a silently-caught exception, an intentional, named skip. A School's
 * templates go only with the School itself, once its last signature has been
 * purged (TenantLifecyclePurgeProcessor, Decision 426 item 2).
 * WaiverSignature.waiverId is `ON DELETE RESTRICT` (since Decision 426's
 * migration; it was CASCADE before, despite what this comment used to say),
 * so a delete fails the instant any signature exists; this skip also covers
 * a template with no signatures yet, which nothing stops being assigned
 * during the 90-day window.
 *
 * WAIVERSIGNATURE (THE PER-STUDENT SIGNED RECORD) HAS ITS OWN SWEEP —
 * Decision 426 (which builds Decision 423 item 8 and amends Decisions 269 and
 * 354 W16). The rule itself lives in one pure, unit-tested place,
 * src/waivers/waiver-retention.ts; read that file's header for it in full.
 * In short: kept while the person is a member of that School and for 7 years
 * after they leave; for a child (under 18 on the signing date) until age 25
 * if later; never-members count from the signing date; a closed School
 * counts as everyone leaving on its close date; a merged-away duplicate's
 * signature is a member's while either record is; a Guardian-signed waiver
 * with no date of birth is kept and shown to the owner as needing one; an
 * unsigned entry of someone no longer a member is removed. Eligibility is
 * computed at sweep time from the inputs (STUDENT RoleGrants, School close
 * date, and the 18th birthday saved on the signature), never persisted, so a
 * later policy change applies to every row at once. Each batch of 500 rows
 * is read in one query; a drawn or paper image is deleted from R2 first and
 * the row only if that worked; every deletion writes one row to the
 * permanent WaiverSignaturePurgeLog (no personal data). Guests
 * (GuestWaiverSignature) follow the same rule: 7 years after the class, and
 * for an under-18 guest not before age 25.
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
/** Rows read per query by the signature sweeps (Decision 426). */
export const WAIVER_RETENTION_BATCH_SIZE = 500;

/** One WaiverSignature with everything the retention rule needs, read in one
 * query per batch. Membership is read only at the signature's own School. */
interface SignatureRetentionRow {
  id: string;
  schoolId: string;
  waiverId: string;
  studentId: string;
  signedById: string | null;
  status: 'SIGNED' | 'EXPIRED' | 'UNSIGNED' | 'PENDING';
  signedDate: Date | null;
  createdAt: Date;
  studentMajorityDate: Date | null;
  signatureImageKey: string | null;
  signedWaiverSha256: string | null;
  schoolClosedAt: Date | null;
  schoolClosureFinal: boolean;
  hasLiveStudentRole: boolean;
  everMember: boolean;
  lastLeftAt: Date | null;
}

/** A row the rule says to delete, with what its purge-log line records. */
interface PurgeCandidate {
  id: string;
  schoolId: string;
  waiverId: string;
  signedWaiverSha256: string | null;
  rule: WaiverPurgeRule;
  retainUntil: Date | null;
  signed: boolean;
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
    skipped += signatureOutcome.failed;

    const guestOutcome = await this.sweepGuestWaiverSignatures(now);
    deleted += guestOutcome.deleted;
    skipped += guestOutcome.failed;
    deleted += await this.sweepRejectedSignUps(now);

    // Backlog 5.11 (Decision 315 item 9): files on a member are erased with
    // the account. Deleting the account sets their studentId to null; the
    // stored file goes here, then the row.
    const memberFiles = await eraseMemberFiles(this.prismaJobs, this.r2Client, this.logger, { studentId: null });
    deleted += memberFiles.deleted;
    skipped += memberFiles.failed;

    // Decision 419 item 1: medical information is deleted when the member
    // leaves the School. RoleGrantsService.revoke deletes it at once; this
    // catches one whose delete failed, and any other way an enrolment ends.
    deleted += await deleteMedicalInfoOfLeavers(this.prismaJobs);

    // Decision 315 item 13: a signed-documents ZIP is kept for 24 hours.
    const exports = await eraseSignedDocumentExports(this.prismaJobs, this.r2Client, this.logger, { expiresAt: { lte: now } });
    deleted += exports.deleted;
    skipped += exports.failed;

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

  /**
   * WaiverSignature's sweep (Decision 426; the rule is in
   * src/waivers/waiver-retention.ts). First saves the 18th birthday on any
   * signed row that has none yet but whose Student now has a date of birth
   * (one added after signing; never changes a saved one). Then reads every
   * row, 500 at a time in id order, each batch with its School's close date
   * and the person's STUDENT roles at that same School (and at the record a
   * merged duplicate was merged into) in a single query, and deletes the
   * rows whose time is up.
   */
  private async sweepWaiverSignatures(now: Date): Promise<{ deleted: number; failed: number; needsDateOfBirth: number }> {
    await this.prismaJobs.$executeRaw`
      UPDATE "WaiverSignature" ws
      SET "studentMajorityDate" = public."waiver_age_of_majority_date"(u."dateOfBirth")
      FROM "User" u
      WHERE u."id" = ws."studentId" AND ws."studentMajorityDate" IS NULL
        AND ws."status" IN ('SIGNED', 'EXPIRED') AND u."dateOfBirth" IS NOT NULL`;

    let deleted = 0;
    let failed = 0;
    let needsDateOfBirth = 0;
    let after: string | null = null;
    for (;;) {
      const rows: SignatureRetentionRow[] = await this.prismaJobs.$queryRaw<SignatureRetentionRow[]>`
        SELECT ws."id", ws."schoolId", ws."waiverId", ws."studentId", ws."signedById", ws."status"::text AS "status",
               ws."signedDate", ws."createdAt", ws."studentMajorityDate", ws."signatureImageKey", ws."signedWaiverSha256",
               s."archivedAt" AS "schoolClosedAt", (s."purgedAt" IS NOT NULL) AS "schoolClosureFinal",
               EXISTS (
                 SELECT 1 FROM "RoleGrant" rg
                 WHERE rg."schoolId" = ws."schoolId" AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
                   AND rg."userId" IN (ws."studentId", ws."mergedIntoStudentId")
               ) AS "hasLiveStudentRole",
               EXISTS (
                 SELECT 1 FROM "RoleGrant" rg
                 WHERE rg."schoolId" = ws."schoolId" AND rg."role" = 'STUDENT'
                   AND rg."userId" IN (ws."studentId", ws."mergedIntoStudentId")
               ) AS "everMember",
               (
                 SELECT max(rg."revokedAt") FROM "RoleGrant" rg
                 WHERE rg."schoolId" = ws."schoolId" AND rg."role" = 'STUDENT'
                   AND rg."userId" IN (ws."studentId", ws."mergedIntoStudentId")
               ) AS "lastLeftAt"
        FROM "WaiverSignature" ws
        JOIN "School" s ON s."id" = ws."schoolId"
        WHERE ${after === null ? Prisma.sql`TRUE` : Prisma.sql`ws."id" > ${after}`}
        ORDER BY ws."id"
        LIMIT ${WAIVER_RETENTION_BATCH_SIZE}`;
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;

      const due: Array<PurgeCandidate & { imageKey: string | null }> = [];
      for (const row of rows) {
        const decision = decideMemberSignatureRetention(row, now, waiverRetentionPolicyFor());
        if (decision.action === 'keep') {
          if (decision.reason === 'NEEDS_DATE_OF_BIRTH') needsDateOfBirth += 1;
          continue;
        }
        due.push({
          id: row.id,
          schoolId: row.schoolId,
          waiverId: row.waiverId,
          signedWaiverSha256: row.signedWaiverSha256,
          rule: decision.rule,
          retainUntil: decision.retainUntil,
          signed: row.status === 'SIGNED' || row.status === 'EXPIRED',
          imageKey: row.signatureImageKey,
        });
      }

      // The image goes first; a row whose image couldn't be deleted stays
      // for the next run, so no image is ever left without its record.
      const ready: PurgeCandidate[] = [];
      for (const candidate of due) {
        if (await this.deleteSignatureImage(candidate.id, candidate.imageKey)) ready.push(candidate);
        else failed += 1;
      }
      deleted += await this.deleteMemberSignatures(ready);

      if (rows.length < WAIVER_RETENTION_BATCH_SIZE) break;
    }
    if (needsDateOfBirth > 0) {
      this.logger.log(
        `entity-offboarding-purge: ${needsDateOfBirth} Guardian-signed WaiverSignature(s) of people who have left have no date of birth on file — ` +
          'kept until one is added (Decision 426 item 4); their School owners see them as "needs date of birth".',
      );
    }
    return { deleted, failed, needsDateOfBirth };
  }

  /** Deletes a signature's drawn or paper image. False when that failed (the
   * row then waits for the next run). Without R2 configured (local
   * development) only the row goes, with a warning, as eraseMemberFiles. */
  private async deleteSignatureImage(signatureId: string, imageKey: string | null): Promise<boolean> {
    if (!imageKey) return true;
    if (!this.r2Client.isConfigured()) {
      this.logger.warn(`entity-offboarding-purge: R2 is not configured, so the image of WaiverSignature ${signatureId} was not deleted.`);
      return true;
    }
    try {
      await this.r2Client.deleteObject(imageKey);
      return true;
    } catch (err) {
      this.logger.error(`entity-offboarding-purge: the image of WaiverSignature ${signatureId} could not be deleted; the signature is kept until the next run.`, err as Error);
      return false;
    }
  }

  /**
   * Deletes the rows and writes one purge-log line for each, in one
   * transaction. The delete re-checks, in the same statement, that the row
   * is still the kind it was read as (signed or not) and that the person is
   * still not a member there (or the School is closed), so someone who
   * rejoined or signed a moment ago is left alone.
   */
  private async deleteMemberSignatures(ready: PurgeCandidate[]): Promise<number> {
    if (ready.length === 0) return 0;
    const signedIds = ready.filter((c) => c.signed).map((c) => c.id);
    const unsignedIds = ready.filter((c) => !c.signed).map((c) => c.id);
    try {
      return await this.prismaJobs.$transaction(async (tx) => {
        const gone = await tx.$queryRaw<Array<{ id: string }>>`
          DELETE FROM "WaiverSignature" ws
          USING "School" s
          WHERE s."id" = ws."schoolId"
            AND (
              (ws."id" = ANY(${signedIds}::text[]) AND ws."status" IN ('SIGNED', 'EXPIRED')
                AND (s."archivedAt" IS NOT NULL OR NOT EXISTS (
                  SELECT 1 FROM "RoleGrant" rg
                  WHERE rg."schoolId" = ws."schoolId" AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
                    AND rg."userId" IN (ws."studentId", ws."mergedIntoStudentId"))))
              OR
              (ws."id" = ANY(${unsignedIds}::text[]) AND ws."status" IN ('UNSIGNED', 'PENDING')
                AND (s."purgedAt" IS NOT NULL OR NOT EXISTS (
                  SELECT 1 FROM "RoleGrant" rg
                  WHERE rg."schoolId" = ws."schoolId" AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
                    AND rg."userId" IN (ws."studentId", ws."mergedIntoStudentId"))))
            )
          RETURNING ws."id"`;
        const goneIds = new Set(gone.map((g) => g.id));
        const logged = ready.filter((c) => goneIds.has(c.id));
        if (logged.length > 0) {
          await tx.waiverSignaturePurgeLog.createMany({ data: logged.map((c) => purgeLogLine('MEMBER', c)) });
        }
        if (logged.length < ready.length) {
          this.logger.warn(
            `entity-offboarding-purge: ${ready.length - logged.length} WaiverSignature(s) changed while being purged (signed, or the person rejoined) — kept.`,
          );
        }
        return logged.length;
      });
    } catch (err) {
      this.logger.error(`entity-offboarding-purge: failed to purge a batch of ${ready.length} WaiverSignature(s); they will be tried again on the next run.`, err as Error);
      return 0;
    }
  }

  /** Decision 362 (and 392): a rejected sign-up is kept 30 days, so staff can
   * still approve it, then deleted with what the person typed. */
  private async sweepRejectedSignUps(now: Date): Promise<number> {
    const result = await this.prismaJobs.signUp.deleteMany({
      where: { status: 'REJECTED', rejectedAt: { lte: new Date(now.getTime() - REJECTED_SIGN_UP_DAYS * 24 * 60 * 60 * 1000) } },
    });
    return result.count;
  }

  /** Guest waiver signatures (Waivers Q9; Decision 426): 7 years after the
   * class, and for a guest under 18 at the class not before they turn 25
   * (18 + 7). Only rows whose class was at least 7 years ago can be due, so
   * only those are read, 500 at a time in id order. */
  private async sweepGuestWaiverSignatures(now: Date): Promise<{ deleted: number; failed: number }> {
    const policy = waiverRetentionPolicyFor();
    const earliestDue = new Date(now.getTime());
    earliestDue.setUTCFullYear(earliestDue.getUTCFullYear() - policy.yearsKeptAfterLeaving);
    let deleted = 0;
    let failed = 0;
    let after: string | null = null;
    for (;;) {
      const rows: Array<{ id: string; schoolId: string; waiverId: string; signedWaiverSha256: string; classStartsAt: Date; guestDateOfBirth: Date }> =
        await this.prismaJobs.guestWaiverSignature.findMany({
          where: { classStartsAt: { lte: earliestDue }, ...(after === null ? {} : { id: { gt: after } }) },
          orderBy: { id: 'asc' },
          take: WAIVER_RETENTION_BATCH_SIZE,
          select: { id: true, schoolId: true, waiverId: true, signedWaiverSha256: true, classStartsAt: true, guestDateOfBirth: true },
        });
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;

      const due: PurgeCandidate[] = [];
      for (const row of rows) {
        const decision = decideGuestSignatureRetention(row, now, policy);
        if (decision.action === 'purge') {
          due.push({ ...row, rule: decision.rule, retainUntil: decision.retainUntil, signed: true });
        }
      }
      if (due.length > 0) {
        try {
          deleted += await this.prismaJobs.$transaction(async (tx) => {
            const gone = await tx.$queryRaw<Array<{ id: string }>>`
              DELETE FROM "GuestWaiverSignature" WHERE "id" = ANY(${due.map((c) => c.id)}::text[]) RETURNING "id"`;
            const goneIds = new Set(gone.map((g) => g.id));
            const logged = due.filter((c) => goneIds.has(c.id));
            if (logged.length > 0) {
              await tx.waiverSignaturePurgeLog.createMany({ data: logged.map((c) => purgeLogLine('GUEST', c)) });
            }
            return logged.length;
          });
        } catch (err) {
          failed += due.length;
          this.logger.error(`entity-offboarding-purge: failed to purge a batch of ${due.length} GuestWaiverSignature(s); they will be tried again on the next run.`, err as Error);
        }
      }

      if (rows.length < WAIVER_RETENTION_BATCH_SIZE) break;
    }
    return { deleted, failed };
  }
}

/** One WaiverSignaturePurgeLog line: ids, the rule and its dates, no personal data. */
function purgeLogLine(kind: 'MEMBER' | 'GUEST', c: PurgeCandidate): Prisma.WaiverSignaturePurgeLogCreateManyInput {
  return {
    kind,
    schoolId: c.schoolId,
    signatureId: c.id,
    waiverId: c.waiverId,
    signedWaiverSha256: c.signedWaiverSha256,
    rule: c.rule,
    retainUntil: c.retainUntil,
  };
}
