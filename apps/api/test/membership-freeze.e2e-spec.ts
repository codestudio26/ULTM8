import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { applyDueFreezeBilling, applyFreezeBillingShift } from '../src/memberships/freeze/freeze-billing';

/**
 * Decision 404 (backlog 3.4): freezing a membership. Staff freeze straight
 * away; a member, or the Guardian for a child, asks and the owner approves or
 * declines. Length rules, which plans can be frozen, the Subscription's next
 * charge moving (Stripe stubbed), a fixed-term expiry date moving, the fee,
 * booking and check-in refused while frozen, and the tenant boundaries.
 * Everything else runs against a real Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[membership-freeze.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const DAY_S = 24 * 60 * 60;
/** A calendar day, `offset` days from today (UTC: the fixture Schools have no time zone). */
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describeIfDb('Freezing a membership (Decision 404)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let prismaJobs: PrismaJobsService;

  let school: { id: string };
  let otherSchool: { id: string };
  let owner: { id: string; email: string };
  let tokenOwner: string;
  let tokenOtherOwner: string;
  let tokenStaff: string;
  let tokenCoach: string;
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const plans: Record<string, string> = {};

  // Stripe, stubbed. The paid period ends in 20 days.
  const periodEnd = Math.floor((Date.now() + 20 * DAY) / 1000);
  let subUpdate: jest.Mock;
  let subRetrieve: jest.Mock;
  let intentCreate: jest.Mock;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: Record<string, unknown>) => http().put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const sign = (user: { id: string; email: string }, role: string | null, schoolId: string | null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: role ? [{ role, franchiseId: null, schoolId, branchId: null }] : [] });

  async function mkUser(label: string, dob = '2000-01-01') {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `membership-freeze-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Freeze',
        passcodeHash: 'x',
        dateOfBirth: new Date(dob),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkStudent(label: string, schoolId = school.id) {
    const user = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    return { user, token: sign(user, 'STUDENT', schoolId) };
  }

  async function mkMembership(
    studentId: string,
    type: 'SUBSCRIPTION' | 'WEEKLY_PASS' | 'CLASS_PACK' | 'FRIEND_PASS' | 'TRIAL_MEMBERSHIP',
    extra: { expiryDate?: Date; stripeSubscriptionId?: string; classesRemaining?: number; cancelAt?: Date; schoolId?: string } = {},
  ) {
    const schoolId = extra.schoolId ?? school.id;
    const key = `${schoolId}:${type}`;
    if (!plans[key]) {
      plans[key] = (
        await superuser.membershipPlan.create({
          data: { id: randomUUID(), schoolId, type, title: `${type} plan`, price: type === 'FRIEND_PASS' ? 0 : 5000, currency: 'GBP' },
        })
      ).id;
    }
    return superuser.membership.create({
      data: {
        id: randomUUID(),
        studentId,
        membershipPlanId: plans[key],
        schoolId,
        frequency: type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME',
        expiryDate: extra.expiryDate,
        stripeSubscriptionId: extra.stripeSubscriptionId,
        classesRemaining: extra.classesRemaining,
        cancelAt: extra.cancelAt,
      },
    });
  }

  const staffFreeze = (membershipId: string, startsAt: string, endsAt: string, token = tokenOwner, schoolId = school.id) =>
    as(token).post(`/v1/schools/${schoolId}/memberships/${membershipId}/freezes`, { startsAt, endsAt });
  const askFreeze = (membershipId: string, startsAt: string, endsAt: string, token: string) =>
    as(token).post(`/v1/memberships/${membershipId}/freeze-requests`, { startsAt, endsAt });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    prismaJobs = app.get(PrismaJobsService);

    subRetrieve = jest.fn().mockImplementation(async () => ({ status: 'active', trial_end: null, items: { data: [{ current_period_end: periodEnd }] } }));
    subUpdate = jest.fn().mockResolvedValue({});
    intentCreate = jest.fn().mockImplementation(async () => ({ id: `pi_${randomUUID()}`, status: 'succeeded' }));
    jest.spyOn(app.get(StripeClientService), 'scopedClient').mockReturnValue({
      subscriptions: { retrieve: subRetrieve, update: subUpdate },
      customers: { retrieve: jest.fn().mockResolvedValue({ invoice_settings: { default_payment_method: 'pm_fixture' } }) },
      paymentIntents: { create: intentCreate },
    } as never);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Freeze School' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Freeze School' } });
    schoolIds.push(school.id, otherSchool.id);
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_fixture' },
    });
    owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokenOwner = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    const otherOwner = await mkUser('other-owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: otherSchool.id, isMainOwner: true } });
    tokenOtherOwner = sign(otherOwner, 'SCHOOL_OWNER_MANAGER', otherSchool.id);
    const staff = await mkUser('staff');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id } });
    tokenStaff = sign(staff, 'BRANCH_STAFF', school.id);
    const coach = await mkUser('coach');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id } });
    tokenCoach = sign(coach, 'INSTRUCTOR', school.id);
  });

  beforeEach(() => {
    subUpdate.mockClear();
    subRetrieve.mockClear();
    intentCreate.mockClear();
  });

  afterEach(async () => {
    await superuser.school.update({ where: { id: school.id }, data: { freezeMaxDaysPer12Months: 90, freezeFeeAmount: null, checkInFrozenMembers: false } });
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.membershipFreeze.deleteMany({ where });
    await superuser.trainingLog.deleteMany({ where });
    await superuser.booking.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.transaction.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.studentPaymentMethod.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('staff freeze a card Subscription straight away', () => {
    it('freezes from today, moves the next charge later by the freeze, and moves it back when ended early', async () => {
      const { user } = await mkStudent('sub');
      const subId = `sub_${randomUUID()}`;
      const m = await mkMembership(user.id, 'SUBSCRIPTION', { stripeSubscriptionId: subId });

      const res = await staffFreeze(m.id, day(0), day(14));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'APPROVED', startsAt: day(0), endsAt: day(14), backOn: day(14), frozenNow: true, requestedById: owner.id, decidedById: owner.id });

      // The paid period's end plus 14 days, with no proration.
      expect(subUpdate).toHaveBeenCalledTimes(1);
      const [calledId, params, opts] = subUpdate.mock.calls[0];
      expect(calledId).toBe(subId);
      expect(params).toEqual({ trial_end: periodEnd + 14 * DAY_S, proration_behavior: 'none' });
      expect(opts.idempotencyKey).toContain(res.body.id);
      const stored = await superuser.membershipFreeze.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.billingShiftAppliedAt).not.toBeNull();
      expect(stored.shiftedTrialEnd?.getTime()).toBe((periodEnd + 14 * DAY_S) * 1000);

      // Never shifted twice: the sweep and a repeat call change nothing.
      await applyDueFreezeBilling(prismaJobs, app.get(StripeClientService), { error: jest.fn() } as never);
      expect(await applyFreezeBillingShift(prismaJobs, app.get(StripeClientService), res.body.id)).toBe(false);
      expect(subUpdate).toHaveBeenCalledTimes(1);

      // Frozen shows on the owner's Student page, the member's own list and the roster.
      const memberships = await as(tokenOwner).get(`/v1/schools/${school.id}/students/${user.id}/memberships`);
      expect(memberships.body.items[0]).toMatchObject({ id: m.id, live: true, frozen: true, freeze: { id: res.body.id, status: 'APPROVED', startsAt: day(0), endsAt: day(14) } });
      const mine = await as(sign(user, 'STUDENT', school.id)).get('/v1/memberships/me');
      expect(mine.body.items.find((x: { id: string }) => x.id === m.id)).toMatchObject({ frozen: true });
      const roster = await as(tokenOwner).get(`/v1/schools/${school.id}/students`);
      expect(roster.body.items.find((s: { id: string }) => s.id === user.id)).toMatchObject({ frozen: true, frozenUntil: day(14) });

      // Ended early the same day: all 14 days unused, so the charge goes back to the period's end.
      const ended = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${res.body.id}/end`);
      expect(ended.status).toBe(201);
      expect(ended.body).toMatchObject({ status: 'APPROVED', backOn: day(0), frozenNow: false });
      expect(subUpdate).toHaveBeenCalledTimes(2);
      expect(subUpdate.mock.calls[1][1]).toEqual({ trial_end: periodEnd, proration_behavior: 'none' });
      const after = await as(tokenOwner).get(`/v1/schools/${school.id}/students/${user.id}/memberships`);
      expect(after.body.items[0]).toMatchObject({ frozen: false, freeze: null });

      // Ending twice is refused.
      const again = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${res.body.id}/end`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('FREEZE_NOT_RUNNING');
    });

    it('a freeze starting later shifts nothing until its start day, when the sweep does it', async () => {
      const { user } = await mkStudent('later');
      const m = await mkMembership(user.id, 'SUBSCRIPTION', { stripeSubscriptionId: `sub_${randomUUID()}` });
      const res = await staffFreeze(m.id, day(3), day(13));
      expect(res.status).toBe(201);
      expect(res.body.frozenNow).toBe(false);
      expect(subUpdate).not.toHaveBeenCalled();

      // On the start day (the sweep runs every 15 minutes).
      const startDay = new Date(Date.now() + 3 * DAY);
      expect(await applyDueFreezeBilling(prismaJobs, app.get(StripeClientService), { error: jest.fn() } as never, startDay)).toBeGreaterThanOrEqual(1);
      expect(subUpdate).toHaveBeenCalledWith(expect.any(String), { trial_end: periodEnd + 10 * DAY_S, proration_behavior: 'none' }, expect.anything());
    });

    it('a cash-paid Weekly Pass: the expiry date moves later by the freeze, and back when ended before it started', async () => {
      const { user } = await mkStudent('weekly');
      const expiry = new Date(Date.now() + 10 * DAY);
      const m = await mkMembership(user.id, 'WEEKLY_PASS', { expiryDate: expiry });
      const res = await staffFreeze(m.id, day(1), day(8));
      expect(res.status).toBe(201);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: m.id } })).expiryDate?.getTime()).toBe(expiry.getTime() + 7 * DAY);
      expect(subUpdate).not.toHaveBeenCalled();

      const ended = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${res.body.id}/end`);
      expect(ended.status).toBe(201);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: m.id } })).expiryDate?.getTime()).toBe(expiry.getTime());
    });
  });

  describe('length rules and which memberships can be frozen', () => {
    it('at least 7 days, starting today or later, no overlap, and within the School\'s maximum in 12 months', async () => {
      const { user } = await mkStudent('rules');
      const m = await mkMembership(user.id, 'SUBSCRIPTION');

      const short = await staffFreeze(m.id, day(1), day(7));
      expect(short.status).toBe(400);
      expect(short.body.error.code).toBe('FREEZE_TOO_SHORT');
      const past = await staffFreeze(m.id, day(-1), day(10));
      expect(past.body.error.code).toBe('FREEZE_START_PASSED');
      const badDate = await staffFreeze(m.id, 'tomorrow', day(10));
      expect(badDate.status).toBe(400);

      await superuser.school.update({ where: { id: school.id }, data: { freezeMaxDaysPer12Months: 20 } });
      expect((await staffFreeze(m.id, day(1), day(15))).status).toBe(201);
      const overlap = await staffFreeze(m.id, day(10), day(20));
      expect(overlap.body.error.code).toBe('FREEZE_OVERLAP');
      const over = await staffFreeze(m.id, day(20), day(30));
      expect(over.status).toBe(400);
      expect(over.body.error).toMatchObject({ code: 'FREEZE_OVER_LIMIT' });
      expect(over.body.error.message).toContain('at most 20 frozen days');
      // 14 used, so 6 left: even the shortest freeze (7 days) doesn't fit.
      expect((await staffFreeze(m.id, day(20), day(27))).body.error.code).toBe('FREEZE_OVER_LIMIT');
    });

    it('an early-ended freeze counts only the days it froze', async () => {
      const { user } = await mkStudent('counted');
      const m = await mkMembership(user.id, 'SUBSCRIPTION');
      await superuser.school.update({ where: { id: school.id }, data: { freezeMaxDaysPer12Months: 20 } });
      const first = await staffFreeze(m.id, day(0), day(20));
      expect(first.status).toBe(201);
      await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${first.body.id}/end`);
      expect((await staffFreeze(m.id, day(1), day(15))).status).toBe(201);
    });

    it('refuses a class pack, a friend pass, a membership set to cancel and one that has ended', async () => {
      const { user } = await mkStudent('refused');
      const pack = await mkMembership(user.id, 'CLASS_PACK', { classesRemaining: 5 });
      const friend = await mkMembership(user.id, 'FRIEND_PASS', { classesRemaining: 1 });
      const cancelling = await mkMembership(user.id, 'SUBSCRIPTION', { cancelAt: new Date(Date.now() + 5 * DAY) });
      const ended = await mkMembership(user.id, 'WEEKLY_PASS', { expiryDate: new Date(Date.now() - DAY) });
      expect((await staffFreeze(pack.id, day(1), day(10))).body.error.code).toBe('FREEZE_CLASS_PACK');
      expect((await staffFreeze(friend.id, day(1), day(10))).body.error.code).toBe('FREEZE_NOT_FREEZABLE');
      expect((await staffFreeze(cancelling.id, day(1), day(10))).body.error.code).toBe('FREEZE_CANCELLING');
      expect((await staffFreeze(ended.id, day(1), day(10))).body.error.code).toBe('FREEZE_MEMBERSHIP_ENDED');
      expect((await askFreeze(pack.id, day(1), day(10), sign(user, 'STUDENT', school.id))).body.error.code).toBe('FREEZE_CLASS_PACK');
    });
  });

  describe('a member asks, the owner decides', () => {
    it('request, approve once; request, decline; request, withdraw', async () => {
      const { user, token } = await mkStudent('asker');
      const m = await mkMembership(user.id, 'SUBSCRIPTION');

      const asked = await askFreeze(m.id, day(2), day(12), token);
      expect(asked.status).toBe(201);
      expect(asked.body).toMatchObject({ status: 'REQUESTED', requestedById: user.id, frozenNow: false });

      const waiting = await as(tokenOwner).get(`/v1/schools/${school.id}/freezes?status=REQUESTED`);
      expect(waiting.status).toBe(200);
      expect(waiting.body.items.find((f: { id: string }) => f.id === asked.body.id)).toMatchObject({ studentFirstName: 'asker', planType: 'SUBSCRIPTION' });
      const mine = await as(token).get('/v1/memberships/freezes/me');
      expect(mine.body.items.find((i: { membershipId: string }) => i.membershipId === m.id)).toMatchObject({
        self: true,
        freeze: { status: 'REQUESTED', startsAt: day(2), endsAt: day(12) },
        maxDaysPer12Months: 90,
        today: day(0),
      });

      const approved = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/approve`);
      expect(approved.status).toBe(201);
      expect(approved.body).toMatchObject({ status: 'APPROVED', decidedById: owner.id });
      const twice = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/approve`);
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('FREEZE_ALREADY_DECIDED');

      const second = await askFreeze(m.id, day(20), day(27), token);
      const declined = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${second.body.id}/decline`);
      expect(declined.body.status).toBe('DECLINED');
      expect((await as(token).post(`/v1/freezes/${second.body.id}/cancel`)).status).toBe(409);

      const third = await askFreeze(m.id, day(30), day(37), token);
      const withdrawn = await as(token).post(`/v1/freezes/${third.body.id}/cancel`);
      expect(withdrawn.status).toBe(201);
      expect(withdrawn.body.status).toBe('CANCELLED');

      // The member ends their approved freeze early (before it started).
      const ended = await as(token).post(`/v1/freezes/${asked.body.id}/end`);
      expect(ended.status).toBe(201);
      expect(ended.body.backOn).toBe(day(2));
    });

    it('a Guardian asks for their child; nobody else can see or ask', async () => {
      const guardian = await mkUser('guardian', '1980-01-01');
      const child = await mkStudent('child');
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: child.user.id } });
      const m = await mkMembership(child.user.id, 'WEEKLY_PASS', { expiryDate: new Date(Date.now() + 30 * DAY) });
      const tokenGuardian = sign(guardian, null, null);

      const asked = await askFreeze(m.id, day(1), day(8), tokenGuardian);
      expect(asked.status).toBe(201);
      expect(asked.body).toMatchObject({ status: 'REQUESTED', studentId: child.user.id, requestedById: guardian.id });
      const mine = await as(tokenGuardian).get('/v1/memberships/freezes/me');
      expect(mine.body.items.find((i: { membershipId: string }) => i.membershipId === m.id)).toMatchObject({ self: false, studentFirstName: 'child' });

      const stranger = await mkStudent('stranger');
      expect((await askFreeze(m.id, day(1), day(8), stranger.token)).status).toBe(404);
      expect((await as(stranger.token).post(`/v1/freezes/${asked.body.id}/cancel`)).status).toBe(404);
      expect((await as(stranger.token).get('/v1/memberships/freezes/me')).body.items.some((i: { membershipId: string }) => i.membershipId === m.id)).toBe(false);

      // Approving notifies the child, and the fan-out copies it to the Guardian.
      expect((await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/approve`)).status).toBe(201);
      expect((await as(tokenGuardian).post(`/v1/freezes/${asked.body.id}/end`)).status).toBe(201);
    });
  });

  describe('the freeze fee', () => {
    it('is charged once on a saved card when approved, and not refunded when ended early', async () => {
      await superuser.school.update({ where: { id: school.id }, data: { freezeFeeAmount: 1500 } });
      const { user, token } = await mkStudent('card-fee');
      await superuser.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: user.id, schoolId: school.id, stripeCustomerId: 'cus_fixture' } });
      const m = await mkMembership(user.id, 'SUBSCRIPTION');
      const asked = await askFreeze(m.id, day(1), day(10), token);
      const approved = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/approve`);
      expect(approved.status).toBe(201);
      expect(approved.body.feeAmount).toBe(1500);
      expect(intentCreate).toHaveBeenCalledTimes(1);
      expect(intentCreate.mock.calls[0][0]).toMatchObject({ amount: 1500, currency: 'gbp', off_session: true, confirm: true });
      expect(intentCreate.mock.calls[0][1]).toEqual({ idempotencyKey: `membership-freeze-fee-${asked.body.id}` });
      const fees = await superuser.transaction.findMany({ where: { studentId: user.id, kind: 'FREEZE_FEE' } });
      expect(fees).toHaveLength(1);
      expect(fees[0]).toMatchObject({ id: approved.body.feeTransactionId, status: 'SUCCESSFUL', paymentMethod: 'STRIPE', amount: 1500, currency: 'GBP', membershipId: m.id });

      await as(token).post(`/v1/freezes/${asked.body.id}/end`);
      expect(await superuser.transaction.findMany({ where: { studentId: user.id, kind: 'FREEZE_FEE' } })).toEqual(fees);
    });

    it('with no saved card it is a pending cash charge the desk marks paid', async () => {
      await superuser.school.update({ where: { id: school.id }, data: { freezeFeeAmount: 900 } });
      const { user } = await mkStudent('cash-fee');
      const m = await mkMembership(user.id, 'SUBSCRIPTION');
      const res = await staffFreeze(m.id, day(1), day(10));
      expect(res.status).toBe(201);
      expect(intentCreate).not.toHaveBeenCalled();
      const fee = await superuser.transaction.findUniqueOrThrow({ where: { id: res.body.feeTransactionId } });
      expect(fee).toMatchObject({ kind: 'FREEZE_FEE', status: 'PENDING', paymentMethod: 'CASH', amount: 900 });

      const confirmed = await as(tokenOwner).patch(`/v1/transactions/${fee.id}/confirm`);
      expect(confirmed.status).toBe(200);
      expect((await superuser.transaction.findUniqueOrThrow({ where: { id: fee.id } })).status).toBe('SUCCESSFUL');
      // No second membership was made.
      expect(await superuser.membership.count({ where: { studentId: user.id } })).toBe(1);
    });
  });

  describe('a frozen member can\'t book or check in', () => {
    async function classIn(minutesFromNow: number) {
      return superuser.class.create({
        data: {
          id: randomUUID(), schoolId: school.id, title: 'Frozen class', membershipInclusion: true,
          startDate: new Date(Date.now() + minutesFromNow * 60_000), endDate: new Date(Date.now() + (minutesFromNow + 60) * 60_000),
        },
      });
    }

    it('booking is refused while frozen, and works again once the freeze ends', async () => {
      const { user, token } = await mkStudent('booker');
      const m = await mkMembership(user.id, 'SUBSCRIPTION');
      const freeze = await staffFreeze(m.id, day(0), day(10));
      const cls = await classIn(24 * 60);
      const refused = await as(token).post(`/v1/classes/${cls.id}/book`);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('MEMBERSHIP_FROZEN');

      await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${freeze.body.id}/end`);
      expect((await as(token).post(`/v1/classes/${cls.id}/book`)).status).toBe(201);
    });

    it('check-in is refused unless the School allows frozen members to check in', async () => {
      const { user } = await mkStudent('checker');
      const m = await mkMembership(user.id, 'SUBSCRIPTION');
      const cls = await classIn(5);
      await superuser.booking.create({ data: { id: randomUUID(), studentId: user.id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });
      expect((await staffFreeze(m.id, day(0), day(10))).status).toBe(201);

      const scan = () => as(tokenCoach).post(`/v1/classes/${cls.id}/attendance-scan`, { studentId: user.id });
      const refused = await scan();
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('MEMBERSHIP_FROZEN');

      const rules = await as(tokenOwner).get(`/v1/schools/${school.id}/check-in-rules`);
      expect(rules.body.frozenMembers).toBe(false);
      const changed = await as(tokenOwner).put(`/v1/schools/${school.id}/check-in-rules`, { ...rules.body, frozenMembers: true });
      expect(changed.status).toBe(200);
      expect(changed.body.frozenMembers).toBe(true);
      expect((await scan()).status).toBe(201);
    });
  });

  describe('settings and who may act', () => {
    it('the owner sets the maximum and the fee on the School', async () => {
      const res = await as(tokenOwner).patch(`/v1/schools/${school.id}`, { freezeMaxDaysPer12Months: 60, freezeFeeAmount: 1000 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ freezeMaxDaysPer12Months: 60, freezeFeeAmount: 1000, checkInFrozenMembers: false });
      expect((await as(tokenOwner).patch(`/v1/schools/${school.id}`, { freezeMaxDaysPer12Months: 0 })).status).toBe(400);
      expect((await as(tokenOwner).patch(`/v1/schools/${school.id}`, { freezeMaxDaysPer12Months: 366 })).status).toBe(400);
      expect((await as(tokenOwner).patch(`/v1/schools/${school.id}`, { freezeFeeAmount: null })).body.freezeFeeAmount).toBeNull();
    });

    it('only the owner freezes, lists, approves, declines and ends; another School gets 404 for this School\'s ids', async () => {
      const { user, token } = await mkStudent('guarded');
      const m = await mkMembership(user.id, 'SUBSCRIPTION');
      const asked = await askFreeze(m.id, day(2), day(12), token);

      for (const t of [tokenStaff, tokenCoach, token]) {
        expect((await staffFreeze(m.id, day(1), day(10), t)).status).toBe(403);
        expect((await as(t).get(`/v1/schools/${school.id}/freezes`)).status).toBe(403);
        expect((await as(t).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/approve`)).status).toBe(403);
        expect((await as(t).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/decline`)).status).toBe(403);
        expect((await as(t).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/end`)).status).toBe(403);
      }

      // The other School's owner: refused at this School, and this School's ids are not found at theirs.
      expect((await staffFreeze(m.id, day(1), day(10), tokenOtherOwner)).status).toBe(403);
      expect((await staffFreeze(m.id, day(1), day(10), tokenOtherOwner, otherSchool.id)).status).toBe(404);
      expect((await as(tokenOtherOwner).post(`/v1/schools/${otherSchool.id}/freezes/${asked.body.id}/approve`)).status).toBe(404);
      expect((await as(tokenOtherOwner).post(`/v1/schools/${otherSchool.id}/freezes/${asked.body.id}/end`)).status).toBe(404);
      const theirList = await as(tokenOtherOwner).get(`/v1/schools/${otherSchool.id}/freezes`);
      expect(theirList.body.items.some((f: { id: string }) => f.id === asked.body.id)).toBe(false);
      // Nor can the other School's owner ask for a freeze on someone else's membership.
      expect((await askFreeze(m.id, day(1), day(10), tokenOtherOwner)).status).toBe(404);
      // The request is untouched.
      expect((await superuser.membershipFreeze.findUniqueOrThrow({ where: { id: asked.body.id } })).status).toBe('REQUESTED');
    });
  });
});
