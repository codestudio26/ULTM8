/**
 * A School's check-in rules (Decision 394, front-desk handover F9):
 * - every default is what check-in did before the rules;
 * - each rule refuses with its own code, the same way in for the coach's
 *   scan and the front desk;
 * - the owner changes them, and Branch Staff only with "Change check-in rules".
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

const DEFAULT_RULES: {
  opensMinutesBeforeStart: number;
  closesMinutesAfterStart: number | null;
  requireWaiver: boolean;
  otherBranches: boolean;
  visitors: boolean;
  severalClasses: boolean;
  frozenMembers: boolean;
  showBeltProgress: boolean;
  blockOverdueDays: number | null;
  codeDigits: number;
} = {
  opensMinutesBeforeStart: 30,
  closesMinutesAfterStart: null,
  requireWaiver: false,
  otherBranches: true,
  visitors: true,
  severalClasses: true,
  // Decision 404: frozen members can't check in by default.
  frozenMembers: false,
  // Backlog §3.5: belt progress shown, never refused for an overdue payment.
  showBeltProgress: true,
  blockOverdueDays: null,
  codeDigits: 4,
};
const ACCESS_OFF = { classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false, disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false };

describeIfDb('Check-in rules (Decision 394)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const MIN = 60_000;

  let school: { id: string };
  let main: { id: string };
  let other: { id: string };
  let planId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${tokens[who]}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const rulesUrl = () => `/v1/schools/${school.id}/check-in-rules`;
  const setRules = (rules: Partial<typeof DEFAULT_RULES>) => as('owner').put(rulesUrl()).send({ ...DEFAULT_RULES, ...rules });

  async function classAt(startMin: number, branchId: string | null = null, minutes = 60) {
    return superuser.class.create({
      data: {
        id: randomUUID(), schoolId: school.id, branchId, title: `Class ${startMin}`, membershipInclusion: true,
        startDate: new Date(Date.now() + startMin * MIN), endDate: new Date(Date.now() + (startMin + minutes) * MIN),
      },
    });
  }
  async function bookedInto(who: string, cls: { id: string }, membershipPlanId = planId) {
    const m = await superuser.membership.create({
      data: { id: randomUUID(), studentId: users[who].id, membershipPlanId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
    return superuser.booking.create({ data: { id: randomUUID(), studentId: users[who].id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });
  }
  const scan = (cls: { id: string }, who: string) => as('coach').post(`/v1/classes/${cls.id}/attendance-scan`).send({ studentId: users[who].id });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Check-in Rules School' } });
    main = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
    other = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Other' } });
    for (const label of ['owner', 'staff', 'coach', 'ana', 'ben', 'cara', 'dan', 'eve']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `check-in-rules-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Rules',
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
    await superuser.school.update({
      where: { id: school.id },
      data: {
        checkInOpensMinutesBeforeStart: 30, checkInClosesMinutesAfterStart: null, checkInRequireWaiver: false,
        checkInOtherBranches: true, checkInVisitors: true, checkInSeveralClasses: true, checkInFrozenMembers: false, checkInCodeDigits: 4,
      },
    });
  });

  afterAll(async () => {
    await superuser.waiverSignature.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiver.deleteMany({ where: { schoolId: school.id } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('defaults to what check-in did before the rules', async () => {
    const res = await as('owner').get(rulesUrl());
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_RULES);
  });

  it('the owner changes them; Branch Staff only with the switch; coaches and students never', async () => {
    const changed = await setRules({ closesMinutesAfterStart: 15, requireWaiver: true, codeDigits: 6 });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ closesMinutesAfterStart: 15, requireWaiver: true, codeDigits: 6 });
    expect(await superuser.school.findUniqueOrThrow({ where: { id: school.id }, select: { checkInCodeDigits: true } })).toEqual({ checkInCodeDigits: 6 });

    const refused = await as('staff').get(rulesUrl());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you change the check-in rules." });
    expect((await as('coach').get(rulesUrl())).status).toBe(403);
    expect((await as('ana').put(rulesUrl()).send(DEFAULT_RULES)).status).toBe(403);

    const switched = await as('owner').put(`/v1/schools/${school.id}/staff/${users.staff.id}/access`).send({ ...ACCESS_OFF, checkInRules: true });
    expect(switched.status).toBe(200);
    expect((await as('staff').get(rulesUrl())).status).toBe(200);
    const byStaff = await as('staff').put(rulesUrl()).send({ ...DEFAULT_RULES, severalClasses: false });
    expect(byStaff.status).toBe(200);
    expect(byStaff.body.severalClasses).toBe(false);

    await as('owner').put(`/v1/schools/${school.id}/staff/${users.staff.id}/access`).send(ACCESS_OFF);
    expect((await as('staff').get(rulesUrl())).status).toBe(403);
  });

  it('refuses rules outside their limits', async () => {
    expect((await setRules({ opensMinutesBeforeStart: -1 })).status).toBe(400);
    expect((await setRules({ closesMinutesAfterStart: 2000 })).status).toBe(400);
    expect((await setRules({ codeDigits: 5 })).status).toBe(400);
  });

  it('closes check-in the set minutes after the start', async () => {
    const started = await classAt(-20);
    await bookedInto('ana', started);
    await setRules({ closesMinutesAfterStart: 10 });
    const late = await scan(started, 'ana');
    expect(late.status).toBe(400);

    await setRules({ closesMinutesAfterStart: 30 });
    expect((await scan(started, 'ana')).status).toBe(201);
  });

  it('opens check-in the set minutes before the start', async () => {
    const soon = await classAt(20);
    await bookedInto('ben', soon);
    await setRules({ opensMinutesBeforeStart: 10 });
    const early = await scan(soon, 'ben');
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('CHECK_IN_NOT_OPEN');
    await setRules({ opensMinutesBeforeStart: 30 });
    expect((await scan(soon, 'ben')).status).toBe(201);
  });

  it('needs a signed waiver only when the rule is on', async () => {
    const cls = await classAt(-5);
    const booking = await bookedInto('cara', cls);
    await setRules({ requireWaiver: true });
    const refused = await scan(cls, 'cara');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CHECK_IN_WAIVER_REQUIRED');
    expect((await superuser.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('UPCOMING');

    const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Text' } });
    await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: waiver.id, studentId: users.cara.id, schoolId: school.id, status: 'SIGNED', signerFullName: 'Cara Rules', signatureText: 'Cara Rules', signedDate: new Date() },
    });
    expect((await scan(cls, 'cara')).status).toBe(201);
  });

  it('checks members in only at their home Branch when other Branches are off', async () => {
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: users.dan.id, branchId: main.id } });
    const there = await classAt(-5, other.id);
    const home = await classAt(-5, main.id);
    const wholeSchool = await classAt(-5);
    await bookedInto('dan', there);
    await bookedInto('dan', home);
    await bookedInto('dan', wholeSchool);
    // Eve has no home Branch, so there is nowhere "other" for her.
    await bookedInto('eve', there);
    await setRules({ otherBranches: false });

    const refused = await scan(there, 'dan');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CHECK_IN_HOME_BRANCH_ONLY');
    expect((await scan(home, 'dan')).status).toBe(201);
    expect((await scan(wholeSchool, 'dan')).status).toBe(201);
    expect((await scan(there, 'eve')).status).toBe(201);
  });

  it('refuses visit passes when visitors are off', async () => {
    const visitPlan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'VISIT_PASS', title: 'Visit', price: 0 } });
    const cls = await classAt(-5);
    await bookedInto('eve', cls, visitPlan.id);
    await setRules({ visitors: false });
    const refused = await scan(cls, 'eve');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CHECK_IN_VISITORS_OFF');
    await setRules({ visitors: true });
    expect((await scan(cls, 'eve')).status).toBe(201);
  });

  it('the front desk checks in to one class at a time when several classes are off', async () => {
    const a = await classAt(-5);
    const b = await classAt(10);
    await bookedInto('ana', a);
    await bookedInto('ana', b);
    await setRules({ severalClasses: false });
    const desk = (classIds: string[]) => as('coach').post(`/v1/schools/${school.id}/front-desk/check-ins`).send({ studentId: users.ana.id, classIds });

    const both = await desk([a.id, b.id]);
    expect(both.status).toBe(200);
    expect(both.body.done).toBe(false);
    expect(both.body.classes.every((c: { ok: boolean; code: string }) => !c.ok && c.code === 'CHECK_IN_ONE_CLASS')).toBe(true);
    expect(await superuser.booking.count({ where: { studentId: users.ana.id, classId: { in: [a.id, b.id] }, status: 'COMPLETED' } })).toBe(0);

    const one = await desk([a.id]);
    expect(one.body.done).toBe(true);
  });
});
