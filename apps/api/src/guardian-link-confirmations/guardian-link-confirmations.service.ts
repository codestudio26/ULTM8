import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decision 172 — a School confirms that a Guardian really is a minor's Guardian;
 * consent can be granted only after that (GuardiansService.grantConsent()).
 *
 * Who may confirm: the School Owner/Manager, or an Instructor or Branch Staff
 * member the owner has given the right (GuardianLinkConfirmer, managed below,
 * same shape as Decision 138's grading permission).
 *
 * Which minors: only those enrolled at the School (an active STUDENT RoleGrant
 * there). The owner covers all of them. Other confirmers cover the minors whose
 * home branch is one of their branches — the same coverage as grading
 * (Decision 168, GradingService.assertBranchCoversStudent()): a School with no
 * branches is one branch, a staff grant with no branch covers no one, and a
 * minor with no home branch yet is the owner's alone.
 *
 * Only the owner of the School that confirmed a link can un-confirm it. Every
 * confirmation and un-confirmation is kept in GuardianLinkConfirmationEvent, so
 * un-confirming never erases who confirmed and when.
 *
 * GuardianLink is self-only for the Guardian (Decision 92), so it is read and
 * written through ultm8_jobs, only after the authorization checks here — the
 * same pattern as GuardiansService's own baseline cascade. ultm8_jobs may write
 * only the three confirmation columns (migration 20261014000000).
 *
 * Its own module because it needs TenantAuthorizationService, and TenantsModule
 * already imports GuardiansModule.
 */
@Injectable()
export class GuardianLinkConfirmationsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  async findLinksForSchool(callerId: string, schoolId: string, status?: 'pending' | 'confirmed') {
    this.assertUuids(schoolId);
    const coverage = await this.confirmerCoverage(callerId, schoolId);

    const studentIds = await this.coveredStudentIds(schoolId, await this.enrolledStudentIds(schoolId), coverage);
    if (studentIds.length === 0) return { items: [] };

    const links = await this.prismaJobs.guardianLink.findMany({
      where: {
        studentId: { in: studentIds },
        revokedAt: null,
        ...(status === 'pending' ? { confirmedAt: null } : status === 'confirmed' ? { confirmedAt: { not: null } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (links.length === 0) return { items: [] };

    // Only the columns ultm8_jobs may read on User (column-level grants).
    const people = await this.prismaJobs.user.findMany({
      where: { id: { in: [...new Set(links.flatMap((l) => [l.studentId, l.guardianId]))] } },
      select: { id: true, firstName: true, surname: true, dateOfBirth: true, phone: true, erasedAt: true },
    });
    const byId = new Map(people.map((p) => [p.id, p]));

    const items = links
      .filter((l) => !byId.get(l.studentId)?.erasedAt)
      .map((l) => {
        const student = byId.get(l.studentId)!;
        const guardian = byId.get(l.guardianId)!;
        return {
          linkId: l.id,
          studentId: l.studentId,
          studentFirstName: student.firstName,
          studentSurname: student.surname,
          studentDateOfBirth: student.dateOfBirth,
          guardianId: l.guardianId,
          guardianFirstName: guardian.firstName,
          guardianSurname: guardian.surname,
          guardianPhone: guardian.phone,
          linkedAt: l.createdAt,
          confirmedAt: l.confirmedAt,
          confirmedById: l.confirmedById,
          confirmedSchoolId: l.confirmedSchoolId,
        };
      });
    return { items };
  }

  async confirm(callerId: string, schoolId: string, linkId: string) {
    this.assertUuids(schoolId, linkId);
    const coverage = await this.confirmerCoverage(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const link = await this.prismaJobs.guardianLink.findUnique({ where: { id: linkId } });
    // A link of a minor not enrolled here is reported as not found, not
    // forbidden, so staff cannot probe other Schools' links.
    if (!link || link.revokedAt || !(await this.isEnrolled(link.studentId, schoolId))) {
      throw new NotFoundException('Guardian link not found for a Student of this School.');
    }
    if ((await this.coveredStudentIds(schoolId, [link.studentId], coverage)).length === 0) {
      throw new ForbiddenException(
        "This Student's home branch is not one of your branches (or they have no home branch yet). The School owner can confirm it.",
      );
    }
    if (link.confirmedAt) {
      throw new ConflictException('This Guardian link is already confirmed.');
    }

    // Guarded on confirmedAt: null, so two staff confirming at once can't
    // overwrite each other's record of who confirmed. The history row commits
    // with it.
    await this.prismaJobs.$transaction(async (tx) => {
      const result = await tx.guardianLink.updateMany({
        where: { id: linkId, confirmedAt: null, revokedAt: null },
        data: { confirmedAt: new Date(), confirmedById: callerId, confirmedSchoolId: schoolId },
      });
      if (result.count === 0) {
        throw new ConflictException('This Guardian link is already confirmed.');
      }
      await tx.guardianLinkConfirmationEvent.create({
        data: { id: randomUUID(), guardianLinkId: linkId, schoolId, actorId: callerId, type: 'CONFIRMED' },
      });
    });
    return this.prismaJobs.guardianLink.findUniqueOrThrow({ where: { id: linkId } });
  }

  /** Owner of the confirming School only. The link goes back to unconfirmed, so
   * no new consent can be given until a School confirms it again. Consent
   * already given is not changed. */
  async unconfirm(callerId: string, schoolId: string, linkId: string) {
    this.assertUuids(schoolId, linkId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const link = await this.prismaJobs.guardianLink.findUnique({ where: { id: linkId } });
    if (!link || link.revokedAt || !link.confirmedAt || link.confirmedSchoolId !== schoolId) {
      throw new NotFoundException('No Guardian link confirmed by this School was found.');
    }

    await this.prismaJobs.$transaction(async (tx) => {
      const result = await tx.guardianLink.updateMany({
        where: { id: linkId, confirmedSchoolId: schoolId, confirmedAt: { not: null } },
        data: { confirmedAt: null, confirmedById: null, confirmedSchoolId: null },
      });
      if (result.count === 0) {
        throw new ConflictException('This Guardian link is no longer confirmed.');
      }
      await tx.guardianLinkConfirmationEvent.create({
        data: { id: randomUUID(), guardianLinkId: linkId, schoolId, actorId: callerId, type: 'UNCONFIRMED' },
      });
    });
    return this.prismaJobs.guardianLink.findUniqueOrThrow({ where: { id: linkId } });
  }

  // ---------------------------------------------------------------------------
  // Who may confirm — School owner only (RLS: guardian_link_confirmer_owner_manage)
  // ---------------------------------------------------------------------------

  async findConfirmers(callerId: string, schoolId: string) {
    this.assertUuids(schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.guardianLinkConfirmer.findMany({ where: { schoolId }, orderBy: { createdAt: 'asc' } }),
    );
    // Names for the owner's list; the owner already sees these ids through the
    // RLS-scoped query above (see resolveUserNames()'s own comment).
    const names = await resolveUserNames(this.prismaAuth, rows.map((r) => r.userId));
    const items = rows.map((r) => ({
      ...r,
      userFirstName: names.get(r.userId)?.firstName ?? null,
      userSurname: names.get(r.userId)?.surname ?? null,
    }));
    return { items };
  }

  /** Gives `userId` the right. Idempotent: giving it twice returns the existing row. */
  async addConfirmer(callerId: string, schoolId: string, userId: string) {
    this.assertUuids(schoolId, userId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    try {
      return await this.prismaApp.withTenantContext(callerId, async (tx) => {
        const staffGrant = await tx.roleGrant.findFirst({
          where: { userId, schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null },
          select: { id: true },
        });
        if (!staffGrant) {
          throw new BadRequestException('Only an Instructor or Branch Staff member of this School can be given this right.');
        }
        const existing = await tx.guardianLinkConfirmer.findUnique({ where: { schoolId_userId: { schoolId, userId } } });
        if (existing) return existing;
        return tx.guardianLinkConfirmer.create({ data: { id: randomUUID(), schoolId, userId, grantedById: callerId } });
      });
    } catch (err) {
      // A concurrent request gave the same right first. Caught outside the
      // transaction: Postgres aborts a transaction once a statement in it fails.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prismaApp.withTenantContext(callerId, (tx) =>
          tx.guardianLinkConfirmer.findUniqueOrThrow({ where: { schoolId_userId: { schoolId, userId } } }),
        );
      }
      throw err;
    }
  }

  async removeConfirmer(callerId: string, schoolId: string, userId: string) {
    this.assertUuids(schoolId, userId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const result = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.guardianLinkConfirmer.deleteMany({ where: { schoolId, userId } }),
    );
    if (result.count === 0) {
      throw new NotFoundException('This staff member does not have the right to confirm Guardian links here.');
    }
    return { removed: true };
  }

  // ---------------------------------------------------------------------------

  /**
   * Throws unless the caller may confirm at this School, and says which minors
   * they cover: 'all' for the owner, and for any confirmer in a School with no
   * branches; otherwise the branches of their current Instructor/Branch Staff
   * grants there (Decision 168). A right without a current staff grant counts
   * for nothing.
   */
  private async confirmerCoverage(callerId: string, schoolId: string): Promise<'all' | string[]> {
    const coverage = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const owner = await tx.roleGrant.findFirst({
        where: { userId: callerId, schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
        select: { id: true },
      });
      if (owner) return 'all' as const;
      const [right, staffGrants] = await Promise.all([
        tx.guardianLinkConfirmer.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: { id: true } }),
        tx.roleGrant.findMany({
          where: { userId: callerId, schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null },
          select: { branchId: true },
        }),
      ]);
      if (!right || staffGrants.length === 0) return null;
      // Under the caller's context, Branch RLS shows staff at least their own
      // branch, so any row means the School has branches — same reasoning as
      // GradingService.assertBranchCoversStudent().
      const anyBranch = await tx.branch.findFirst({ where: { schoolId }, select: { id: true } });
      if (!anyBranch) return 'all' as const;
      return staffGrants.map((g) => g.branchId).filter((id): id is string => id !== null);
    });
    if (coverage === null) {
      throw new ForbiddenException(
        "Only this School's Owner/Manager, or staff the owner has allowed, may confirm Guardian links.",
      );
    }
    return coverage;
  }

  /** The subset of `studentIds` whose home branch at this School is covered. */
  private async coveredStudentIds(schoolId: string, studentIds: string[], coverage: 'all' | string[]): Promise<string[]> {
    if (coverage === 'all' || studentIds.length === 0) return studentIds;
    if (coverage.length === 0) return [];
    const homes = await this.prismaJobs.studentHomeBranch.findMany({
      where: { schoolId, studentId: { in: studentIds }, branchId: { in: coverage } },
      select: { studentId: true },
    });
    return homes.map((h) => h.studentId);
  }

  private async enrolledStudentIds(schoolId: string): Promise<string[]> {
    const grants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId, role: 'STUDENT', revokedAt: null },
      select: { userId: true },
    });
    return [...new Set(grants.map((g) => g.userId))];
  }

  private async isEnrolled(studentId: string, schoolId: string): Promise<boolean> {
    const grant = await this.prismaJobs.roleGrant.findFirst({
      where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null },
      select: { id: true },
    });
    return Boolean(grant);
  }

  private assertUuids(...ids: string[]): void {
    if (ids.some((id) => !UUID_PATTERN.test(id))) {
      throw new BadRequestException('schoolId, userId and linkId must be valid UUIDs');
    }
  }
}
