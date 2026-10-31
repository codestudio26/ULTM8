import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomMemberFieldType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { CUSTOM_TEXT_VALUE_MAX, type CustomMemberFieldCreateDto, type CustomMemberFieldUpdateDto, type SetCustomFieldValueDto } from './dto/custom-member-field.dto';

/** Most fields one School can have (not set by a decision). */
export const MAX_CUSTOM_FIELDS = 50;
/** Most statuses one School can have (not set by a decision). */
export const MAX_CUSTOM_STATUSES = 50;

const FIELD_SELECT = { id: true, name: true, type: true, options: true, position: true } as const;
type FieldRow = Prisma.CustomMemberFieldGetPayload<{ select: typeof FIELD_SELECT }>;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const byPosition = (a: FieldRow, b: FieldRow) => a.position - b.position || byName(a, b);
const sameText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

/** A number as staff type it: optional minus, up to 15 digits, up to 6 decimals. */
const NUMBER_RE = /^-?\d{1,15}(\.\d{1,6})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Custom member fields and statuses (Decision 315 item 14): each School adds
 * its own fields (text, number, date, drop-down, yes/no) and its own member
 * statuses (up to 50 characters), shown on the student's page and as list
 * filters.
 *
 * Who: Decision 315 doesn't say, so this follows tags (Decision 315 item 7,
 * StudentTagsService): staff-only, with no member-facing endpoint, and the
 * tables have no grant to the app connection. The staff who can edit the
 * student's details (SchoolsService.assertStaffCanEditStudent) read and set a
 * student's values and status; the owner, coaches and Branch Staff with the
 * Students switch manage the School's lists; any staff at the School read the
 * lists.
 *
 * Deleting a field deletes its values and deleting a status clears it from
 * every student (both by cascade). A student's values and status are erased
 * with the account (the rows cascade with the User), and the School's purge
 * takes everything (the rows cascade with the School).
 */
@Injectable()
export class CustomMemberFieldsService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schools: SchoolsService,
  ) {}

  // ---- Fields ----

  async listFields(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    return { items: await this.fieldsOf(schoolId) };
  }

  async createField(callerId: string, schoolId: string, dto: CustomMemberFieldCreateDto) {
    await this.assertMayManage(callerId, schoolId);
    const options = this.checkOptions(dto.type, dto.options);
    await this.assertFieldNameFree(schoolId, dto.name);
    const existing = await this.prismaJobs.customMemberField.findMany({ where: { schoolId }, select: { position: true } });
    if (existing.length >= MAX_CUSTOM_FIELDS) throw new ConflictException('This School already has 50 member fields. Delete one before adding another.');
    const position = existing.reduce((max, f) => Math.max(max, f.position + 1), 0);
    try {
      return await this.prismaJobs.customMemberField.create({
        data: { id: randomUUID(), schoolId, name: dto.name, type: dto.type, options, position },
        select: FIELD_SELECT,
      });
    } catch (err) {
      throw this.duplicateFieldOr(err);
    }
  }

  /** Rename a field and, for a drop-down, change its choices. A student whose
   * value is no longer a choice loses it. The type never changes. */
  async updateField(callerId: string, schoolId: string, fieldId: string, dto: CustomMemberFieldUpdateDto) {
    await this.assertMayManage(callerId, schoolId);
    const field = await this.findField(schoolId, fieldId);
    if (dto.name !== undefined) await this.assertFieldNameFree(schoolId, dto.name, fieldId);
    const options = dto.options !== undefined ? this.checkOptions(field.type, dto.options) : undefined;
    try {
      return await this.prismaJobs.$transaction(async (tx) => {
        const row = await tx.customMemberField.update({ where: { id: fieldId }, data: { name: dto.name, options }, select: FIELD_SELECT });
        if (options) {
          // A choice whose letter case changed keeps its students.
          for (const option of options) {
            await tx.customMemberFieldValue.updateMany({ where: { schoolId, fieldId, value: { equals: option, mode: 'insensitive' } }, data: { value: option } });
          }
          await tx.customMemberFieldValue.deleteMany({ where: { schoolId, fieldId, value: { notIn: options } } });
        }
        return row;
      });
    } catch (err) {
      throw this.duplicateFieldOr(err);
    }
  }

  /** Deleting a field deletes every student's value for it. */
  async deleteField(callerId: string, schoolId: string, fieldId: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findField(schoolId, fieldId);
    await this.prismaJobs.customMemberField.delete({ where: { id: fieldId } });
  }

  /** The new order: every one of the School's fields, each once. */
  async reorderFields(callerId: string, schoolId: string, fieldIds: string[]) {
    await this.assertMayManage(callerId, schoolId);
    const fields = await this.prismaJobs.customMemberField.findMany({ where: { schoolId }, select: { id: true } });
    const known = new Set(fields.map((f) => f.id));
    if (new Set(fieldIds).size !== fieldIds.length || fieldIds.length !== known.size || fieldIds.some((id) => !known.has(id))) {
      throw new BadRequestException("Send every one of the School's fields, each once.");
    }
    await this.prismaJobs.$transaction(fieldIds.map((id, position) => this.prismaJobs.customMemberField.update({ where: { id }, data: { position } })));
    return { items: await this.fieldsOf(schoolId) };
  }

  // ---- Statuses ----

  async listStatuses(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const rows = await this.prismaJobs.customMemberStatus.findMany({
      where: { schoolId },
      select: { id: true, name: true, _count: { select: { students: true } } },
    });
    return { items: rows.map((r) => ({ id: r.id, name: r.name, studentCount: r._count.students })).sort(byName) };
  }

  async createStatus(callerId: string, schoolId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.assertStatusNameFree(schoolId, name);
    if ((await this.prismaJobs.customMemberStatus.count({ where: { schoolId } })) >= MAX_CUSTOM_STATUSES) {
      throw new ConflictException('This School already has 50 member statuses. Delete one before adding another.');
    }
    try {
      const row = await this.prismaJobs.customMemberStatus.create({ data: { id: randomUUID(), schoolId, name }, select: { id: true, name: true } });
      return { ...row, studentCount: 0 };
    } catch (err) {
      throw this.duplicateStatusOr(err);
    }
  }

  async renameStatus(callerId: string, schoolId: string, statusId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findStatus(schoolId, statusId);
    await this.assertStatusNameFree(schoolId, name, statusId);
    try {
      const row = await this.prismaJobs.customMemberStatus.update({
        where: { id: statusId },
        data: { name },
        select: { id: true, name: true, _count: { select: { students: true } } },
      });
      return { id: row.id, name: row.name, studentCount: row._count.students };
    } catch (err) {
      throw this.duplicateStatusOr(err);
    }
  }

  /** Deleting a status clears it from every student who has it. */
  async deleteStatus(callerId: string, schoolId: string, statusId: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.findStatus(schoolId, statusId);
    await this.prismaJobs.customMemberStatus.delete({ where: { id: statusId } });
  }

  /** Each student's status, for the Students list's Member status filter and
   * column. Staff other than the owner get only the students they cover. */
  async statusAssignments(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    const rows = await this.prismaJobs.studentCustomStatus.findMany({ where: { schoolId }, select: { studentId: true, statusId: true } });
    const covered = await this.coveredOf(callerId, schoolId, rows.map((r) => r.studentId));
    return { items: rows.filter((r) => covered.has(r.studentId)) };
  }

  /** The students whose value for this field matches, for the Students list's
   * Member field filter (Decision 315 item 14: fields are list filters too).
   * A drop-down, yes/no, number or date matches the value exactly (a number
   * by value, so 72.50 finds 72.5); text matches when it contains the value,
   * ignoring case. Staff other than the owner get only the students they
   * cover. */
  async fieldMatches(callerId: string, schoolId: string, fieldId: string, raw: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    const field = await this.findField(schoolId, fieldId);
    const value = this.normalise(field, raw);
    if (value === null) throw new BadRequestException('Choose a value to filter by.');
    const rows = await this.prismaJobs.customMemberFieldValue.findMany({
      where: { schoolId, fieldId, value: field.type === CustomMemberFieldType.TEXT ? { contains: value, mode: 'insensitive' } : value },
      select: { studentId: true },
    });
    const covered = await this.coveredOf(callerId, schoolId, rows.map((r) => r.studentId));
    return { studentIds: rows.map((r) => r.studentId).filter((id) => covered.has(id)) };
  }

  // ---- One student ----

  async studentValues(callerId: string, schoolId: string, studentId: string) {
    await this.schools.assertStaffCanEditStudent(callerId, schoolId, studentId);
    return this.valuesOf(schoolId, studentId);
  }

  /** Set or clear the student's values for the fields listed (null or empty
   * clears). Every value is checked against its field's type first; nothing
   * is saved if one is wrong. */
  async setStudentValues(callerId: string, schoolId: string, studentId: string, values: SetCustomFieldValueDto[]) {
    await this.schools.assertStaffCanEditStudent(callerId, schoolId, studentId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    if (new Set(values.map((v) => v.fieldId)).size !== values.length) throw new BadRequestException('Each field can be set only once.');
    const fields = await this.prismaJobs.customMemberField.findMany({ where: { schoolId, id: { in: values.map((v) => v.fieldId) } }, select: FIELD_SELECT });
    const byId = new Map(fields.map((f) => [f.id, f]));
    const writes = values.map((v) => {
      const field = byId.get(v.fieldId);
      if (!field) throw new NotFoundException('Field not found');
      return { fieldId: field.id, value: this.normalise(field, v.value) };
    });
    await this.prismaJobs.$transaction(
      writes.map((w) =>
        w.value === null
          ? this.prismaJobs.customMemberFieldValue.deleteMany({ where: { schoolId, studentId, fieldId: w.fieldId } })
          : this.prismaJobs.customMemberFieldValue.upsert({
              where: { fieldId_studentId: { fieldId: w.fieldId, studentId } },
              create: { fieldId: w.fieldId, schoolId, studentId, value: w.value },
              update: { value: w.value },
            }),
      ),
    );
    return this.valuesOf(schoolId, studentId);
  }

  /** Give the student one of the School's statuses, or none. */
  async setStudentStatus(callerId: string, schoolId: string, studentId: string, statusId: string | null) {
    await this.schools.assertStaffCanEditStudent(callerId, schoolId, studentId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    if (statusId === null) {
      await this.prismaJobs.studentCustomStatus.deleteMany({ where: { schoolId, studentId } });
    } else {
      await this.findStatus(schoolId, statusId);
      await this.prismaJobs.studentCustomStatus.upsert({
        where: { schoolId_studentId: { schoolId, studentId } },
        create: { schoolId, studentId, statusId },
        update: { statusId },
      });
    }
    return this.valuesOf(schoolId, studentId);
  }

  // ---- Helpers ----

  /** Of these students, the ones the caller covers: all of them for the owner
   * or when the School has no branches, else those whose home branch the
   * caller covers (as the tag filter does). */
  private async coveredOf(callerId: string, schoolId: string, studentIds: string[]): Promise<Set<string>> {
    if (studentIds.length === 0 || (await this.tenantAuth.isSchoolOwner(callerId, schoolId))) return new Set(studentIds);
    const coverage = await this.tenantAuth.staffBranchCoverage(callerId, schoolId);
    if (!coverage.hasBranches) return new Set(studentIds);
    const homes = await this.prismaJobs.studentHomeBranch.findMany({
      where: { schoolId, studentId: { in: studentIds }, branchId: { in: [...coverage.branchIds] } },
      select: { studentId: true },
    });
    return new Set(homes.map((h) => h.studentId));
  }

  private async fieldsOf(schoolId: string) {
    return (await this.prismaJobs.customMemberField.findMany({ where: { schoolId }, select: FIELD_SELECT })).sort(byPosition);
  }

  private async valuesOf(schoolId: string, studentId: string) {
    const [fields, values, status] = await Promise.all([
      this.fieldsOf(schoolId),
      this.prismaJobs.customMemberFieldValue.findMany({ where: { schoolId, studentId }, select: { fieldId: true, value: true } }),
      this.prismaJobs.studentCustomStatus.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { statusId: true } }),
    ]);
    const valueOf = new Map(values.map((v) => [v.fieldId, v.value]));
    return { fields: fields.map((f) => ({ ...f, value: valueOf.get(f.id) ?? null })), statusId: status?.statusId ?? null };
  }

  /** A value in its field type's stored form, or null to clear it. */
  private normalise(field: FieldRow, raw: string | null): string | null {
    const value = raw === null ? '' : raw.trim();
    if (value === '') return null;
    switch (field.type) {
      case CustomMemberFieldType.TEXT:
        if (value.length > CUSTOM_TEXT_VALUE_MAX) throw new BadRequestException('A value can be at most 500 characters.');
        return value;
      case CustomMemberFieldType.NUMBER:
        if (!NUMBER_RE.test(value)) throw new BadRequestException('This field takes a number.');
        return String(Number(value));
      case CustomMemberFieldType.DATE: {
        const m = DATE_RE.exec(value);
        const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
        if (!m || !date || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('This field takes a date (YYYY-MM-DD).');
        return value;
      }
      case CustomMemberFieldType.DROPDOWN: {
        const choice = field.options.find((o) => sameText(o, value));
        if (choice === undefined) throw new BadRequestException("Pick one of the field's choices.");
        return choice;
      }
      case CustomMemberFieldType.YES_NO:
        if (value !== 'true' && value !== 'false') throw new BadRequestException('This field takes yes or no.');
        return value;
    }
  }

  /** A drop-down needs its own, distinct choices; no other type has any. */
  private checkOptions(type: CustomMemberFieldType, options: string[] | undefined): string[] {
    if (type !== CustomMemberFieldType.DROPDOWN) {
      if (options && options.length > 0) throw new BadRequestException('Only a drop-down has choices.');
      return [];
    }
    if (!options || options.length === 0) throw new BadRequestException('A drop-down needs at least one choice.');
    if (options.some((o, i) => options.findIndex((p) => sameText(p, o)) !== i)) throw new BadRequestException("A drop-down can't have the same choice twice.");
    return options;
  }

  /** The same staff who can edit a student's details, School-wide. */
  private async assertMayManage(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
  }

  private async findField(schoolId: string, fieldId: string) {
    const field = await this.prismaJobs.customMemberField.findFirst({ where: { id: fieldId, schoolId }, select: FIELD_SELECT });
    if (!field) throw new NotFoundException('Field not found');
    return field;
  }

  private async findStatus(schoolId: string, statusId: string) {
    const status = await this.prismaJobs.customMemberStatus.findFirst({ where: { id: statusId, schoolId }, select: { id: true } });
    if (!status) throw new NotFoundException('Status not found');
    return status;
  }

  /** Names are matched ignoring case, so "Belt size" and "belt size" are one field. */
  private async assertFieldNameFree(schoolId: string, name: string, exceptId?: string) {
    const clash = await this.prismaJobs.customMemberField.findFirst({ where: { schoolId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ConflictException('This School already has a member field with that name.');
  }

  private async assertStatusNameFree(schoolId: string, name: string, exceptId?: string) {
    const clash = await this.prismaJobs.customMemberStatus.findFirst({ where: { schoolId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ConflictException('This School already has a member status with that name.');
  }

  private duplicateFieldOr(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? new ConflictException('This School already has a member field with that name.') : err;
  }

  private duplicateStatusOr(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? new ConflictException('This School already has a member status with that name.') : err;
  }
}
