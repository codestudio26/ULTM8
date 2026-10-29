import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Decision 391 — Visitors (Decision 315 item 1): the School sets how long a
 * visit pass lasts (no default), staff give passes, a Visitor books free while
 * a pass lasts, and the hidden visit-pass plan never shows up as a plan.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[visitors.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describeIfDb('Visitors and visit passes (Decision 391)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  let tokenOwner: string;
  let tokenStaffA: string;
  let staffA: { id: string; email: string };
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const give = (studentId: string, token = tokenOwner) =>
    http().post(`/v1/schools/${school.id}/students/${studentId}/visit-passes`).set('Authorization', `Bearer ${token}`).send();
  const roster = (token = tokenOwner) => http().get(`/v1/schools/${school.id}/students`).set('Authorization', `Bearer ${token}`);
  const setPeriod = (days: number | null) =>
    http().patch(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${tokenOwner}`).send({ visitorPeriodDays: days });

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `visitors-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Visitor',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkStudent(label: string, branchId = branchA.id) {
    const user = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
    await superuser.studentHomeBranch.create({ data: { schoolId: school.id, studentId: user.id, branchId } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
    return { user, token };
  }

  async function mkClass(startsIn: number) {
    return superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branchA.id,
        title: 'Fundamentals',
        startDate: new Date(Date.now() + startsIn),
        endDate: new Date(Date.now() + startsIn + HOUR),
        membershipInclusion: true,
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Visitors School' } });
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    const owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    tokenOwner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    staffA = await mkUser('staffA');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staffA.id, schoolId: school.id, branchId: branchA.id } });
    tokenStaffA = jwt.sign({ sub: staffA.id, email: staffA.email, grants: [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchA.id }] });
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    await superuser.booking.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.studentHomeBranch.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('has no default period: no pass can be given until the School sets one', async () => {
    const { user } = await mkStudent('early');
    const school0 = await http().get(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${tokenOwner}`);
    expect(school0.body.visitorPeriodDays).toBeNull();
    const res = await give(user.id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VISITOR_PERIOD_NOT_SET');
    expect((await setPeriod(0)).status).toBe(400);
    const set = await setPeriod(10);
    expect(set.status).toBe(200);
    expect(set.body.visitorPeriodDays).toBe(10);
  });

  it('gives a pass for the period; the student is a Visitor and books and checks in free', async () => {
    const { user, token } = await mkStudent('ana');
    const res = await give(user.id);
    expect(res.status).toBe(201);
    const ends = new Date(res.body.membership.expiryDate).getTime();
    expect(Math.abs(ends - (Date.now() + 10 * DAY))).toBeLessThan(60_000);
    expect(res.body.transactionId).toBeNull();

    const row = (await roster()).body.items.find((s: { id: string }) => s.id === user.id);
    expect(row).toMatchObject({ visitor: true });
    expect(new Date(row.visitPassEndsAt).getTime()).toBe(ends);

    const mine = await http().get('/v1/memberships/me').set('Authorization', `Bearer ${token}`);
    expect(mine.body.items).toEqual([expect.objectContaining({ id: res.body.membership.id, visitPass: true })]);

    const cls = await mkClass(2 * HOUR);
    const book = await http().post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${token}`).send({});
    expect(book.status).toBe(201);
    expect(await superuser.transaction.count({ where: { studentId: user.id } })).toBe(0);
  });

  it('a second pass starts when the running one ends; a double click is refused', async () => {
    const { user } = await mkStudent('ben');
    const first = await give(user.id);
    expect(first.status).toBe(201);
    const again = await give(user.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DESK_REPEAT');
    await superuser.membership.update({ where: { id: first.body.membership.id }, data: { createdAt: new Date(Date.now() - 2 * 60_000) } });
    const second = await give(user.id);
    expect(second.status).toBe(201);
    expect(new Date(second.body.membership.startDate).getTime()).toBe(new Date(first.body.membership.expiryDate).getTime());
    expect(new Date(second.body.membership.expiryDate).getTime()).toBe(new Date(first.body.membership.expiryDate).getTime() + 10 * DAY);
  });

  it('once the pass has ended the Visitor stays a Visitor but cannot book', async () => {
    const { user, token } = await mkStudent('cara');
    const pass = await give(user.id);
    await superuser.membership.update({ where: { id: pass.body.membership.id }, data: { expiryDate: new Date(Date.now() - DAY) } });
    const row = (await roster()).body.items.find((s: { id: string }) => s.id === user.id);
    expect(row.visitor).toBe(true);
    const cls = await mkClass(3 * HOUR);
    const book = await http().post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${token}`).send({});
    expect(book.status).toBe(400);
  });

  it('a membership makes a Visitor a member, and a member gets no pass while it lasts', async () => {
    const { user } = await mkStudent('dan');
    await give(user.id);
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Ten', type: 'CLASS_PACK', price: 5000, classesIncluded: 10 } });
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: user.id, membershipPlanId: plan.id, schoolId: school.id, frequency: 'ONE_TIME', classesRemaining: 10 },
    });
    const row = (await roster()).body.items.find((s: { id: string }) => s.id === user.id);
    expect(row).toMatchObject({ visitor: false, visitPassEndsAt: null });
    const res = await give(user.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VISITOR_HAS_MEMBERSHIP');
  });

  it('Branch Staff give passes to their own branch\'s students, only with the students switch on', async () => {
    const { user: mine } = await mkStudent('eve', branchA.id);
    const { user: other } = await mkStudent('fay', branchB.id);
    expect((await give(mine.id, tokenStaffA)).status).toBe(201);
    expect((await give(other.id, tokenStaffA)).status).toBe(403);
    await superuser.staffPermission.upsert({
      where: { schoolId_userId: { schoolId: school.id, userId: staffA.id } },
      create: { schoolId: school.id, userId: staffA.id, canManageStudents: false },
      update: { canManageStudents: false },
    });
    const { user: third } = await mkStudent('gus', branchA.id);
    const off = await give(third.id, tokenStaffA);
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');
    await superuser.staffPermission.deleteMany({ where: { schoolId: school.id, userId: staffA.id } });
  });

  it('a student cannot give themselves a pass, and a coach cannot give one', async () => {
    const { user, token } = await mkStudent('hal');
    expect((await give(user.id, token)).status).toBe(403);
    const coach = await mkUser('coach');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id, branchId: branchA.id } });
    const coachToken = jwt.sign({ sub: coach.id, email: coach.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: branchA.id }] });
    expect((await give(user.id, coachToken)).status).toBe(403);
  });

  it('the hidden plan is one per School and never listed, read, sold or bought', async () => {
    const plans = await superuser.membershipPlan.findMany({ where: { schoolId: school.id, type: 'VISIT_PASS' } });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ price: 0, visible: false });
    const list = await http().get(`/v1/schools/${school.id}/membership-plans`).set('Authorization', `Bearer ${tokenOwner}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(plans[0].id);
    expect((await http().get(`/v1/membership-plans/${plans[0].id}`).set('Authorization', `Bearer ${tokenOwner}`)).status).toBe(404);
    expect((await http().patch(`/v1/membership-plans/${plans[0].id}`).set('Authorization', `Bearer ${tokenOwner}`).send({ price: 100 })).status).toBe(404);
    const { user, token } = await mkStudent('ivy');
    const sell = await http()
      .post(`/v1/schools/${school.id}/students/${user.id}/memberships/sell`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ membershipPlanId: plans[0].id, paymentMethod: 'CASH' });
    expect(sell.status).toBe(404);
    const buy = await http().post(`/v1/membership-plans/${plans[0].id}/purchase`).set('Authorization', `Bearer ${token}`).send({});
    expect(buy.status).toBe(404);
    const created = await http()
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'VISIT_PASS', title: 'Sneaky', price: 0 });
    expect(created.status).toBe(400);
    // Nor does it count as the School's first plan, or a visit pass as an active student.
    await superuser.membershipPlan.updateMany({ where: { schoolId: school.id, type: 'CLASS_PACK' }, data: { archivedAt: new Date() } });
    const dash = await http().get(`/v1/schools/${school.id}/dashboard`).set('Authorization', `Bearer ${tokenOwner}`);
    expect(dash.body.setupChecklist.steps.find((st: { key: string }) => st.key === 'MEMBERSHIP_PLAN').done).toBe(false);
    expect(dash.body.activeStudents).toBe(1); // dan's Class Pack only
  });

  it('turning the period off stops new passes', async () => {
    expect((await setPeriod(null)).status).toBe(200);
    const { user } = await mkStudent('jon');
    expect((await give(user.id)).body.error.code).toBe('VISITOR_PERIOD_NOT_SET');
  });
});
