import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { SchoolsService } from '../schools/schools.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
  ) {}

  /** School Owner/Manager only (Spec §8.2: "Manage their own School/Branches"). */
  async create(callerId: string, schoolId: string, dto: CreateBranchDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const branchId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.create({
        data: {
          id: branchId,
          schoolId,
          name: dto.name,
          address: dto.address,
          contactPhone: dto.contactPhone,
          timezone: dto.timezone,
          currencyOverride: dto.currencyOverride,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
        },
      }),
    );
  }

  /** Branches visible to the caller under one School — RLS restricts this to School
   * Owner/Manager (sees every Branch under their School) or a Branch Staff grant
   * matching that one Branch (branch_tenant_isolation, migration.sql). */
  async findAllForSchool(
    callerId: string,
    schoolId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.branch.findMany({ ...args, where: { schoolId } }), cursor, limit),
    );
  }

  async findOne(callerId: string, branchId: string) {
    const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.findUnique({ where: { id: branchId } }),
    );
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  /** School Owner/Manager only — resolved via the Branch's own schoolId, not a route param. */
  async update(callerId: string, branchId: string, dto: UpdateBranchDto) {
    const existing = await this.findOne(callerId, branchId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);

    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.update({
        where: { id: branchId },
        data: {
          name: dto.name,
          address: dto.address,
          contactPhone: dto.contactPhone,
          timezone: dto.timezone,
          currencyOverride: dto.currencyOverride,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
        },
      }),
    );
  }

  // No delete method — same reasoning as SchoolsService.
}
