import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
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
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

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
