import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PlanSwitchProcessor } from '../src/jobs/plan-switch.processor';
import { fakePaymentCheckoutSession } from './stripe-fakes';

/**
 * Decision 316 item 4, as answered by Decision 435 items 7-9, over real HTTP
 * against a real Postgres, with Stripe faked:
 * - item 7: a Class Pack, Weekly Pass or Trial can start on the first
 *   check-in (never a Subscription); its days start with that check-in;
 * - item 8: a plan on fixed dates runs from its first to its last day in the
 *   School's time zone, is sold before and during them at full price, never
 *   after; it pays for no class before its first day;
 * - item 9: a plan switches to another when it ends only for a member who
 *   agreed when buying; they are told before; the next plan is charged to
 *   their saved card; without one (or declined) it simply ends, and nothing
 *   is owed.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.REDIS_URL);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[plan-dates.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / REDIS_URL not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const ZONE = 'Asia/Tokyo';
const dayInZone = (offset: number) => DateTime.now().setZone(ZONE).plus({ days: offset }).toISODate() as string;

describeIfDb('Plan start and end dates (Decision 316 item 4, Decision 435 items 7-9)', () => {
  let app: INestApplication;
  let switcher: PlanSwitchProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const tokens: Record<string, string> = {};

  // The fake Stripe: a saved card whose next charge succeeds or is declined.
  let declineNext = false;
  const intents: Array<{ amount: number; idempotencyKey?: string }> = [];
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      customers: { retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })) },
      paymentIntents: {
        create: jest.fn(async (params: { amount: number }, opts?: { idempotencyKey?: string }) => {
          intents.push({ amount: params.amount, idempotencyKey: opts?.idempotencyKey });
          const id = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          const declined = declineNext;
          declineNext = false;
          return { id, client_secret: `${id}_secret`, status: declined ? 'requires_payment_method' : 'succeeded' };
        }),
      },
      checkout: { sessions: { create: jest.fn(async (params: { metadata?: Record<string, string> }) => fakePaymentCheckoutSession(params)) } },
      refunds: { create: jest.fn(async () => ({ id: `re_${randomUUID()}` })) },
    })),
    platformClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const sign = (user: { id: string; email: string }, role: string, schoolId: string) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `plan-dates-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Dates',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkSchool(label: string, provider: 'STRIPE' | 'CASH') {
    const school = await su.school.create({ data: { id: randomUUID(), name: `Plan dates ${label}`, timezone: ZONE, defaultCurrency: 'GBP', addressCountry: 'GB' } });
    schoolIds.push(school.id);
    await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider, accountTitle: provider, country: 'GB', stripeConnectedAccountId: provider === 'STRIPE' ? `acct_${randomUUID().slice(0, 12)}` : undefined },
    });
    const owner = await mkUser(`${label}-owner`);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokens[`${label}-owner`] = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    const coach = await mkUser(`${label}-coach`);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id } });
    tokens[`${label}-coach`] = sign(coach, 'INSTRUCTOR', school.id);
    return { school, owner: tokens[`${label}-owner`], coach: tokens[`${label}-coach`] };
  }
  type School = Awaited<ReturnType<typeof mkSchool>>;

  async function mkStudent(s: School, label: string) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: s.school.id } });
    tokens[label] = sign(user, 'STUDENT', s.school.id);
    return user;
  }

  const mkPlan = (s: School, data: Record<string, unknown>) =>
    su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, title: `Plan ${randomUUID().slice(0, 6)}`, currency: 'GBP', ...data } as never });
  const createPlan = (s: School, body: Record<string, unknown>) => as(s.owner).post(`/v1/schools/${s.school.id}/membership-plans`, { title: 'Plan', price: 3000, ...body });
  const sell = (s: School, studentId: string, planId: string) =>
    as(s.owner).post(`/v1/schools/${s.school.id}/students/${studentId}/memberships/sell`, { membershipPlanId: planId, paymentMethod: 'CASH' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    switcher = app.get(PlanSwitchProcessor);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.trainingLog.deleteMany({ where });
    await su.booking.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.updateMany({ where, data: { switchToPlanId: null } });
    await su.membershipPlan.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('the owner sets them on a plan', () => {
    let s: School;
    beforeAll(async () => {
      s = await mkSchool('rules', 'CASH');
    });

    it('offers "starts on first check-in" for packs, passes and trials, never a Subscription', async () => {
      const sub = await createPlan(s, { type: 'SUBSCRIPTION', startsOnFirstCheckIn: true });
      expect(sub.status).toBe(400);
      expect(sub.body.error.code).toBe('FIRST_CHECK_IN_NOT_FOR_TYPE');
      const pass = await createPlan(s, { type: 'WEEKLY_PASS', expiryDurationDays: 7, startsOnFirstCheckIn: true });
      expect(pass.status).toBe(201);
      expect(pass.body.startsOnFirstCheckIn).toBe(true);
      const noDays = await createPlan(s, { type: 'CLASS_PACK', classesIncluded: 10, startsOnFirstCheckIn: true });
      expect(noDays.body.error.code).toBe('FIRST_CHECK_IN_NEEDS_DAYS');
    });

    it('takes fixed dates in place of a number of days, both days, in order, real ones', async () => {
      const camp = await createPlan(s, { type: 'WEEKLY_PASS', fixedStartDate: '2027-07-01', fixedEndDate: '2027-08-11' });
      expect(camp.status).toBe(201);
      expect(camp.body.fixedStartDate.slice(0, 10)).toBe('2027-07-01');
      expect((await createPlan(s, { type: 'WEEKLY_PASS', expiryDurationDays: 7, fixedStartDate: '2027-07-01', fixedEndDate: '2027-08-11' })).body.error.code).toBe('PLAN_TERM_CONFLICT');
      expect((await createPlan(s, { type: 'WEEKLY_PASS', fixedStartDate: '2027-07-01' })).body.error.code).toBe('FIXED_DATES_NEED_BOTH');
      expect((await createPlan(s, { type: 'WEEKLY_PASS', fixedStartDate: '2027-08-01', fixedEndDate: '2027-07-01' })).body.error.code).toBe('FIXED_DATES_ORDER');
      expect((await createPlan(s, { type: 'WEEKLY_PASS', fixedStartDate: '2027-02-30', fixedEndDate: '2027-03-01' })).body.error.code).toBe('FIXED_DATES_INVALID');
      expect((await createPlan(s, { type: 'SUBSCRIPTION', fixedStartDate: '2027-07-01', fixedEndDate: '2027-08-11' })).body.error.code).toBe('FIXED_DATES_NOT_FOR_TYPE');
      expect((await createPlan(s, { type: 'WEEKLY_PASS', fixedStartDate: '2027-07-01', fixedEndDate: '2027-08-11', startsOnFirstCheckIn: true })).body.error.code).toBe('PLAN_TERM_CONFLICT');
      // Dates can be taken off again, given a number of days.
      const off = await as(s.owner).patch(`/v1/membership-plans/${camp.body.id}`, { fixedStartDate: null, fixedEndDate: null, expiryDurationDays: 30 });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ fixedStartDate: null, fixedEndDate: null, expiryDurationDays: 30 });
    });

    it('switches only from a plan with an end, to a paid pack, pass or trial of the School without a contract', async () => {
      const next = await createPlan(s, { type: 'CLASS_PACK', classesIncluded: 10 });
      const monthly = await createPlan(s, { type: 'SUBSCRIPTION' });
      const ok = await createPlan(s, { type: 'WEEKLY_PASS', expiryDurationDays: 7, switchToPlanId: next.body.id });
      expect(ok.status).toBe(201);
      expect(ok.body.switchToPlanId).toBe(next.body.id);
      expect((await createPlan(s, { type: 'WEEKLY_PASS', expiryDurationDays: 7, switchToPlanId: monthly.body.id })).body.error.code).toBe('SWITCH_TARGET_INVALID');
      expect((await createPlan(s, { type: 'CLASS_PACK', classesIncluded: 5, switchToPlanId: next.body.id })).body.error.code).toBe('SWITCH_NEEDS_END');
      expect((await createPlan(s, { type: 'SUBSCRIPTION', switchToPlanId: next.body.id })).body.error.code).toBe('SWITCH_NEEDS_END');
      expect((await as(s.owner).patch(`/v1/membership-plans/${next.body.id}`, { expiryDurationDays: 30, switchToPlanId: next.body.id })).body.error.code).toBe('SWITCH_TARGET_INVALID');
    });
  });

  describe('starts on the first check-in', () => {
    let s: School;
    beforeAll(async () => {
      s = await mkSchool('first', 'CASH');
    });

    it('has no end until the first check-in with it, which starts its days from the class', async () => {
      const pass = await mkPlan(s, { type: 'WEEKLY_PASS', price: 2000, expiryDurationDays: 7, startsOnFirstCheckIn: true });
      const student = await mkStudent(s, 'first-student');
      const sold = await sell(s, student.id, pass.id);
      expect(sold.status).toBe(201);
      const before = await su.membership.findUniqueOrThrow({ where: { id: sold.body.membership.id } });
      expect(before).toMatchObject({ awaitingFirstCheckIn: true, expiryDate: null });

      const classStart = new Date(Date.now() - 5 * 60_000);
      const cls = await su.class.create({ data: { id: randomUUID(), schoolId: s.school.id, title: 'Kids', startDate: classStart, endDate: new Date(Date.now() + 55 * 60_000) } });
      await su.booking.create({ data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: s.school.id, sourceMembershipId: before.id } });
      const checkIn = await as(s.coach).post(`/v1/classes/${cls.id}/attendance-scan`, { studentId: student.id });
      expect(checkIn.status).toBe(201);
      const after = await su.membership.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.awaitingFirstCheckIn).toBe(false);
      expect(after.startDate.getTime()).toBe(classStart.getTime());
      expect(after.expiryDate!.getTime()).toBe(DateTime.fromJSDate(classStart, { zone: ZONE }).plus({ days: 7 }).toMillis());
    });
  });

  describe('fixed dates', () => {
    let s: School;
    beforeAll(async () => {
      s = await mkSchool('camp', 'CASH');
    });

    it('a camp bought before it starts runs from its first day to the end of its last, and pays for no class before', async () => {
      const camp = await mkPlan(s, { type: 'WEEKLY_PASS', price: 12000, fixedStartDate: new Date(`${dayInZone(10)}T00:00:00Z`), fixedEndDate: new Date(`${dayInZone(51)}T00:00:00Z`) });
      const student = await mkStudent(s, 'camp-early');
      const sold = await sell(s, student.id, camp.id);
      expect(sold.status).toBe(201);
      const m = await su.membership.findUniqueOrThrow({ where: { id: sold.body.membership.id } });
      expect(m.startDate.getTime()).toBe(DateTime.fromISO(dayInZone(10), { zone: ZONE }).toMillis());
      expect(m.expiryDate!.getTime()).toBe(DateTime.fromISO(dayInZone(52), { zone: ZONE }).toMillis());
      expect(await su.transaction.findFirstOrThrow({ where: { membershipId: m.id } })).toMatchObject({ amount: 12000 });

      const cls = await su.class.create({ data: { id: randomUUID(), schoolId: s.school.id, title: 'Open', startDate: new Date(Date.now() + DAY), endDate: new Date(Date.now() + DAY + 3_600_000) } });
      const book = await as(tokens['camp-early']).post(`/v1/classes/${cls.id}/book`);
      expect(book.status).toBe(400);
      expect(book.body.error.code).toBe('PLAN_NOT_STARTED');
    });

    it('is sold at full price once started, starting now; never after its last day', async () => {
      const running = await mkPlan(s, { type: 'CLASS_PACK', price: 8000, classesIncluded: 12, fixedStartDate: new Date(`${dayInZone(-5)}T00:00:00Z`), fixedEndDate: new Date(`${dayInZone(5)}T00:00:00Z`) });
      const late = await mkStudent(s, 'camp-late');
      const sold = await sell(s, late.id, running.id);
      expect(sold.status).toBe(201);
      const m = await su.membership.findUniqueOrThrow({ where: { id: sold.body.membership.id } });
      expect(m.startDate.getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(await su.transaction.findFirstOrThrow({ where: { membershipId: m.id } })).toMatchObject({ amount: 8000 });

      const over = await mkPlan(s, { type: 'WEEKLY_PASS', price: 8000, fixedStartDate: new Date(`${dayInZone(-20)}T00:00:00Z`), fixedEndDate: new Date(`${dayInZone(-1)}T00:00:00Z`) });
      const buyer = await mkStudent(s, 'camp-over');
      const desk = await sell(s, buyer.id, over.id);
      expect(desk.status).toBe(400);
      expect(desk.body.error.code).toBe('PLAN_DATES_OVER');
      const app = await as(tokens['camp-over']).post(`/v1/membership-plans/${over.id}/purchase`);
      expect(app.status).toBe(400);
      expect(app.body.error.code).toBe('PLAN_DATES_OVER');
    });
  });

  describe('switch to another plan when it ends', () => {
    let card: School;
    let cash: School;
    let next: { id: string };
    let pass: { id: string };
    beforeAll(async () => {
      card = await mkSchool('switch-card', 'STRIPE');
      cash = await mkSchool('switch-cash', 'CASH');
      next = await mkPlan(card, { type: 'CLASS_PACK', price: 6000, classesIncluded: 10, title: 'Ten classes' });
      pass = await mkPlan(card, { type: 'WEEKLY_PASS', price: 2000, expiryDurationDays: 7, switchToPlanId: next.id, title: 'Intro week' });
    });

    it("keeps the member's agreement with the payment and puts it on the membership; refuses agreeing to a plan with no switch", async () => {
      const cashNext = await mkPlan(cash, { type: 'CLASS_PACK', price: 6000, classesIncluded: 10 });
      const cashPass = await mkPlan(cash, { type: 'WEEKLY_PASS', price: 2000, expiryDurationDays: 7, switchToPlanId: cashNext.id });
      await mkStudent(cash, 'switch-cash-member');
      const bad = await as(tokens['switch-cash-member']).post(`/v1/membership-plans/${cashNext.id}/purchase`, { agreeToPlanSwitch: true });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('PLAN_HAS_NO_SWITCH');
      const order = await as(tokens['switch-cash-member']).post(`/v1/membership-plans/${cashPass.id}/purchase`, { agreeToPlanSwitch: true });
      expect(order.status).toBe(201);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: order.body.transactionId } })).toMatchObject({ planSwitchToPlanId: cashNext.id });
      const confirmed = await as(cash.owner).patch(`/v1/transactions/${order.body.transactionId}/confirm`);
      expect(confirmed.status).toBe(200);
      const m = await su.membership.findFirstOrThrow({ where: { schoolId: cash.school.id, membershipPlanId: cashPass.id } });
      expect(m.switchToPlanId).toBe(cashNext.id);
      expect(m.switchAgreedAt).not.toBeNull();

      // Hosted Checkout keeps it on the pending card payment too.
      await mkStudent(card, 'switch-checkout');
      const checkout = await as(tokens['switch-checkout']).post(`/v1/membership-plans/${pass.id}/purchase`, { useHostedCheckout: true, agreeToPlanSwitch: true });
      expect(checkout.status).toBe(201);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: checkout.body.transactionId } })).toMatchObject({ planSwitchToPlanId: next.id });
    });

    async function agreedMembership(label: string, opts: { savedCard: boolean; endsIn: number }) {
      const student = await mkStudent(card, label);
      if (opts.savedCard) {
        await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: student.id, schoolId: card.school.id, stripeCustomerId: `cus_${randomUUID().slice(0, 8)}` } as never });
      }
      return su.membership.create({
        data: {
          id: randomUUID(),
          studentId: student.id,
          membershipPlanId: pass.id,
          schoolId: card.school.id,
          frequency: 'ONE_TIME',
          startDate: new Date(Date.now() - 7 * DAY + opts.endsIn),
          expiryDate: new Date(Date.now() + opts.endsIn),
          switchToPlanId: next.id,
          switchAgreedAt: new Date(Date.now() - 7 * DAY),
        },
      });
    }

    it('tells the member before, then charges the next plan to their saved card and starts it, once', async () => {
      const m = await agreedMembership('switch-saved', { savedCard: true, endsIn: 3 * DAY });
      await switcher.run(new Date());
      const told = await su.membership.findUniqueOrThrow({ where: { id: m.id } });
      expect(told.switchNoticeSentAt).not.toBeNull();
      expect(told.switchedAt).toBeNull();

      const atEnd = new Date(Date.now() + 3 * DAY + 60_000);
      await switcher.run(atEnd);
      await switcher.run(atEnd);
      const done = await su.membership.findUniqueOrThrow({ where: { id: m.id } });
      expect(done.switchOutcome).toBe('SWITCHED');
      const started = await su.membership.findUniqueOrThrow({ where: { id: done.switchedToMembershipId! } });
      expect(started).toMatchObject({ membershipPlanId: next.id, classesRemaining: 10, switchToPlanId: null });
      const paid = await su.transaction.findMany({ where: { membershipId: started.id } });
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ amount: 6000, status: 'SUCCESSFUL', paymentMethod: 'STRIPE' });
      expect(intents.filter((i) => i.idempotencyKey === `plan-switch-${m.id}`)).toHaveLength(1);
      for (const title of ['Your plan is about to change', 'Your plan has changed']) {
        let rows: unknown[] = [];
        for (let i = 0; i < 50 && rows.length === 0; i++) {
          rows = await su.notification.findMany({ where: { userId: m.studentId, title } });
          if (rows.length === 0) await new Promise((r) => setTimeout(r, 100));
        }
        expect(rows).toHaveLength(1);
      }
    });

    it('simply ends with no saved card, or a declined one: nothing owed, and the member is told', async () => {
      const noCard = await agreedMembership('switch-no-card', { savedCard: false, endsIn: -60_000 });
      const declined = await agreedMembership('switch-declined', { savedCard: true, endsIn: -60_000 });
      await su.membership.updateMany({ where: { id: { in: [noCard.id, declined.id] } }, data: { switchNoticeSentAt: new Date(Date.now() - 2 * DAY) } });
      declineNext = true;
      await switcher.run(new Date());
      const [a, b] = await Promise.all([noCard.id, declined.id].map((id) => su.membership.findUniqueOrThrow({ where: { id } })));
      expect(a.switchOutcome).toBe('NO_CARD');
      expect(b.switchOutcome).toBe('DECLINED');
      expect(await su.membership.count({ where: { studentId: { in: [noCard.studentId, declined.studentId] }, membershipPlanId: next.id } })).toBe(0);
      expect(await su.charge.count({ where: { studentId: { in: [noCard.studentId, declined.studentId] } } })).toBe(0);
      expect(await su.transaction.findFirst({ where: { studentId: declined.studentId } })).toMatchObject({ status: 'FAILED', membershipId: null });
    });

    it('never switches before the member was told, or without their agreement', async () => {
      const untold = await agreedMembership('switch-untold', { savedCard: true, endsIn: -60_000 });
      const notAgreed = await agreedMembership('switch-not-agreed', { savedCard: true, endsIn: -60_000 });
      await su.membership.update({ where: { id: notAgreed.id }, data: { switchAgreedAt: null, switchNoticeSentAt: new Date() } });
      await switcher.run(new Date());
      // The untold one is told now and switched on the next run; the other never.
      expect((await su.membership.findUniqueOrThrow({ where: { id: untold.id } })).switchOutcome).toBeNull();
      expect((await su.membership.findUniqueOrThrow({ where: { id: notAgreed.id } })).switchOutcome).toBeNull();
      await switcher.run(new Date());
      expect((await su.membership.findUniqueOrThrow({ where: { id: untold.id } })).switchOutcome).toBe('SWITCHED');
      expect((await su.membership.findUniqueOrThrow({ where: { id: notAgreed.id } })).switchedAt).toBeNull();
    });
  });
});
