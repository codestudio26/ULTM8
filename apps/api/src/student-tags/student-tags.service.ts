import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import type { AddStudentTagDto } from './dto/student-tag.dto';

const TAG_NOT_FOUND = 'Tag not found';
const TAG_EXISTS = 'This School already has a tag with that name.';
const TOO_MANY_TAGS = 'This School already has 100 tags. Delete one before adding another.';
const TAG_OR_NAME = 'Choose a tag or type a new one.';
/** Most tags one School can have (backlog 5.4; not set by a decision). */
export const MAX_SCHOOL_TAGS = 100;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Tags on students (backlog 5.4; Decision 315 item 7): a list each School
 * manages, staff can add a new tag while tagging, and members never see their
 * tags. There is deliberately no member-facing endpoint here, and the tables
 * have no grant to the app connection.
 *
 * Who: Decision 315 doesn't say, so the staff who can edit the student's
 * details (SchoolsService.assertStaffCanEditStudent: the owner, coaches, and
 * Branch Staff with the Students switch, for the students they cover) tag and
 * untag. The same staff (the owner, coaches, Branch Staff with the Students
 * switch) rename and delete tags in the School's list. Any staff at the
 * School read the list.
 *
 * A tag on a student is kept while the student's account exists and erased
 * with it (the row cascades with the User, like StudentNote), and goes when
 * the tag is deleted from the list. Read and written on the jobs connection
 * after these checks.
 */
@Injectable()
export class StudentTagsService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schools: SchoolsService,
  ) {}

  /** The School's list, by name, with how many students have each tag. */
  async listTags(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const rows = await this.prismaJobs.schoolTag.findMany({
      where: { schoolId },
      select: { id: true, name: true, _count: { select: { students: true } } },
    });
    return { items: rows.map((r) => ({ id: r.id, name: r.name, studentCount: r._count.students })).sort(byName) };
  }

  async createTag(callerId: string, schoolId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    const tag = await this.insertTag(schoolId, name);
    return { ...tag, studentCount: 0 };
  }

  async renameTag(callerId: string, schoolId: string, tagId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findTag(schoolId, tagId);
    const clash = await this.findByName(schoolId, name);
    if (clash && clash.id !== tagId) throw new ConflictException(TAG_EXISTS);
    try {
      const row = await this.prismaJobs.schoolTag.update({
        where: { id: tagId },
        data: { name },
        select: { id: true, name: true, _count: { select: { students: true } } },
      });
      return { id: row.id, name: row.name, studentCount: row._count.students };
    } catch (err) {
      throw this.duplicateOr(err);
    }
  }

  /** Deleting a tag takes it off every student. */
  async deleteTag(callerId: string, schoolId: string, tagId: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findTag(schoolId, tagId);
    await this.prismaJobs.schoolTag.delete({ where: { id: tagId } });
  }

  /** The students with this tag, for the Students list's tag filter. Staff
   * other than the owner get only the students they cover. */
  async taggedStudents(callerId: string, schoolId: string, tagId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    await this.findTag(schoolId, tagId);
    const rows = await this.prismaJobs.studentTag.findMany({ where: { schoolId, tagId }, select: { studentId: true } });
    let studentIds = rows.map((r) => r.studentId);
    if (!(await this.tenantAuth.isSchoolOwner(callerId, schoolId))) {
      const coverage = await this.tenantAuth.staffBranchCoverage(callerId, schoolId);
      if (coverage.hasBranches) {
        const homes = await this.prismaJobs.studentHomeBranch.findMany({
          where: { schoolId, studentId: { in: studentIds }, branchId: { in: [...coverage.branchIds] } },
          select: { studentId: true },
        });
        const covered = new Set(homes.map((h) => h.studentId));
        studentIds = studentIds.filter((id) => covered.has(id));
      }
    }
    return { studentIds };
  }

  async studentTags(callerId: string, schoolId: string, studentId: string) {
    await this.schools.assertStaffCanEditStudent(callerId, schoolId, studentId);
    return this.tagsOf(schoolId, studentId);
  }

  /** Tag a student with a tag from the list, or with a new one typed while
   * tagging (Decision 315 item 7). A tag from another School is never found. */
  async addToStudent(callerId: string, schoolId: string, studentId: string, dto: AddStudentTagDto) {
    if (!dto.tagId === !dto.name) throw new BadRequestException(TAG_OR_NAME);
    await this.schools.assertStaffCanEditStudent(callerId, schoolId, studentId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const tag = dto.tagId ? await this.findTag(schoolId, dto.tagId) : ((await this.findByName(schoolId, dto.name!)) ?? (await this.insertTag(schoolId, dto.name!)));
    await this.prismaJobs.studentTag.createMany({ data: [{ tagId: tag.id, schoolId, studentId }], skipDuplicates: true });
    return this.tagsOf(schoolId, studentId);
  }

  async removeFromStudent(callerId: string, schoolId: string, studentId: string, tagId: string) {
    await this.schools.assertStaffCanEditStudent(callerId, schoolId, studentId);
    const { count } = await this.prismaJobs.studentTag.deleteMany({ where: { schoolId, studentId, tagId } });
    if (count === 0) throw new NotFoundException(TAG_NOT_FOUND);
  }

  private async tagsOf(schoolId: string, studentId: string) {
    const rows = await this.prismaJobs.studentTag.findMany({ where: { schoolId, studentId }, select: { tag: { select: { id: true, name: true } } } });
    return { items: rows.map((r) => r.tag).sort(byName) };
  }

  /** The same staff who can edit a student's details, School-wide. */
  private async assertMayManage(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
  }

  private async findTag(schoolId: string, tagId: string) {
    const tag = await this.prismaJobs.schoolTag.findFirst({ where: { id: tagId, schoolId }, select: { id: true, name: true } });
    if (!tag) throw new NotFoundException(TAG_NOT_FOUND);
    return tag;
  }

  /** Names are matched ignoring case, so "Kids" and "kids" are one tag. */
  private findByName(schoolId: string, name: string) {
    return this.prismaJobs.schoolTag.findFirst({ where: { schoolId, name: { equals: name, mode: 'insensitive' } }, select: { id: true, name: true } });
  }

  private async insertTag(schoolId: string, name: string) {
    if (await this.findByName(schoolId, name)) throw new ConflictException(TAG_EXISTS);
    if ((await this.prismaJobs.schoolTag.count({ where: { schoolId } })) >= MAX_SCHOOL_TAGS) throw new ConflictException(TOO_MANY_TAGS);
    try {
      return await this.prismaJobs.schoolTag.create({ data: { id: randomUUID(), schoolId, name }, select: { id: true, name: true } });
    } catch (err) {
      throw this.duplicateOr(err);
    }
  }

  private duplicateOr(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? new ConflictException(TAG_EXISTS) : err;
  }
}
