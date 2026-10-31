import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';

const ROSTER_NOT_FOUND = 'Roster not found';
const ROSTER_EXISTS = 'This School already has a roster with that name.';
const TOO_MANY_ROSTERS = 'This School already has 100 rosters. Delete one before adding another.';
const NOT_ON_ROSTER = 'This student is not on this roster.';
/** Existing messages (SchoolsService, TenantAuthorizationService), already translated. */
const NOT_A_STUDENT = 'This person is not a Student at this School.';
const NOT_YOUR_BRANCH = 'This student belongs to a branch you are not assigned to.';
const NO_HOME_BRANCH = 'This student has no home branch yet. Only the School owner can see or grade them until one is assigned.';
/** Most rosters one School can have (not set by a decision). */
export const MAX_SCHOOL_ROSTERS = 100;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Rosters (Decision 317 item 6): named lists of members for staff, to take
 * attendance or filter the Students list. Being on a roster doesn't change who
 * can book (Decision 319 item 2): nothing in booking reads these tables.
 * Staff-only: there is no member-facing endpoint, and the tables have no
 * grant to the app connection.
 *
 * Who: the decision says "for staff" and no more, so the same rule as the
 * Students page:
 * - Any staff at the School read the list of rosters.
 * - Who's on a roster (the Students list's and roll call's filter) is read by
 *   staff who can read the Students list (the owner, coaches, Branch Staff
 *   with the Students or Bookings switch), and only for the current students
 *   they cover (their own branches' students; the owner every student).
 * - Creating, renaming and deleting rosters, and adding and removing members,
 *   is for the staff who can edit students (the owner, coaches, Branch Staff
 *   with the Students switch); members only among the students they cover.
 *
 * Read and written on the jobs connection after these checks. A (rosterId,
 * schoolId) foreign key keeps a roster on its own School's students.
 */
@Injectable()
export class RostersService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** The School's rosters, by name, each with how many of its current
   * students the caller covers. */
  async list(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const rosters = await this.prismaJobs.roster.findMany({ where: { schoolId }, select: { id: true, name: true } });
    const members = await this.prismaJobs.rosterMember.findMany({ where: { schoolId }, select: { rosterId: true, studentId: true } });
    const visible = await this.visibleStudents(callerId, schoolId, [...new Set(members.map((m) => m.studentId))]);
    const counts = new Map<string, number>();
    for (const m of members) if (visible.has(m.studentId)) counts.set(m.rosterId, (counts.get(m.rosterId) ?? 0) + 1);
    return { items: rosters.map((r) => ({ id: r.id, name: r.name, memberCount: counts.get(r.id) ?? 0 })).sort(byName) };
  }

  async create(callerId: string, schoolId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    if (await this.findByName(schoolId, name)) throw new ConflictException(ROSTER_EXISTS);
    if ((await this.prismaJobs.roster.count({ where: { schoolId } })) >= MAX_SCHOOL_ROSTERS) throw new ConflictException(TOO_MANY_ROSTERS);
    try {
      const row = await this.prismaJobs.roster.create({ data: { id: randomUUID(), schoolId, name }, select: { id: true, name: true } });
      return { ...row, memberCount: 0 };
    } catch (err) {
      throw this.duplicateOr(err);
    }
  }

  async rename(callerId: string, schoolId: string, rosterId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findRoster(schoolId, rosterId);
    const clash = await this.findByName(schoolId, name);
    if (clash && clash.id !== rosterId) throw new ConflictException(ROSTER_EXISTS);
    try {
      await this.prismaJobs.roster.update({ where: { id: rosterId }, data: { name } });
    } catch (err) {
      throw this.duplicateOr(err);
    }
    const { studentIds } = await this.membersFor(callerId, schoolId, rosterId);
    return { id: rosterId, name, memberCount: studentIds.length };
  }

  /** Deleting a roster takes everyone off it. Nobody's bookings change. */
  async remove(callerId: string, schoolId: string, rosterId: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findRoster(schoolId, rosterId);
    await this.prismaJobs.roster.delete({ where: { id: rosterId } });
  }

  /** Who's on the roster: the current students the caller covers. */
  async students(callerId: string, schoolId: string, rosterId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    // The Students list's own gate (Decision 387): students or bookings.
    if (!(await this.tenantAuth.staffMay(callerId, schoolId, 'bookings'))) {
      await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    }
    await this.findRoster(schoolId, rosterId);
    return this.membersFor(callerId, schoolId, rosterId);
  }

  /** Adds current students of this School that the caller covers. Students
   * already on it stay as they are. All or nothing. */
  async addStudents(callerId: string, schoolId: string, rosterId: string, studentIds: string[]) {
    await this.assertMayManage(callerId, schoolId);
    await this.findRoster(schoolId, rosterId);
    const ids = [...new Set(studentIds)];
    const enrolled = await this.enrolled(schoolId, ids);
    if (ids.some((id) => !enrolled.has(id))) throw new NotFoundException(NOT_A_STUDENT);
    await this.assertCovers(callerId, schoolId, ids);
    await this.prismaJobs.rosterMember.createMany({ data: ids.map((studentId) => ({ rosterId, schoolId, studentId })), skipDuplicates: true });
    return this.membersFor(callerId, schoolId, rosterId);
  }

  /** Takes one student off. Also works for someone who has since left the
   * School, as long as the caller covers them. */
  async removeStudent(callerId: string, schoolId: string, rosterId: string, studentId: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findRoster(schoolId, rosterId);
    await this.assertCovers(callerId, schoolId, [studentId]);
    const { count } = await this.prismaJobs.rosterMember.deleteMany({ where: { rosterId, schoolId, studentId } });
    if (count === 0) throw new NotFoundException(NOT_ON_ROSTER);
  }

  private async membersFor(callerId: string, schoolId: string, rosterId: string) {
    const rows = await this.prismaJobs.rosterMember.findMany({ where: { rosterId, schoolId }, select: { studentId: true }, orderBy: { addedAt: 'asc' } });
    const visible = await this.visibleStudents(callerId, schoolId, rows.map((r) => r.studentId));
    return { studentIds: rows.map((r) => r.studentId).filter((id) => visible.has(id)) };
  }

  /** Of these, the current students of the School that the caller covers. */
  private async visibleStudents(callerId: string, schoolId: string, studentIds: string[]): Promise<Set<string>> {
    if (studentIds.length === 0) return new Set();
    const enrolled = await this.enrolled(schoolId, studentIds);
    if (await this.tenantAuth.isSchoolOwner(callerId, schoolId)) return enrolled;
    const coverage = await this.tenantAuth.staffBranchCoverage(callerId, schoolId);
    if (!coverage.hasBranches) return enrolled;
    const homes = await this.prismaJobs.studentHomeBranch.findMany({
      where: { schoolId, studentId: { in: [...enrolled] }, branchId: { in: [...coverage.branchIds] } },
      select: { studentId: true },
    });
    return new Set(homes.map((h) => h.studentId));
  }

  /** The ones holding a current STUDENT grant at this School. */
  private async enrolled(schoolId: string, studentIds: string[]): Promise<Set<string>> {
    const grants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId, role: 'STUDENT', revokedAt: null, userId: { in: studentIds } },
      select: { userId: true },
    });
    return new Set(grants.map((g) => g.userId));
  }

  /** The owner covers everyone; other staff their own branches' students
   * (TenantAuthorizationService.staffBranchCoverage). */
  private async assertCovers(callerId: string, schoolId: string, studentIds: string[]) {
    if (await this.tenantAuth.isSchoolOwner(callerId, schoolId)) return;
    const coverage = await this.tenantAuth.staffBranchCoverage(callerId, schoolId);
    if (!coverage.hasBranches) return;
    const homes = await this.prismaJobs.studentHomeBranch.findMany({ where: { schoolId, studentId: { in: studentIds } }, select: { studentId: true, branchId: true } });
    const homeOf = new Map(homes.map((h) => [h.studentId, h.branchId]));
    for (const id of studentIds) {
      const home = homeOf.get(id);
      if (!home) throw new ForbiddenException(NO_HOME_BRANCH);
      if (!coverage.branchIds.has(home)) throw new ForbiddenException(NOT_YOUR_BRANCH);
    }
  }

  /** The staff who can edit students (Decision 387's Students switch; coaches
   * and the owner always), at a School that isn't closed. */
  private async assertMayManage(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
  }

  private async findRoster(schoolId: string, rosterId: string) {
    const roster = await this.prismaJobs.roster.findFirst({ where: { id: rosterId, schoolId }, select: { id: true, name: true } });
    if (!roster) throw new NotFoundException(ROSTER_NOT_FOUND);
    return roster;
  }

  /** Names are matched ignoring case, so "Comp team" and "comp team" are one roster. */
  private findByName(schoolId: string, name: string) {
    return this.prismaJobs.roster.findFirst({ where: { schoolId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
  }

  private duplicateOr(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? new ConflictException(ROSTER_EXISTS) : err;
  }
}
