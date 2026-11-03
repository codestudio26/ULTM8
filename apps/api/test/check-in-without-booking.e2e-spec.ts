/**
 * Decision 422 item 2: the owner can switch off "require a booking" for
 * check-in.
 * - By default a booking is still needed: the app QR, the app code and the
 *   coach's scan all refuse a member who hasn't booked, as before.
 * - Switched off, each of them books a place first, by the booking's own rules
 *   (a full Class is refused as a booking is; the membership that pays, a
 *   pack's credit spent as a booking spends it), then checks in with every
 *   check-in rule (the window, an overdue payment). A refused check-in books
 *   nothing.
 * - Another School's switch changes nothing here.
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

const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;
/** A @db.Date `n` days from today (UTC; the Schools below have no time zone, so UTC). */
const dayFromToday = (n: number) => new Date(`${new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10)}T00:00:00.000Z`);
const NO_BOOKING = 'No Upcoming Booking found for this Student on this Class.';

describeIfDb('Check-in without a booking (Decision 422 item 2)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let elsewhere: { id: string };
  let subscriptionPlanId: string;
  let packPlanId: string;
  let invoice = 0;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${tokens[who]}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const rulesUrl = (schoolId = school.id) => `/v1/schools/${schoolId}/check-in-rules`;
  /** Changes the rules the way the Settings form does: every rule at once. */
  async function setRules(who: string, schoolId: string, changes: Record<string, unknown>) {
    const current = await as(who).get(rulesUrl(schoolId));
    expect(current.status).toBe(200);
    const res = await as(who).put(rulesUrl(schoolId)).send({ ...current.body, ...changes });
    expect(res.status).toBe(200);
    return res;
  }
  const withoutBooking = () => setRules('owner', school.id, { requireBooking: false });

  async function classAt(startMin: number, extra: { capacity?: number; schoolId?: string } = {}) {
    return superuser.class.create({
      data: {
        id: randomUUID(), schoolId: extra.schoolId ?? school.id, title: `Class ${startMin}`, membershipInclusion: true, capacity: extra.capacity ?? null,
        startDate: new Date(Date.now() + startMin * MIN), endDate: new Date(Date.now() + (startMin + 60) * MIN),
      },
    });
  }
  async function subscription(who: string, schoolId = school.id, planId = subscriptionPlanId) {
    return superuser.membership.create({
      data: { id: randomUUID(), studentId: users[who].id, membershipPlanId: planId, schoolId, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
  }
  async function pack(who: string, classes: number) {
    return superuser.membership.create({
      data: { id: randomUUID(), studentId: users[who].id, membershipPlanId: packPlanId, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: classes },
    });
  }
  async function chargeDue(who: string, dueInDays: number) {
    invoice += 1;
    return superuser.charge.create({
      data: {
        id: randomUUID(), schoolId: school.id, studentId: users[who].id, invoiceNumber: invoice, description: 'Seminar',
        unitAmount: 1000, taxRateBasisPoints: 0, taxInclusive: true, taxExempt: true, netAmount: 1000, taxAmount: 0, grossAmount: 1000,
        currency: 'GBP', dueDate: dayFromToday(dueInDays),
      },
    });
  }
  /** The Class's QR and code, as the portal's QR screen shows them. */
  async function classQr(cls: { id: string }, staff = 'coach') {
    const res = await as(staff).get(`/v1/classes/${cls.id}/qr-token`);
    expect(res.status).toBe(200);
    return res.body as { token: string; code: string };
  }
  const appScan = async (cls: { id: string }, who: string) => as(who).post('/v1/attendance/scan').send({ classId: cls.id, qrToken: (await classQr(cls)).token });
  const appCode = async (cls: { id: string }, who: string) => as(who).post('/v1/attendance/code').send({ classId: cls.id, code: (await classQr(cls)).code });
  const coachScan = (cls: { id: string }, who: string, coach = 'coach') => as(coach).post(`/v1/classes/${cls.id}/attendance-scan`).send({ studentId: users[who].id });
  const bookingsOf = (who: string, cls: { id: string }) => superuser.booking.findMany({ where: { studentId: users[who].id, classId: cls.id } });
  const creditsLeft = async (m: { id: string }) => (await superuser.membership.findUniqueOrThrow({ where: { id: m.id } })).classesRemaining;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Check-in Without Booking School' } });
    elsewhere = await superuser.school.create({ data: { id: randomUUID(), name: 'Check-in Without Booking Elsewhere' } });
    for (const label of ['owner', 'staff', 'coach', 'ana', 'ben', 'cara', 'dan', 'eve', 'fay', 'gus', 'hal', 'otherOwner', 'otherCoach', 'ivy']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `check-in-unbooked-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Unbooked',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    const grants: Array<[string, 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT', string]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', school.id],
      ['staff', 'BRANCH_STAFF', school.id],
      ['coach', 'INSTRUCTOR', school.id],
      ['ana', 'STUDENT', school.id],
      ['ben', 'STUDENT', school.id],
      ['cara', 'STUDENT', school.id],
      ['dan', 'STUDENT', school.id],
      ['eve', 'STUDENT', school.id],
      ['fay', 'STUDENT', school.id],
      ['gus', 'STUDENT', school.id],
      ['hal', 'STUDENT', school.id],
      ['otherOwner', 'SCHOOL_OWNER_MANAGER', elsewhere.id],
      ['otherCoach', 'INSTRUCTOR', elsewhere.id],
      ['ivy', 'STUDENT', elsewhere.id],
    ];
    await superuser.roleGrant.createMany({
      data: grants.map(([who, role, schoolId]) => ({ id: randomUUID(), role, userId: users[who].id, schoolId, branchId: null, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' })),
    });
    for (const [who, role, schoolId] of grants) {
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
    }
    subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    packPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5 classes', price: 4000, classesIncluded: 5 } })).id;
  });

  afterEach(async () => {
    await superuser.school.updateMany({
      where: { id: { in: [school.id, elsewhere.id] } },
      data: { checkInRequireBooking: true, checkInBlockOverdueDays: null, checkInOpensMinutesBeforeStart: 30 },
    });
  });

  afterAll(async () => {
    const where = { schoolId: { in: [school.id, elsewhere.id] } };
    await superuser.chargeAllocation.deleteMany({ where });
    await superuser.charge.deleteMany({ where });
    await superuser.trainingLog.deleteMany({ where });
    await superuser.bookingAttendee.deleteMany({ where });
    await superuser.booking.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: [school.id, elsewhere.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('needs a booking by default; the setting is in the check-in rules and on the School', async () => {
    const rules = await as('owner').get(rulesUrl());
    expect(rules.status).toBe(200);
    expect(rules.body.requireBooking).toBe(true);
    expect((await as('owner').get(`/v1/schools/${school.id}`)).body.checkInRequireBooking).toBe(true);

    await subscription('ana');
    const cls = await classAt(-5);
    for (const attempt of [() => appScan(cls, 'ana'), () => appCode(cls, 'ana'), () => coachScan(cls, 'ana')]) {
      const refused = await attempt();
      expect(refused.status).toBe(404);
      expect(refused.body.error.message).toBe(NO_BOOKING);
    }
    expect(await bookingsOf('ana', cls)).toHaveLength(0);
  });

  it('only those who may change the check-in rules switch it; a save that leaves it out keeps it', async () => {
    const off = await withoutBooking();
    expect(off.body.requireBooking).toBe(false);
    expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).checkInRequireBooking).toBe(false);

    const current = (await as('owner').get(rulesUrl())).body;
    expect((await as('staff').put(rulesUrl()).send({ ...current, requireBooking: true })).status).toBe(403);
    expect((await as('coach').put(rulesUrl()).send({ ...current, requireBooking: true })).status).toBe(403);
    expect((await as('ana').put(rulesUrl()).send({ ...current, requireBooking: true })).status).toBe(403);

    const older = { ...current };
    delete older.requireBooking;
    const kept = await as('owner').put(rulesUrl()).send({ ...older, severalClasses: false });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ requireBooking: false, severalClasses: false });
    await setRules('owner', school.id, { severalClasses: true });
  });

  it('switched off, the app QR books a place and checks in, spending a pack credit as a booking does', async () => {
    await withoutBooking();
    // A booking first, for comparison: it spends one credit.
    const bensPack = await pack('ben', 5);
    const booked = await classAt(-10);
    expect((await as('ben').post(`/v1/classes/${booked.id}/book`).send({})).status).toBe(201);
    expect(await creditsLeft(bensPack)).toBe(4);

    const anasPack = await pack('cara', 5);
    const cls = await classAt(-5, { capacity: 10 });
    const res = await appScan(cls, 'cara');
    expect(res.status).toBe(201);
    const [booking] = await bookingsOf('cara', cls);
    expect(booking).toMatchObject({ status: 'COMPLETED', checkInMethod: 'SELF_SERVICE', sourceMembershipId: anasPack.id, schoolId: school.id });
    expect(await creditsLeft(anasPack)).toBe(4);

    // Checked in once: a second scan is refused as a second booking is.
    const again = await appScan(cls, 'cara');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ATTENDED');
    expect(await creditsLeft(anasPack)).toBe(4);
  });

  it('switched off, the app code and the coach scan book and check in too', async () => {
    await withoutBooking();
    await subscription('dan');
    const a = await classAt(-5);
    const b = await classAt(-5);
    expect((await appCode(a, 'dan')).status).toBe(201);
    expect((await coachScan(b, 'dan')).status).toBe(201);
    expect((await bookingsOf('dan', a))[0]).toMatchObject({ status: 'COMPLETED', checkInMethod: 'SELF_SERVICE_CODE' });
    expect((await bookingsOf('dan', b))[0]).toMatchObject({ status: 'COMPLETED', checkInMethod: 'INSTRUCTOR_MANUAL', checkedInById: users.coach.id });
  });

  it('a booked member still checks in to their own booking, with no second place taken', async () => {
    await withoutBooking();
    const m = await pack('eve', 3);
    const cls = await classAt(-5, { capacity: 1 });
    expect((await as('eve').post(`/v1/classes/${cls.id}/book`).send({})).status).toBe(201);
    expect(await creditsLeft(m)).toBe(2);
    expect((await appScan(cls, 'eve')).status).toBe(201);
    const bookings = await bookingsOf('eve', cls);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].status).toBe('COMPLETED');
    expect(await creditsLeft(m)).toBe(2);
  });

  it('a full Class is refused with the booking\'s own message, and nothing is spent', async () => {
    await withoutBooking();
    await subscription('fay');
    const m = await pack('gus', 3);
    const cls = await classAt(-5, { capacity: 1 });
    expect((await as('fay').post(`/v1/classes/${cls.id}/book`).send({})).status).toBe(201);

    const booking = await as('gus').post(`/v1/classes/${cls.id}/book`).send({});
    expect(booking.status).toBe(409);
    expect(booking.body.error.code).toBe('CLASS_FULL');
    for (const attempt of [() => appScan(cls, 'gus'), () => appCode(cls, 'gus'), () => coachScan(cls, 'gus')]) {
      const refused = await attempt();
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: 'CLASS_FULL', message: booking.body.error.message });
    }
    expect(await bookingsOf('gus', cls)).toHaveLength(0);
    expect(await creditsLeft(m)).toBe(3);
  });

  it('no active membership is refused, as a booking is', async () => {
    await withoutBooking();
    const cls = await classAt(-5);
    const booking = await as('hal').post(`/v1/classes/${cls.id}/book`).send({});
    expect(booking.status).toBe(400);
    for (const attempt of [() => appScan(cls, 'hal'), () => coachScan(cls, 'hal')]) {
      const refused = await attempt();
      expect(refused.status).toBe(400);
      expect(refused.body.error.message).toBe(booking.body.error.message);
    }
    expect(await bookingsOf('hal', cls)).toHaveLength(0);
  });

  it('an overdue payment is refused, and the place it would have booked is given back', async () => {
    await setRules('owner', school.id, { requireBooking: false, blockOverdueDays: 7 });
    const m = await pack('ben', 2);
    await superuser.membership.updateMany({ where: { studentId: users.ben.id, id: { not: m.id } }, data: { status: 'EXPIRED' } });
    await chargeDue('ben', -30);
    const cls = await classAt(-5, { capacity: 5 });
    for (const attempt of [() => appScan(cls, 'ben'), () => coachScan(cls, 'ben')]) {
      const refused = await attempt();
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('CHECK_IN_PAYMENT_OVERDUE');
    }
    expect(await bookingsOf('ben', cls)).toHaveLength(0);
    expect(await creditsLeft(m)).toBe(2);
  });

  it('the check-in window still applies: nothing is booked before check-in opens', async () => {
    await withoutBooking();
    // Ana's subscription is from the first test.
    const later = await classAt(90);
    const early = await appScan(later, 'ana');
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('CHECK_IN_NOT_OPEN');
    expect(await bookingsOf('ana', later)).toHaveLength(0);
  });

  it("another School's switch has no effect here", async () => {
    // Elsewhere checks in without a booking; this School still needs one.
    const there = await setRules('otherOwner', elsewhere.id, { requireBooking: false });
    expect(there.body.requireBooking).toBe(false);
    expect((await as('owner').get(rulesUrl())).body.requireBooking).toBe(true);
    // The other School's owner can't change this School's rules.
    expect((await as('otherOwner').put(rulesUrl()).send({ ...there.body, requireBooking: false })).status).toBe(403);

    const otherPlan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: elsewhere.id, type: 'SUBSCRIPTION', title: 'Other unlimited', price: 5000 } });
    await subscription('ivy', elsewhere.id, otherPlan.id);
    await subscription('eve');
    const here = await classAt(-5);
    const thereClass = await classAt(-5, { schoolId: elsewhere.id });

    // Here, unbooked: refused for this School's member, whoever's QR or coach.
    const refused = await appScan(here, 'eve');
    expect(refused.status).toBe(404);
    expect(refused.body.error.message).toBe(NO_BOOKING);
    expect((await coachScan(here, 'eve')).status).toBe(404);
    // The other School's coach can't even see the Class.
    expect((await coachScan(here, 'eve', 'otherCoach')).status).toBe(404);
    // A member of the other School can't use its switch to get into a Class here.
    expect((await appScan(here, 'ivy')).status).toBe(404);
    // Nor can this School's member use it to check in there.
    const qrThere = (await classQr(thereClass, 'otherCoach')).token;
    expect((await as('eve').post('/v1/attendance/scan').send({ classId: thereClass.id, qrToken: qrThere })).status).toBe(404);
    expect(await superuser.booking.count({ where: { classId: { in: [here.id, thereClass.id] } } })).toBe(0);

    // There, it works for its own member.
    expect((await as('ivy').post('/v1/attendance/scan').send({ classId: thereClass.id, qrToken: qrThere })).status).toBe(201);
    expect((await bookingsOf('ivy', thereClass))[0]).toMatchObject({ status: 'COMPLETED', schoolId: elsewhere.id });
  });
});
