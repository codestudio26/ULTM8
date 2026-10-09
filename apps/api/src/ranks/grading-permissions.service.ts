import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SetGradingPermissionsDto } from './dto/grading-permission.dto';

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
    const items = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.gradingPermission.findMany({ where: { schoolId }, orderBy: [{ userId: 'asc' }, { disciplineId: 'asc' }] }),
    );
    return { items };
  }

  /** Replaces one staff member's list of disciplines. The target must be an
   * active Instructor or Branch Staff at this School (the owner needs no
   * grant), and every discipline must belong to this School. */
  async setForUser(callerId: string, schoolId: string, userId: string, dto: SetGradingPermissionsDto) {
    this.assertUuids(schoolId, userId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const staffGrant = await tx.roleGrant.findFirst({
        where: { userId, schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { id: true },
      });
      if (!staffGrant) {
        throw new BadRequestException('Grading permission can only be given to an Instructor or Branch Staff member of this School.');
      }
      if (dto.disciplineIds.length) {
        const found = await tx.discipline.count({ where: { id: { in: dto.disciplineIds }, schoolId } });
        if (found !== dto.disciplineIds.length) {
          throw new BadRequestException('disciplineIds must all reference disciplines (styles) of this School.');
        }
      }
      await tx.gradingPermission.deleteMany({ where: { schoolId, userId } });
      if (dto.disciplineIds.length) {
        await tx.gradingPermission.createMany({
          data: dto.disciplineIds.map((disciplineId) => ({ id: randomUUID(), schoolId, userId, disciplineId, grantedById: callerId })),
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
