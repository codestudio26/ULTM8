import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole, Prisma } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { RolesChangedService } from '../common/prisma/roles-changed.service';
import { recordStaffActivity } from '../tenants/staff-activity/staff-activity';
import { AuditLogService, AuditAction } from './audit-log.service';

const PAUSABLE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF'] as const;

/**
 * Decision 432 item 6 (stress test round 5, PRIV-6; amends Decision 423
 * item 10) — ULTM8 support's emergency "pause staff". Only a School's main
 * owner pauses or removes its coaches and Branch Staff; when the main owner
 * is away or has lost their account, support can pause one, the same Pause
 * the main owner has (Decision 390): their coach and Branch Staff roles end
 * now and come back, as they were, when the main owner unpauses them.
 * Support can't unpause or remove anyone, and owners are never paused.
 *
 * Reading the list is open to every admin sub-role, like the School's
 * owners; pausing is FULL_ADMIN-only, like changing the main owner. Both are
 * audit-logged, and a pause is also a line on the School's own Staff
 * activity log ("ULTM8 support paused …"). RoleGrant is read and written
 * through ultm8_jobs, as PlatformAdminSchoolOwnersService does.
 */
@Injectable()
export class PlatformAdminSchoolStaffService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly auditLog: AuditLogService,
    private readonly rolesChanged: RolesChangedService,
  ) {}

  private async findSchool(schoolId: string) {
    const school = await this.prismaPlatformAdmin.school.findUnique({ where: { id: schoolId }, select: { id: true, franchiseId: true } });
    if (!school) throw new NotFoundException('School not found');
    return school;
  }

  /** GET /platform-admin/schools/{id}/staff — everyone holding, or paused
   * from, a coach or Branch Staff role here, one row per person. */
  async listStaff(adminUserId: string, schoolId: string) {
    const school = await this.findSchool(schoolId);
    const grants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId, role: { in: [...PAUSABLE_ROLES] }, OR: [{ revokedAt: null }, { pausedAt: { not: null } }] },
      orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
      select: { userId: true, role: true, pausedAt: true, branch: { select: { name: true } }, user: { select: { firstName: true, surname: true, email: true } } },
    });
    const people = new Map<string, { userId: string; firstName: string; surname: string; email: string; roles: Array<{ role: string; branchName: string | null }>; paused: boolean }>();
    for (const g of grants) {
      const person = people.get(g.userId) ?? { userId: g.userId, firstName: g.user.firstName, surname: g.user.surname, email: g.user.email, roles: [], paused: true };
      person.roles.push({ role: g.role, branchName: g.branch?.name ?? null });
      // Paused only when every one of their roles here is paused.
      if (!g.pausedAt) person.paused = false;
      people.set(g.userId, person);
    }
    await this.auditLog.record({
      adminUserId,
      action: AuditAction.VIEW_SCHOOL_STAFF,
      targetType: 'School',
      targetId: school.id,
      schoolId: school.id,
      franchiseId: school.franchiseId,
    });
    return { items: [...people.values()] };
  }

  /** POST /platform-admin/schools/{id}/staff/{userId}/pause. */
  async pauseStaff(adminUserId: string, schoolId: string, userId: string) {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: adminUserId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may pause a School’s staff.');
    }
    const school = await this.findSchool(schoolId);
    const pausedAt = new Date();
    const pausedRoles = await this.prismaJobs.$transaction(async (tx) => {
      const owner = await tx.roleGrant.findFirst({ where: { userId, schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { id: true } });
      if (owner) {
        throw new BadRequestException("Owners can't be paused. Pause is for coaches and Branch Staff.");
      }
      const { count } = await tx.roleGrant.updateMany({
        where: { userId, schoolId, revokedAt: null, role: { in: [...PAUSABLE_ROLES] } },
        // No pausedById: it names a School user, and support isn't one.
        data: { revokedAt: pausedAt, pausedAt, pausedById: null },
      });
      if (count === 0) {
        const already = await tx.roleGrant.findFirst({ where: { userId, schoolId, pausedAt: { not: null } }, select: { id: true } });
        if (already) throw new ConflictException('This person is already paused.');
        throw new NotFoundException('This person holds no coach or Branch Staff role at this School.');
      }
      // The School's own Staff activity log shows who paused them: support.
      await recordStaffActivity(tx as Prisma.TransactionClient, {
        schoolId,
        actorId: null,
        targetUserId: userId,
        action: 'PAUSED',
        details: { pausedRoles: count, byUltm8Support: true },
      });
      return count;
    });

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.PAUSE_SCHOOL_STAFF,
      targetType: 'User',
      targetId: userId,
      schoolId: school.id,
      franchiseId: school.franchiseId,
      details: { pausedRoles },
    });
    this.rolesChanged.forget(userId);
    return { userId, pausedRoles, pausedAt: pausedAt.toISOString() };
  }
}
