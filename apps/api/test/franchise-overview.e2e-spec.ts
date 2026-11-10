/**
 * Decision 450 item 1 — the Franchise owner's read-only overview of its member
 * Schools' totals: GET /franchises/{id}/overview.
 *
 * - The numbers are each member School's own: students as the Dashboard and
 *   Students → Growth count them, check-ins as Students → Attendance, new and
 *   cancelled students as Growth, revenue as the billing overview (checked
 *   against those endpoints, read by each School's own owner).
 * - Revenue stays per currency, never added across currencies.
 * - A School that left the Franchise, another Franchise's Schools and another
 *   School's data are never counted.
 * - Only totals: no member's id, name, email or per-person row is in the
 *   response, and a School with one student still shows only a count.
 * - Refusals (Decision 449 item 6): the owner of a member School, its staff,
 *   coaches, members and Guardians get 403 "You don't have permission to view
 *   this page"; another Franchise's owner, another School's owner and a
 *   stranger get 404; impersonation is refused.
 * - The SQL functions check the caller themselves: called directly as ultm8_app
 *   for anyone but the owner, or during impersonation, they return nothing,
 *   and the helper behind them can't be called at all.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MembershipPlanType, PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[franchise-overview.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const TOKYO = 'Asia/Tokyo';
const HOUR = 3_600_000;
const DAY = 86_400_000;

type Role = 'FRANCHISE_OWNER' | 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

describeIfDb('Franchise overview (Decision 450 item 1)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const http = () => request(app.getHttpServer());

  const users: Record<string, { id: string; email: string; firstName: string }> = {};
  const tokens: Record<string, string> = {};
  const franchise = { id: randomUUID() };
  const otherFranchise = { id: randomUUID() };
  // A (Tokyo, USD and BRL), B (UTC, one student), Left (was a member), D (other Franchise's).
  const schools = { a: randomUUID(), b: randomUUID(), left: randomUUID(), d: randomUUID() };
  const accounts: Record<string, string> = {};
  const plans: Record<string, Partial<Record<MembershipPlanType, string>>> = {};

  const nowTokyo = DateTime.now().setZone(TOKYO);
  const lastMonthStart = nowTokyo.startOf('month').minus({ months: 1 }).toJSDate();
  // Last month in Tokyo, but the month before in UTC.
  const justAfterLastStart = new Date(lastMonthStart.getTime() + HOUR);
  const day = (dt: DateTime) => new Date(`${dt.toISODate()}T00:00:00.000Z`);

  const get = (who: string, url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`);
  const overview = (who: string, id: string = franchise.id) => get(who, `/v1/franchises/${id}/overview`);

  async function mkUser(label: string) {
    const firstName = `Fo${label}${Math.floor(Math.random() * 1e6)}`;
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `fo-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname: 'Overview',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
      select: { id: true, email: true, firstName: true },
    });
  }

  async function grant(who: string, role: Role, where: { schoolId?: string; franchiseId?: string }, extra: Record<string, unknown> = {}) {
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role, userId: users[who].id, schoolId: where.schoolId ?? null, franchiseId: where.franchiseId ?? null, isMainOwner: role === 'SCHOOL_OWNER_MANAGER', ...extra },
    });
    if (!tokens[who]) {
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: where.franchiseId ?? null, schoolId: where.schoolId ?? null, branchId: null }] });
    }
  }

  const membership = (who: string, schoolId: string, type: MembershipPlanType, extra: Record<string, unknown> = {}) =>
    superuser.membership.create({
      data: {
        id: randomUUID(), studentId: users[who].id, membershipPlanId: plans[schoolId][type]!, schoolId,
        status: 'ACTIVE', frequency: type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME', ...extra,
      },
    });

  const payment = (who: string, schoolId: string, data: Record<string, unknown>) =>
    superuser.transaction.create({
      data: { id: randomUUID(), schoolId, studentId: users[who].id, paymentAccountId: accounts[schoolId], paymentMethod: 'CASH', status: 'SUCCESSFUL', ...data } as never,
    });

  async function completedBooking(who: string, schoolId: string, classId: string, status: 'COMPLETED' | 'UPCOMING' = 'COMPLETED') {
    return superuser.booking.create({ data: { id: randomUUID(), studentId: users[who].id, classId, schoolId, status } });
  }

  const mkClass = (schoolId: string, start: Date) =>
    superuser.class.create({ data: { id: randomUUID(), schoolId, title: 'Overview class', startDate: start, endDate: new Date(start.getTime() + HOUR) } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.franchise.create({ data: { id: franchise.id, name: 'Overview Franchise' } });
    await superuser.franchise.create({ data: { id: otherFranchise.id, name: 'Overview Other Franchise' } });
    await superuser.school.create({ data: { id: schools.a, name: 'Overview A', timezone: TOKYO, franchiseId: franchise.id } });
    await superuser.school.create({ data: { id: schools.b, name: 'Overview B', timezone: 'UTC', franchiseId: franchise.id } });
    await superuser.school.create({ data: { id: schools.left, name: 'Overview Left', timezone: 'UTC', franchiseId: franchise.id } });
    await superuser.school.create({ data: { id: schools.d, name: 'Overview D', timezone: 'UTC', franchiseId: otherFranchise.id } });

    for (const label of [
      'fOwner', 'gOwner', 'aOwner', 'aStaff', 'aCoach', 'bOwner', 'leftOwner', 'dOwner', 'stranger', 'guardian',
      's1', 's2', 's3', 's4', 's5', 's6', 'guest', 'b1', 'left1', 'd1',
    ]) await mkUser(label);

    await grant('fOwner', 'FRANCHISE_OWNER', { franchiseId: franchise.id });
    await grant('gOwner', 'FRANCHISE_OWNER', { franchiseId: otherFranchise.id });
    await grant('aOwner', 'SCHOOL_OWNER_MANAGER', { schoolId: schools.a });
    await grant('aStaff', 'BRANCH_STAFF', { schoolId: schools.a });
    await grant('aCoach', 'INSTRUCTOR', { schoolId: schools.a });
    await grant('bOwner', 'SCHOOL_OWNER_MANAGER', { schoolId: schools.b });
    await grant('leftOwner', 'SCHOOL_OWNER_MANAGER', { schoolId: schools.left });
    await grant('dOwner', 'SCHOOL_OWNER_MANAGER', { schoolId: schools.d });
    for (const s of ['s1', 's2', 's3', 's4', 's6', 'guest']) await grant(s, 'STUDENT', { schoolId: schools.a });
    // s5 left School A: not enrolled, so not counted although a membership is live.
    await grant('s5', 'STUDENT', { schoolId: schools.a }, { revokedAt: new Date() });
    await grant('b1', 'STUDENT', { schoolId: schools.b });
    await grant('left1', 'STUDENT', { schoolId: schools.left });
    await grant('d1', 'STUDENT', { schoolId: schools.d });
    tokens.stranger = jwt.sign({ sub: users.stranger.id, email: users.stranger.email, grants: [] });
    tokens.guardian = jwt.sign({ sub: users.guardian.id, email: users.guardian.email, grants: [] });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.guardian.id, studentId: users.s1.id } });

    for (const schoolId of Object.values(schools)) {
      accounts[schoolId] = (await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } })).id;
      plans[schoolId] = {};
      for (const type of ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'FRIEND_PASS'] as MembershipPlanType[]) {
        plans[schoolId][type] = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId, type, title: type, price: 1000 } })).id;
      }
    }

    // ---- School A: students
    const s1Sub = await membership('s1', schools.a, 'SUBSCRIPTION'); // active
    const s2Weekly = await membership('s2', schools.a, 'WEEKLY_PASS', { expiryDate: new Date(Date.now() + 30 * DAY) });
    await superuser.membershipFreeze.create({
      data: {
        id: randomUUID(), membershipId: s2Weekly.id, schoolId: schools.a, studentId: users.s2.id, status: 'APPROVED',
        startsAt: day(nowTokyo.minus({ days: 2 })), endsAt: day(nowTokyo.plus({ days: 5 })),
      },
    }); // frozen today: not active
    await membership('s3', schools.a, 'CLASS_PACK', { classesRemaining: 0 }); // used up: not active
    await membership('s4', schools.a, 'SUBSCRIPTION', { status: 'EXPIRED', cancelAt: justAfterLastStart, cancelledById: users.s4.id }); // cancelled last month (Tokyo)
    await membership('s5', schools.a, 'SUBSCRIPTION'); // live, but s5 left
    // A freeze ended early yesterday: back today, so active.
    const s6Sub = await membership('s6', schools.a, 'SUBSCRIPTION');
    await superuser.membershipFreeze.create({
      data: {
        id: randomUUID(), membershipId: s6Sub.id, schoolId: schools.a, studentId: users.s6.id, status: 'APPROVED',
        startsAt: day(nowTokyo.minus({ days: 5 })), endsAt: day(nowTokyo.plus({ days: 10 })), endedEarlyAt: new Date(Date.now() - DAY),
      },
    });
    const guestPass = await membership('guest', schools.a, 'FRIEND_PASS', { classesRemaining: 1 });
    await superuser.studentJoinDate.updateMany({ where: { schoolId: schools.a, studentId: users.s1.id }, data: { joinedOn: day(nowTokyo.startOf('month').minus({ months: 1 })) } });
    await superuser.studentJoinDate.updateMany({ where: { schoolId: schools.a, studentId: users.s2.id }, data: { joinedOn: day(nowTokyo.minus({ months: 14 })) } });

    // ---- School A: attendance
    const recent = await mkClass(schools.a, new Date(Date.now() - 2 * DAY));
    const older = await mkClass(schools.a, new Date(Date.now() - 40 * DAY));
    const future = await mkClass(schools.a, new Date(Date.now() + 2 * DAY));
    const s1Booking = await completedBooking('s1', schools.a, recent.id);
    await completedBooking('s2', schools.a, recent.id);
    await completedBooking('s3', schools.a, recent.id, 'UPCOMING');
    await completedBooking('s1', schools.a, older.id);
    await completedBooking('s1', schools.a, future.id);
    await superuser.bookingAttendee.create({
      data: { id: randomUUID(), bookingId: s1Booking.id, schoolId: schools.a, membershipId: guestPass.id, checkedInAt: new Date() },
    });
    void s1Sub;

    // ---- School A: revenue (USD and BRL)
    const lastMonth = new Date(nowTokyo.startOf('month').minus({ days: 3 }).toJSDate());
    await payment('s1', schools.a, { kind: 'MEMBERSHIP', amount: 10000, surchargeAmount: 300, refundedAmount: 2000, currency: 'USD', billingDate: lastMonth });
    // Refunded, a non-refundable joining fee kept: price 1000, surcharge 0 kept.
    await payment('s2', schools.a, { kind: 'RENEWAL', amount: 5000, surchargeAmount: 300, refundedAmount: 4300, joiningFeeAmount: 1000, joiningFeeRefundable: false, status: 'REFUNDED', currency: 'USD', billingDate: lastMonth });
    await payment('s3', schools.a, { kind: 'LATE_CANCEL_FEE', amount: 700, currency: 'USD' });
    await payment('s1', schools.a, { kind: 'MEMBERSHIP', amount: 9999, currency: 'USD', status: 'FAILED' }); // not counted
    await payment('s1', schools.a, { kind: 'MEMBERSHIP', amount: 8888, currency: 'USD', billingDate: new Date(Date.now() - 400 * DAY) }); // too old
    await payment('s2', schools.a, { kind: 'MEMBERSHIP', amount: 15000, currency: 'BRL' });
    const chargePayment = await payment('s1', schools.a, { kind: 'CHARGE_PAYMENT', amount: 2000, surchargeAmount: 60, currency: 'USD' });
    await superuser.balanceEntry.create({ data: { id: randomUUID(), schoolId: schools.a, studentId: users.s1.id, kind: 'PAYMENT', amount: -2000, currency: 'USD', transactionId: chargePayment.id } });
    const refund = await superuser.chargeRefund.create({
      data: { id: randomUUID(), schoolId: schools.a, studentId: users.s1.id, transactionId: chargePayment.id, kind: 'CARD', amount: 500, currency: 'USD' },
    });
    await superuser.balanceEntry.create({
      data: { id: randomUUID(), schoolId: schools.a, studentId: users.s1.id, kind: 'REFUND', amount: 500, currency: 'USD', transactionId: chargePayment.id, refundId: refund.id },
    });

    // ---- School B: one student, a payment in lower-case USD.
    await membership('b1', schools.b, 'SUBSCRIPTION');
    await payment('b1', schools.b, { kind: 'MEMBERSHIP', amount: 4000, currency: 'usd' });
    const bClass = await mkClass(schools.b, new Date(Date.now() - DAY));
    await completedBooking('b1', schools.b, bClass.id);

    // ---- Left School and School D: data that must never be counted.
    for (const [who, schoolId] of [['left1', schools.left], ['d1', schools.d]] as const) {
      await membership(who, schoolId, 'SUBSCRIPTION');
      await payment(who, schoolId, { kind: 'MEMBERSHIP', amount: 777777, currency: 'USD' });
      const c = await mkClass(schoolId, new Date(Date.now() - DAY));
      await completedBooking(who, schoolId, c.id);
    }
    // The School leaves (what leaving and removal write: franchiseId cleared).
    await superuser.school.update({ where: { id: schools.left }, data: { franchiseId: null } });
  });

  afterAll(async () => {
    const schoolIds = Object.values(schools);
    const userIds = Object.values(users).map((u) => u.id);
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.balanceEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.chargeRefund.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.transaction.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipFreeze.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentJoinDate.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffActivity.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: users.guardian?.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: [franchise.id, otherFranchise.id] } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  type Body = {
    totals: Totals;
    schools: Array<Totals & { schoolId: string; name: string; archivedAt: string | null; timeZone: string }>;
  };
  type Totals = {
    enrolledStudents: number;
    activeStudents: number;
    checkInsLast30Days: number;
    months: Array<{ month: string; checkIns: number; newStudents: number; cancelled: number }>;
    revenue: Array<{ currency: string; memberships: number; charges: number; fees: number; surcharges: number; total: number; byMonth: Array<{ month: string; memberships: number; charges: number; fees: number; surcharges: number; total: number }> }>;
  };

  describe('the Franchise owner', () => {
    let body: Body;
    beforeAll(async () => {
      const res = await overview('fOwner');
      expect(res.status).toBe(200);
      body = res.body;
    });

    it('lists the Schools that are members now: not one that left, not another Franchise\'s', () => {
      expect(body.schools.map((s) => s.schoolId)).toEqual([schools.a, schools.b]);
      expect(body.schools.map((s) => s.name)).toEqual(['Overview A', 'Overview B']);
      expect(body.schools[0].timeZone).toBe(TOKYO);
      expect(JSON.stringify(body)).not.toContain('777777');
    });

    it('counts students: enrolled now, and active as the Dashboard does', () => {
      const a = body.schools[0];
      // s1 s2 s3 s4 s6 guest enrolled; s5 left. Active: s1 and s6 (back from a freeze ended early);
      // not s2 (frozen today), s3 (used up), s4 (cancelled) or guest (Friend Pass).
      expect(a.enrolledStudents).toBe(6);
      expect(a.activeStudents).toBe(2);
      expect(body.totals.enrolledStudents).toBe(7);
      expect(body.totals.activeStudents).toBe(3);
    });

    it('counts check-ins over the last 30 days and by month, guests included', () => {
      const a = body.schools[0];
      // s1 + s2 + s1's guest at the recent class; the older class only by month; the future class never.
      expect(a.checkInsLast30Days).toBe(3);
      expect(a.months.reduce((n, m) => n + m.checkIns, 0)).toBe(4);
      expect(body.totals.checkInsLast30Days).toBe(4);
      expect(a.months).toHaveLength(12);
      expect(a.months[11].month).toBe(nowTokyo.toFormat('yyyy-MM'));
    });

    it('counts new and cancelled students by month in the School\'s time zone', () => {
      const a = body.schools[0];
      const last = nowTokyo.minus({ months: 1 }).toFormat('yyyy-MM');
      expect(a.months.find((m) => m.month === last)!.cancelled).toBe(1);
      expect(a.months.find((m) => m.month === last)!.newStudents).toBeGreaterThanOrEqual(1);
    });

    it('keeps revenue per currency and never adds currencies together', () => {
      const a = body.schools[0];
      expect(a.revenue.map((r) => r.currency)).toEqual(['BRL', 'USD']);
      const usd = a.revenue.find((r) => r.currency === 'USD')!;
      // 8000 + 1000 kept of the memberships; 700 fee; 2000 - 500 toward charges; 300 + 60 surcharges.
      expect(usd).toMatchObject({ memberships: 9000, fees: 700, charges: 1500, surcharges: 360, total: 11560 });
      expect(a.revenue.find((r) => r.currency === 'BRL')!.total).toBe(15000);
      // School B's lower-case "usd" is USD; the Franchise's USD is A's plus B's, BRL on its own.
      expect(body.schools[1].revenue).toEqual([expect.objectContaining({ currency: 'USD', memberships: 4000, total: 4000 })]);
      expect(body.totals.revenue.map((r) => r.currency)).toEqual(['BRL', 'USD']);
      expect(body.totals.revenue.find((r) => r.currency === 'USD')!.total).toBe(15560);
      expect(body.totals.revenue.find((r) => r.currency === 'BRL')!.total).toBe(15000);
    });

    it('returns only totals: no member id, name or email, and no per-person rows', () => {
      const text = JSON.stringify(body);
      for (const label of ['s1', 's2', 's3', 's4', 's5', 's6', 'guest', 'b1', 'guardian', 'aOwner', 'aStaff', 'aCoach', 'bOwner']) {
        expect(text).not.toContain(users[label].id);
        expect(text).not.toContain(users[label].firstName);
        expect(text).not.toContain(users[label].email);
      }
      expect(Object.keys(body).sort()).toEqual(['schools', 'totals']);
      const totalsKeys = ['activeStudents', 'checkInsLast30Days', 'enrolledStudents', 'months', 'revenue'];
      expect(Object.keys(body.totals).sort()).toEqual(totalsKeys);
      for (const s of body.schools) {
        expect(Object.keys(s).sort()).toEqual([...totalsKeys, 'archivedAt', 'name', 'schoolId', 'timeZone'].sort());
        for (const m of s.months) expect(Object.keys(m).sort()).toEqual(['cancelled', 'checkIns', 'month', 'newStudents']);
        for (const r of s.revenue) {
          expect(Object.keys(r).sort()).toEqual(['byMonth', 'charges', 'currency', 'fees', 'memberships', 'surcharges', 'total']);
          for (const m of r.byMonth) expect(Object.keys(m).sort()).toEqual(['charges', 'fees', 'memberships', 'month', 'surcharges', 'total']);
        }
      }
    });

    it('a School with a single student still shows only counts', () => {
      const b = body.schools[1];
      expect(b.enrolledStudents).toBe(1);
      expect(b.activeStudents).toBe(1);
      expect(b.checkInsLast30Days).toBe(1);
      expect(JSON.stringify(b)).not.toContain(users.b1.id);
    });

    it('matches what each member School\'s own owner sees on Growth, Attendance and the billing overview', async () => {
      for (const [owner, schoolId] of [['aOwner', schools.a], ['bOwner', schools.b]] as const) {
        const mine = body.schools.find((s) => s.schoolId === schoolId)!;
        const growth = (await get(owner, `/v1/schools/${schoolId}/growth`)).body;
        const stats = (await get(owner, `/v1/schools/${schoolId}/attendance/stats`)).body;
        const billing = (await get(owner, `/v1/schools/${schoolId}/charge-reports/overview`)).body;
        expect(mine.activeStudents).toBe(growth.activeStudents);
        expect(mine.months.map((m) => ({ month: m.month, newStudents: m.newStudents, cancelled: m.cancelled }))).toEqual(growth.months);
        expect(mine.checkInsLast30Days).toBe(stats.checkIns);
        const withRevenue = (billing.currencies as Array<{ currency: string; paid: number; memberships: number; fees: number; surcharges: number; total: number; revenueByMonth: Array<{ month: string; net: number; memberships: number; fees: number; surcharges: number; total: number }> }>)
          .filter((c) => c.revenueByMonth.some((m) => m.net || m.memberships || m.fees || m.surcharges));
        expect(mine.revenue.map((r) => r.currency)).toEqual(withRevenue.map((c) => c.currency));
        for (const c of withRevenue) {
          const r = mine.revenue.find((x) => x.currency === c.currency)!;
          expect({ charges: r.charges, memberships: r.memberships, fees: r.fees, surcharges: r.surcharges, total: r.total }).toEqual({
            charges: c.paid, memberships: c.memberships, fees: c.fees, surcharges: c.surcharges, total: c.total,
          });
          expect(r.byMonth.map((m) => [m.month, m.charges, m.memberships, m.fees, m.surcharges, m.total])).toEqual(
            c.revenueByMonth.map((m) => [m.month, m.net, m.memberships, m.fees, m.surcharges, m.total]),
          );
        }
      }
    });

    it('adds the months up across Schools by name', () => {
      for (const t of body.totals.months) {
        const sum = body.schools.reduce((n, s) => n + (s.months.find((m) => m.month === t.month)?.checkIns ?? 0), 0);
        expect(t.checkIns).toBe(sum);
      }
    });
  });

  describe('everyone else is refused', () => {
    it('people linked to a member School get 403 "no permission", never the figures', async () => {
      for (const who of ['aOwner', 'aStaff', 'aCoach', 's1', 'guardian', 'bOwner']) {
        const res = await overview(who);
        expect({ who, status: res.status, code: res.body.error?.code }).toEqual({ who, status: 403, code: 'NO_PERMISSION' });
        expect(res.body.schools).toBeUndefined();
      }
    });

    it('another Franchise\'s owner, another School\'s owner, a stranger and the owner of a School that left get 404', async () => {
      for (const who of ['gOwner', 'dOwner', 'stranger', 'leftOwner']) {
        const res = await overview(who);
        expect({ who, status: res.status }).toEqual({ who, status: 404 });
      }
    });

    it('an unknown or malformed Franchise id is 404, even for a Franchise owner', async () => {
      expect((await overview('fOwner', randomUUID())).status).toBe(404);
      expect((await overview('fOwner', 'not-a-uuid')).status).toBe(404);
      // Another Franchise's id: the owner of this one has no link to it.
      expect((await overview('fOwner', otherFranchise.id)).status).toBe(404);
    });

    it('is refused during an impersonation session', async () => {
      const token = jwt.sign({
        sub: users.fOwner.id,
        email: users.fOwner.email,
        grants: [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }],
        impersonation: { adminUserId: randomUUID(), startedAt: new Date().toISOString(), schoolId: schools.a },
      });
      const res = await http().get(`/v1/franchises/${franchise.id}/overview`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('the SQL functions check the caller themselves', () => {
    async function callAs(userId: string, fn: string, impersonationSchoolId = '') {
      return appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.impersonation_school_id', ${impersonationSchoolId}, true)`;
        return tx.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${fn}($1)`, franchise.id);
      });
    }
    const FUNCTIONS = ['franchise_overview_school_totals', 'franchise_overview_school_months', 'franchise_overview_school_revenue'];

    it('return rows for the Franchise owner only', async () => {
      for (const fn of FUNCTIONS) {
        expect((await callAs(users.fOwner.id, fn)).length).toBeGreaterThan(0);
        for (const who of ['aOwner', 'aStaff', 's1', 'gOwner', 'stranger']) {
          expect({ fn, who, rows: (await callAs(users[who].id, fn)).length }).toEqual({ fn, who, rows: 0 });
        }
      }
    });

    it('return nothing during impersonation, even for the owner', async () => {
      for (const fn of FUNCTIONS) expect((await callAs(users.fOwner.id, fn, schools.a)).length).toBe(0);
    });

    it('a revoked Franchise owner gets nothing', async () => {
      await mkUser('formerOwner');
      await grant('formerOwner', 'FRANCHISE_OWNER', { franchiseId: franchise.id }, { revokedAt: new Date() });
      for (const fn of FUNCTIONS) expect((await callAs(users.formerOwner.id, fn)).length).toBe(0);
      expect((await overview('formerOwner')).status).toBe(403);
    });

    it('the scope helper behind them is not callable by the app role', async () => {
      await expect(callAs(users.fOwner.id, 'franchise_overview_scope')).rejects.toThrow(/permission denied/);
    });

    it('return only School-level columns', async () => {
      const [totals] = (await callAs(users.fOwner.id, 'franchise_overview_school_totals')) as Array<Record<string, unknown>>;
      expect(Object.keys(totals).sort()).toEqual(['activeStudents', 'archivedAt', 'checkInsLast30Days', 'enrolledStudents', 'name', 'schoolId', 'timeZone']);
      const [month] = (await callAs(users.fOwner.id, 'franchise_overview_school_months')) as Array<Record<string, unknown>>;
      expect(Object.keys(month).sort()).toEqual(['cancelled', 'checkIns', 'month', 'newStudents', 'schoolId']);
      const [revenue] = (await callAs(users.fOwner.id, 'franchise_overview_school_revenue')) as Array<Record<string, unknown>>;
      expect(Object.keys(revenue).sort()).toEqual(['charges', 'currency', 'fees', 'memberships', 'month', 'schoolId', 'surcharges']);
    });
  });
});
