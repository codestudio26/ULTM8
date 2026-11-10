import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { NO_PERMISSION } from '../tenant-authorization.service';
import {
  FranchiseOverviewMonthDto,
  FranchiseOverviewResponseDto,
  FranchiseOverviewRevenueDto,
  FranchiseOverviewRevenueMonthDto,
  FranchiseOverviewSchoolDto,
  FranchiseOverviewTotalsDto,
} from './dto/franchise-overview-response.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SchoolTotalsRow = {
  schoolId: string;
  name: string;
  archivedAt: Date | null;
  timeZone: string;
  enrolledStudents: number;
  activeStudents: number;
  checkInsLast30Days: number;
};
type SchoolMonthRow = { schoolId: string; month: string; checkIns: number; newStudents: number; cancelled: number };
type SchoolRevenueRow = {
  schoolId: string;
  month: string;
  currency: string;
  charges: bigint | number;
  memberships: bigint | number;
  fees: bigint | number;
  surcharges: bigint | number;
};

type RevenueLine = Omit<FranchiseOverviewRevenueMonthDto, 'month'>;
const emptyLine = (): RevenueLine => ({ memberships: 0, charges: 0, fees: 0, surcharges: 0, total: 0 });
function addLine(into: RevenueLine, from: RevenueLine) {
  into.memberships += from.memberships;
  into.charges += from.charges;
  into.fees += from.fees;
  into.surcharges += from.surcharges;
  into.total += from.total;
}

/**
 * Decision 450 item 1: the Franchise owner's read-only overview of its member
 * Schools' totals (students, attendance, revenue, growth), per School and
 * added up across the Franchise.
 *
 * The figures come from three SECURITY DEFINER functions (migration
 * 20270405000001_franchise_overview), called in the caller's own context:
 * each checks from `app.current_user_id` that the caller owns the Franchise
 * and reads only the Schools that are its members now, and returns counts and
 * sums only. They follow each School's own reports (Dashboard / Growth,
 * Attendance statistics, the billing overview), so a member School's owner
 * and the Franchise owner see the same numbers.
 *
 * Who gets what (Decision 449 item 6): the Franchise's owner the overview;
 * anyone else linked to the Franchise (a role, now or before, at the
 * Franchise or at one of its member Schools, or a Guardian of a student
 * there) 403 "You don't have permission to view this page"; anyone with no
 * link at all 404, so ULTM8 never confirms the Franchise exists to another
 * business.
 */
@Injectable()
export class FranchiseOverviewService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
  ) {}

  /** 404 for a stranger, 403 for someone linked to the Franchise who isn't its owner. */
  private async refuseUnlessOwner(callerId: string, franchiseId: string): Promise<void> {
    if (!UUID_PATTERN.test(franchiseId)) throw new NotFoundException('Franchise not found');
    const { grants, wardIds } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      grants: await tx.roleGrant.findMany({
        where: { userId: callerId, OR: [{ franchiseId }, { schoolId: { not: null } }] },
        select: { role: true, franchiseId: true, schoolId: true, revokedAt: true },
      }),
      wardIds: (await tx.guardianLink.findMany({ where: { guardianId: callerId, revokedAt: null }, select: { studentId: true } })).map((l) => l.studentId),
    }));
    if (grants.some((g) => g.franchiseId === franchiseId && g.role === 'FRANCHISE_OWNER' && !g.revokedAt)) return;

    // Linked to the Franchise: read on the jobs connection, after the
    // caller's own grants were read in their context, and only to choose
    // between 403 and 404 (nothing from it is returned).
    let linked = grants.some((g) => g.franchiseId === franchiseId);
    const schoolIds = [...new Set(grants.map((g) => g.schoolId).filter((id): id is string => !!id))];
    if (!linked && schoolIds.length > 0) {
      linked = (await this.prismaJobs.school.count({ where: { id: { in: schoolIds }, franchiseId } })) > 0;
    }
    if (!linked && wardIds.length > 0) {
      const wardSchools = await this.prismaJobs.roleGrant.findMany({
        where: { userId: { in: wardIds }, role: 'STUDENT', schoolId: { not: null } },
        select: { schoolId: true },
        distinct: ['schoolId'],
      });
      const ids = wardSchools.map((w) => w.schoolId).filter((id): id is string => !!id);
      if (ids.length > 0) linked = (await this.prismaJobs.school.count({ where: { id: { in: ids }, franchiseId } })) > 0;
    }
    if (linked) throw new ForbiddenException(NO_PERMISSION);
    throw new NotFoundException('Franchise not found');
  }

  /** GET /franchises/{id}/overview */
  async overview(callerId: string, franchiseId: string): Promise<FranchiseOverviewResponseDto> {
    await this.refuseUnlessOwner(callerId, franchiseId);

    const [totals, months, revenue] = await this.prismaApp.withTenantContext(callerId, async (tx) => [
      await tx.$queryRaw<SchoolTotalsRow[]>`SELECT * FROM franchise_overview_school_totals(${franchiseId})`,
      await tx.$queryRaw<SchoolMonthRow[]>`SELECT * FROM franchise_overview_school_months(${franchiseId})`,
      await tx.$queryRaw<SchoolRevenueRow[]>`SELECT * FROM franchise_overview_school_revenue(${franchiseId})`,
    ] as const);

    const monthsBySchool = new Map<string, FranchiseOverviewMonthDto[]>();
    for (const m of months) {
      const list = monthsBySchool.get(m.schoolId) ?? [];
      list.push({ month: m.month, checkIns: Number(m.checkIns), newStudents: Number(m.newStudents), cancelled: Number(m.cancelled) });
      monthsBySchool.set(m.schoolId, list);
    }

    const schools: FranchiseOverviewSchoolDto[] = totals.map((s) => {
      const schoolMonths = monthsBySchool.get(s.schoolId) ?? [];
      return {
        schoolId: s.schoolId,
        name: s.name,
        archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
        timeZone: s.timeZone,
        enrolledStudents: Number(s.enrolledStudents),
        activeStudents: Number(s.activeStudents),
        checkInsLast30Days: Number(s.checkInsLast30Days),
        months: schoolMonths,
        revenue: this.revenueFor(
          schoolMonths.map((m) => m.month),
          revenue.filter((r) => r.schoolId === s.schoolId),
        ),
      };
    });

    return { totals: this.addUp(schools), schools };
  }

  /** One School's revenue per currency, each with every one of its months. */
  private revenueFor(monthKeys: string[], rows: SchoolRevenueRow[]): FranchiseOverviewRevenueDto[] {
    const byCurrency = new Map<string, Map<string, RevenueLine>>();
    for (const r of rows) {
      let perMonth = byCurrency.get(r.currency);
      if (!perMonth) {
        perMonth = new Map(monthKeys.map((m) => [m, emptyLine()]));
        byCurrency.set(r.currency, perMonth);
      }
      const line = perMonth.get(r.month);
      if (!line) continue;
      const add = { memberships: Number(r.memberships), charges: Number(r.charges), fees: Number(r.fees), surcharges: Number(r.surcharges), total: 0 };
      add.total = add.memberships + add.charges + add.fees + add.surcharges;
      addLine(line, add);
    }
    return [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, perMonth]) => this.revenueEntry(currency, perMonth));
  }

  private revenueEntry(currency: string, perMonth: Map<string, RevenueLine>): FranchiseOverviewRevenueDto {
    const byMonth = [...perMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, line]) => ({ month, ...line }));
    const sum = emptyLine();
    for (const m of byMonth) addLine(sum, m);
    return { currency, ...sum, byMonth };
  }

  /** The Franchise's totals: counts added up, revenue per currency (never
   * across currencies), months matched by name. */
  private addUp(schools: FranchiseOverviewSchoolDto[]): FranchiseOverviewTotalsDto {
    const months = new Map<string, FranchiseOverviewMonthDto>();
    const revenue = new Map<string, Map<string, RevenueLine>>();
    for (const s of schools) {
      for (const m of s.months) {
        const t = months.get(m.month) ?? { month: m.month, checkIns: 0, newStudents: 0, cancelled: 0 };
        t.checkIns += m.checkIns;
        t.newStudents += m.newStudents;
        t.cancelled += m.cancelled;
        months.set(m.month, t);
      }
    }
    const allMonths = [...months.keys()].sort();
    for (const s of schools) {
      for (const r of s.revenue) {
        let perMonth = revenue.get(r.currency);
        if (!perMonth) {
          perMonth = new Map(allMonths.map((m) => [m, emptyLine()]));
          revenue.set(r.currency, perMonth);
        }
        for (const m of r.byMonth) addLine(perMonth.get(m.month)!, m);
      }
    }
    return {
      enrolledStudents: schools.reduce((n, s) => n + s.enrolledStudents, 0),
      activeStudents: schools.reduce((n, s) => n + s.activeStudents, 0),
      checkInsLast30Days: schools.reduce((n, s) => n + s.checkInsLast30Days, 0),
      months: allMonths.map((m) => months.get(m)!),
      revenue: [...revenue.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, perMonth]) => this.revenueEntry(currency, perMonth)),
    };
  }
}
