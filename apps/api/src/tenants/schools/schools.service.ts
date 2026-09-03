import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';

@Injectable()
export class SchoolsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /**
   * Self-service School creation (explicitly confirmed with the product owner for
   * Phase 2 — not stated anywhere in Spec 55/domain-rules/the decision log; the only
   * prior evidence was the `createSchoolProfile` Figma screen, [OBSERVED IN DESIGNS]
   * only). Any authenticated User may create a School and is granted
   * SCHOOL_OWNER_MANAGER on it atomically, in the same transaction as the School row
   * itself — this is the same self-registration RLS bootstrap pattern already used by
   * AuthService.register() (School's RLS WITH CHECK for INSERT only requires an
   * established app.current_user_id context; the RoleGrant's own INSERT is covered by
   * the existing rolegrant_self_only policy, since the grantee is the caller).
   *
   * franchiseId is never accepted here — see CreateSchoolDto's header comment.
   */
  async create(callerId: string, dto: CreateSchoolDto) {
    const schoolId = randomUUID();
    const roleGrantId = randomUUID();

    const school = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const created = await tx.school.create({
        data: {
          id: schoolId,
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          address: dto.address,
          businessType: dto.businessType,
          activities: dto.activities ?? [],
          facilities: dto.facilities ?? [],
          ranksToggle: dto.ranksToggle ?? false,
          defaultLanguage: dto.defaultLanguage,
          defaultCurrency: dto.defaultCurrency,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          classCancellationPolicy: dto.classCancellationPolicy,
          waitlistClaimWindowMinutes: dto.waitlistClaimWindowMinutes,
        },
      });

      await tx.roleGrant.create({
        data: {
          id: roleGrantId,
          role: 'SCHOOL_OWNER_MANAGER',
          userId: callerId,
          schoolId: created.id,
          grantedById: callerId, // self-granted at creation time — there is no prior grantor
        },
      });

      return created;
    });

    return school;
  }

  /** Schools visible to the caller — RLS already restricts this to Schools where the
   * caller holds any active RoleGrant (school_tenant_isolation, migration.sql). */
  async findAllForCaller(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.school.findMany(args), cursor, limit),
    );
  }

  async findOne(callerId: string, schoolId: string) {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId } }),
    );
    // RLS returns null (not another tenant's row) for a School outside the caller's
    // scope — a genuine 404 and a cross-tenant-blocked read are indistinguishable at
    // this layer by design (ultm8-tenant-isolation §2: "a query missing a tenant filter
    // returns nothing", never an error that could leak existence).
    if (!school) {
      throw new NotFoundException('School not found');
    }
    return school;
  }

  /** School Owner/Manager only (Spec §8.2) — see TenantAuthorizationService. */
  async update(callerId: string, schoolId: string, dto: UpdateSchoolDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: {
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          address: dto.address,
          businessType: dto.businessType,
          activities: dto.activities,
          facilities: dto.facilities,
          ranksToggle: dto.ranksToggle,
          defaultLanguage: dto.defaultLanguage,
          defaultCurrency: dto.defaultCurrency,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          classCancellationPolicy: dto.classCancellationPolicy,
          waitlistClaimWindowMinutes: dto.waitlistClaimWindowMinutes,
        },
      }),
    );
    return updated;
  }

  // No delete method — general tenant offboarding is [UNRESOLVED]
  // (ultm8-domain-rules §2, ultm8-app-publishing §4). Do not add one without a decision.
}
