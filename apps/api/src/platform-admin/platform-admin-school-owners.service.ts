import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { RolesChangedService } from '../common/prisma/roles-changed.service';
import { mainOwnerGrant } from '../tenants/role-grants/role-grants.service';
import { AuditLogService, AuditAction } from './audit-log.service';
import { ChangeSchoolMainOwnerDto } from './dto/school-owners.dto';

/**
 * Decision 370 — nobody inside a School can remove its main owner; ULTM8
 * support can. A Platform Admin sees the School's owners and moves the main
 * owner role to one of its co-owners, optionally ending the former main
 * owner's owner role in the same step.
 *
 * Reading is open to every admin sub-role, like PlatformAdminSchoolsService's
 * own School read; changing the main owner is FULL_ADMIN-only, like closing a
 * School (TenantLifecycleService). RoleGrant/User are read and written through
 * ultm8_jobs (table-level SELECT/UPDATE on RoleGrant, SELECT on the User name
 * and email columns), the same client TenantLifecycleService uses for
 * cross-tenant RoleGrant work; ultm8_platform_admin has only a few RoleGrant
 * columns. Every read and change is audit-logged.
 */
@Injectable()
export class PlatformAdminSchoolOwnersService {
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

  async listOwners(adminUserId: string, schoolId: string) {
    const school = await this.findSchool(schoolId);
    const items = await this.prismaJobs.$transaction(async (tx) => {
      const main = await mainOwnerGrant(tx, schoolId);
      const grants = await tx.roleGrant.findMany({
        where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
        orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
        select: { userId: true, grantedAt: true, user: { select: { firstName: true, surname: true, email: true } } },
      });
      const seen = new Set<string>();
      return grants
        .filter((g) => !seen.has(g.userId) && seen.add(g.userId))
        .map((g) => ({
          userId: g.userId,
          firstName: g.user.firstName,
          surname: g.user.surname,
          email: g.user.email,
          mainOwner: g.userId === main?.userId,
          ownerSince: g.grantedAt.toISOString(),
        }))
        .sort((a, b) => Number(b.mainOwner) - Number(a.mainOwner));
    });

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.VIEW_SCHOOL_OWNERS,
      targetType: 'School',
      targetId: school.id,
      schoolId: school.id,
      franchiseId: school.franchiseId,
    });
    return { items };
  }

  async changeMainOwner(adminUserId: string, schoolId: string, dto: ChangeSchoolMainOwnerDto) {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: adminUserId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may change a School’s main owner.');
    }
    const school = await this.findSchool(schoolId);

    const { formerUserId, formerRemoved } = await this.prismaJobs.$transaction(async (tx) => {
      const main = await mainOwnerGrant(tx, schoolId);
      if (main?.userId === dto.userId) {
        throw new BadRequestException('This person is already the main owner.');
      }
      const target = await tx.roleGrant.findFirst({
        where: { schoolId, userId: dto.userId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
        orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (!target) {
        throw new NotFoundException('This person is not a co-owner of this School. They need to be made a co-owner first.');
      }
      await tx.roleGrant.updateMany({ where: { schoolId, isMainOwner: true, revokedAt: null }, data: { isMainOwner: false } });
      await tx.roleGrant.update({ where: { id: target.id }, data: { isMainOwner: true } });
      let removed = false;
      if (dto.removeFormerMainOwner && main) {
        const { count } = await tx.roleGrant.updateMany({
          where: { schoolId, userId: main.userId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
          data: { revokedAt: new Date() },
        });
        removed = count > 0;
      }
      return { formerUserId: main?.userId ?? null, formerRemoved: removed };
    });

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.CHANGE_SCHOOL_MAIN_OWNER,
      targetType: 'School',
      targetId: school.id,
      schoolId: school.id,
      franchiseId: school.franchiseId,
      details: { fromUserId: formerUserId, toUserId: dto.userId, formerMainOwnerRemoved: formerRemoved },
    });
    if (formerUserId) this.rolesChanged.forget(formerUserId);
    this.rolesChanged.forget(dto.userId);
    return { mainOwnerUserId: dto.userId, formerMainOwnerRemoved: formerRemoved };
  }
}
