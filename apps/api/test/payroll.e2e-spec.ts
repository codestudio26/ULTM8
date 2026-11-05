/**
 * Decision 320 item 4 — the payroll report (GET /schools/:schoolId/payroll/
 * report) and its rates (GET …/payroll/rates, PUT …/payroll/rates/:userId).
 * Real HTTP against a real Postgres: what counts as a class taught (ended,
 * not cancelled, in range, the coach on that single class), the pay sum, who
 * is left out, owner-only access, and the StaffPayRate RLS policy read
 * directly on the app connection.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Payroll report (Decision 320 item 4)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const branchA = randomUUID();
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`),
    put: (path: string) => http().put(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const rates = (schoolId = schoolA) => `/v1/schools/${schoolId}/payroll/rates`;
  const report = (query: string, schoolId = schoolA) => `/v1/schools/${schoolId}/payroll/report?${query}`;
  const march = 'preset=CUSTOM&from=2026-03-01&to=2026-03-31';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolA, name: 'Payroll School A', defaultCurrency: 'gbp' } });
    await superuser.school.create({ data: { id: schoolB, name: 'Payroll School B' } });
    // A Branch in Tokyo: its classes' local dates are Tokyo dates.
    await superuser.branch.create({ data: { id: branchA, schoolId: schoolA, name: 'Tokyo', timezone: 'Asia/Tokyo' } });

    const mkUser = async (label: string) => {
      const u = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `payroll-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Payroll',
          passcodeHash: 'x',
          phoneVerifiedAt: new Date(),
        },
      });
      users[label] = u;
    };
    for (const label of ['owner', 'ownerB', 'coach', 'sub', 'desk', 'blank', 'leaver', 'student']) await mkUser(label);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: users.owner.id, schoolId: schoolA },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: users.ownerB.id, schoolId: schoolB },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: users.coach.id, schoolId: schoolA },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: users.sub.id, schoolId: schoolA },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: users.desk.id, schoolId: schoolA, branchId: branchA },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: users.blank.id, schoolId: schoolA },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: users.leaver.id, schoolId: schoolA },
        { id: randomUUID(), role: 'STUDENT', userId: users.student.id, schoolId: schoolA },
      ],
    });
    // The School's own name for the coach (Decision 381) is the name shown.
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: schoolA, userId: users.coach.id, displayName: 'Coach Ana' } });

    const grant = (role: string, user: string, schoolId: string, branchId: string | null = null) =>
      jwt.sign({ sub: users[user].id, email: users[user].email, grants: [{ role, franchiseId: null, schoolId, branchId }] });
    tokens.owner = grant('SCHOOL_OWNER_MANAGER', 'owner', schoolA);
    tokens.ownerB = grant('SCHOOL_OWNER_MANAGER', 'ownerB', schoolB);
    tokens.coach = grant('INSTRUCTOR', 'coach', schoolA);
    tokens.desk = grant('BRANCH_STAFF', 'desk', schoolA, branchA);
    tokens.student = grant('STUDENT', 'student', schoolA);

    const cls = (instructor: string | null, start: string, minutes: number, extra: Record<string, unknown> = {}) =>
      superuser.class.create({
        data: {
          id: randomUUID(),
          schoolId: schoolA,
          title: 'Class',
          instructorId: instructor ? users[instructor].id : null,
          startDate: new Date(start),
          endDate: new Date(Date.parse(start) + minutes * 60_000),
          ...extra,
        },
      });
    // The coach taught two classes in March: 60 + 90 minutes.
    await cls('coach', '2026-03-02T18:00:00Z', 60);
    await cls('coach', '2026-03-31T18:00:00Z', 90);
    // Cancelled: not taught.
    await cls('coach', '2026-03-10T18:00:00Z', 60, { cancelledAt: new Date('2026-03-09T00:00:00Z') });
    // Outside the range.
    await cls('coach', '2026-04-01T18:00:00Z', 60);
    await cls('coach', '2026-02-28T18:00:00Z', 60);
    // Still to come: not taught yet.
    await cls('coach', new Date(Date.now() + 86_400_000).toISOString(), 60);
    // A single class whose coach was changed to the substitute: the substitute is paid.
    await cls('sub', '2026-03-05T18:00:00Z', 45);
    // In Tokyo, 31 Mar 20:00 UTC is already 1 Apr: outside March.
    await cls('sub', '2026-03-31T20:00:00Z', 60, { branchId: branchA });
    // In Tokyo, 28 Feb 16:00 UTC is already 1 Mar: inside March.
    await cls('sub', '2026-02-28T16:00:00Z', 30, { branchId: branchA });
    // The leaver taught one class before leaving.
    await cls('leaver', '2026-03-03T18:00:00Z', 60);
    // A class with no coach (an open mat) pays nobody.
    await cls(null, '2026-03-04T18:00:00Z', 60);
    // The blank coach taught, but has no rates: left out.
    await cls('blank', '2026-03-06T18:00:00Z', 60);
  });

  afterAll(async () => {
    const schoolIds = [schoolA, schoolB];
    await superuser.staffPayRate.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  it('lists the staff with blank rates to start with', async () => {
    const res = await as('owner').get(rates());
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('GBP');
    const names = res.body.items.map((i: { name: string }) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Coach Ana', 'sub Payroll', 'desk Payroll', 'owner Payroll']));
    expect(names).not.toContain('student Payroll');
    expect(res.body.items.find((i: { userId: string }) => i.userId === users.desk.id)).toMatchObject({ roles: ['BRANCH_STAFF'], hourlyRate: null, perClassRate: null });
  });

  it('sets rates for the staff', async () => {
    const set = (who: string, hourlyRate: number | null, perClassRate: number | null) => as('owner').put(`${rates()}/${users[who].id}`).send({ hourlyRate, perClassRate });
    expect((await set('coach', 2000, 500)).status).toBe(200);
    expect((await set('sub', null, 1500)).status).toBe(200);
    expect((await set('desk', 1200, null)).status).toBe(200);
    const res = await set('leaver', 3000, 0);
    expect(res.status).toBe(200);
    expect(res.body.items.find((i: { userId: string }) => i.userId === users.coach.id)).toMatchObject({ hourlyRate: 2000, perClassRate: 500 });
  });

  it('refuses a rate for someone not on the staff, and bad amounts', async () => {
    expect((await as('owner').put(`${rates()}/${users.student.id}`).send({ hourlyRate: 1000, perClassRate: null })).status).toBe(404);
    expect((await as('owner').put(`${rates()}/${users.ownerB.id}`).send({ hourlyRate: 1000, perClassRate: null })).status).toBe(404);
    expect((await as('owner').put(`${rates()}/${users.coach.id}`).send({ hourlyRate: -1, perClassRate: null })).status).toBe(400);
    expect((await as('owner').put(`${rates()}/${users.coach.id}`).send({ hourlyRate: 10.5, perClassRate: null })).status).toBe(400);
    expect((await as('owner').put(`${rates()}/${users.coach.id}`).send({ hourlyRate: 1000 })).status).toBe(400);
  });

  it("needs the School's currency before a non-zero rate", async () => {
    const res = await as('ownerB').put(`${rates(schoolB)}/${users.ownerB.id}`).send({ hourlyRate: 1000, perClassRate: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SCHOOL_CURRENCY_REQUIRED');
  });

  it('adds up classes taught × rates over the range, per person', async () => {
    // The leaver leaves after setting their rate: their March classes still count.
    await superuser.roleGrant.updateMany({ where: { schoolId: schoolA, userId: users.leaver.id }, data: { revokedAt: new Date() } });
    const res = await as('owner').get(report(march));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preset: 'CUSTOM', from: '2026-03-01', to: '2026-03-31', currency: 'GBP' });
    const row = (who: string) => res.body.rows.find((r: { userId: string }) => r.userId === users[who].id);
    // 2.5 hours × 20.00 + 2 classes × 5.00
    expect(row('coach')).toMatchObject({ name: 'Coach Ana', onStaff: true, classesTaught: 2, minutesTaught: 150, pay: 6000 });
    // The substitute's own class, and the Tokyo class that falls on 1 March there.
    expect(row('sub')).toMatchObject({ classesTaught: 2, minutesTaught: 75, pay: 3000 });
    // Front desk: no classes taught, so nothing from the hourly rate.
    expect(row('desk')).toMatchObject({ classesTaught: 0, minutesTaught: 0, pay: 0 });
    expect(row('leaver')).toMatchObject({ onStaff: false, classesTaught: 1, minutesTaught: 60, pay: 3000 });
    // No rates: left out.
    expect(row('blank')).toBeUndefined();
    expect(row('owner')).toBeUndefined();
    expect(res.body).toMatchObject({ totalClasses: 5, totalMinutes: 285, totalPay: 12000 });
  });

  it('takes a preset, defaulting to the last 30 days', async () => {
    const res = await as('owner').get(report(''));
    expect(res.status).toBe(200);
    expect(res.body.preset).toBe('LAST_30_DAYS');
    const today = new Date().toISOString().slice(0, 10);
    expect(res.body.to).toBe(today);
    // The class still to come doesn't count.
    expect(res.body.rows.find((r: { userId: string }) => r.userId === users.coach.id).classesTaught).toBe(0);
    expect((await as('owner').get(report('preset=LAST_MONTH'))).status).toBe(200);
  });

  it('refuses a bad range', async () => {
    expect((await as('owner').get(report('preset=CUSTOM&from=2026-03-31&to=2026-03-01'))).status).toBe(400);
    expect((await as('owner').get(report('preset=CUSTOM&from=2024-01-01&to=2026-03-01'))).status).toBe(400);
    expect((await as('owner').get(report('preset=CUSTOM&from=2026-03-01'))).status).toBe(400);
    expect((await as('owner').get(report('preset=CUSTOM&from=2026-02-30&to=2026-03-01'))).status).toBe(400);
    expect((await as('owner').get(report('preset=NEXT_YEAR'))).status).toBe(400);
  });

  it('clearing both rates leaves the person out', async () => {
    const res = await as('owner').put(`${rates()}/${users.leaver.id}`).send({ hourlyRate: null, perClassRate: null });
    expect(res.status).toBe(200);
    // Gone from the rates list too, now they have left and have no rate.
    expect(res.body.items.find((i: { userId: string }) => i.userId === users.leaver.id)).toBeUndefined();
    const after = await as('owner').get(report(march));
    expect(after.body.rows.find((r: { userId: string }) => r.userId === users.leaver.id)).toBeUndefined();
  });

  it('is for the School owner, not coaches, students, other Schools or Branch Staff without the switch', async () => {
    for (const who of ['coach', 'desk', 'student', 'ownerB']) {
      expect([who, (await as(who).get(rates())).status]).toEqual([who, 403]);
      expect([who, (await as(who).get(report(march))).status]).toEqual([who, 403]);
      expect([who, (await as(who).put(`${rates()}/${users.coach.id}`).send({ hourlyRate: 1, perClassRate: 1 })).status]).toEqual([who, 403]);
    }
  });

  it("lets only the School's owners read or write rates on the app connection (RLS)", async () => {
    const asUser = <T>(userId: string, fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) =>
      appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return fn(tx);
      });
    expect(await asUser(users.owner.id, (tx) => tx.staffPayRate.count({ where: { schoolId: schoolA } }))).toBe(3);
    for (const who of ['coach', 'desk', 'ownerB', 'student']) {
      expect([who, await asUser(users[who].id, (tx) => tx.staffPayRate.count())]).toEqual([who, 0]);
    }
    // Another School's owner can't write a rate into School A.
    await expect(
      asUser(users.ownerB.id, (tx) => tx.staffPayRate.create({ data: { id: randomUUID(), schoolId: schoolA, userId: users.coach.id, hourlyRate: 1 } })),
    ).rejects.toThrow();
    expect(await superuser.staffPayRate.count({ where: { schoolId: schoolA } })).toBe(3);
  });

  describe('the "Payroll" switch for Branch Staff (Decision 435 item 22)', () => {
    const asUser = <T>(userId: string, fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) =>
      appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return fn(tx);
      });
    const DEFAULTS = {
      classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, disciplines: false, checkInRules: false,
      exportStudents: false, freezeMemberships: false, attendanceStats: false, memberFiles: false, importData: false, seeMedicalInfo: false, payroll: false,
    };
    const setAccess = (access: Record<string, boolean>) => as('owner').put(`/v1/schools/${schoolA}/staff/${users.desk.id}/access`).send(access);

    it('is off by default: the Branch Staff member sees "off" on their access and is refused', async () => {
      const me = await as('desk').get(`/v1/schools/${schoolA}/staff/me/access`);
      expect(me.status).toBe(200);
      expect(me.body.access.payroll).toBe(false);
      const refused = await as('desk').get(report(march));
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('STAFF_ACCESS_OFF');
      // The owner has it by role.
      expect((await as('owner').get(`/v1/schools/${schoolA}/staff/me/access`)).body.access.payroll).toBe(true);
    });

    it('switched on, they see the whole School: every staff member, every Branch, and set rates', async () => {
      const put = await setAccess({ ...DEFAULTS, payroll: true });
      expect(put.status).toBe(200);
      expect(put.body.access.payroll).toBe(true);
      expect((await superuser.staffPermission.findFirstOrThrow({ where: { schoolId: schoolA, userId: users.desk.id } })).canSeePayroll).toBe(true);

      // Their own grant is for the Tokyo Branch only, yet the report counts
      // the classes with no Branch and shows the School's names.
      const res = await as('desk').get(report(march));
      expect(res.status).toBe(200);
      const row = (who: string) => res.body.rows.find((r: { userId: string }) => r.userId === users[who].id);
      expect(row('coach')).toMatchObject({ name: 'Coach Ana', onStaff: true, classesTaught: 2, minutesTaught: 150, pay: 6000 });
      expect(row('sub')).toMatchObject({ classesTaught: 2, minutesTaught: 75 });

      const list = await as('desk').get(rates());
      expect(list.status).toBe(200);
      expect(list.body.items.map((i: { name: string }) => i.name)).toEqual(expect.arrayContaining(['Coach Ana', 'sub Payroll', 'owner Payroll']));
      const set = await as('desk').put(`${rates()}/${users.blank.id}`).send({ hourlyRate: 900, perClassRate: null });
      expect(set.status).toBe(200);
      expect(set.body.items.find((i: { userId: string }) => i.userId === users.blank.id)).toMatchObject({ hourlyRate: 900 });

      // The database lets them reach this School's rates, and no other School's.
      expect(await asUser(users.desk.id, (tx) => tx.staffPayRate.count({ where: { schoolId: schoolA } }))).toBe(4);
      await expect(
        asUser(users.desk.id, (tx) => tx.staffPayRate.create({ data: { id: randomUUID(), schoolId: schoolB, userId: users.ownerB.id, hourlyRate: 1 } })),
      ).rejects.toThrow();
      // Another School stays closed to them.
      expect((await as('desk').get(rates(schoolB))).status).toBe(403);
    });

    it('a coach never has it, even with the column set; a paused Branch Staff member loses it', async () => {
      await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: schoolA, userId: users.sub.id, canSeePayroll: true } });
      const subToken = jwt.sign({ sub: users.sub.id, email: users.sub.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: schoolA, branchId: null }] });
      expect((await http().get(report(march)).set('Authorization', `Bearer ${subToken}`)).status).toBe(403);
      expect(await asUser(users.sub.id, (tx) => tx.staffPayRate.count())).toBe(0);

      // Paused (Decision 390): the role's revokedAt is set.
      await superuser.roleGrant.updateMany({ where: { schoolId: schoolA, userId: users.desk.id }, data: { revokedAt: new Date(), pausedAt: new Date() } });
      try {
        expect((await as('desk').get(report(march))).status).toBe(403);
        expect(await asUser(users.desk.id, (tx) => tx.staffPayRate.count())).toBe(0);
      } finally {
        await superuser.roleGrant.updateMany({ where: { schoolId: schoolA, userId: users.desk.id }, data: { revokedAt: null, pausedAt: null } });
      }
    });

    it('switched off again, they are refused at once', async () => {
      expect((await setAccess(DEFAULTS)).status).toBe(200);
      expect((await as('desk').get(rates())).status).toBe(403);
      expect(await asUser(users.desk.id, (tx) => tx.staffPayRate.count())).toBe(0);
    });
  });
});
