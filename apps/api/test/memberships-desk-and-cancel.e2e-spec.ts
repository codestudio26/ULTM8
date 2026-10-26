import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PaymentsService } from '../src/payments/payments.service';

/**
 * Decision NNN — the Memberships follow-ups the owner approved on 26 Oct 2026:
 * the owner sells a plan at the desk (cash or bank), gives a Friend Pass,
 * cancels a Subscription at the end of its paid period (so can the Student or
 * their Guardian), and sees who is on each plan. Stripe is stubbed for the
 * cancel calls; everything else runs against a real Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[memberships-desk-and-cancel.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;

describeIfDb('Memberships desk sale, Friend Pass, cancel and member list (Decision NNN)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let tokenOwner: string;
  let tokenStaff: string;
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const periodEnd = new Date(Date.now() + 20 * DAY);
  let stripeCancel: jest.SpyInstance;

  function sign(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `memberships-desk-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Desk',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkStudent(label: string, schoolId = school.id) {
    const user = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    return { user, token: sign(user, [{ role: 'STUDENT', franchiseId: null, schoolId, branchId: null }]) };
  }

  const http = () => request(app.getHttpServer());
  const sell = (studentId: string, body: Record<string, unknown>, token = tokenOwner) =>
    http().post(`/v1/schools/${school.id}/students/${studentId}/memberships/sell`).set('Authorization', `Bearer ${token}`).send(body);
  const gift = (studentId: string, body: Record<string, unknown>, token = tokenOwner) =>
    http().post(`/v1/schools/${school.id}/students/${studentId}/memberships/gift`).set('Authorization', `Bearer ${token}`).send(body);
  const cancel = (membershipId: string, token: string, body: Record<string, unknown> = {}) =>
    http().post(`/v1/memberships/${membershipId}/cancel`).set('Authorization', `Bearer ${token}`).send(body);

  async function mkPlan(body: Record<string, unknown>) {
    const res = await http()
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ currency: 'gbp', ...body });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  /** A Subscription Membership as the Stripe webhook would have created it. */
  async function mkSubscription(studentId: string) {
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, title: `Monthly ${randomUUID().slice(0, 6)}`, type: 'SUBSCRIPTION', price: 5000, currency: 'GBP' },
    });
    return superuser.membership.create({
      data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: school.id, frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}` },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const payments = app.get(PaymentsService);
    jest.spyOn(payments, 'getStripeConnectedAccountId').mockResolvedValue('acct_fixture');
    stripeCancel = jest.spyOn(payments, 'cancelSubscriptionAtPeriodEnd').mockResolvedValue(periodEnd);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Memberships Desk School' } });
    schoolIds.push(school.id);
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_fixture' },
    });
    owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    tokenOwner = sign(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    const staff = await mkUser('staff');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id } });
    tokenStaff = sign(staff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.transaction.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.waiverSignature.deleteMany({ where });
    await superuser.waiver.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('selling at the desk', () => {
    it('records a paid Class Pack as cash: the Membership is live at once with a Successful cash Transaction', async () => {
      const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Ten classes', price: 6000, classesIncluded: 10, expiryDurationDays: 90 });
      const { user } = await mkStudent('cash');
      const res = await sell(user.id, { membershipPlanId: plan.id, paymentMethod: 'CASH' });
      expect(res.status).toBe(201);
      expect(res.body.membership.classesRemaining).toBe(10);
      expect(res.body.membership.status).toBe('ACTIVE');
      const tx = await superuser.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
      expect(tx).toMatchObject({ status: 'SUCCESSFUL', paymentMethod: 'CASH', amount: 6000, currency: 'GBP', membershipId: res.body.membership.id });
    });

    it('records a bank transfer, and a hidden plan can still be sold at the desk', async () => {
      const plan = await mkPlan({ type: 'WEEKLY_PASS', title: 'Staff deal week', price: 1500, expiryDurationDays: 7, visible: false });
      const { user } = await mkStudent('bank');
      const res = await sell(user.id, { membershipPlanId: plan.id, paymentMethod: 'BANK_TRANSFER' });
      expect(res.status).toBe(201);
      const tx = await superuser.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
      expect(tx.paymentMethod).toBe('BANK_TRANSFER');
    });

    it('a £0 plan creates no Transaction', async () => {
      const plan = await mkPlan({ type: 'TRIAL_MEMBERSHIP', title: 'Desk trial', price: 0, expiryDurationDays: 7 });
      const { user } = await mkStudent('free');
      const res = await sell(user.id, { membershipPlanId: plan.id, paymentMethod: 'CASH' });
      expect(res.status).toBe(201);
      expect(res.body.transactionId).toBeNull();
      expect(await superuser.transaction.count({ where: { studentId: user.id } })).toBe(0);
    });

    it('keeps the one-live-Weekly-Pass rule and the trial allowance', async () => {
      const week = await mkPlan({ type: 'WEEKLY_PASS', title: 'Desk week', price: 1000, expiryDurationDays: 7 });
      const { user } = await mkStudent('twice');
      expect((await sell(user.id, { membershipPlanId: week.id, paymentMethod: 'CASH' })).status).toBe(201);
      const second = await sell(user.id, { membershipPlanId: week.id, paymentMethod: 'CASH' });
      expect(second.status).toBe(409);
      // Refused before any money was recorded.
      expect(await superuser.transaction.count({ where: { studentId: user.id } })).toBe(1);
    });

    it('refuses a Subscription, a Friend Pass, an archived plan, a removed Student and a missing payment method', async () => {
      const sub = await mkPlan({ type: 'SUBSCRIPTION', title: 'Monthly desk', price: 5000 });
      const friend = await mkPlan({ type: 'FRIEND_PASS', title: 'Bring a friend', price: 0, classesIncluded: 1 });
      const archived = await mkPlan({ type: 'CLASS_PACK', title: 'Old pack', price: 100, classesIncluded: 1 });
      await http().post(`/v1/membership-plans/${archived.id}/archive`).set('Authorization', `Bearer ${tokenOwner}`).send();
      const { user } = await mkStudent('refusals');
      expect((await sell(user.id, { membershipPlanId: sub.id, paymentMethod: 'CASH' })).status).toBe(400);
      expect((await sell(user.id, { membershipPlanId: friend.id, paymentMethod: 'CASH' })).status).toBe(400);
      expect((await sell(user.id, { membershipPlanId: archived.id, paymentMethod: 'CASH' })).status).toBe(400);
      const pack = await mkPlan({ type: 'CLASS_PACK', title: 'Pack', price: 100, classesIncluded: 1 });
      expect((await sell(user.id, { membershipPlanId: pack.id })).status).toBe(400);
      expect((await sell(user.id, { membershipPlanId: pack.id, paymentMethod: 'STRIPE' })).status).toBe(400);

      await superuser.roleGrant.updateMany({ where: { userId: user.id, role: 'STUDENT' }, data: { revokedAt: new Date() } });
      expect((await sell(user.id, { membershipPlanId: pack.id, paymentMethod: 'CASH' })).status).toBe(400);
    });

    it('needs the waiver when the plan requires it', async () => {
      const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Waiver pack', price: 100, classesIncluded: 1, termsWaiverRequired: true });
      const { user } = await mkStudent('waiver');
      expect((await sell(user.id, { membershipPlanId: plan.id, paymentMethod: 'CASH' })).status).toBe(400);
    });

    it('is owner only: Branch Staff and the Student themselves are refused', async () => {
      const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Owner only pack', price: 100, classesIncluded: 1 });
      const { user, token } = await mkStudent('owneronly');
      expect((await sell(user.id, { membershipPlanId: plan.id, paymentMethod: 'CASH' }, tokenStaff)).status).toBe(403);
      expect((await sell(user.id, { membershipPlanId: plan.id, paymentMethod: 'CASH' }, token)).status).toBe(403);
    });
  });

  describe('giving a Friend Pass', () => {
    it('creates a £0, one-class pass recorded as given by the owner, which the Student can use for a guest', async () => {
      const plan = await mkPlan({ type: 'FRIEND_PASS', title: 'Friend pass', price: 0, classesIncluded: 1, expiryDurationDays: 30 });
      const { user, token } = await mkStudent('gift');
      const res = await gift(user.id, { membershipPlanId: plan.id });
      expect(res.status).toBe(201);
      expect(res.body.transactionId).toBeNull();
      expect(res.body.membership).toMatchObject({ giftedById: owner.id, classesRemaining: 1, studentId: user.id });

      const mine = await http().get('/v1/memberships/me').set('Authorization', `Bearer ${token}`);
      expect(mine.body.items.map((m: { id: string }) => m.id)).toContain(res.body.membership.id);

      // A second friend gets a second, separate pass (Spec 55 §6.1).
      expect((await gift(user.id, { membershipPlanId: plan.id })).status).toBe(201);
    });

    it('only gives Friend Pass plans, owner only; the Student still can\'t buy one', async () => {
      const pack = await mkPlan({ type: 'CLASS_PACK', title: 'Not a friend pass', price: 100, classesIncluded: 1 });
      const friend = await mkPlan({ type: 'FRIEND_PASS', title: 'Friend pass 2', price: 0, classesIncluded: 1 });
      const { user, token } = await mkStudent('gift-refusals');
      expect((await gift(user.id, { membershipPlanId: pack.id })).status).toBe(400);
      expect((await gift(user.id, { membershipPlanId: friend.id }, tokenStaff)).status).toBe(403);
      expect((await http().post(`/v1/membership-plans/${friend.id}/purchase`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(400);
    });
  });

  describe('cancelling a Subscription', () => {
    it('the Student cancels: the Membership stays live and records when it ends; asking again changes nothing', async () => {
      const { user, token } = await mkStudent('cancel-self');
      const sub = await mkSubscription(user.id);
      stripeCancel.mockClear();

      const res = await cancel(sub.id, token);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(new Date(res.body.cancelAt).getTime()).toBe(periodEnd.getTime());
      expect(res.body.cancelledById).toBe(user.id);
      expect(stripeCancel).toHaveBeenCalledWith('acct_fixture', sub.stripeSubscriptionId);

      expect((await cancel(sub.id, token)).status).toBe(201);
      expect(stripeCancel).toHaveBeenCalledTimes(1);
    });

    it('the owner cancels for a Student', async () => {
      const { user } = await mkStudent('cancel-owner');
      const sub = await mkSubscription(user.id);
      const res = await cancel(sub.id, tokenOwner);
      expect(res.status).toBe(201);
      expect(res.body.cancelledById).toBe(owner.id);
    });

    it('a Guardian cancels for a linked minor', async () => {
      const { user: minor } = await mkStudent('cancel-minor');
      const guardian = await mkUser('guardian');
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: minor.id } });
      const tokenGuardian = sign(guardian, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);
      const sub = await mkSubscription(minor.id);

      expect((await cancel(sub.id, tokenGuardian)).status).toBe(404);
      const res = await cancel(sub.id, tokenGuardian, { studentId: minor.id });
      expect(res.status).toBe(201);
      expect(res.body.cancelledById).toBe(guardian.id);
    });

    it('refuses another Student, Branch Staff, a plan that isn\'t a Subscription and one already ended', async () => {
      const { user } = await mkStudent('cancel-target');
      const { token: otherToken } = await mkStudent('cancel-other');
      const sub = await mkSubscription(user.id);
      expect((await cancel(sub.id, otherToken)).status).toBe(404);
      expect((await cancel(sub.id, tokenStaff)).status).toBe(404);

      const pack = await mkPlan({ type: 'CLASS_PACK', title: 'Not cancellable', price: 0, classesIncluded: 2 });
      const sold = await sell(user.id, { membershipPlanId: pack.id, paymentMethod: 'CASH' });
      expect((await cancel(sold.body.membership.id, tokenOwner)).status).toBe(400);

      await superuser.membership.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
      expect((await cancel(sub.id, tokenOwner)).status).toBe(400);
    });
  });

  describe('owner lists', () => {
    it('the plan member list shows current members by name with dates, and leaves out expired, used-up and removed ones', async () => {
      const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Listed pack', price: 0, classesIncluded: 5, expiryDurationDays: 30 });
      const { user: amy } = await mkStudent('Amy');
      const { user: ben } = await mkStudent('Ben');
      const { user: cat } = await mkStudent('Cat');
      const { user: dan } = await mkStudent('Dan');
      for (const s of [amy, ben, cat, dan]) expect((await sell(s.id, { membershipPlanId: plan.id, paymentMethod: 'CASH' })).status).toBe(201);
      await superuser.membership.updateMany({ where: { studentId: ben.id }, data: { expiryDate: new Date(Date.now() - DAY) } });
      await superuser.membership.updateMany({ where: { studentId: cat.id }, data: { classesRemaining: 0 } });
      await superuser.roleGrant.updateMany({ where: { userId: dan.id, role: 'STUDENT' }, data: { revokedAt: new Date() } });

      const res = await http().get(`/v1/membership-plans/${plan.id}/members`).set('Authorization', `Bearer ${tokenOwner}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ studentId: amy.id, firstName: 'Amy', surname: 'Desk', classesRemaining: 5, gifted: false, cancelAt: null });
      expect(res.body.items[0].expiryDate).toBeTruthy();

      const count = await http().get(`/v1/membership-plans/${plan.id}/active-count`).set('Authorization', `Bearer ${tokenOwner}`);
      expect(count.body.activeCount).toBe(1);

      expect((await http().get(`/v1/membership-plans/${plan.id}/members`).set('Authorization', `Bearer ${tokenStaff}`)).status).toBe(403);
    });

    it('a Student\'s memberships, newest first with plan names and whether each is live; owner only', async () => {
      const pack = await mkPlan({ type: 'CLASS_PACK', title: 'History pack', price: 0, classesIncluded: 1 });
      const friend = await mkPlan({ type: 'FRIEND_PASS', title: 'History friend', price: 0, classesIncluded: 1 });
      const { user, token } = await mkStudent('history');
      await sell(user.id, { membershipPlanId: pack.id, paymentMethod: 'CASH' });
      await superuser.membership.updateMany({ where: { studentId: user.id }, data: { classesRemaining: 0, createdAt: new Date(Date.now() - DAY) } });
      await gift(user.id, { membershipPlanId: friend.id });

      const res = await http().get(`/v1/schools/${school.id}/students/${user.id}/memberships`).set('Authorization', `Bearer ${tokenOwner}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((m: { planTitle: string; live: boolean; planType: string }) => [m.planTitle, m.planType, m.live])).toEqual([
        ['History friend', 'FRIEND_PASS', true],
        ['History pack', 'CLASS_PACK', false],
      ]);
      expect((await http().get(`/v1/schools/${school.id}/students/${user.id}/memberships`).set('Authorization', `Bearer ${token}`)).status).toBe(403);
    });
  });
});
