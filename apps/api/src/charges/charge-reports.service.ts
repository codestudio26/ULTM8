import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { dayIn, freezeZone } from '../memberships/freeze/membership-freeze';
import { chargeRemaining } from './charge-ledger';

/** The Transaction kinds that are membership revenue (Decision 414 item 3):
 * plans bought in the app or sold at the desk, and Subscription renewals. */
export const MEMBERSHIP_REVENUE_KINDS = ['MEMBERSHIP', 'RENEWAL'] as const;

/**
 * The billing reports (backlog §3.6 step 4; Decision 338 item 11): an
 * Overview (scheduled, paid and overdue totals, revenue by month) and Member
 * balances. Seen by the owner (the whole School) and "staff with payment
 * access": Branch Staff when the School lets Branch Staff record payments
 * (Decision 347, the switch step 1 uses for desk payments), for their own
 * branches' students only (Decision 303 item 3). Coaches never.
 *
 * Read on the jobs connection after these checks, with the student filter
 * applied here: Branch Staff can't read Transaction under their own context
 * (Spec 55 §8.2). Charges are added up from the ledger (BalanceEntry), not
 * from their Transaction rows. Charges revenue is the ledger's: payments toward charges
 * when they were settled, less money given back (refunds to the card or in
 * cash, lost disputes). A refund as credit moves no money and is not in it.
 *
 * Decision 414 item 3: the Overview also shows membership revenue, and the
 * total. Memberships are Transaction rows of kind MEMBERSHIP (a plan bought in
 * the app or sold at the desk) and RENEWAL (a Subscription's later payments),
 * counted as the Transactions page's Revenue tile counts them (Successful rows,
 * by billing date, currency in capitals), less what was refunded on each row.
 * CHARGE_PAYMENT rows are left out: they are the ledger's payments above, so
 * counting them here would count them twice. Late-cancellation and freeze fees
 * are neither part (Decision 414 names charges and memberships only).
 */
@Injectable()
export class ChargeReportsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** Whose ledgers the caller may see: the whole School, or these students. */
  private async scope(callerId: string, schoolId: string): Promise<{ wholeSchool: true } | { wholeSchool: false; studentIds: string[] }> {
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({ where: { userId: callerId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null }, select: { role: true } }),
    );
    if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return { wholeSchool: true };
    const school = await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { branchStaffCanRecordPayments: true } });
    if (grants.length === 0 || !school?.branchStaffCanRecordPayments) {
      // Decision 347's own wording, as for a desk payment.
      throw new ForbiddenException(grants.length > 0 ? 'The School owner has not let Branch Staff record payments.' : "Only that School's Owner/Manager may perform this action.");
    }
    const coverage = await this.tenantAuth.staffBranchCoverage(callerId, schoolId);
    if (!coverage.hasBranches) {
      const students = await this.prismaJobs.roleGrant.findMany({ where: { schoolId, role: 'STUDENT' }, select: { userId: true }, distinct: ['userId'] });
      return { wholeSchool: false, studentIds: students.map((s) => s.userId) };
    }
    const homes = await this.prismaJobs.studentHomeBranch.findMany({ where: { schoolId, branchId: { in: [...coverage.branchIds] } }, select: { studentId: true } });
    return { wholeSchool: false, studentIds: homes.map((h) => h.studentId) };
  }

  private async loadSchool(schoolId: string) {
    const school = await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
    if (!school) throw new NotFoundException('School not found');
    return school;
  }

  private where(schoolId: string, scope: Awaited<ReturnType<ChargeReportsService['scope']>>) {
    return scope.wholeSchool ? { schoolId } : { schoolId, studentId: { in: scope.studentIds } };
  }

  /** What each student owes, and its overdue part, per currency, from their charges. */
  private async owedByStudent(schoolId: string, scope: Awaited<ReturnType<ChargeReportsService['scope']>>, today: string) {
    const charges = await this.prismaJobs.charge.findMany({
      where: { ...this.where(schoolId, scope), cancelledAt: null },
      include: { allocations: { select: { amount: true } } },
    });
    const out = new Map<string, { studentId: string; currency: string; owed: number; overdue: number; scheduled: number }>();
    for (const c of charges) {
      const owed = Math.max(0, chargeRemaining(c));
      if (owed === 0) continue;
      const key = `${c.studentId}:${c.currency}`;
      const row = out.get(key) ?? { studentId: c.studentId, currency: c.currency, owed: 0, overdue: 0, scheduled: 0 };
      row.owed += owed;
      if (c.dueDate.toISOString().slice(0, 10) < today) row.overdue += owed;
      else row.scheduled += owed;
      out.set(key, row);
    }
    return out;
  }

  /** GET /schools/{schoolId}/charge-reports/overview. */
  async overview(callerId: string, schoolId: string, months = 12) {
    const scope = await this.scope(callerId, schoolId);
    const school = await this.loadSchool(schoolId);
    const zone = freezeZone(school.timezone);
    const now = DateTime.now().setZone(zone);
    const first = now.startOf('month').minus({ months: months - 1 });
    const monthKeys = Array.from({ length: months }, (_, i) => first.plus({ months: i }).toFormat('yyyy-MM'));

    const [owed, entries, memberships] = await Promise.all([
      this.owedByStudent(schoolId, scope, dayIn(new Date(), school.timezone)),
      this.prismaJobs.balanceEntry.findMany({
        where: { ...this.where(schoolId, scope), kind: { in: ['PAYMENT', 'REFUND'] }, createdAt: { gte: first.toJSDate() } },
        select: { kind: true, amount: true, currency: true, createdAt: true },
      }),
      this.prismaJobs.transaction.findMany({
        where: { ...this.where(schoolId, scope), kind: { in: [...MEMBERSHIP_REVENUE_KINDS] }, status: 'SUCCESSFUL', billingDate: { gte: first.toJSDate() } },
        select: { amount: true, refundedAmount: true, currency: true, billingDate: true },
      }),
    ]);
    const byCurrency = new Map<string, { scheduled: number; overdue: number; months: Map<string, { received: number; refunded: number; memberships: number }> }>();
    const bucket = (currency: string) => {
      let b = byCurrency.get(currency);
      if (!b) {
        b = { scheduled: 0, overdue: 0, months: new Map(monthKeys.map((m) => [m, { received: 0, refunded: 0, memberships: 0 }])) };
        byCurrency.set(currency, b);
      }
      return b;
    };
    for (const row of owed.values()) {
      const b = bucket(row.currency);
      b.scheduled += row.scheduled;
      b.overdue += row.overdue;
    }
    for (const e of entries) {
      const month = DateTime.fromJSDate(e.createdAt, { zone }).toFormat('yyyy-MM');
      const m = bucket(e.currency).months.get(month);
      if (!m) continue;
      if (e.kind === 'PAYMENT') m.received += -e.amount;
      else m.refunded += e.amount;
    }
    for (const t of memberships) {
      // Every priced plan's payment has a currency; a row without one can't be
      // put in any currency's figures (the Transactions page lists it apart).
      if (!t.currency) continue;
      const month = DateTime.fromJSDate(t.billingDate, { zone }).toFormat('yyyy-MM');
      if (!monthKeys.includes(month)) continue;
      const m = bucket(t.currency.toUpperCase()).months.get(month)!;
      m.memberships += Math.max(0, t.amount - (t.refundedAmount ?? 0));
    }
    const currencies = [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, b]) => {
        const revenueByMonth = monthKeys.map((month) => {
          const m = b.months.get(month)!;
          const net = m.received - m.refunded;
          return { month, received: m.received, refunded: m.refunded, net, memberships: m.memberships, total: net + m.memberships };
        });
        const paid = revenueByMonth.reduce((n, m) => n + m.net, 0);
        const membershipRevenue = revenueByMonth.reduce((n, m) => n + m.memberships, 0);
        return { currency, scheduled: b.scheduled, overdue: b.overdue, paid, memberships: membershipRevenue, total: paid + membershipRevenue, revenueByMonth };
      });
    return { months, wholeSchool: scope.wholeSchool, currencies };
  }

  /** GET /schools/{schoolId}/charge-reports/member-balances: every member
   * whose balance isn't zero, with what they owe, their credit and the
   * overdue part. */
  async memberBalances(callerId: string, schoolId: string) {
    const scope = await this.scope(callerId, schoolId);
    const school = await this.loadSchool(schoolId);
    const [owed, sums] = await Promise.all([
      this.owedByStudent(schoolId, scope, dayIn(new Date(), school.timezone)),
      this.prismaJobs.balanceEntry.groupBy({ by: ['studentId', 'currency'], where: this.where(schoolId, scope), _sum: { amount: true } }),
    ]);
    const rows = sums
      .map((s) => {
        const net = s._sum.amount ?? 0;
        const o = owed.get(`${s.studentId}:${s.currency}`);
        const owedAmount = o?.owed ?? 0;
        return { studentId: s.studentId, currency: s.currency, owed: owedAmount, credit: Math.max(0, owedAmount - net), net, overdue: o?.overdue ?? 0 };
      })
      .filter((r) => r.net !== 0);
    const names = await resolveUserNames(this.prismaAuth, [...new Set(rows.map((r) => r.studentId))]);
    const items = rows.map((r) => ({ ...r, firstName: names.get(r.studentId)?.firstName ?? '', surname: names.get(r.studentId)?.surname ?? '' }));
    items.sort(
      (a, b) =>
        Number(b.net > 0) - Number(a.net > 0) ||
        Number(b.overdue > 0) - Number(a.overdue > 0) ||
        Math.abs(b.net) - Math.abs(a.net) ||
        `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`),
    );
    return { wholeSchool: scope.wholeSchool, items };
  }
}
