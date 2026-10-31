/**
 * Students → Growth (backlog 5.8, Gymdesk G1–G5): GET /schools/{id}/growth.
 * - Active is the Dashboard's count (Decision 317 item 5 / 374), and the two
 *   endpoints agree; Visitors and frozen members are their own numbers;
 * - new students per month by join date, cancelled Subscriptions per month,
 *   and new students per style, over the last 12 months in the School's time
 *   zone (a Tokyo School, with instants either side of a month's start);
 * - the owner sees the whole School; Branch Staff only with "See attendance
 *   statistics", and only their own Branches' students; coaches, students and
 *   another School's owner see nothing, and no other School's data is counted.
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
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[students-growth.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const ZONE = 'Asia/Tokyo';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ACCESS_DEFAULTS = {
  classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false,
  disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false,
};

describeIfDb('Students → Growth (backlog 5.8)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const http = () => request(app.getHttpServer());

  let school: { id: string };
  let otherSchool: { id: string };
  let north: { id: string };
  let south: { id: string };
  let otherBranch: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const plans: Partial<Record<MembershipPlanType, string>> = {};

  // Months in Tokyo. "last" is the month before this one; it starts at
  // local midnight on its 1st, which is 15:00 UTC the day before (the UTC
  // month before it). An hour after that start is "last" in Tokyo but the
  // month before in UTC; an hour before it is the month before in both.
  const nowTokyo = DateTime.now().setZone(ZONE);
  const thisMonth = nowTokyo.startOf('month');
  const lastMonth = thisMonth.minus({ months: 1 });
  const twoAgo = thisMonth.minus({ months: 2 });
  const lastMonthStart = lastMonth.toJSDate();
  const justAfterLastStart = new Date(lastMonthStart.getTime() + HOUR);
  const justBeforeLastStart = new Date(lastMonthStart.getTime() - HOUR);
  const M = (dt: DateTime) => dt.toFormat('yyyy-MM');
  const day = (dt: DateTime) => new Date(`${dt.toISODate()}T00:00:00.000Z`);

  const as = (who: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const growth = (who: string, query = '', schoolId = school.id) => as(who).get(`/v1/schools/${schoolId}/growth${query}`);
  const setAccess = (who: string, access: Partial<typeof ACCESS_DEFAULTS>) =>
    as('owner').put(`/v1/schools/${school.id}/staff/${users[who].id}/access`).send({ ...ACCESS_DEFAULTS, ...access });
  const monthRow = (body: { months: Array<{ month: string; newStudents: number; cancelled: number }> }, month: string) =>
    body.months.find((m) => m.month === month)!;

  async function mkUser(label: string) {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `growth-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Growth',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  }

  async function membership(who: string, type: MembershipPlanType, extra: Record<string, unknown> = {}, schoolId = school.id, planId?: string) {
    return superuser.membership.create({
      data: {
        id: randomUUID(), studentId: users[who].id, membershipPlanId: planId ?? plans[type]!, schoolId,
        status: 'ACTIVE', frequency: type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME', ...extra,
      },
    });
  }

  const setJoined = (who: string, joinedOn: Date, schoolId = school.id) =>
    superuser.studentJoinDate.update({ where: { schoolId_studentId: { schoolId, studentId: users[who].id } }, data: { joinedOn } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Growth School', timezone: ZONE } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Growth Other School', timezone: 'UTC' } });
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    otherBranch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: otherSchool.id, name: 'Elsewhere' } });

    for (const label of ['owner', 'staff', 'coach', 'ana', 'ben', 'cara', 'dan', 'eve', 'fay', 'left', 'otherOwner', 'otherStudent']) await mkUser(label);
    const grants: Array<[string, 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT', string | null, string]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', null, school.id],
      ['staff', 'BRANCH_STAFF', north.id, school.id],
      ['coach', 'INSTRUCTOR', north.id, school.id],
      ['ana', 'STUDENT', null, school.id],
      ['ben', 'STUDENT', null, school.id],
      ['cara', 'STUDENT', null, school.id],
      ['dan', 'STUDENT', null, school.id],
      ['eve', 'STUDENT', null, school.id],
      ['fay', 'STUDENT', null, school.id],
      ['otherOwner', 'SCHOOL_OWNER_MANAGER', null, otherSchool.id],
      ['otherStudent', 'STUDENT', null, otherSchool.id],
    ];
    await superuser.roleGrant.createMany({
      data: grants.map(([who, role, branchId, schoolId]) => ({ id: randomUUID(), role, userId: users[who].id, schoolId, branchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' })),
    });
    // A former student: no longer enrolled, no home Branch.
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: users.left.id, schoolId: school.id, revokedAt: new Date() } });
    for (const [who, role, branchId, schoolId] of grants) {
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId, branchId }] });
    }
    await superuser.studentHomeBranch.createMany({
      data: [
        ['ana', north], ['cara', north], ['eve', north],
        ['ben', south], ['dan', south], ['fay', south],
      ].map(([who, branch]) => ({ id: randomUUID(), schoolId: school.id, studentId: users[who as string].id, branchId: (branch as { id: string }).id })),
    });

    for (const type of ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP', 'FRIEND_PASS', 'VISIT_PASS'] as MembershipPlanType[]) {
      plans[type] = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type, title: type, price: type === 'VISIT_PASS' ? 0 : 1000 } })).id;
    }
    const otherPlan = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: otherSchool.id, type: 'SUBSCRIPTION', title: 'Other', price: 1000 } })).id;

    // ana (North): active Subscription.
    await membership('ana', 'SUBSCRIPTION');
    // ben (South): active Weekly Pass, frozen today: still active, also frozen.
    const benWeekly = await membership('ben', 'WEEKLY_PASS', { expiryDate: new Date(Date.now() + 60 * DAY) });
    await superuser.membershipFreeze.create({
      data: {
        id: randomUUID(), membershipId: benWeekly.id, schoolId: school.id, studentId: users.ben.id, status: 'APPROVED',
        startsAt: day(nowTokyo.minus({ days: 2 })), endsAt: day(nowTokyo.plus({ days: 10 })),
      },
    });
    // cara (North): a Visitor (a visit pass, nothing since).
    await membership('cara', 'VISIT_PASS', { expiryDate: new Date(Date.now() + 5 * DAY), giftedById: users.owner.id });
    // dan (South): cancelled Subscription, ended an hour after last month began (Tokyo).
    await membership('dan', 'SUBSCRIPTION', { status: 'EXPIRED', cancelAt: justAfterLastStart, cancelledById: users.dan.id });
    // eve (North): a used-up Class Pack and a Friend Pass: not active.
    await membership('eve', 'CLASS_PACK', { classesRemaining: 0 });
    await membership('eve', 'FRIEND_PASS', { classesRemaining: 1 });
    // fay (South): a Trial in effect: active. A Subscription cancelled for a date still to come: not counted yet.
    await membership('fay', 'TRIAL_MEMBERSHIP', { expiryDate: new Date(Date.now() + 5 * DAY) });
    await membership('fay', 'SUBSCRIPTION', { cancelAt: new Date(Date.now() + 20 * DAY) });
    // left: a Subscription cancelled an hour before last month began, then left the School.
    await membership('left', 'SUBSCRIPTION', { status: 'EXPIRED', cancelAt: justBeforeLastStart });
    // Another School's student: active, cancelled last month, joined last month. Never counted here.
    await membership('otherStudent', 'SUBSCRIPTION', {}, otherSchool.id, otherPlan);
    await membership('otherStudent', 'SUBSCRIPTION', { status: 'EXPIRED', cancelAt: justAfterLastStart }, otherSchool.id, otherPlan);

    // Join dates (Decision 315 item 4): the School's own calendar days.
    await setJoined('ana', day(lastMonth)); // 1st of last month
    await setJoined('ben', day(lastMonth.minus({ days: 1 }))); // last day of the month before
    await setJoined('cara', day(thisMonth));
    await setJoined('dan', day(thisMonth.minus({ months: 13 }))); // outside the 12 months
    await setJoined('eve', day(twoAgo.plus({ days: 3 })));
    await setJoined('fay', day(thisMonth));
    await setJoined('left', day(lastMonth.plus({ days: 4 })));
    await setJoined('otherStudent', day(lastMonth), otherSchool.id);

    // Styles: BJJ (live) and Judo (archived). Ranks created either side of last month's start.
    const bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    const judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo', archivedAt: new Date() } });
    const otherStyle = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: otherSchool.id, name: 'Karate' } });
    const rank = (d: { id: string }, schoolId: string) =>
      superuser.rank.create({ data: { id: randomUUID(), disciplineId: d.id, schoolId, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const bjjWhite = await rank(bjj, school.id);
    const judoWhite = await rank(judo, school.id);
    const karateWhite = await rank(otherStyle, otherSchool.id);
    const studentRank = (who: string, d: { id: string }, r: { id: string }, createdAt: Date, schoolId = school.id) =>
      superuser.studentRank.create({ data: { id: randomUUID(), studentId: users[who].id, disciplineId: d.id, schoolId, currentRankId: r.id, createdAt } });
    await studentRank('ana', bjj, bjjWhite, justAfterLastStart);
    await studentRank('ben', bjj, bjjWhite, justBeforeLastStart);
    await studentRank('left', bjj, bjjWhite, justAfterLastStart); // started, then left: new, not a student now
    await studentRank('cara', judo, judoWhite, justAfterLastStart);
    await studentRank('otherStudent', otherStyle, karateWhite, justAfterLastStart, otherSchool.id);
  });

  afterAll(async () => {
    const schoolIds = [school.id, otherSchool.id];
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipFreeze.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentJoinDate.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffActivity.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('the owner, whole School', () => {
    it('counts Active as the Dashboard does, with Visitors and frozen members as their own numbers', async () => {
      const res = await growth('owner');
      expect(res.status).toBe(200);
      expect(res.body.timeZone).toBe(ZONE);
      expect(res.body.branchIds).toBeNull();
      // ana (Subscription), ben (Weekly Pass, frozen), fay (Trial).
      expect(res.body.activeStudents).toBe(3);
      expect(res.body.visitors).toBe(1); // cara
      expect(res.body.frozen).toBe(1); // ben

      const dashboard = await as('owner').get(`/v1/schools/${school.id}/dashboard`);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.activeStudents).toBe(res.body.activeStudents);
    });

    it('gives the last 12 months in Tokyo, this month last', async () => {
      const { body } = await growth('owner');
      expect(body.months).toHaveLength(12);
      expect(body.months[11].month).toBe(M(thisMonth));
      expect(body.months[0].month).toBe(M(thisMonth.minus({ months: 11 })));
    });

    it('counts new students by their join date, former students included', async () => {
      const { body } = await growth('owner');
      expect(monthRow(body, M(thisMonth)).newStudents).toBe(2); // cara, fay
      expect(monthRow(body, M(lastMonth)).newStudents).toBe(2); // ana (the 1st), left
      expect(monthRow(body, M(twoAgo)).newStudents).toBe(2); // ben (the last day), eve
      // dan joined 13 months ago, the other School's student isn't ours.
      expect(body.months.reduce((n: number, m: { newStudents: number }) => n + m.newStudents, 0)).toBe(6);
    });

    it("buckets cancellations by the School's month, not UTC's, and leaves out ones still to come", async () => {
      const { body } = await growth('owner');
      // dan: an hour into last month in Tokyo (still the month before in UTC).
      expect(monthRow(body, M(lastMonth)).cancelled).toBe(1);
      // left: an hour before last month began.
      expect(monthRow(body, M(twoAgo)).cancelled).toBe(1);
      expect(monthRow(body, M(thisMonth)).cancelled).toBe(0); // fay's ends later
      expect(body.months.reduce((n: number, m: { cancelled: number }) => n + m.cancelled, 0)).toBe(2);
    });

    it('lists live styles with their students now and who started each month', async () => {
      const { body } = await growth('owner');
      expect(body.programmes).toHaveLength(1); // Judo is archived
      const [bjj] = body.programmes;
      expect(bjj.name).toBe('BJJ');
      expect(bjj.students).toBe(2); // ana, ben (left isn't enrolled)
      expect(bjj.newByMonth).toHaveLength(12);
      expect(bjj.newByMonth[10]).toBe(2); // ana and left, an hour into last month
      expect(bjj.newByMonth[9]).toBe(1); // ben, an hour before it
    });

    it('narrows to one Branch by home Branch', async () => {
      const res = await growth('owner', `?branchId=${south.id}`);
      expect(res.status).toBe(200);
      expect(res.body.branchIds).toEqual([south.id]);
      expect(res.body.activeStudents).toBe(2); // ben, fay
      expect(res.body.visitors).toBe(0);
      expect(res.body.frozen).toBe(1);
      expect(monthRow(res.body, M(lastMonth)).cancelled).toBe(1); // dan
      expect(monthRow(res.body, M(twoAgo)).cancelled).toBe(0); // left has no home Branch
      expect(monthRow(res.body, M(lastMonth)).newStudents).toBe(0);
      expect(res.body.programmes[0].students).toBe(1); // ben
    });
  });

  describe('who may see it', () => {
    it('Branch Staff need "See attendance statistics", then see only their own Branches', async () => {
      const off = await growth('staff');
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');

      expect((await setAccess('staff', { attendanceStats: true })).status).toBe(200);
      const on = await growth('staff');
      expect(on.status).toBe(200);
      expect(on.body.branchIds).toEqual([north.id]);
      expect(on.body.activeStudents).toBe(1); // ana
      expect(on.body.visitors).toBe(1); // cara
      expect(on.body.frozen).toBe(0);
      expect(monthRow(on.body, M(lastMonth)).newStudents).toBe(1); // ana
      expect(on.body.months.reduce((n: number, m: { cancelled: number }) => n + m.cancelled, 0)).toBe(0);
      expect(on.body.programmes[0].students).toBe(1);

      const otherBranchHere = await growth('staff', `?branchId=${south.id}`);
      expect(otherBranchHere.status).toBe(403);
      expect(otherBranchHere.body.error.code).toBe('OTHER_BRANCH');
    });

    it('coaches and students see nothing', async () => {
      expect((await growth('coach')).status).toBe(403);
      expect((await growth('ana')).status).toBe(403);
    });

    it("another School's owner can't read this School, and another School's Branch is refused (400)", async () => {
      expect((await growth('otherOwner', '', school.id)).status).toBe(403);
      const foreignBranch = await growth('owner', `?branchId=${otherBranch.id}`);
      expect(foreignBranch.status).toBe(400);
    });

    it("the other School's owner sees only their own School", async () => {
      const res = await growth('otherOwner', '', otherSchool.id);
      expect(res.status).toBe(200);
      expect(res.body.timeZone).toBe('UTC');
      expect(res.body.activeStudents).toBe(1);
      expect(res.body.programmes.map((p: { name: string }) => p.name)).toEqual(['Karate']);
    });
  });
});
