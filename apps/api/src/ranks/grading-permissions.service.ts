import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { PERMISSION_TOGGLES, PermissionToggle, SetGradingPermissionsDto } from './dto/grading-permission.dto';

const ALL_ON = Object.fromEntries(PERMISSION_TOGGLES.map((t) => [t, true])) as Record<PermissionToggle, boolean>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Grading permission per discipline (grading foundation PR 4, Decision 138):
 * the School owner always has it; anyone else grades only in the disciplines
 * the owner grants here, as in the prototype's Settings → "Instructor grading
 * permissions" table. Only the owner reads or changes the whole table (RLS:
 * grading_permission_owner_manage); a staff member can read their own rows.
 * GradingService.assertCanGrade() enforces it.
 */
@Injectable()
export class GradingPermissionsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  async findAllForSchool(callerId: string, schoolId: string) {
    this.assertUuids(schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const items = await tx.gradingPermission.findMany({ where: { schoolId }, orderBy: [{ userId: 'asc' }, { disciplineId: 'asc' }] });
      // Who can be given grading permission: the School's active Instructors
      // and Branch Staff, for the portal's permissions page (Decision 181).
      const grants = await tx.roleGrant.findMany({
        where: { schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true, userId: true, user: { select: { firstName: true, surname: true } } },
      });
      const staff = new Map<string, { userId: string; firstName: string; surname: string; roles: string[] }>();
      for (const g of grants) {
        const entry = staff.get(g.userId) ?? { userId: g.userId, firstName: g.user.firstName, surname: g.user.surname, roles: [] };
        if (!entry.roles.includes(g.role)) entry.roles.push(g.role);
        staff.set(g.userId, entry);
      }
      const sorted = [...staff.values()].sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`));
      return { items, staff: sorted };
    });
  }

  /** Replaces one staff member's styles and toggles (Decision 181). The
   * target must be an active Instructor or Branch Staff at this School (the
   * owner needs no grant), and every style must belong to this School. The
   * older `disciplineIds` form gives every toggle. */
  async setForUser(callerId: string, schoolId: string, userId: string, dto: SetGradingPermissionsDto) {
    this.assertUuids(schoolId, userId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const styles = dto.styles ?? (dto.disciplineIds ?? []).map((disciplineId) => ({ disciplineId, ...ALL_ON }));
    const disciplineIds = styles.map((s) => s.disciplineId);
    if (new Set(disciplineIds).size !== disciplineIds.length) {
      throw new BadRequestException('Each style can appear only once.');
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const staffGrant = await tx.roleGrant.findFirst({
        where: { userId, schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { id: true },
      });
      if (!staffGrant) {
        throw new BadRequestException('Grading permission can only be given to an Instructor or Branch Staff member of this School.');
      }
      if (disciplineIds.length) {
        const found = await tx.discipline.count({ where: { id: { in: disciplineIds }, schoolId } });
        if (found !== disciplineIds.length) {
          throw new BadRequestException('disciplineIds must all reference disciplines (styles) of this School.');
        }
      }
      await tx.gradingPermission.deleteMany({ where: { schoolId, userId } });
      if (styles.length) {
        await tx.gradingPermission.createMany({
          data: styles.map((s) => ({
            id: randomUUID(),
            schoolId,
            userId,
            grantedById: callerId,
            disciplineId: s.disciplineId,
            ...Object.fromEntries(PERMISSION_TOGGLES.map((t) => [t, s[t]])),
          })),
        });
      }
      const items = await tx.gradingPermission.findMany({ where: { schoolId, userId }, orderBy: { disciplineId: 'asc' } });
      return { items };
    });
  }

  private assertUuids(...ids: string[]): void {
    if (ids.some((id) => !UUID_PATTERN.test(id))) {
      throw new BadRequestException('schoolId and userId must be valid UUIDs');
    }
  }
}
