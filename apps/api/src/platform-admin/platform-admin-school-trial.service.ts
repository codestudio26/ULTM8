import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { AuditAction, AuditLogService } from './audit-log.service';

const DAY_MS = 86_400_000;

/**
 * Backlog 3.14 (Decision 318 item 5): a free trial of ULTM8 for a School. Only
 * ULTM8 HQ manages it, never a School owner, and no card is taken. When it
 * ends without an active platform subscription the School drops into the
 * existing read-only state (SubscriptionGateService) until it subscribes;
 * nothing is deleted.
 *
 * Full Platform Admins only, like managing the platform's subscription plans
 * (SubscriptionPlansService). Written on the Platform Admin connection, column
 * by column, and audit-logged.
 */
@Injectable()
export class PlatformAdminSchoolTrialService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Starts a trial ending `days` from now. A School that already pays isn't put on one. */
  async start(adminUserId: string, schoolId: string, days: number) {
    await this.assertFullAdmin(adminUserId);
    const school = await this.findSchool(schoolId);
    if (school.platformSubscriptionStatus === 'ACTIVE' || school.platformSubscriptionStatus === 'PAST_DUE') {
      throw new ConflictException('This School already has a platform subscription, so it needs no trial.');
    }
    const now = new Date();
    const ends = new Date(now.getTime() + days * DAY_MS);
    await this.prismaPlatformAdmin.school.update({ where: { id: schoolId }, data: { platformTrialStartedAt: now, platformTrialEndsAt: ends } });
    await this.record(adminUserId, school, AuditAction.START_SCHOOL_TRIAL, { days, endsAt: ends.toISOString() });
    return { platformTrialStartedAt: now, platformTrialEndsAt: ends };
  }

  /** Adds `days` to the trial's end, or to now if it has already ended. */
  async extend(adminUserId: string, schoolId: string, days: number) {
    await this.assertFullAdmin(adminUserId);
    const school = await this.findSchool(schoolId);
    if (!school.platformTrialStartedAt || !school.platformTrialEndsAt) {
      throw new ConflictException('This School has no trial to extend. Start one first.');
    }
    const from = Math.max(school.platformTrialEndsAt.getTime(), Date.now());
    const ends = new Date(from + days * DAY_MS);
    await this.prismaPlatformAdmin.school.update({ where: { id: schoolId }, data: { platformTrialEndsAt: ends } });
    await this.record(adminUserId, school, AuditAction.EXTEND_SCHOOL_TRIAL, { days, from: school.platformTrialEndsAt.toISOString(), endsAt: ends.toISOString() });
    return { platformTrialStartedAt: school.platformTrialStartedAt, platformTrialEndsAt: ends };
  }

  private async assertFullAdmin(adminUserId: string) {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: adminUserId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may manage a School’s free trial.');
    }
  }

  private async findSchool(schoolId: string) {
    const school = await this.prismaPlatformAdmin.school.findUnique({
      where: { id: schoolId },
      select: { id: true, franchiseId: true, archivedAt: true, platformSubscriptionStatus: true, platformTrialStartedAt: true, platformTrialEndsAt: true },
    });
    if (!school) throw new NotFoundException('School not found');
    if (school.archivedAt) throw new ConflictException('This School is closed. Reactivate it first.');
    return school;
  }

  private record(adminUserId: string, school: { id: string; franchiseId: string | null }, action: AuditAction, details: Record<string, unknown>) {
    return this.auditLog.record({ adminUserId, action, targetType: 'School', targetId: school.id, schoolId: school.id, franchiseId: school.franchiseId, details });
  }
}
