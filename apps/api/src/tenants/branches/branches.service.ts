import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { SchoolsService } from '../schools/schools.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchesQueryDto } from './dto/branches-query.dto';
import { compareBranches, matchesBranchFilter, paginateSorted } from './branch-list-filter';
import { addressWriteData } from '../../common/address/postal-address.dto';
import { BranchDependentCounts, branchHasHistory, countBranchDependents, describeBranchDependents, hasBranchDependents } from './branch-dependents';
import { CloseBranchDto, WHOLE_SCHOOL } from './dto/close-branch.dto';

const RETENTION_WINDOW_DAYS = 90;

/** Coach invites to a Branch that can still be accepted. */
const pendingInvitesAt = (branchId: string, now: Date) => ({ branchId, acceptedAt: null, cancelledAt: null, expiresAt: { gt: now } });

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

  /** Decision 330 — what closing would move, and whether the Branch keeps
   * its history afterwards (never purged) or is removed after 90 days. */
  async closePreview(callerId: string, branchId: string) {
    const existing = await this.findOne(callerId, branchId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const now = new Date();
      const counts = await countBranchDependents(tx, branchId, now);
      const hasHistory = await branchHasHistory(tx, branchId);
      const pendingCoachInvites = await tx.coachInvite.count({ where: pendingInvitesAt(branchId, now) });
      return {
        upcomingClasses: counts.classes,
        timetableSlots: counts.timetableSlots,
        instructors: counts.instructors,
        students: counts.students,
        staffRoles: counts.roleGrants,
        pendingCoachInvites,
        hasHistory,
      };
    });
  }

  /** Decision 226/293 archive, kept for API callers: a close with no moves,
   * so it is refused (409) while anything is still in use (fix 5). */
  async archive(callerId: string, branchId: string) {
    return this.close(callerId, branchId, {});
  }

  /**
   * Decision 330 (fixes 5, 6 and 7) — close a Branch. School Owner/Manager
   * only, while the School is open; idempotent on an already-closed Branch.
   *
   * In one transaction, with the Branch row locked:
   * - upcoming Classes (with their Bookings' and waitlist entries' branchId,
   *   which are copied from the Class) and active weekly slots move to
   *   `classesTo`; home-branch Students to `studentsTo` (none for the whole
   *   School); active Instructor profiles to `instructorsTo`;
   * - active staff and coach roles are re-granted at `staffTo` and the old
   *   grants revoked, so the role history stays with this Branch. A Branch
   *   role never becomes School-wide (that would widen it);
   * - coach invites still open for this Branch are cancelled (an invite's
   *   branch can't change after it is sent);
   * - a Class whose coach could teach here but has no coach role at the new
   *   Branch refuses the whole close, so no class is left with a coach who
   *   can't run it.
   * Past and archived Classes, Bookings, attendance, money and messages are
   * not touched, and nobody is charged or emailed. Then the Branch is
   * archived: kept for good if it has history (fix 7), otherwise removed by
   * the purge job after 90 days. Reopen (unarchive) still works either way.
   */
  async close(callerId: string, branchId: string, dto: CloseBranchDto) {
    const existing = await this.findOne(callerId, branchId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (existing.archivedAt) {
      return existing; // idempotent — closing an already-closed Branch is a no-op, not an error.
    }

    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Same row lock as a concurrent close/archive; re-read under it.
      await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} FOR UPDATE`;
      const locked = await tx.branch.findUnique({ where: { id: branchId }, select: { archivedAt: true } });
      if (!locked || locked.archivedAt) return; // lost the race to a concurrent close — idempotent either way.

      const now = new Date();
      const resolve = async (value: string | undefined, wholeSchoolAllowed = true): Promise<string | null | undefined> => {
        if (value === undefined) return undefined;
        if (value === WHOLE_SCHOOL) {
          if (!wholeSchoolAllowed) {
            throw new BadRequestException("Staff and coach roles must go to another Branch. To end someone's access instead, remove it on the Staff page first.");
          }
          return null;
        }
        if (value === branchId) throw new BadRequestException("Things can't move to the Branch being closed. Pick another Branch.");
        const target = await tx.branch.findUnique({ where: { id: value }, select: { schoolId: true, archivedAt: true } });
        if (!target || target.schoolId !== existing.schoolId || target.archivedAt) {
          throw new BadRequestException("That Branch isn't an open Branch of this School. Pick another one.");
        }
        return value;
      };
      const classesTo = await resolve(dto.classesTo);
      const studentsTo = await resolve(dto.studentsTo);
      const instructorsTo = await resolve(dto.instructorsTo);
      const staffTo = await resolve(dto.staffTo, false);

      // Groups still in use with nowhere to go.
      const counts = await countBranchDependents(tx, branchId, now);
      const unplaced: BranchDependentCounts = {
        classes: classesTo === undefined ? counts.classes : 0,
        timetableSlots: classesTo === undefined ? counts.timetableSlots : 0,
        instructors: instructorsTo === undefined ? counts.instructors : 0,
        students: studentsTo === undefined ? counts.students : 0,
        roleGrants: staffTo === undefined ? counts.roleGrants : 0,
      };
      if (hasBranchDependents(unplaced)) {
        throw new ConflictException({
          code: 'BRANCH_STILL_IN_USE',
          message: `This Branch can't be closed while it still has ${describeBranchDependents(unplaced).join(', ')}. Choose where they go, or move them first.`,
        });
      }

      const movingClasses = classesTo === undefined
        ? []
        : await tx.class.findMany({ where: { branchId, archivedAt: null, endDate: { gte: now } }, select: { id: true, instructorId: true } });
      const movingSlots = classesTo === undefined
        ? []
        : await tx.timetableSlot.findMany({ where: { branchId, archivedAt: null }, select: { id: true, instructorId: true } });
      const coachIds = [...new Set([...movingClasses, ...movingSlots].map((r) => r.instructorId).filter((id): id is string => !!id))];
      const coachBranches = async () => {
        const grants = await tx.roleGrant.findMany({
          where: { userId: { in: coachIds }, schoolId: existing.schoolId, role: 'INSTRUCTOR', revokedAt: null },
          select: { userId: true, branchId: true },
        });
        return (userId: string, at: string | null) => grants.some((g) => g.userId === userId && (g.branchId === null || at === null || g.branchId === at));
      };
      const couldTeachHere = await coachBranches();

      if (staffTo !== undefined) {
        const grants = await tx.roleGrant.findMany({ where: { branchId, revokedAt: null } });
        for (const grant of grants) {
          await tx.roleGrant.update({ where: { id: grant.id }, data: { revokedAt: now } });
          const already = await tx.roleGrant.findFirst({
            where: { userId: grant.userId, schoolId: grant.schoolId, role: grant.role, branchId: staffTo, revokedAt: null },
            select: { id: true },
          });
          if (!already) {
            await tx.roleGrant.create({
              data: { id: randomUUID(), role: grant.role, userId: grant.userId, franchiseId: grant.franchiseId, schoolId: grant.schoolId, branchId: staffTo, grantedById: callerId },
            });
          }
        }
      }
      await tx.coachInvite.updateMany({ where: pendingInvitesAt(branchId, now), data: { cancelledAt: now, cancelledById: callerId } });

      if (classesTo !== undefined) {
        const canTeachThere = await coachBranches();
        const stranded = coachIds.filter((id) => couldTeachHere(id, branchId) && !canTeachThere(id, classesTo));
        if (stranded.length > 0) {
          throw new ConflictException({
            code: 'BRANCH_CLOSE_COACH_NOT_AT_TARGET',
            message:
              "A coach who teaches these classes has no coach role at the Branch they're moving to. Move staff and coach roles to the same Branch, or give the coach a role there first.",
          });
        }
        const classIds = movingClasses.map((c) => c.id);
        await tx.class.updateMany({ where: { id: { in: classIds } }, data: { branchId: classesTo } });
        await tx.booking.updateMany({ where: { classId: { in: classIds } }, data: { branchId: classesTo } });
        await tx.waitlistEntry.updateMany({ where: { classId: { in: classIds } }, data: { branchId: classesTo } });
        await tx.timetableSlot.updateMany({ where: { id: { in: movingSlots.map((s) => s.id) } }, data: { branchId: classesTo } });
      }
      if (studentsTo === null) {
        await tx.studentHomeBranch.deleteMany({ where: { branchId } });
      } else if (studentsTo !== undefined) {
        await tx.studentHomeBranch.updateMany({ where: { branchId }, data: { branchId: studentsTo, assignedById: callerId } });
      }
      if (instructorsTo !== undefined) {
        await tx.instructor.updateMany({ where: { branchId, archivedAt: null }, data: { branchId: instructorsTo } });
      }

      // Re-checked after the moves: anything added meanwhile refuses the close.
      const left = await countBranchDependents(tx, branchId, now);
      if (hasBranchDependents(left)) {
        throw new ConflictException({
          code: 'BRANCH_STILL_IN_USE',
          message: `This Branch can't be closed while it still has ${describeBranchDependents(left).join(', ')}. Choose where they go, or move them first.`,
        });
      }
      const keep = await branchHasHistory(tx, branchId);
      const purgeAt = keep ? null : new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      await tx.branch.updateMany({ where: { id: branchId, archivedAt: null }, data: { archivedAt: now, purgeAt } });
    });
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
