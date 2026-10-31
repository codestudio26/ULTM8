/**
 * The rest of a School's check-in rules (v1.3 backlog §3.5):
 * - "Block check-in for overdue payments" (No / after 7 days / after 14 days),
 *   No by default, as before: an overdue charge never stopped a check-in;
 * - "Show belt progress on the check-in screen", on by default, as before;
 * - both read and saved with the other rules, and left as they are by a save
 *   that leaves them out (older clients);
 * - the refusal carries its code and reason on every way in: the coach's scan,
 *   the student's own QR and the front desk's one-step check-in.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { overdueBlocksCheckIn } from '../src/attendance/check-in-rules';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A @db.Date `n` days from today (UTC; the School below has no time zone, so UTC). */
const dayFromToday = (n: number) => new Date(`${new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10)}T00:00:00.000Z`);

const OLD_RULES = {
  opensMinutesBeforeStart: 30,
  closesMinutesAfterStart: null,
  requireWaiver: false,
  otherBranches: true,
  visitors: true,
  severalClasses: true,
  frozenMembers: false,
  codeDigits: 4,
};

describe('overdueBlocksCheckIn', () => {
  it('blocks once more than N days have passed since the due day', () => {
    expect(overdueBlocksCheckIn('2026-11-01', 7, '2026-11-01')).toBe(false);
    expect(overdueBlocksCheckIn('2026-11-01', 7, '2026-11-08')).toBe(false);
    expect(overdueBlocksCheckIn('2026-11-01', 7, '2026-11-09')).toBe(true);
    expect(overdueBlocksCheckIn('2026-11-01', 14, '2026-11-15')).toBe(false);
    expect(overdueBlocksCheckIn('2026-11-01', 14, '2026-11-16')).toBe(true);
    // Across a month end.
    expect(overdueBlocksCheckIn('2026-10-28', 7, '2026-11-05')).toBe(true);
  });
});

describeIfDb('Check-in rules: overdue payments and belt progress (backlog §3.5)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const MIN = 60_000;

  let school: { id: string };
  let main: { id: string };
  let planId: string;
  let invoice = 0;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${tokens[who]}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const rulesUrl = () => `/v1/schools/${school.id}/check-in-rules`;
  const setRules = (rules: Record<string, unknown>) => as('owner').put(rulesUrl()).send({ ...OLD_RULES, ...rules });

  async function classAt(startMin: number, branchId: string | null = null) {
    return superuser.class.create({
      data: {
        id: randomUUID(), schoolId: school.id, branchId, title: `Class ${startMin}`, membershipInclusion: true,
        startDate: new Date(Date.now() + startMin * MIN), endDate: new Date(Date.now() + (startMin + 60) * MIN),
      },
    });
  }
  async function bookedInto(who: string, cls: { id: string }) {
    const m = await superuser.membership.create({
      data: { id: randomUUID(), studentId: users[who].id, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
    return superuser.booking.create({ data: { id: randomUUID(), studentId: users[who].id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });
  }
  async function chargeDue(who: string, dueInDays: number, extra: { cancelledAt?: Date } = {}) {
    invoice += 1;
    return superuser.charge.create({
      data: {
        id: randomUUID(), schoolId: school.id, studentId: users[who].id, invoiceNumber: invoice, description: 'Seminar',
        unitAmount: 1000, taxRateBasisPoints: 0, taxInclusive: true, taxExempt: true, netAmount: 1000, taxAmount: 0, grossAmount: 1000,
        currency: 'GBP', dueDate: dayFromToday(dueInDays), ...extra,
      },
    });
  }
  const scan = (cls: { id: string }, who: string) => as('coach').post(`/v1/classes/${cls.id}/attendance-scan`).send({ studentId: users[who].id });
  const statusOf = async (bookingId: string) => (await superuser.booking.findUniqueOrThrow({ where: { id: bookingId } })).status;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Check-in Rules Rest School' } });
    main = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
    for (const label of ['owner', 'staff', 'coach', 'ana', 'ben', 'cara', 'dan', 'eve', 'fay']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `check-in-rest-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Rest',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    const grants: Array<[string, 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT', string | null]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', null],
      ['staff', 'BRANCH_STAFF', main.id],
      ['coach', 'INSTRUCTOR', null],
      ['ana', 'STUDENT', null],
      ['ben', 'STUDENT', null],
      ['cara', 'STUDENT', null],
      ['dan', 'STUDENT', null],
      ['eve', 'STUDENT', null],
      ['fay', 'STUDENT', null],
    ];
    await superuser.roleGrant.createMany({
      data: grants.map(([who, role, branchId]) => ({ id: randomUUID(), role, userId: users[who].id, schoolId: school.id, branchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' })),
    });
    for (const [who, role, branchId] of grants) {
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId }] });
    }
    planId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
  });

  afterEach(async () => {
    await superuser.school.update({ where: { id: school.id }, data: { checkInBlockOverdueDays: null, checkInShowBeltProgress: true } });
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    await superuser.frontDeskSession.deleteMany({ where });
    await superuser.studentRank.deleteMany({ where });
    await superuser.rankStripeTier.deleteMany({ where });
    await superuser.rank.deleteMany({ where });
    await superuser.discipline.deleteMany({ where });
    await superuser.chargeAllocation.deleteMany({ where });
    await superuser.charge.deleteMany({ where });
    await superuser.trainingLog.deleteMany({ where });
    await superuser.booking.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.staffKioskCode.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('defaults to what check-in did before: never refused for an overdue payment, belt progress shown', async () => {
    const res = await as('owner').get(rulesUrl());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ showBeltProgress: true, blockOverdueDays: null });
    const school1 = await as('owner').get(`/v1/schools/${school.id}`);
    expect(school1.body).toMatchObject({ checkInShowBeltProgress: true, checkInBlockOverdueDays: null });

    // A charge owed for 60 days stops nothing while the rule is No.
    await chargeDue('ana', -60);
    const cls = await classAt(-5);
    await bookedInto('ana', cls);
    expect((await scan(cls, 'ana')).status).toBe(201);
  });

  it('a save that leaves the new rules out keeps them; only No, 7 or 14 are taken', async () => {
    const set = await setRules({ blockOverdueDays: 14, showBeltProgress: false });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ blockOverdueDays: 14, showBeltProgress: false });

    const older = await setRules({ severalClasses: false });
    expect(older.status).toBe(200);
    expect(older.body).toMatchObject({ blockOverdueDays: 14, showBeltProgress: false, severalClasses: false });

    const no = await setRules({ blockOverdueDays: null });
    expect(no.body.blockOverdueDays).toBeNull();

    expect((await setRules({ blockOverdueDays: 10 })).status).toBe(400);
    expect((await setRules({ blockOverdueDays: 0 })).status).toBe(400);
    expect((await setRules({ showBeltProgress: 'yes' })).status).toBe(400);
    await expect(superuser.school.update({ where: { id: school.id }, data: { checkInBlockOverdueDays: 3 } })).rejects.toThrow(/checkInBlockOverdueDays_check/);
  });

  it('Branch Staff change them only with "Change check-in rules"; students never', async () => {
    expect((await as('staff').put(rulesUrl()).send({ ...OLD_RULES, blockOverdueDays: 7 })).status).toBe(403);
    expect((await as('ana').put(rulesUrl()).send({ ...OLD_RULES, blockOverdueDays: 7 })).status).toBe(403);
    expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).checkInBlockOverdueDays).toBeNull();
  });

  it('after 7 days: refuses a member still owing more than 7 days after the due date, with the reason', async () => {
    await chargeDue('ben', -8);
    await chargeDue('cara', -7);
    const cls = await classAt(-5);
    const benBooking = await bookedInto('ben', cls);
    const caraBooking = await bookedInto('cara', cls);
    await setRules({ blockOverdueDays: 7 });

    const refused = await scan(cls, 'ben');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: 'CHECK_IN_PAYMENT_OVERDUE', message: "This School doesn't check members in while a payment is overdue. Pay it in the app or at the desk." });
    expect(await statusOf(benBooking.id)).toBe('UPCOMING');

    // Exactly 7 days after the due date is still allowed.
    expect((await scan(cls, 'cara')).status).toBe(201);
    expect(await statusOf(caraBooking.id)).toBe('COMPLETED');

    // After 14 days: Ben's 8-day-old charge no longer blocks.
    await setRules({ blockOverdueDays: 14 });
    expect((await scan(cls, 'ben')).status).toBe(201);
  });

  it('a paid or cancelled charge never blocks', async () => {
    const paid = await chargeDue('dan', -30);
    await superuser.chargeAllocation.create({ data: { id: randomUUID(), schoolId: school.id, studentId: users.dan.id, chargeId: paid.id, amount: 1000 } });
    await chargeDue('dan', -30, { cancelledAt: new Date() });
    const cls = await classAt(-5);
    await bookedInto('dan', cls);
    await setRules({ blockOverdueDays: 7 });
    expect((await scan(cls, 'dan')).status).toBe(201);
  });

  it("the student's own QR scan and the front desk give the same refusal", async () => {
    await chargeDue('eve', -20);
    const a = await classAt(-5);
    const b = await classAt(-5);
    await bookedInto('eve', a);
    await bookedInto('eve', b);
    await setRules({ blockOverdueDays: 14 });

    const desk = await as('owner').post(`/v1/schools/${school.id}/front-desk/check-ins`).send({ studentId: users.eve.id, classIds: [a.id, b.id] });
    expect(desk.status).toBe(200);
    expect(desk.body.done).toBe(false);
    expect(desk.body.classes.some((c: { ok: boolean; code: string }) => !c.ok && c.code === 'CHECK_IN_PAYMENT_OVERDUE')).toBe(true);
    expect(await superuser.booking.count({ where: { studentId: users.eve.id, status: 'COMPLETED' } })).toBe(0);

    const classToken = await as('coach').get(`/v1/classes/${a.id}/qr-token`);
    expect(classToken.status).toBe(200);
    const self = await as('eve').post('/v1/attendance/scan').send({ classId: a.id, qrToken: classToken.body.token });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('CHECK_IN_PAYMENT_OVERDUE');
  });

  it('the tablet welcome card shows belt progress only while the rule is on', async () => {
    const bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White Belt', primaryColour: '#FFFFFF' } });
    const tier0 = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: white.id, schoolId: school.id, order: 0, count: 0, colour: '#000000', name: 'Rung 0' } });
    await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: white.id, schoolId: school.id, order: 1, count: 1, colour: '#000000', name: 'Rung 1', classesRequired: 40 } });
    await superuser.studentRank.create({ data: { id: randomUUID(), studentId: users.fay.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: white.id, currentStripeId: tier0.id } });

    const session = await as('owner').post(`/v1/schools/${school.id}/front-desk/sessions`).send({ branchId: main.id });
    expect(session.status).toBe(201);
    const from = new Date(Date.now() - 12 * 3_600_000).toISOString();
    const to = new Date(Date.now() + 12 * 3_600_000).toISOString();
    const card = () => http().get(`/v1/front-desk/kiosk/students/${users.fay.id}/card`).query({ startsFrom: from, startsTo: to }).set('Authorization', `Bearer ${session.body.sessionToken}`);

    const shown = await card();
    expect(shown.status).toBe(200);
    expect(shown.body.progress).toMatchObject({ counted: 0, required: 40 });

    await setRules({ showBeltProgress: false });
    const hidden = await card();
    expect(hidden.status).toBe(200);
    expect(hidden.body.progress).toBeNull();
  });
});
