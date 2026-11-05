import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PlanWaitlistProcessor } from '../src/jobs/plan-waitlist.processor';

/**
 * Decision 316 item 5, as answered by Decision 435 items 10-15, over real HTTP
 * against a real Postgres:
 * - 10: live and frozen members and waiting Cash/Bank payments take a place,
 *   each person once;
 * - 11: a freed place is held 24 hours for the first person waiting, who is
 *   told, then passes to the next;
 * - 12: the desk sells over the limit; members can't buy over it;
 * - 13: a number on the plan, blank = no limit;
 * - 14: a parent puts their child on the list;
 * - 15: a lower limit keeps members and closes the plan until there is room.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.REDIS_URL);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[plan-member-limit.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / REDIS_URL not set.');
}

const DAY = 24 * 60 * 60 * 1000;

describeIfDb('Member limit and waiting list (Decision 316 item 5, Decision 435 items 10-15)', () => {
  let app: INestApplication;
  let job: PlanWaitlistProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};
  let school: { id: string };
  let other: { id: string };
  let owner: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token}`),
  });

  async function mkUser(label: string, dateOfBirth = new Date('1990-01-01')) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `plan-limit-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Limit',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }
  async function mkStudent(label: string, schoolId = school.id, dateOfBirth?: Date) {
    const user = await mkUser(label, dateOfBirth);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    tokens[label] = jwt.sign({ sub: user.id, email: user.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId, branchId: null }] });
    return user;
  }
  const mkPlan = (data: Record<string, unknown>) =>
    su.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, title: `Plan ${randomUUID().slice(0, 6)}`, currency: 'GBP', type: 'WEEKLY_PASS', price: 2000, expiryDurationDays: 30, ...data } as never });
  const member = (studentId: string, planId: string, data: Record<string, unknown> = {}) =>
    su.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: planId, schoolId: school.id, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 10 * DAY), ...data } });
  const buy = (who: string, planId: string, body: Record<string, unknown> = {}) => as(tokens[who]).post(`/v1/membership-plans/${planId}/purchase`, body);
  const joinList = (who: string, planId: string, body: Record<string, unknown> = {}) => as(tokens[who]).post(`/v1/membership-plans/${planId}/waitlist`, body);
  const availability = async (who: string, planId: string, studentId?: string) => {
    const res = await as(tokens[who]).get(`/v1/schools/${school.id}/plan-availability${studentId ? `?studentId=${studentId}` : ''}`);
    expect(res.status).toBe(200);
    return res.body.items.find((i: { planId: string }) => i.planId === planId);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    job = app.get(PlanWaitlistProcessor);
    school = await su.school.create({ data: { id: randomUUID(), name: 'Plan limit School', defaultCurrency: 'GBP', timezone: 'Europe/London' } });
    other = await su.school.create({ data: { id: randomUUID(), name: 'Plan limit other School', defaultCurrency: 'GBP' } });
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
    const o = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: o.id, schoolId: school.id, isMainOwner: true } });
    owner = jwt.sign({ sub: o.id, email: o.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  afterAll(async () => {
    const where = { schoolId: { in: [school.id, other.id] } };
    await su.planWaitlistEntry.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: [school.id, other.id] } } });
    await su.$disconnect();
    await app.close();
  });

  it('is a number on the plan; blank is no limit (item 13)', async () => {
    const created = await as(owner).post(`/v1/schools/${school.id}/membership-plans`, { type: 'WEEKLY_PASS', title: 'Kids', price: 2000, expiryDurationDays: 30, memberLimit: 12 });
    expect(created.status).toBe(201);
    expect(created.body.memberLimit).toBe(12);
    expect((await as(owner).patch(`/v1/membership-plans/${created.body.id}`, { memberLimit: 0 })).status).toBe(400);
    const cleared = await as(owner).patch(`/v1/membership-plans/${created.body.id}`, { memberLimit: null });
    expect(cleared.body.memberLimit).toBeNull();
  });

  describe('a plan with two places', () => {
    let plan: { id: string };
    const ids: Record<string, string> = {};
    beforeAll(async () => {
      plan = await mkPlan({ memberLimit: 2, title: 'Small group' });
      for (const label of ['ana', 'ben', 'cara', 'dan', 'eve', 'fay']) ids[label] = (await mkStudent(label)).id;
      // Ana is a member (frozen counts too: a freeze leaves her ACTIVE); Ben's Cash order is waiting.
      await member(ids.ana, plan.id);
      await su.transaction.create({
        data: { id: randomUUID(), schoolId: school.id, studentId: ids.ben, paymentAccountId: (await su.paymentAccount.findUniqueOrThrow({ where: { schoolId: school.id } })).id, membershipPlanId: plan.id, amount: 2000, currency: 'GBP', status: 'PENDING', paymentMethod: 'CASH' },
      });
    });

    it('counts members and waiting Cash payments, and refuses a member buying over the limit (items 10, 12)', async () => {
      const refused = await buy('cara', plan.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('PLAN_FULL');
      expect((await availability('cara', plan.id)).full).toBe(true);
      // Ana already has her place: buying it again isn't refused for the limit.
      expect((await availability('ana', plan.id)).full).toBe(false);
    });

    it('puts members on the waiting list in order; joining twice keeps the place; no line while there is room', async () => {
      const first = await joinList('cara', plan.id);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ status: 'WAITING', position: 1 });
      expect((await joinList('cara', plan.id)).body).toMatchObject({ id: first.body.id, position: 1 });
      expect((await joinList('dan', plan.id)).body.position).toBe(2);
      expect((await availability('dan', plan.id)).waitlist).toMatchObject({ status: 'WAITING', position: 2 });
      expect((await joinList('ana', plan.id)).body.error.code).toBe('ALREADY_A_MEMBER');
      const roomy = await mkPlan({ memberLimit: 5 });
      expect((await joinList('eve', roomy.id)).body.error.code).toBe('PLAN_HAS_ROOM');
      const open = await mkPlan({});
      expect((await joinList('eve', open.id)).body.error.code).toBe('PLAN_HAS_NO_LIMIT');
    });

    it('lets the desk sell over the limit (item 12)', async () => {
      const sale = await as(owner).post(`/v1/schools/${school.id}/students/${ids.fay}/memberships/sell`, { membershipPlanId: plan.id, paymentMethod: 'CASH' });
      expect(sale.status).toBe(201);
      const list = await as(owner).get(`/v1/membership-plans/${plan.id}/waitlist`);
      expect(list.body).toMatchObject({ memberLimit: 2, placesTaken: 3 });
      expect(list.body.items.map((e: { studentId: string }) => e.studentId)).toEqual([ids.cara, ids.dan]);
    });

    it('holds a freed place 24 hours for the first person waiting, who is told and may buy; then passes it on (item 11)', async () => {
      // Two places free up: Fay's membership ends and Ben's Cash order is cancelled.
      await su.membership.updateMany({ where: { studentId: ids.fay, membershipPlanId: plan.id }, data: { expiryDate: new Date(Date.now() - 60_000) } });
      await su.transaction.updateMany({ where: { studentId: ids.ben, membershipPlanId: plan.id }, data: { status: 'FAILED' } });
      // Lowered meanwhile to one place (item 15): Ana keeps hers, nobody is offered.
      await as(owner).patch(`/v1/membership-plans/${plan.id}`, { memberLimit: 1 });
      expect((await job.run(new Date())).offered).toBe(0);
      expect((await su.membership.count({ where: { studentId: ids.ana, membershipPlanId: plan.id, status: 'ACTIVE' } }))).toBe(1);

      await as(owner).patch(`/v1/membership-plans/${plan.id}`, { memberLimit: 2 });
      const now = new Date();
      expect((await job.run(now)).offered).toBe(1);
      const held = await availability('cara', plan.id);
      expect(held).toMatchObject({ full: false, waitlist: { status: 'OFFERED' } });
      expect(new Date(held.waitlist.offerExpiresAt).getTime()).toBe(now.getTime() + DAY);
      // Dan, next in line, can't jump in.
      expect((await buy('dan', plan.id)).body.error.code).toBe('PLAN_FULL');
      let told: unknown[] = [];
      for (let i = 0; i < 50 && told.length === 0; i++) {
        told = await su.notification.findMany({ where: { userId: ids.cara, title: 'A place is free' } });
        if (told.length === 0) await new Promise((r) => setTimeout(r, 100));
      }
      expect(told).toHaveLength(1);

      // Cara lets the 24 hours pass: the place goes to Dan.
      const outcome = await job.run(new Date(now.getTime() + DAY + 60_000));
      expect(outcome.expired).toBe(1);
      expect(await su.planWaitlistEntry.findFirst({ where: { studentId: ids.cara, membershipPlanId: plan.id } })).toMatchObject({ status: 'EXPIRED' });
      expect((await availability('dan', plan.id)).waitlist).toMatchObject({ status: 'OFFERED' });

      // Dan buys it (a Cash order), and his place in line is closed.
      const bought = await buy('dan', plan.id);
      expect(bought.status).toBe(201);
      await as(owner).patch(`/v1/transactions/${bought.body.transactionId}/confirm`);
      await job.run(new Date(now.getTime() + DAY + 120_000));
      expect(await su.planWaitlistEntry.findFirst({ where: { studentId: ids.dan, membershipPlanId: plan.id } })).toMatchObject({ status: 'BOUGHT' });
    });

    it("lets a parent put their child on the list and take them off (item 14); never someone else's child", async () => {
      const child = await mkStudent('kid', school.id, new Date(Date.now() - 9 * 365 * DAY));
      const parent = await mkUser('parent');
      await su.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: child.id } });
      tokens.parent = jwt.sign({ sub: parent.id, email: parent.email, grants: [] });
      const full = await mkPlan({ memberLimit: 1 });
      await member(ids.eve, full.id);
      const joined = await joinList('parent', full.id, { studentId: child.id });
      expect(joined.status).toBe(201);
      expect(await su.planWaitlistEntry.findFirst({ where: { studentId: child.id, membershipPlanId: full.id } })).toMatchObject({ joinedById: parent.id, status: 'WAITING' });
      expect((await availability('parent', full.id, child.id)).waitlist.position).toBe(1);
      expect((await joinList('ben', full.id, { studentId: child.id })).status).toBe(403);
      const left = await as(tokens.parent).delete(`/v1/membership-plans/${full.id}/waitlist?studentId=${child.id}`);
      expect(left.body).toEqual({ left: true });
    });

    it("hides the line from members and other Schools' staff", async () => {
      expect((await as(tokens.eve).get(`/v1/membership-plans/${plan.id}/waitlist`)).status).toBe(403);
      await mkStudent('outsider', other.id);
      expect((await as(tokens.outsider).get(`/v1/schools/${school.id}/plan-availability`)).status).toBe(404);
      expect((await joinList('outsider', plan.id)).status).toBe(404);
    });
  });
});
