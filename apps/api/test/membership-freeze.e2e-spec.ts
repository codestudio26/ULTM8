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
import { Job } from 'bullmq';
import { applyDueFreezeBilling, applyFreezeBillingShift } from '../src/memberships/freeze/freeze-billing';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';

/**
 * Decision 404 (backlog 3.4): freezing a membership. Staff freeze straight
 * away; a member, or the Guardian for a child, asks and the owner approves or
 * declines. Length rules, which plans can be frozen, the Subscription's next
 * charge moving (Stripe stubbed), a fixed-term expiry date moving, the fee,
 * booking and check-in refused while frozen, and the tenant boundaries.
 * Decision 409: the bookings inside a freeze cancelled, the "Can freeze
 * memberships" access switch, when the next charge moves (at approval, or
 * after the renewal that falls before the freeze) and £0 invoices kept off
 * the ledger. Everything else runs against a real Postgres.
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

  // Stripe, stubbed. The paid period ends in 20 days unless a test sets its
  // own (periods). A trial_end sent is kept (trials) and read back, as Stripe
  // would.
  const periodEnd = Math.floor((Date.now() + 20 * DAY) / 1000);
  const periods = new Map<string, number>();
  const trials = new Map<string, number>();
  const invoices = new Map<string, object>();
  let subUpdate: jest.Mock;
  let subRetrieve: jest.Mock;
  let intentCreate: jest.Mock;
  const eventIds: string[] = [];

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

  /** A Membership Subscription's renewal invoice, as Stripe would send it. */
  const renewalInvoice = (subscriptionId: string, amount: number) => ({
    id: `in_${randomUUID()}`,
    billing_reason: 'subscription_cycle',
    amount_paid: amount,
    amount_due: amount,
    currency: 'gbp',
    created: Math.floor(Date.now() / 1000),
    status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
    parent: { subscription_details: { subscription: subscriptionId } },
    payments: { data: [] },
  });
  /** Runs the webhook job for one invoice.paid event. */
  async function invoicePaid(invoice: { id: string } & Record<string, unknown>) {
    invoices.set(invoice.id, invoice);
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await app
      .get(StripeWebhookProcessingProcessor)
      .process({ data: { stripeEventId, eventType: 'invoice.paid', objectId: invoice.id, stripeAccountId: 'acct_fixture' } } as unknown as Job);
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

    subRetrieve = jest.fn().mockImplementation(async (id: string) => ({
      status: 'active',
      trial_end: trials.get(id) ?? null,
      items: { data: [{ current_period_end: periods.get(id) ?? periodEnd }] },
    }));
    subUpdate = jest.fn().mockImplementation(async (id: string, params: { trial_end?: number }) => {
      if (params.trial_end) trials.set(id, params.trial_end);
      return {};
    });
    intentCreate = jest.fn().mockImplementation(async () => ({ id: `pi_${randomUUID()}`, status: 'succeeded' }));
    jest.spyOn(app.get(StripeClientService), 'scopedClient').mockReturnValue({
      subscriptions: { retrieve: subRetrieve, update: subUpdate },
      invoices: { retrieve: jest.fn(async (id: string) => invoices.get(id)) },
      customers: { retrieve: jest.fn().mockResolvedValue({ invoice_settings: { default_payment_method: 'pm_fixture' } }) },
      paymentIntents: { create: intentCreate },
    } as never);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Freeze School', defaultCurrency: 'GBP' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Freeze School', defaultCurrency: 'GBP' } });
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
    await superuser.waitlistEntry.deleteMany({ where });
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
    await superuser.staffActivity.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.studentHomeBranch.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where });
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
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

    it('Decision 409: a freeze starting later, with no renewal before it, moves the next charge at approval; ended before it started, the charge goes back', async () => {
      const { user } = await mkStudent('later');
      const subId = `sub_${randomUUID()}`;
      const m = await mkMembership(user.id, 'SUBSCRIPTION', { stripeSubscriptionId: subId });
      // Paid until day 20, so no renewal falls before day 3.
      const res = await staffFreeze(m.id, day(3), day(13));
      expect(res.status).toBe(201);
      expect(res.body.frozenNow).toBe(false);
      expect(subUpdate).toHaveBeenCalledTimes(1);
      expect(subUpdate).toHaveBeenCalledWith(subId, { trial_end: periodEnd + 10 * DAY_S, proration_behavior: 'none' }, expect.anything());
      expect((await superuser.membershipFreeze.findUniqueOrThrow({ where: { id: res.body.id } })).billingShiftAppliedAt).not.toBeNull();

      // The sweep on the start day finds nothing left to do.
      const startDay = new Date(Date.now() + 3 * DAY);
      await applyDueFreezeBilling(prismaJobs, app.get(StripeClientService), { error: jest.fn() } as never, startDay);
      expect(subUpdate).toHaveBeenCalledTimes(1);

      // Ended before it started: every day unused, back to the paid period's end.
      const ended = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${res.body.id}/end`);
      expect(ended.status).toBe(201);
      expect(subUpdate).toHaveBeenCalledTimes(2);
      expect(subUpdate.mock.calls[1]).toEqual([subId, { trial_end: periodEnd, proration_behavior: 'none' }, { idempotencyKey: `membership-freeze-restore-${res.body.id}-${periodEnd}` }]);
      const stored = await superuser.membershipFreeze.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.billingRestoredAt).not.toBeNull();
      expect(stored.restoredTrialEnd?.getTime()).toBe(periodEnd * 1000);
    });

    it('Decision 409: a renewal before the freeze: nothing moves at approval; the renewal\'s invoice.paid moves it (the sweep is the backup)', async () => {
      const { user } = await mkStudent('renewal-first');
      const subId = `sub_${randomUUID()}`;
      const m = await mkMembership(user.id, 'SUBSCRIPTION', { stripeSubscriptionId: subId });
      // Paid only until day 2; the freeze starts on day 5.
      periods.set(subId, Math.floor((Date.now() + 2 * DAY) / 1000));
      const res = await staffFreeze(m.id, day(5), day(15));
      expect(res.status).toBe(201);
      expect(subUpdate).not.toHaveBeenCalled();
      expect((await superuser.membershipFreeze.findUniqueOrThrow({ where: { id: res.body.id } })).shiftedTrialEnd).toBeNull();
      // The sweep before the start day leaves it waiting too.
      await applyDueFreezeBilling(prismaJobs, app.get(StripeClientService), { error: jest.fn() } as never);
      expect(subUpdate).not.toHaveBeenCalled();

      // The renewal is paid: the period now runs to day 32, and the freeze's 10 days go on top.
      const renewed = Math.floor((Date.now() + 32 * DAY) / 1000);
      periods.set(subId, renewed);
      await invoicePaid(renewalInvoice(subId, 5000));
      expect(subUpdate).toHaveBeenCalledTimes(1);
      expect(subUpdate).toHaveBeenCalledWith(subId, { trial_end: renewed + 10 * DAY_S, proration_behavior: 'none' }, expect.anything());
      const rows = await superuser.transaction.findMany({ where: { membershipId: m.id, kind: 'RENEWAL' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'SUCCESSFUL', amount: 5000 });

      // A second renewal event changes nothing more.
      await invoicePaid(renewalInvoice(subId, 5000));
      expect(subUpdate).toHaveBeenCalledTimes(1);
    });

    it('Decision 409: when no renewal webhook comes, the sweep moves it on the start day', async () => {
      const { user } = await mkStudent('sweep-backup');
      const subId = `sub_${randomUUID()}`;
      const m = await mkMembership(user.id, 'SUBSCRIPTION', { stripeSubscriptionId: subId });
      const paid = Math.floor((Date.now() + 2 * DAY) / 1000);
      periods.set(subId, paid);
      const res = await staffFreeze(m.id, day(5), day(15));
      expect(res.status).toBe(201);
      expect(subUpdate).not.toHaveBeenCalled();
      const startDay = new Date(Date.now() + 5 * DAY);
      expect(await applyDueFreezeBilling(prismaJobs, app.get(StripeClientService), { error: jest.fn() } as never, startDay)).toBeGreaterThanOrEqual(1);
      expect(subUpdate).toHaveBeenCalledWith(subId, { trial_end: paid + 10 * DAY_S, proration_behavior: 'none' }, expect.anything());
    });

    it('Decision 409: a £0 renewal invoice (a trial_end move) is not put on the ledger', async () => {
      const { user } = await mkStudent('zero-invoice');
      const subId = `sub_${randomUUID()}`;
      const m = await mkMembership(user.id, 'SUBSCRIPTION', { stripeSubscriptionId: subId });
      await invoicePaid({ ...renewalInvoice(subId, 0), billing_reason: 'subscription_update', amount_due: 0 });
      expect(await superuser.transaction.count({ where: { membershipId: m.id } })).toBe(0);
      // A real renewal still is.
      await invoicePaid(renewalInvoice(subId, 5000));
      expect(await superuser.transaction.count({ where: { membershipId: m.id, kind: 'RENEWAL' } })).toBe(1);
    });

    it('Decision 409: two freezes shifted out of date order; ending the later one early keeps the earlier one\'s days', async () => {
      const { user } = await mkStudent('two-freezes');
      const subId = `sub_${randomUUID()}`;
      const m = await mkMembership(user.id, 'SUBSCRIPTION', { stripeSubscriptionId: subId });
      const paid = Math.floor((Date.now() + 60 * DAY) / 1000);
      periods.set(subId, paid);
      // The later freeze (10 days) first, then an earlier one (7 days).
      const later = await staffFreeze(m.id, day(20), day(30));
      expect(later.status).toBe(201);
      const earlier = await staffFreeze(m.id, day(2), day(9));
      expect(earlier.status).toBe(201);
      expect(trials.get(subId)).toBe(paid + 17 * DAY_S);

      // The later one ends before it started: its 10 days come off, the earlier one's 7 stay.
      expect((await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${later.body.id}/end`)).status).toBe(201);
      expect(trials.get(subId)).toBe(paid + 7 * DAY_S);
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
      expect((await staffFreeze(m.id, day(0), day(10))).status).toBe(201);
      // Made after the approval, which cancels the bookings already inside a
      // freeze (Decision 409): a booking left in place, say by staff.
      await superuser.booking.create({ data: { id: randomUUID(), studentId: user.id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });

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

    it('without the switch, staff, coaches and members can\'t freeze, list, approve, decline or end; another School gets 404 for this School\'s ids', async () => {
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

  describe('Decision 409: the bookings inside a freeze are cancelled', () => {
    async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      let value = await fn();
      while (!done(value) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        value = await fn();
      }
      return value;
    }
    const mkClass = (offsetDays: number, title: string, extra: { capacity?: number; refundFeeDate?: Date; cancellationCharge?: number } = {}) =>
      superuser.class.create({
        data: {
          id: randomUUID(), schoolId: school.id, title, membershipInclusion: true,
          startDate: new Date(Date.now() + offsetDays * DAY), endDate: new Date(Date.now() + offsetDays * DAY + 60 * 60_000), ...extra,
        },
      });
    const book = (studentId: string, classId: string, sourceMembershipId: string) =>
      superuser.booking.create({ data: { id: randomUUID(), studentId, classId, schoolId: school.id, sourceMembershipId } });
    const status = async (id: string) => (await superuser.booking.findUniqueOrThrow({ where: { id } })).status;

    it('only the ones this membership paid for, with no late fee; the seat goes to the waitlist; one notice; ending early brings none back', async () => {
      await superuser.school.update({ where: { id: school.id }, data: { chargeLateCancellationFee: true } });
      const { user, token } = await mkStudent('booked');
      // A saved card, so a late fee would be charged if one were due.
      await superuser.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: user.id, schoolId: school.id, stripeCustomerId: 'cus_fixture' } });
      const weekly = await mkMembership(user.id, 'WEEKLY_PASS', { expiryDate: new Date(Date.now() + 60 * DAY) });
      const pack = await mkMembership(user.id, 'CLASS_PACK', { classesRemaining: 5 });

      // Inside the freeze: a full class past its refund cut-off with a cancellation charge, and another.
      const full = await mkClass(3, 'Full class', { capacity: 1, refundFeeDate: new Date(Date.now() - DAY), cancellationCharge: 700 });
      const second = await mkClass(5, 'Second class');
      // Inside too, but paid by the class pack; and one after the freeze.
      const packClass = await mkClass(4, 'Pack class');
      const later = await mkClass(12, 'Later class');
      const inFull = await book(user.id, full.id, weekly.id);
      const inSecond = await book(user.id, second.id, weekly.id);
      const byPack = await book(user.id, packClass.id, pack.id);
      const afterFreeze = await book(user.id, later.id, weekly.id);
      const other = await mkStudent('waiting');
      const entry = await superuser.waitlistEntry.create({ data: { id: randomUUID(), studentId: other.user.id, classId: full.id, schoolId: school.id, position: 1 } });

      const asked = await askFreeze(weekly.id, day(1), day(10), token);
      const approved = await as(tokenOwner).post(`/v1/schools/${school.id}/freezes/${asked.body.id}/approve`);
      expect(approved.status).toBe(201);

      expect(await status(inFull.id)).toBe('CANCELLED');
      expect(await status(inSecond.id)).toBe('CANCELLED');
      expect(await status(byPack.id)).toBe('UPCOMING');
      expect(await status(afterFreeze.id)).toBe('UPCOMING');
      const cancelled = await superuser.booking.findUniqueOrThrow({ where: { id: inFull.id } });
      expect(cancelled).toMatchObject({ refundResolution: 'REFUNDED', resolvedById: owner.id, cancellationChargeOutcome: null });
      // No late-cancellation fee, whatever the cut-off says.
      expect(intentCreate).not.toHaveBeenCalled();
      expect(await superuser.transaction.count({ where: { studentId: user.id, kind: 'LATE_CANCEL_FEE' } })).toBe(0);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(5);

      // The freed seat is offered to the waitlist, as for any cancellation.
      const offered = await waitFor(() => superuser.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } }), (e) => e.status === 'NOTIFIED');
      expect(offered.status).toBe('NOTIFIED');

      // One notice naming both classes.
      const noticeId = `membership-freeze-bookings-${asked.body.id}`;
      const notice = await waitFor(() => superuser.notification.findUnique({ where: { id: noticeId } }), (n) => n !== null);
      expect(notice).toMatchObject({ userId: user.id, title: 'Bookings cancelled' });
      expect(notice!.body).toBe(
        `Your WEEKLY_PASS plan membership is frozen from ${day(1)} and you're back on ${day(10)}, ` +
          `so your bookings in between were cancelled: Full class (${day(3)}); Second class (${day(5)}). You can book again once the freeze ends.`,
      );
      expect(await superuser.notification.count({ where: { userId: user.id, title: 'Bookings cancelled' } })).toBe(1);

      // Ending early doesn't bring them back; the member can book again.
      expect((await as(token).post(`/v1/freezes/${asked.body.id}/end`)).status).toBe(201);
      expect(await status(inSecond.id)).toBe('CANCELLED');
    });

    it('a staff-made freeze cancels them too; nothing to cancel means no notice', async () => {
      const { user } = await mkStudent('staff-made');
      const weekly = await mkMembership(user.id, 'WEEKLY_PASS', { expiryDate: new Date(Date.now() + 60 * DAY) });
      const inside = await mkClass(2, 'Inside class');
      const booking = await book(user.id, inside.id, weekly.id);
      const res = await staffFreeze(weekly.id, day(1), day(9));
      expect(res.status).toBe(201);
      expect(await status(booking.id)).toBe('CANCELLED');

      const { user: quiet } = await mkStudent('no-bookings');
      const quietPass = await mkMembership(quiet.id, 'WEEKLY_PASS', { expiryDate: new Date(Date.now() + 60 * DAY) });
      const quietFreeze = await staffFreeze(quietPass.id, day(1), day(9));
      expect(quietFreeze.status).toBe(201);
      await waitFor(() => superuser.notification.findUnique({ where: { id: `membership-freeze-approved-${quietFreeze.body.id}` } }), (n) => n !== null);
      expect(await superuser.notification.count({ where: { userId: quiet.id, title: 'Bookings cancelled' } })).toBe(0);
    });
  });

  describe('Decision 409: the "Can freeze memberships" switch', () => {
    const ACCESS = { classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false, disciplines: false, checkInRules: false, exportStudents: false, attendanceStats: false, memberFiles: false, importData: false };

    it("staff with it act for their own branches' students only; the School's freeze settings stay the owner's; turning it on is logged", async () => {
      const branched = await superuser.school.create({ data: { id: randomUUID(), name: 'Branched Freeze School', defaultCurrency: 'GBP' } });
      schoolIds.push(branched.id);
      const branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: branched.id, name: 'A' } });
      const branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: branched.id, name: 'B' } });
      const bOwner = await mkUser('branched-owner');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: bOwner.id, schoolId: branched.id, isMainOwner: true } });
      const ownerToken = sign(bOwner, 'SCHOOL_OWNER_MANAGER', branched.id);
      const staffA = await mkUser('staff-a');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staffA.id, schoolId: branched.id, branchId: branchA.id } });
      const staffToken = jwt.sign({ sub: staffA.id, email: staffA.email, grants: [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: branched.id, branchId: branchA.id }] });
      const x = await mkStudent('home-a', branched.id);
      const y = await mkStudent('home-b', branched.id);
      await superuser.studentHomeBranch.createMany({
        data: [
          { id: randomUUID(), schoolId: branched.id, studentId: x.user.id, branchId: branchA.id },
          { id: randomUUID(), schoolId: branched.id, studentId: y.user.id, branchId: branchB.id },
        ],
      });
      const expiryDate = new Date(Date.now() + 60 * DAY);
      const mx = await mkMembership(x.user.id, 'WEEKLY_PASS', { expiryDate, schoolId: branched.id });
      const my = await mkMembership(y.user.id, 'WEEKLY_PASS', { expiryDate, schoolId: branched.id });
      const base = `/v1/schools/${branched.id}`;

      // Off by default: refused.
      const off = await staffFreeze(mx.id, day(1), day(8), staffToken, branched.id);
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');
      expect((await as(staffToken).get(`${base}/students/${x.user.id}/freezable-memberships`)).status).toBe(403);
      expect((await as(staffToken).get(`${base}/freezes`)).status).toBe(403);
      expect((await as(staffToken).get(`${base}/staff/me/access`)).body.access.freezeMemberships).toBe(false);

      // The owner turns it on; the staff activity log records it.
      const put = await as(ownerToken).put(`${base}/staff/${staffA.id}/access`, { ...ACCESS, freezeMemberships: true });
      expect(put.status).toBe(200);
      const logged = await superuser.staffActivity.findFirstOrThrow({ where: { schoolId: branched.id, targetUserId: staffA.id, action: 'ACCESS_CHANGED' } });
      expect(logged.details).toEqual({ changes: [{ switch: 'freezeMemberships', on: true }] });
      expect((await as(staffToken).get(`${base}/staff/me/access`)).body.access.freezeMemberships).toBe(true);

      // Their branch's student: list, freeze, decline a request, end.
      const list = await as(staffToken).get(`${base}/students/${x.user.id}/freezable-memberships`);
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([expect.objectContaining({ id: mx.id, planType: 'WEEKLY_PASS', frozen: false, freeze: null })]);
      expect(Object.keys(list.body.items[0]).sort()).toEqual(['cancelAt', 'expiryDate', 'freeze', 'frozen', 'id', 'planTitle', 'planType']);
      const frozen = await staffFreeze(mx.id, day(1), day(8), staffToken, branched.id);
      expect(frozen.status).toBe(201);
      expect(frozen.body).toMatchObject({ status: 'APPROVED', decidedById: staffA.id });
      const askX = await askFreeze(mx.id, day(20), day(27), x.token);
      const askY = await askFreeze(my.id, day(20), day(27), y.token);
      const waiting = await as(staffToken).get(`${base}/freezes?status=REQUESTED`);
      expect(waiting.status).toBe(200);
      expect(waiting.body.items.map((f: { id: string }) => f.id)).toEqual([askX.body.id]);
      expect((await as(staffToken).post(`${base}/freezes/${askX.body.id}/decline`)).status).toBe(201);
      expect((await as(staffToken).post(`${base}/freezes/${frozen.body.id}/end`)).status).toBe(201);

      // Another branch's student: refused.
      expect((await as(staffToken).get(`${base}/students/${y.user.id}/freezable-memberships`)).status).toBe(403);
      expect((await staffFreeze(my.id, day(1), day(8), staffToken, branched.id)).status).toBe(403);
      expect((await as(staffToken).post(`${base}/freezes/${askY.body.id}/approve`)).status).toBe(403);
      expect((await as(staffToken).post(`${base}/freezes/${askY.body.id}/decline`)).status).toBe(403);
      expect((await superuser.membershipFreeze.findUniqueOrThrow({ where: { id: askY.body.id } })).status).toBe('REQUESTED');
      // The owner sees both.
      const ownerList = await as(ownerToken).get(`${base}/freezes?status=REQUESTED`);
      expect(ownerList.body.items.map((f: { id: string }) => f.id)).toEqual([askY.body.id]);

      // The School's freeze settings stay the owner's.
      expect((await as(staffToken).patch(base, { freezeMaxDaysPer12Months: 30 })).status).toBe(403);
    });
  });
});
