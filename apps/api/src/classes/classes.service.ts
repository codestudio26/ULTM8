import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
  ) {}

  /**
   * School Owner/Manager only (Spec §8.2) — Class CRUD isn't among Instructor's
   * confirmed permissions (attendance scan, grading, booking override only — never
   * School settings), so it gets no write path here, same as Branch Staff.
   */
  async create(callerId: string, schoolId: string, dto: CreateClassDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    if (dto.branchId) {
      await this.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
    }
    if (dto.instructorId) {
      await this.assertValidInstructor(callerId, dto.instructorId, schoolId, dto.branchId ?? null);
    }

    const classId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.create({
        data: {
          id: classId,
          schoolId,
          branchId: dto.branchId,
          instructorId: dto.instructorId,
          title: dto.title,
          activities: dto.activities,
          bannerUrl: dto.bannerUrl,
          description: dto.description,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          capacity: dto.capacity,
          bookingEndAt: dto.bookingEndAt ? new Date(dto.bookingEndAt) : undefined,
          qrAttendanceEndAt: dto.qrAttendanceEndAt ? new Date(dto.qrAttendanceEndAt) : undefined,
          refundFeeDate: dto.refundFeeDate ? new Date(dto.refundFeeDate) : undefined,
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired ?? false,
          membershipInclusion: dto.membershipInclusion ?? false,
        },
      }),
    );
  }

  /** Classes visible to the caller under one School — RLS restricts this to a School-
   * level grant (sees every Class, any Branch) or a Branch-scoped grant (their own
   * Branch's Classes plus School-wide ones — class_tenant_isolation, this phase's
   * migration). */
  async findAllForSchool(
    callerId: string,
    schoolId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.class.findMany({ ...args, where: { schoolId } }), cursor, limit),
    );
  }

  async findOne(callerId: string, classId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findUnique({ where: { id: classId } }),
    );
    // RLS returns null (not another tenant's row) for a Class outside the caller's scope
    // — a genuine 404 and a cross-tenant-blocked read are indistinguishable at this layer
    // by design (ultm8-tenant-isolation §2).
    if (!found) {
      throw new NotFoundException('Class not found');
    }
    return found;
  }

  /** School Owner/Manager only — resolved via the Class's own schoolId, not a route param. */
  async update(callerId: string, classId: string, dto: UpdateClassDto) {
    const existing = await this.findOne(callerId, classId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);

    const nextBranchId = dto.branchId !== undefined ? dto.branchId : existing.branchId ?? undefined;
    if (dto.branchId) {
      await this.assertBranchBelongsToSchool(callerId, dto.branchId, existing.schoolId);
    }
    if (dto.instructorId) {
      await this.assertValidInstructor(callerId, dto.instructorId, existing.schoolId, nextBranchId ?? null);
    }

    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.update({
        where: { id: classId },
        data: {
          branchId: dto.branchId,
          instructorId: dto.instructorId,
          title: dto.title,
          activities: dto.activities,
          bannerUrl: dto.bannerUrl,
          description: dto.description,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          capacity: dto.capacity,
          bookingEndAt: dto.bookingEndAt ? new Date(dto.bookingEndAt) : undefined,
          qrAttendanceEndAt: dto.qrAttendanceEndAt ? new Date(dto.qrAttendanceEndAt) : undefined,
          refundFeeDate: dto.refundFeeDate ? new Date(dto.refundFeeDate) : undefined,
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired,
          membershipInclusion: dto.membershipInclusion,
        },
      }),
    );
  }

  // No delete method — general tenant offboarding is [UNRESOLVED]
  // (ultm8-domain-rules §2, ultm8-app-publishing §4), same reasoning as School/Branch.

  private async assertBranchBelongsToSchool(callerId: string, branchId: string, schoolId: string) {
    const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.findUnique({ where: { id: branchId }, select: { id: true, schoolId: true } }),
    );
    if (!branch || branch.schoolId !== schoolId) {
      throw new BadRequestException('branchId must reference a Branch belonging to this School');
    }
  }

  /**
   * "Taught by an Instructor" (domain-rules §9) means instructorId references a User
   * holding an active INSTRUCTOR RoleGrant at this Class's School — not a separate
   * Instructor table (§6.1). The branch check mirrors class_tenant_isolation's own
   * three-way structure rather than a flat equality: a School-scoped Instructor grant
   * (branchId null) may teach ANY Class at the School, including a Branch-specific one; a
   * Branch-scoped Instructor grant may teach that Branch's Classes plus School-wide ones;
   * it may never teach a DIFFERENT Branch's Class. A flat equality would wrongly reject
   * the first case.
   */
  private async assertValidInstructor(
    callerId: string,
    instructorId: string,
    schoolId: string,
    classBranchId: string | null,
  ) {
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: {
          userId: instructorId,
          schoolId,
          role: 'INSTRUCTOR',
          revokedAt: null,
        },
        select: { branchId: true },
      }),
    );
    const valid = grants.some(
      (g) => g.branchId === null || classBranchId === null || g.branchId === classBranchId,
    );
    if (!valid) {
      throw new BadRequestException(
        'instructorId must reference a User holding an active INSTRUCTOR RoleGrant at this School (matching this Class\'s Branch, if any).',
      );
    }
  }
}
