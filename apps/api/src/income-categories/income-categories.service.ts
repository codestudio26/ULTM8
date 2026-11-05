import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';

const NOT_FOUND = 'Income category not found';
const EXISTS = 'This School already has an income category with that name.';
const TOO_MANY = 'This School already has 100 income categories. Delete one before adding another.';
const IN_USE = 'This income category is used by a plan or a charge, so it can\'t be deleted. Rename it instead.';
const NOT_OF_SCHOOL = 'Choose an income category from this School\'s list.';
/** Most income categories one School can have (not set by a decision). */
export const MAX_INCOME_CATEGORIES = 100;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Income categories (Decision 316 item 10): each School names its own list,
 * a membership plan and a staff-created or recurring charge can each carry
 * one, and the Transactions export shows it. No accounting codes and no
 * accounting integration yet (Decisions 316, 338).
 *
 * Who: the School owner manages the list (the decision says "the School
 * names"; plans are owner-only too). Any staff at the School read it, so
 * staff who create charges can pick one. Members never see it. A category in
 * use can't be deleted (the foreign keys block it too), only renamed.
 *
 * Read and written on the jobs connection after these checks; the app
 * connection has no grant on the table.
 */
@Injectable()
export class IncomeCategoriesService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** The School's list, by name, with how many plans and charges use each. */
  async list(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const rows = await this.prismaJobs.incomeCategory.findMany({ where: { schoolId }, select: SELECT });
    return { items: rows.map(shape).sort(byName) };
  }

  async create(callerId: string, schoolId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    if (await this.findByName(schoolId, name)) throw new ConflictException(EXISTS);
    if ((await this.prismaJobs.incomeCategory.count({ where: { schoolId } })) >= MAX_INCOME_CATEGORIES) throw new ConflictException(TOO_MANY);
    try {
      return shape(await this.prismaJobs.incomeCategory.create({ data: { id: randomUUID(), schoolId, name }, select: SELECT }));
    } catch (err) {
      throw duplicateOr(err);
    }
  }

  async rename(callerId: string, schoolId: string, categoryId: string, name: string) {
    await this.assertMayManage(callerId, schoolId);
    await this.find(schoolId, categoryId);
    const clash = await this.findByName(schoolId, name);
    if (clash && clash.id !== categoryId) throw new ConflictException(EXISTS);
    try {
      return shape(await this.prismaJobs.incomeCategory.update({ where: { id: categoryId }, data: { name }, select: SELECT }));
    } catch (err) {
      throw duplicateOr(err);
    }
  }

  /** Only a category nothing uses. */
  async remove(callerId: string, schoolId: string, categoryId: string) {
    await this.assertMayManage(callerId, schoolId);
    const found = await this.prismaJobs.incomeCategory.findFirst({ where: { id: categoryId, schoolId }, select: SELECT });
    if (!found) throw new NotFoundException(NOT_FOUND);
    if (shape(found).useCount > 0) throw new ConflictException(IN_USE);
    try {
      await this.prismaJobs.incomeCategory.delete({ where: { id: categoryId } });
    } catch (err) {
      // Something started using it between the count and the delete.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') throw new ConflictException(IN_USE);
      throw err;
    }
  }

  /**
   * For the plan and charge writes: `undefined` leaves the field alone, `null`
   * clears it, and an id must be one of this School's categories (a category
   * of another School is refused here, and by the hand-written foreign key).
   */
  async resolveForSchool(schoolId: string, categoryId: string | null | undefined): Promise<string | null | undefined> {
    if (categoryId === undefined || categoryId === null) return categoryId;
    const found = await this.prismaJobs.incomeCategory.findFirst({ where: { id: categoryId, schoolId }, select: { id: true } });
    if (!found) throw new BadRequestException(NOT_OF_SCHOOL);
    return found.id;
  }

  /** The names of these categories, for rows the caller was already allowed to read. */
  async namesFor(schoolId: string, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
    const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const rows = await this.prismaJobs.incomeCategory.findMany({ where: { schoolId, id: { in: wanted } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async assertMayManage(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
  }

  private async find(schoolId: string, categoryId: string) {
    const found = await this.prismaJobs.incomeCategory.findFirst({ where: { id: categoryId, schoolId }, select: { id: true } });
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  /** Names are matched ignoring case, so "Kids" and "kids" are one category. */
  private findByName(schoolId: string, name: string) {
    return this.prismaJobs.incomeCategory.findFirst({ where: { schoolId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
  }
}

const SELECT = {
  id: true,
  name: true,
  _count: { select: { membershipPlans: true, charges: true, recurringCharges: true } },
} satisfies Prisma.IncomeCategorySelect;

function shape(r: Prisma.IncomeCategoryGetPayload<{ select: typeof SELECT }>) {
  return { id: r.id, name: r.name, useCount: r._count.membershipPlans + r._count.charges + r._count.recurringCharges };
}

function duplicateOr(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? new ConflictException(EXISTS) : err;
}
