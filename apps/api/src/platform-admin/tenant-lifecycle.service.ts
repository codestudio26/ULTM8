import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { FRANCHISE_FEE_FINAL_CANCEL } from '../franchise-fees/franchise-fee-cancel';
import { AuditLogService, AuditAction } from './audit-log.service';
import { CloseTenantAccountDto } from './dto/close-tenant-account.dto';

const RETENTION_WINDOW_DAYS = 90;

/**
 * Decision 110 (POST-SPEC-55-DECISION-LOG.md) — general tenant/content
 * offboarding, Phase 56. The only trigger this decision names for a
 * School/Franchise's offboarding countdown: an explicit, Platform-Admin-
 * mediated close-account action (FULL_ADMIN-only, its own re-typed-name
 * confirmation step). A lapsed platformSubscriptionStatus alone never reaches
 * this service — see SubscriptionGateService's own header comment for that
 * separate, payment-only gate, which Decision 110 explicitly keeps distinct.
 *
 * close() sets archivedAt = now, purgeAt = now + 90 days. From that moment,
 * TenantAuthorizationService.assertSchoolNotArchived/assertFranchiseNotArchived
 * (called from all 10 of the entity services Decision 110 names) refuses every
 * create/update against this tenant; reads are unaffected ("read-only," not
 * hidden — Decision 110 part 1). reactivate() clears both fields, undoing the
 * countdown — but only before the row has actually been purged (purgedAt set):
 * once the scheduled purge job has run, there is no "undo" for a School/
 * Franchise that was hard-deleted or anonymized, so reactivate refuses instead
 * of quietly reviving an empty shell.
 *
 * Uses PrismaAppService (ultm8_app role) for the AdminUser lookup in
 * assertFullAdmin, exactly the same split PlatformAdminUsersService's own
 * assertFullAdmin already established (AdminUser has no RLS policy, so the
 * plain ultm8_app client is sufficient there) — and PrismaPlatformAdminService
 * (ultm8_platform_admin role) for the actual School/Franchise read/write, per
 * this phase's own migration (20261006000000_tenant_lifecycle_module).
 *
 * FOUND ON REVIEW (V1 Stress Test Round 3) — all four actions below originally
 * used a plain `findUnique()` THEN a conditional throw THEN a separate,
 * unconditional `update()`: a real TOCTOU window with a genuine Stripe-collision-
 * class impact, proven under real concurrent HTTP load against a real Postgres
 * (docs/V1-STRESS-TEST-REPORT-ROUND3.md) — unlike `SubscriptionPlansService.
 * subscribe()`'s own analogous race (which needs an actual Stripe network call
 * in between to open the window), here the window is just two ordinary DB round
 * trips, wide open to ANY concurrent double-click or multi-tab close/reactivate
 * attempt, not a rare timing accident. Two (or, observed directly, all four)
 * concurrently-dispatched `close()` calls for the SAME School could each read
 * `archivedAt` as still `null`, each pass the guard, and each perform its own
 * `update()` — not a harmless idempotent repeat: every one of them ALSO calls
 * `auditLog.record()`, so the audit trail (the one thing Decision 110/
 * ultm8-tenant-isolation §6 are most insistent must correctly reflect "who did
 * what, once") ends up with N duplicate CLOSE/REACTIVATE rows for a single real
 * action, and N-1 HTTP callers are told their own close/reactivate succeeded
 * (200) when they were never the one who actually caused it.
 *
 * Closed the same way `SubscriptionPlansService.subscribe()`'s own analogous
 * race was closed this round: the fast-path `findUnique` + message-specific
 * checks stay (so the ordinary, non-racing error messages — "not found",
 * "already closed", "already purged" — are unchanged), but the actual mutation
 * is now a conditional `updateMany()` re-checked against the row's CURRENT
 * state at write time, not the possibly-stale read from before. Only the call
 * that actually flips `count` to 1 ever writes the audit row.
 */
@Injectable()
export class TenantLifecycleService {
  private readonly logger = new Logger(TenantLifecycleService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly stripeClient: StripeClientService,
  ) {}

  /**
   * Decision 337 (F16, product owner's answer to Q8) — closing a School, or the
   * Franchise it belongs to, ends that School's franchise-fee billing straight
   * away, the same way leaving the Franchise does (SchoolsService.leaveFranchise):
   * a final invoice for what has accrued, then the subscription is cancelled and
   * the School's columns cleared. Reactivating doesn't restart anything here — the
   * monthly franchise-fee job sets up a fresh subscription at its next run, as it
   * does for any newly joined School.
   *
   * Runs on the jobs connection (the platform-admin role has no grant on these
   * columns or on PaymentAccount's Stripe id beyond read), after the close itself
   * has committed, and best-effort like leaveFranchise: a Stripe failure is logged
   * loudly, never a reason to undo the close. The monthly job also skips closed
   * Schools and Franchises, so a subscription left behind by a failure here is not
   * reported further usage.
   */
  private async stopFranchiseFeeBilling(where: { schoolId: string } | { franchiseId: string }): Promise<void> {
    const schools = await this.prismaJobs.school.findMany({
      where: {
        ...('schoolId' in where ? { id: where.schoolId } : { franchiseId: where.franchiseId }),
        stripeFranchiseFeeSubscriptionId: { not: null },
      },
      select: { id: true, stripeFranchiseFeeSubscriptionId: true, franchise: { select: { id: true, paymentAccount: true } } },
    });
    for (const school of schools) {
      const subscriptionId = school.stripeFranchiseFeeSubscriptionId!;
      const account = school.franchise?.paymentAccount;
      try {
        if (account?.provider === 'STRIPE' && account.stripeConnectedAccountId) {
          await this.stripeClient.scopedClient(account.stripeConnectedAccountId).subscriptions.cancel(subscriptionId, FRANCHISE_FEE_FINAL_CANCEL);
        }
        await this.prismaJobs.school.updateMany({
          where: { id: school.id, stripeFranchiseFeeSubscriptionId: subscriptionId },
          data: { stripeFranchiseFeeSubscriptionId: null, franchiseFeeSubscriptionStatus: 'CANCELED' },
        });
      } catch (err) {
        this.logger.error(
          `School ${school.id} was closed (or its Franchise ${school.franchise?.id} was), but cancelling its franchise-fee subscription (${subscriptionId}) failed — it may need manual cancellation.`,
          err as Error,
        );
      }
    }
  }

  private async assertFullAdmin(callerId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: callerId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may close or reactivate a tenant account.');
    }
  }

  async closeSchool(adminUserId: string, schoolId: string, dto: CloseTenantAccountDto) {
    await this.assertFullAdmin(adminUserId);

    const school = await this.prismaPlatformAdmin.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!school) {
      throw new NotFoundException('School not found');
    }
    if (school.archivedAt) {
      throw new ConflictException('This School is already closed.');
    }
    if (dto.confirmName !== school.name) {
      throw new BadRequestException("confirmName must exactly match the School's current name.");
    }

    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // Atomic, conditional write — `archivedAt: null` is re-checked against the
    // row's state AT WRITE TIME, inside Postgres's own row-level locking for
    // this single UPDATE, not the possibly-stale `school.archivedAt` read
    // above. See this class's own header comment for the race this closes.
    const { count } = await this.prismaPlatformAdmin.school.updateMany({
      where: { id: schoolId, archivedAt: null },
      data: { archivedAt: now, purgeAt },
    });
    if (count === 0) {
      // A concurrent close() call already claimed this School between our own
      // read above and this write.
      throw new ConflictException('This School is already closed.');
    }
    const updated = await this.prismaPlatformAdmin.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { id: true, archivedAt: true, purgeAt: true, purgedAt: true },
    });

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.CLOSE_SCHOOL_ACCOUNT,
      targetType: 'School',
      targetId: schoolId,
      schoolId,
    });

    await this.stopFranchiseFeeBilling({ schoolId });

    return updated;
  }

  async reactivateSchool(adminUserId: string, schoolId: string) {
    await this.assertFullAdmin(adminUserId);

    const school = await this.prismaPlatformAdmin.school.findUnique({
      where: { id: schoolId },
      select: { id: true, archivedAt: true, purgedAt: true },
    });
    if (!school) {
      throw new NotFoundException('School not found');
    }
    if (!school.archivedAt) {
      throw new ConflictException('This School is not closed.');
    }
    if (school.purgedAt) {
      throw new ConflictException('This School has already been purged and cannot be reactivated.');
    }

    const { count } = await this.prismaPlatformAdmin.school.updateMany({
      where: { id: schoolId, archivedAt: { not: null }, purgedAt: null },
      data: { archivedAt: null, purgeAt: null },
    });
    if (count === 0) {
      // Lost the race — re-fetch to report the specific, now-current reason
      // (same two messages the fast-path check above already gives) rather
      // than a generic one.
      const current = await this.prismaPlatformAdmin.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { archivedAt: true, purgedAt: true },
      });
      if (current.purgedAt) {
        throw new ConflictException('This School has already been purged and cannot be reactivated.');
      }
      throw new ConflictException('This School is not closed.');
    }
    const updated = await this.prismaPlatformAdmin.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { id: true, archivedAt: true, purgeAt: true, purgedAt: true },
    });

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.REACTIVATE_SCHOOL_ACCOUNT,
      targetType: 'School',
      targetId: schoolId,
      schoolId,
    });

    return updated;
  }

  async closeFranchise(adminUserId: string, franchiseId: string, dto: CloseTenantAccountDto) {
    await this.assertFullAdmin(adminUserId);

    const franchise = await this.prismaPlatformAdmin.franchise.findUnique({
      where: { id: franchiseId },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!franchise) {
      throw new NotFoundException('Franchise not found');
    }
    if (franchise.archivedAt) {
      throw new ConflictException('This Franchise is already closed.');
    }
    if (dto.confirmName !== franchise.name) {
      throw new BadRequestException("confirmName must exactly match the Franchise's current name.");
    }

    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prismaPlatformAdmin.franchise.updateMany({
      where: { id: franchiseId, archivedAt: null },
      data: { archivedAt: now, purgeAt },
    });
    if (count === 0) {
      throw new ConflictException('This Franchise is already closed.');
    }
    const updated = await this.prismaPlatformAdmin.franchise.findUniqueOrThrow({
      where: { id: franchiseId },
      select: { id: true, archivedAt: true, purgeAt: true, purgedAt: true },
    });

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.CLOSE_FRANCHISE_ACCOUNT,
      targetType: 'Franchise',
      targetId: franchiseId,
      franchiseId,
    });

    await this.stopFranchiseFeeBilling({ franchiseId });

    return updated;
  }

  async reactivateFranchise(adminUserId: string, franchiseId: string) {
    await this.assertFullAdmin(adminUserId);

    const franchise = await this.prismaPlatformAdmin.franchise.findUnique({
      where: { id: franchiseId },
      select: { id: true, archivedAt: true, purgedAt: true },
    });
    if (!franchise) {
      throw new NotFoundException('Franchise not found');
    }
    if (!franchise.archivedAt) {
      throw new ConflictException('This Franchise is not closed.');
    }
    if (franchise.purgedAt) {
      throw new ConflictException('This Franchise has already been purged and cannot be reactivated.');
    }

    const { count } = await this.prismaPlatformAdmin.franchise.updateMany({
      where: { id: franchiseId, archivedAt: { not: null }, purgedAt: null },
      data: { archivedAt: null, purgeAt: null },
    });
    if (count === 0) {
      const current = await this.prismaPlatformAdmin.franchise.findUniqueOrThrow({
        where: { id: franchiseId },
        select: { archivedAt: true, purgedAt: true },
      });
      if (current.purgedAt) {
        throw new ConflictException('This Franchise has already been purged and cannot be reactivated.');
      }
      throw new ConflictException('This Franchise is not closed.');
    }
    const updated = await this.prismaPlatformAdmin.franchise.findUniqueOrThrow({
      where: { id: franchiseId },
      select: { id: true, archivedAt: true, purgeAt: true, purgedAt: true },
    });

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.REACTIVATE_FRANCHISE_ACCOUNT,
      targetType: 'Franchise',
      targetId: franchiseId,
      franchiseId,
    });

    return updated;
  }
}
