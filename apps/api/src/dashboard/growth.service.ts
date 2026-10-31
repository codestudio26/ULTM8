import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { safeZone } from '../bookings/booking-week';
import { loadVisitorStatuses } from '../memberships/visitors';
import { loadFrozenStudents } from '../memberships/freeze/freeze-states';
import { dayToDate } from '../memberships/freeze/membership-freeze';
import { loadActiveStudents } from './active-students';
import { growthWindow, monthOf, monthOfDay } from './growth-months';
import { GrowthResponseDto } from './dto/growth.dto';

/**
 * Students → Growth (backlog 5.8, Gymdesk G1–G5).
 *
 * - **Active** (G1): Decision 317 item 5, counted by loadActiveStudents, the
 *   same code as the Dashboard card (Decision 374), so the two agree.
 * - **Visitors** and **Frozen** (G3): the separate numbers Decision 317 item 5
 *   asks for. Visitors as the Students list flags them (Decision 391), frozen
 *   as a freeze covering today (Decision 404).
 * - **New per month** (G2): the join date at the School (Decision 315 item 4).
 * - **Cancelled per month** (G3): Subscriptions that ended by cancellation.
 * - **By programme** (G5): per style, students holding a rank in it, and how
 *   many started it each month.
 *
 * Who sees it: the people who see attendance statistics (Decision 317 item 3):
 * the owner the whole School, Branch Staff with "See attendance statistics"
 * their own Branches' students (by home Branch). Months are calendar months in
 * the School's time zone, the last 12 including this one.
 *
 * Read on the jobs connection after that check, with the School named on every
 * query: Branch Staff can't read memberships in their own context.
 */
@Injectable()
export class GrowthService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  async growth(callerId: string, schoolId: string, query: { branchId?: string }): Promise<GrowthResponseDto> {
    const scope = await this.tenantAuth.attendanceStatsScope(callerId, schoolId);
    let branchIds = scope.branchIds;
    if (query.branchId) {
      if (branchIds && !branchIds.includes(query.branchId)) {
        throw new ForbiddenException({ code: 'OTHER_BRANCH', message: "You can only see your own Branches' growth." });
      }
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, query.branchId, schoolId);
      branchIds = [query.branchId];
    }

    const db = this.prismaJobs;
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
    if (!school) throw new NotFoundException('School not found');
    const zone = safeZone(school.timezone);
    const now = new Date();
    const { months, firstDay, from } = growthWindow(now, zone);

    // With a Branch filter, only students whose home Branch is one of them.
    // A former student has no home Branch, so is only in the whole School.
    const homes = branchIds
      ? new Set(
          (await db.studentHomeBranch.findMany({ where: { schoolId, branchId: { in: branchIds } }, select: { studentId: true } })).map((h) => h.studentId),
        )
      : null;
    const inScope = (studentId: string) => homes === null || homes.has(studentId);

    const { enrolled, active } = await loadActiveStudents(db, schoolId, now);
    const enrolledHere = [...enrolled].filter(inScope);
    const [visitors, frozen, joins, cancellations, disciplines, ranks] = await Promise.all([
      loadVisitorStatuses(db, schoolId, enrolledHere),
      loadFrozenStudents(db, schoolId, enrolledHere),
      db.studentJoinDate.findMany({ where: { schoolId, joinedOn: { gte: dayToDate(firstDay) } }, select: { studentId: true, joinedOn: true } }),
      db.membership.findMany({
        where: { schoolId, membershipPlan: { type: 'SUBSCRIPTION' }, cancelAt: { gte: from, lte: now } },
        select: { studentId: true, cancelAt: true },
      }),
      db.discipline.findMany({ where: { schoolId, archivedAt: null }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      db.studentRank.findMany({ where: { schoolId, discipline: { archivedAt: null } }, select: { studentId: true, disciplineId: true, createdAt: true } }),
    ]);

    const index = new Map(months.map((m, i) => [m, i]));
    const newStudents = months.map(() => 0);
    for (const j of joins) {
      const i = index.get(monthOfDay(j.joinedOn));
      if (i !== undefined && inScope(j.studentId)) newStudents[i]++;
    }
    // A student is counted once a month, however many Subscriptions ended.
    const cancelled = months.map(() => new Set<string>());
    for (const c of cancellations) {
      const i = index.get(monthOf(c.cancelAt as Date, zone));
      if (i !== undefined && inScope(c.studentId)) cancelled[i].add(c.studentId);
    }

    const programmes = disciplines.map((d) => ({ disciplineId: d.id, name: d.name, students: 0, newByMonth: months.map(() => 0) }));
    const byId = new Map(programmes.map((p) => [p.disciplineId, p]));
    for (const r of ranks) {
      const p = byId.get(r.disciplineId);
      if (!p || !inScope(r.studentId)) continue;
      if (enrolled.has(r.studentId)) p.students++;
      const i = r.createdAt >= from ? index.get(monthOf(r.createdAt, zone)) : undefined;
      if (i !== undefined) p.newByMonth[i]++;
    }

    return {
      timeZone: zone,
      branchIds,
      activeStudents: [...active].filter(inScope).length,
      visitors: [...visitors.values()].filter((v) => v.visitor).length,
      frozen: frozen.size,
      months: months.map((month, i) => ({ month, newStudents: newStudents[i], cancelled: cancelled[i].size })),
      programmes,
    };
  }
}
