import { Injectable } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { daysInRange, defaultWeekRange, safeZone } from '../bookings/booking-week';
import { localDay } from '../ranks/engine';
import { BirthdaysResponseDto, DashboardOverviewDto, SetupStepKey } from './dto/dashboard.dto';

/** Membership types that make a student "active" (Decision 317 item 5). */
const ACTIVE_TYPES = ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'] as const;

/**
 * Decision 374 — the Dashboard items Decisions 317 and 318 decided: Active
 * students, this week's birthdays, and the owner's setup checklist.
 *
 * Visitors and frozen members (Decision 317 item 5's separate numbers) don't
 * exist in ULTM8 yet, so there is nothing to count for them.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  async getOverview(callerId: string, schoolId: string): Promise<DashboardOverviewDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const [school, enrolled, memberships, branch, style, cls, slot, plan, waiver, account, staff, invite] = await Promise.all([
        tx.school.findUnique({ where: { id: schoolId }, select: { setupChecklistHiddenAt: true } }),
        tx.roleGrant.findMany({ where: { schoolId, role: 'STUDENT', revokedAt: null }, select: { userId: true } }),
        tx.membership.findMany({
          where: { schoolId, status: 'ACTIVE', membershipPlan: { type: { in: [...ACTIVE_TYPES] } } },
          select: { studentId: true, status: true, expiryDate: true, classesRemaining: true },
        }),
        tx.branch.findFirst({ where: { schoolId, archivedAt: null }, select: { id: true } }),
        // A style counts once it has at least one belt.
        tx.discipline.findFirst({ where: { schoolId, archivedAt: null, ranks: { some: { archivedAt: null } } }, select: { id: true } }),
        tx.class.findFirst({ where: { schoolId, archivedAt: null }, select: { id: true } }),
        tx.timetableSlot.findFirst({ where: { schoolId, archivedAt: null }, select: { id: true } }),
        tx.membershipPlan.findFirst({ where: { schoolId, archivedAt: null, type: { not: 'VISIT_PASS' } }, select: { id: true } }),
        tx.waiver.findFirst({ where: { schoolId, archivedAt: null }, select: { id: true } }),
        tx.paymentAccount.findFirst({ where: { schoolId, status: 'ACTIVE', stripeConnectedAccountId: { not: null } }, select: { id: true } }),
        tx.roleGrant.findFirst({ where: { schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null }, select: { id: true } }),
        tx.coachInvite.findFirst({ where: { schoolId, acceptedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, select: { id: true } }),
      ]);

      const enrolledIds = new Set(enrolled.map((g) => g.userId));
      const now = new Date();
      const active = new Set(memberships.filter((m) => enrolledIds.has(m.studentId) && isMembershipLive(m, now)).map((m) => m.studentId));

      return {
        activeStudents: active.size,
        setupChecklist: {
          hidden: !!school?.setupChecklistHiddenAt,
          steps: [
            { key: SetupStepKey.BRANCH, done: !!branch },
            { key: SetupStepKey.STYLE_AND_BELTS, done: !!style },
            { key: SetupStepKey.CLASS, done: !!cls || !!slot },
            { key: SetupStepKey.MEMBERSHIP_PLAN, done: !!plan },
            { key: SetupStepKey.WAIVER, done: !!waiver },
            { key: SetupStepKey.STRIPE, done: !!account },
            // An invite still waiting counts: the owner has done their part.
            { key: SetupStepKey.STAFF, done: !!staff || !!invite },
          ],
        },
      };
    });
  }

  async setSetupChecklistHidden(callerId: string, schoolId: string, hidden: boolean): Promise<DashboardOverviewDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({ where: { id: schoolId }, data: { setupChecklistHiddenAt: hidden ? new Date() : null } }),
    );
    return this.getOverview(callerId, schoolId);
  }

  /**
   * This week's birthdays (Decision 318 item 2): every member of staff, the
   * students they can see (school_student_birthdays, 20261213000000), children
   * included. Only the day it falls on this week leaves the API, never the year.
   * A 29 February birthday falls on 28 February in a year without one.
   */
  async getBirthdays(callerId: string, schoolId: string): Promise<BirthdaysResponseDto> {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const { school, rows } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      school: await tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }),
      rows: await tx.$queryRaw<Array<{ id: string; firstName: string; surname: string; birthMonth: number; birthDay: number }>>`
        SELECT * FROM school_student_birthdays(${schoolId})`,
    }));
    const zone = safeZone(school?.timezone);
    const { from, to } = defaultWeekRange(zone);
    const week = daysInRange(from, to);

    const items: BirthdaysResponseDto['items'] = [];
    for (const r of rows) {
      const date = week.find((day) => {
        const year = Number(day.slice(0, 4));
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        const month = r.birthMonth;
        const dayOfMonth = r.birthMonth === 2 && r.birthDay === 29 && !leap ? 28 : r.birthDay;
        return day.slice(5) === `${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
      });
      if (date) items.push({ studentId: r.id, firstName: r.firstName, surname: r.surname, date });
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.firstName.localeCompare(b.firstName) || a.surname.localeCompare(b.surname));
    return { from, to, today: localDay(new Date(), zone), items };
  }
}
