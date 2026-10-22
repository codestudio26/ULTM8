import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { SchoolsService } from '../schools/schools.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchesQueryDto } from './dto/branches-query.dto';
import { compareBranches, matchesBranchFilter, paginateSorted } from './branch-list-filter';
import { addressWriteData } from '../../common/address/postal-address.dto';
import { countBranchDependents, describeBranchDependents, hasBranchDependents } from './branch-dependents';

const RETENTION_WINDOW_DAYS = 90;

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
          ...addressWriteData(dto),
          contactPhone: dto.contactPhone,
          timezone: dto.timezone,
          currencyOverride: dto.currencyOverride,
          type: dto.type,
          activities: dto.activities,
          facilities: dto.facilities,
          defaultLanguage: dto.defaultLanguage,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
        },
      }),
    );
  }

  /** Branches visible to the caller under one School — RLS restricts this to School
   * Owner/Manager (sees every Branch under their School) or a Branch Staff grant
   * matching that one Branch (branch_tenant_isolation, migration.sql).
   *
   * Decision 294 — sorted by name, filtered by `city` / `q` / `country`
   * ignoring case and accents, and paged in memory (branch-list-filter.ts
   * says why). Each row also carries its home-branch student count and
   * upcoming class count for the list's overview columns.
   *
   * Decision 226 — `includeArchived` (default false) excludes archived Branches
   * from the default view, same "excluded by default, visible via a filter"
   * convention applied to every one of the 7 entities this build covers. */
  async findAllForSchool(callerId: string, schoolId: string, query: BranchesQueryDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const { rows, students, classes } = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const rows = await tx.branch.findMany({ where: { schoolId, ...(query.includeArchived ? {} : { archivedAt: null }) } });
      const branchIds = rows.map((r) => r.id);
      const [students, classes] = await Promise.all([
        tx.studentHomeBranch.groupBy({ by: ['branchId'], where: { branchId: { in: branchIds } }, _count: { _all: true } }),
        tx.class.groupBy({
          by: ['branchId'],
          where: { branchId: { in: branchIds }, archivedAt: null, startDate: { gte: new Date() } },
          _count: { _all: true },
        }),
      ]);
      return { rows, students, classes };
    });
    const studentCounts = new Map(students.map((g) => [g.branchId, g._count._all]));
    const classCounts = new Map(classes.map((g) => [g.branchId, g._count._all]));
    const sorted = rows
      .filter((b) => matchesBranchFilter(b, query))
      .sort(compareBranches)
      .map((b) => ({ ...b, studentCount: studentCounts.get(b.id) ?? 0, upcomingClassCount: classCounts.get(b.id) ?? 0 }));
    return paginateSorted(sorted, query.cursor, query.limit);
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
          ...addressWriteData(dto),
          contactPhone: dto.contactPhone,
          timezone: dto.timezone,
          currencyOverride: dto.currencyOverride,
          type: dto.type,
          activities: dto.activities,
          facilities: dto.facilities,
          defaultLanguage: dto.defaultLanguage,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Decision 226 — entity-level tenant offboarding. School Owner/Manager only
  // (same gate as update() above), usable while the School stays open — this
  // archives ONE Branch, not the whole School/Franchise (that's Decision 110's
  // separate, already-shipped close-account flow). Soft-archive with the same
  // full archivedAt/purgeAt/purgedAt trio and 90-day retention window as
  // School/Franchise (Decision 110) — see this entity's own schema.prisma
  // comment for why the fuller trio was chosen over MembershipPlan's simpler
  // bare-archivedAt shape. Mirrors TenantLifecycleService.closeSchool's own
  // TOCTOU-safe conditional-updateMany pattern (re-checked against the row's
  // CURRENT state at write time, not a possibly-stale read) rather than
  // MembershipsService.archivePlan's simpler read-then-update (that method has
  // no dependents check to race against; this one does, and a second
  // concurrent archive() call successfully slipping through the first one's
  // dependents check is exactly the kind of race TenantLifecycleService's own
  // header comment documents being found and fixed for School/Franchise).
  // ---------------------------------------------------------------------------

  /** Active dependents that block archiving a Branch — the safest
   * (most conservative) reading found after checking this schema's real FKs:
   * any Class, Instructor profile, or Student (StudentHomeBranch) currently
   * pointing at this Branch (the task's own starting hint), PLUS any
   * non-revoked RoleGrant scoped to it — added as this build's own judgment
   * call, not in the original hint, because RoleGrant.branchId is an
   * `ON DELETE CASCADE` FK (verified in this phase's migration review):
   * purging an archived Branch that still has an active Branch-Staff/
   * Instructor RoleGrant scoped to it would silently destroy that person's
   * access grant, not just "remove a Branch" — the task's own standing
   * instruction to apply the safest reasonable rule when a hint turns out to
   * be incomplete once checked against the real schema. Decision 293 adds
   * TimetableSlot; the counting lives in branch-dependents.ts so the purge
   * job rechecks exactly the same rule before deleting. */
  private async assertNoActiveDependents(callerId: string, branchId: string): Promise<void> {
    const counts = await this.prismaApp.withTenantContext(callerId, (tx) => countBranchDependents(tx, branchId));
    if (hasBranchDependents(counts)) {
      throw new ConflictException(
        `This Branch can't be archived while it still has ${describeBranchDependents(counts).join(', ')}. Move or remove them first.`,
      );
    }
  }

  async archive(callerId: string, branchId: string) {
    const existing = await this.findOne(callerId, branchId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (existing.archivedAt) {
      return existing; // idempotent — archiving an already-archived Branch is a no-op, not an error.
    }
    await this.assertNoActiveDependents(callerId, branchId);

    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // TOCTOU-safe: re-checked against the row's CURRENT state at write time
    // (archivedAt: null), not the possibly-stale `existing` read above — see
    // this section's own header comment.
    const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.updateMany({ where: { id: branchId, archivedAt: null }, data: { archivedAt: now, purgeAt } }),
    );
    if (count === 0) {
      return this.findOne(callerId, branchId); // lost the race to a concurrent archive() — idempotent either way.
    }
    return this.findOne(callerId, branchId);
  }

  async unarchive(callerId: string, branchId: string) {
    const existing = await this.findOne(callerId, branchId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (!existing.archivedAt) {
      return existing; // idempotent, same reasoning as archive() above.
    }
    if (existing.purgedAt) {
      throw new ConflictException('This Branch has already been purged and cannot be unarchived.');
    }
    const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.updateMany({
        where: { id: branchId, archivedAt: { not: null }, purgedAt: null },
        data: { archivedAt: null, purgeAt: null },
      }),
    );
    if (count === 0) {
      const current = await this.findOne(callerId, branchId);
      if (current.purgedAt) {
        throw new ConflictException('This Branch has already been purged and cannot be unarchived.');
      }
      return current;
    }
    return this.findOne(callerId, branchId);
  }
}
