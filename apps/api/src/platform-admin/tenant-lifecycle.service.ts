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
    const updated = await this.prismaPlatformAdmin.school.update({
      where: { id: schoolId },
      data: { archivedAt: now, purgeAt },
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

    const updated = await this.prismaPlatformAdmin.school.update({
      where: { id: schoolId },
      data: { archivedAt: null, purgeAt: null },
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
    const updated = await this.prismaPlatformAdmin.franchise.update({
      where: { id: franchiseId },
      data: { archivedAt: now, purgeAt },
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

    const updated = await this.prismaPlatformAdmin.franchise.update({
      where: { id: franchiseId },
      data: { archivedAt: null, purgeAt: null },
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
