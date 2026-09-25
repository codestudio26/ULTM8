import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
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
 *    behind, so a School that still has Waivers is never hard-deleted here,
 *    at any purgeAt. Its PII-bearing fields are anonymized instead (a real,
 *    GDPR-minimization-aligned partial purge of what's safe to remove even
 *    though the row itself must persist for its Waivers' sake), and it stays
 *    anonymized-but-present until a future decision sets Waiver's own real
 *    retention period.
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
 * Deliberately does NOT touch Membership/Transaction/PaymentAccount/Booking/
 * WaitlistEntry/RoleGrant — none of these are named in Decision 110's own
 * scope, and several (Membership, Transaction) are financial/attendance
 * records of the same character the existing PlatformCharge/FranchiseFeeCharge
 * RESTRICT protection already treats carefully. They DO still cascade away
 * automatically in the "no exception applies" full-delete path (their own FKs
 * to School are CASCADE, unchanged by this phase) — this note is about what
 * this job does NOT special-case, not about adding new protection for them.
 * Flagged as a real, narrower-than-literal scope reading for a follow-up
 * decision, same as the Waiver/billing exceptions above.
 */
@Processor(TENANT_LIFECYCLE_PURGE_QUEUE)
export class TenantLifecyclePurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(TenantLifecyclePurgeProcessor.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    let deleted = 0;
    let anonymized = 0;

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
    const waiverCount = await this.prismaJobs.waiver.count({ where: { schoolId } });
    if (waiverCount > 0) {
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

  private async anonymizeSchool(schoolId: string): Promise<void> {
    await this.prismaJobs.school.update({
      where: { id: schoolId },
      data: {
        name: '[Closed School]',
        mobileNumber: null,
        address: null,
        description: null,
        logoUrl: null,
        bannerUrl: null,
        purgedAt: new Date(),
      },
    });
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
        description: null,
        logoUrl: null,
        bannerUrl: null,
        purgedAt: new Date(),
      },
    });
  }
}
