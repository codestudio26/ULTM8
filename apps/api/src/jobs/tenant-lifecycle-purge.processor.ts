import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { eraseMemberFiles } from '../member-files/member-file-erasure';
import { eraseSignedDocumentExports } from '../signed-documents/signed-documents-erasure';
import { TENANT_LIFECYCLE_PURGE_QUEUE } from './queue.constants';

/** Once a day is enough — purgeAt is date-granular (90 days out), unlike the
 * booking-no-show sweep's 15-minute window. Developer-level choice, flagged for
 * Architect review same as every other CRON_* constant in this directory. */
const CRON_DAILY_AT_3AM_UTC = '0 3 * * *';
const REPEATABLE_JOB_ID = 'tenant-lifecycle-purge-sweep';

/** Same fixed-jobId / not-awaited / bounded-retry-with-backoff registration
 * pattern as every other scheduler in this directory — see
 * BookingNoShowProcessingScheduler's own doc comment for the full reasoning,
 * not repeated here. */
@Injectable()
export class TenantLifecyclePurgeScheduler implements OnModuleInit {
  private readonly logger = new Logger(TenantLifecyclePurgeScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(TENANT_LIFECYCLE_PURGE_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...TenantLifecyclePurgeScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_3AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable tenant-lifecycle-purge job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable tenant-lifecycle-purge job after all retries — ' +
        'closed Schools/Franchises past their 90-day retention window will never be purged until this succeeds.',
    );
  }
}

function isForeignKeyRestrictError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

/**
 * Consumes the tenant-lifecycle-purge queue (Phase 56, Decision 110) — the
 * second half of the close-account lifecycle TenantLifecycleService starts.
 * Finds every School/Franchise whose purgeAt has elapsed with no reactivation
 * (purgedAt still null) and either hard-deletes it or, in two specific,
 * flagged cases, anonymizes it in place instead. Runs via PrismaJobsService
 * (ultm8_jobs role) — a genuine cross-tenant sweep with no single caller, same
 * reasoning as every other scheduled job in this codebase.
 *
 * THE TWO ANONYMIZE-INSTEAD-OF-DELETE CASES, both deliberate, both flagged —
 * neither is Decision 110 left unbuilt; both are this job's own reasoned
 * implementation of what that decision already settled, given this schema's
 * real FK graph (grepped in full before writing this):
 *
 * 1. School still owns Waiver rows. Decision 110 explicitly excepts Waiver
 *    from the uniform 90-day clock ("Waiver's own purge timing needs real
 *    legal input... before it runs on the same 90-day clock as everything
 *    else"). Waiver.schoolId is a required, ON DELETE CASCADE FK — Postgres
 *    has no way to delete a School while leaving only its Waiver children
 *    behind, so a School that still has Waivers is not hard-deleted at its
 *    purgeAt. Its PII-bearing fields are anonymized instead (a real,
 *    GDPR-minimization-aligned partial purge of what's safe to remove even
 *    though the row itself must persist for its Waivers' sake). Decision 426
 *    set Waiver's retention period: the retention job
 *    (EntityOffboardingPurgeProcessor) deletes each signature when its time
 *    is up (a School closing counts as every member leaving on its close
 *    date), and once a closed School has no WaiverSignature or
 *    GuestWaiverSignature left, finishClosedSchoolsWithNoSignaturesLeft()
 *    below deletes its Waiver templates and then the School (Decision 426
 *    item 2), unless case 2 also applies.
 * 2. PlatformCharge/FranchiseFeeCharge billing history exists. Both hold
 *    `ON DELETE RESTRICT` FKs to School/Franchise (existing schema, not new
 *    here) — deliberate protection for financial/audit records this job does
 *    not loosen. A School/Franchise with billing history rejects the DELETE
 *    outright (caught below as a P2003); same anonymize-in-place fallback.
 *
 * Every other named entity Decision 110 lists (Branch, Class, TimetableSlot,
 * Instructor, MembershipPlan, Rank/Discipline/Skill, Lesson) cascades away
 * automatically via each table's own ON DELETE CASCADE FK to School — the
 * empirically-verified Postgres behavior this phase's own investigation
 * confirmed (a role with DELETE-grant+policy ONLY on the parent table still
 * triggers every child's CASCADE, even with FORCE ROW LEVEL SECURITY enabled
 * and zero grants on the child tables themselves) — so no per-table deletes
 * are written out here; one `school.delete()`/`franchise.delete()` is
 * sufficient and correct for the common case (no Waivers, no billing history).
 *
 * 3. Members' payment history exists (Decision 261, applied here by
 *    Decision 426): any Transaction or Membership row. Both FKs to School are
 *    ON DELETE CASCADE, so deleting the School would erase them; such a
 *    School is anonymized in place instead and never hard-deleted.
 *
 * PaymentAccount/Booking/WaitlistEntry/RoleGrant are not special-cased: they
 * cascade away when a School with none of the above is deleted.
 *
 * A School kept (anonymized) for any of the reasons above still loses its
 * members' other data (Decision 433, stress test round 5 PRIV-1): every role
 * there ends, dated at the close, so nobody can sign in to it any more, and
 * the member rows that are not payment history or signed waivers are deleted
 * (purgeMemberData). That runs for every purged School not yet done, so
 * Schools purged before this change are caught up too.
 */
@Processor(TENANT_LIFECYCLE_PURGE_QUEUE)
export class TenantLifecyclePurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(TenantLifecyclePurgeProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly r2Client: R2ClientService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    let deleted = 0;
    let anonymized = 0;

    // Decision 426 item 2 first, so a School anonymized below waits for the
    // next run (and the retention job's sweep in between) before it is
    // looked at again.
    const finished = await this.finishClosedSchoolsWithNoSignaturesLeft();
    deleted += finished;

    const dueSchools = await this.prismaJobs.school.findMany({
      where: { purgeAt: { lte: now }, purgedAt: null },
      select: { id: true },
    });
    for (const { id: schoolId } of dueSchools) {
      try {
        const outcome = await this.purgeSchool(schoolId);
        if (outcome === 'deleted') deleted += 1;
        else anonymized += 1;
      } catch (err) {
        this.logger.error(`tenant-lifecycle-purge: failed to purge School ${schoolId}`, err as Error);
      }
    }

    // Decision 433 (PRIV-1): Schools anonymized above, and any purged before
    // this existed, lose their members' non-financial data.
    const pending = await this.prismaJobs.school.findMany({
      where: { purgedAt: { not: null }, memberDataPurgedAt: null },
      select: { id: true, archivedAt: true, purgedAt: true },
    });
    for (const school of pending) {
      try {
        await this.purgeMemberData(school.id, school.archivedAt ?? school.purgedAt ?? now);
      } catch (err) {
        this.logger.error(`tenant-lifecycle-purge: failed to delete the member data of closed School ${school.id}`, err as Error);
      }
    }

    const dueFranchises = await this.prismaJobs.franchise.findMany({
      where: { purgeAt: { lte: now }, purgedAt: null },
      select: { id: true },
    });
    for (const { id: franchiseId } of dueFranchises) {
      try {
        const outcome = await this.purgeFranchise(franchiseId);
        if (outcome === 'deleted') deleted += 1;
        else anonymized += 1;
      } catch (err) {
        this.logger.error(`tenant-lifecycle-purge: failed to purge Franchise ${franchiseId}`, err as Error);
      }
    }

    this.logger.log(`tenant-lifecycle-purge: ${deleted} hard-deleted, ${anonymized} anonymized in place.`);
  }

  private async purgeSchool(schoolId: string): Promise<'deleted' | 'anonymized'> {
    // Backlog 5.11 (Decision 315 item 9): the files on its members go first,
    // whether the School is then deleted or anonymized. Their rows would
    // cascade with the School, leaving the stored files behind, so a School
    // whose files can't all be deleted yet waits for the next sweep.
    const files = await eraseMemberFiles(this.prismaJobs, this.r2Client, this.logger, { schoolId });
    if (files.failed > 0) {
      throw new Error(`${files.failed} member file(s) could not be deleted from storage; School ${schoolId} is left for the next sweep.`);
    }
    // Decision 315 item 13: and its signed-documents ZIPs.
    const exports = await eraseSignedDocumentExports(this.prismaJobs, this.r2Client, this.logger, { schoolId });
    if (exports.failed > 0) {
      throw new Error(`${exports.failed} signed-documents export(s) could not be deleted from storage; School ${schoolId} is left for the next sweep.`);
    }
    const waiverCount = await this.prismaJobs.waiver.count({ where: { schoolId } });
    // Decision 261, applied here by Decision 426: members' payment history
    // (Transaction, Membership; both ON DELETE CASCADE from School) is never
    // deleted, so a School that has any is anonymized instead of deleted.
    if (waiverCount > 0 || (await this.keepsMemberPaymentHistory(schoolId))) {
      await this.anonymizeSchool(schoolId);
      return 'anonymized';
    }
    try {
      await this.prismaJobs.school.delete({ where: { id: schoolId } });
      return 'deleted';
    } catch (err) {
      if (isForeignKeyRestrictError(err)) {
        await this.anonymizeSchool(schoolId);
        return 'anonymized';
      }
      throw err;
    }
  }

  /**
   * Decision 426 item 2: finishes Decision 110's close-account purge for a
   * School that was kept (anonymized) because of its waivers. Once its last
   * WaiverSignature and GuestWaiverSignature are gone (the retention job
   * deletes them when their time is up), its Waiver templates are deleted
   * and then the School itself. A School that also has billing history
   * (RESTRICT-protected) stays anonymized, without its templates, and is not
   * looked at again. The same checks as a first purge run before the
   * delete: the member files and signed-documents exports go first.
   */
  private async finishClosedSchoolsWithNoSignaturesLeft(): Promise<number> {
    const kept = await this.prismaJobs.school.findMany({
      where: { archivedAt: { not: null }, purgedAt: { not: null }, waivers: { some: {} } },
      select: { id: true },
    });
    let deleted = 0;
    for (const { id: schoolId } of kept) {
      try {
        const [signatures, guestSignatures] = await Promise.all([
          this.prismaJobs.waiverSignature.count({ where: { schoolId } }),
          this.prismaJobs.guestWaiverSignature.count({ where: { schoolId } }),
        ]);
        if (signatures > 0 || guestSignatures > 0) continue;

        const files = await eraseMemberFiles(this.prismaJobs, this.r2Client, this.logger, { schoolId });
        const exports = await eraseSignedDocumentExports(this.prismaJobs, this.r2Client, this.logger, { schoolId });
        if (files.failed > 0 || exports.failed > 0) {
          this.logger.warn(`tenant-lifecycle-purge: closed School ${schoolId}'s stored files could not all be deleted; left for the next sweep.`);
          continue;
        }
        // WaiverSignature.waiverId is RESTRICT: this fails, and nothing is
        // deleted, if a signature appeared since the count above.
        await this.prismaJobs.waiver.deleteMany({ where: { schoolId } });
        // Decision 426 item 2 (as answered 4 Nov 2026) and Decision 261: a
        // School with members' payment history (Transaction, Membership) is
        // never deleted, because deleting it would cascade that history away.
        // It stays anonymized, now without its templates, and is not looked
        // at again (it has no Waivers left).
        if (await this.keepsMemberPaymentHistory(schoolId)) {
          this.logger.log(`tenant-lifecycle-purge: closed School ${schoolId} has no waivers left but keeps its members' payment history — stays anonymized.`);
          continue;
        }
        try {
          await this.prismaJobs.school.delete({ where: { id: schoolId } });
          deleted += 1;
        } catch (err) {
          if (!isForeignKeyRestrictError(err)) throw err;
          this.logger.log(`tenant-lifecycle-purge: closed School ${schoolId} has no waivers left but keeps its billing history — stays anonymized.`);
        }
      } catch (err) {
        this.logger.error(`tenant-lifecycle-purge: failed to finish purging closed School ${schoolId}`, err as Error);
      }
    }
    return deleted;
  }

  /** Whether the School has any members' payment history (Decision 261). */
  private async keepsMemberPaymentHistory(schoolId: string): Promise<boolean> {
    const [transactions, memberships] = await Promise.all([
      this.prismaJobs.transaction.count({ where: { schoolId } }),
      this.prismaJobs.membership.count({ where: { schoolId } }),
    ]);
    return transactions > 0 || memberships > 0;
  }

  private async anonymizeSchool(schoolId: string): Promise<void> {
    // Decision 315 item 10: students' medical information goes with the
    // School. A School kept for its Waivers or billing history keeps no
    // health data: the rows are deleted, and so is any still waiting on a
    // tablet sign-up. (A School that is deleted takes them by cascade.)
    await this.prismaJobs.studentMedicalInfo.deleteMany({ where: { schoolId } });
    await this.prismaJobs.signUp.updateMany({ where: { schoolId, medicalInfo: { not: null } }, data: { medicalInfo: null, medicalConsentAt: null } });
    await this.prismaJobs.school.update({
      where: { id: schoolId },
      data: {
        name: '[Closed School]',
        mobileNumber: null,
        address: null,
        addressLine1: null,
        addressLine2: null,
        addressCity: null,
        addressRegion: null,
        addressPostalCode: null,
        addressCountry: null,
        description: null,
        logoUrl: null,
        bannerUrl: null,
        taxId: null,
        purgedAt: new Date(),
      },
    });
  }

  /**
   * Decision 433 (stress test round 5, PRIV-1), for a School kept anonymized
   * after its 90 days:
   * 1. Every role still live there ends, dated at the close (`closedAt`, the
   *    School's archivedAt), not today: the waiver retention clock counts from
   *    when a member left (Decision 426 item 1), and closing is that day. The
   *    RoleGrant trigger stamps rolesChangedAt, so access tokens issued
   *    before stop working at once (Decision 361).
   * 2. The members' data that is neither payment history (Transaction,
   *    Membership, Charge; Decision 261) nor a signed waiver (Decision 426)
   *    is deleted: notes, tags, check-in codes, join dates, home branches,
   *    tablet sign-ups, export logs, custom fields and statuses, rosters,
   *    child invites, absence alerts, lesson favourites and watch history;
   *    and, with migration 20270223000100, broadcasts, the staff activity
   *    log, coach invites, front-desk sessions, hours trained and the
   *    bookings no money row refers to. Notifications stay: each is its
   *    recipient's own record (Decisions 244, 277).
   * Each step can run again; memberDataPurgedAt is set once all succeeded.
   */
  private async purgeMemberData(schoolId: string, closedAt: Date): Promise<void> {
    const db = this.prismaJobs;
    await db.roleGrant.updateMany({ where: { schoolId, revokedAt: null }, data: { revokedAt: closedAt } });

    const where = { schoolId };
    // Children before their parents where a foreign key would refuse.
    await db.studentTag.deleteMany({ where });
    await db.schoolTag.deleteMany({ where });
    await db.customMemberFieldValue.deleteMany({ where });
    await db.customMemberField.deleteMany({ where });
    await db.studentCustomStatus.deleteMany({ where });
    await db.customMemberStatus.deleteMany({ where });
    await db.rosterMember.deleteMany({ where });
    await db.roster.deleteMany({ where });
    await db.studentNote.deleteMany({ where });
    await db.studentCheckInCode.deleteMany({ where });
    await db.studentJoinDate.deleteMany({ where });
    await db.studentHomeBranch.deleteMany({ where });
    await db.signUp.deleteMany({ where });
    await db.studentExportLog.deleteMany({ where });
    await db.childInvite.deleteMany({ where });
    await db.studentAbsenceAlert.deleteMany({ where });
    await db.favorite.deleteMany({ where });
    await db.watchHistory.deleteMany({ where });
    // Decision 435 item 14: places on full plans' waiting lists.
    await db.planWaitlistEntry.deleteMany({ where });
    // Stage 2 (migration 20270223000100): only for a School already purged.
    await db.notificationBroadcast.deleteMany({ where });
    await db.staffActivity.deleteMany({ where });
    await db.coachInvite.deleteMany({ where });
    await db.frontDeskSession.deleteMany({ where });
    await db.trainingLog.deleteMany({ where });
    // The policy keeps every Booking a money row refers to; these are the rest.
    await db.booking.deleteMany({ where });

    await db.school.update({ where: { id: schoolId }, data: { memberDataPurgedAt: new Date() } });
  }

  private async purgeFranchise(franchiseId: string): Promise<'deleted' | 'anonymized'> {
    try {
      await this.prismaJobs.franchise.delete({ where: { id: franchiseId } });
      return 'deleted';
    } catch (err) {
      if (isForeignKeyRestrictError(err)) {
        await this.anonymizeFranchise(franchiseId);
        return 'anonymized';
      }
      throw err;
    }
  }

  private async anonymizeFranchise(franchiseId: string): Promise<void> {
    await this.prismaJobs.franchise.update({
      where: { id: franchiseId },
      data: {
        name: '[Closed Franchise]',
        mobileNumber: null,
        address: null,
        addressLine1: null,
        addressLine2: null,
        addressCity: null,
        addressRegion: null,
        addressPostalCode: null,
        addressCountry: null,
        description: null,
        logoUrl: null,
        bannerUrl: null,
        purgedAt: new Date(),
      },
    });
  }
}
