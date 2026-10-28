/**
 * Decision 364 — a School Owner closes their own School (name + passcode, the
 * same 90-day close a Platform Admin does), every close stops the Students'
 * Subscription Memberships and the tenant's own platform subscription, and
 * Franchise join requests, removals and closes send in-app notices.
 *
 * Stripe is faked (no live key in CI or this sandbox): the fake records every
 * subscription update, so the tests check what WOULD be sent to Stripe.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS,
 * DATABASE_URL_PLATFORM_ADMIN, JWT_ACCESS_SECRET, PLATFORM_ADMIN_JWT_SECRET —
 * skips with a warning if any are unset, same convention as every other
 * HTTP-level gate in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(
  DATABASE_URL &&
    process.env.DATABASE_URL_APP &&
    process.env.DATABASE_URL_JOBS &&
    process.env.DATABASE_URL_PLATFORM_ADMIN &&
    process.env.JWT_ACCESS_SECRET &&
    process.env.PLATFORM_ADMIN_JWT_SECRET,
);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[school-self-close-and-franchise-notices.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / ' +
      'DATABASE_URL_PLATFORM_ADMIN / JWT_ACCESS_SECRET / PLATFORM_ADMIN_JWT_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const PERIOD_END = Math.floor(Date.UTC(2030, 0, 31) / 1000);

/** Records every Stripe subscription update and cancel. */
function makeFakeStripe() {
  const calls = {
    update: [] as Array<{ account: string; subscriptionId: string; params: unknown }>,
    cancel: [] as Array<{ account: string; subscriptionId: string; params: unknown }>,
    refund: [] as Array<{ account: string; paymentIntentId: string }>,
  };
  const subscriptions = (account: string) => ({
    update: jest.fn(async (subscriptionId: string, params: unknown) => {
      calls.update.push({ account, subscriptionId, params });
      return { id: subscriptionId, cancel_at: PERIOD_END, items: { data: [] } };
    }),
    cancel: jest.fn(async (subscriptionId: string, params: unknown) => {
      calls.cancel.push({ account, subscriptionId, params });
      return { id: subscriptionId, status: 'canceled' };
    }),
    retrieve: jest.fn(async (subscriptionId: string) => ({ id: subscriptionId, status: 'canceled' })),
  });
  const refunds = (account: string) => ({
    create: jest.fn(async (params: { payment_intent: string }) => {
      calls.refund.push({ account, paymentIntentId: params.payment_intent });
      return { id: `re_${randomUUID()}` };
    }),
  });
  const fake = {
    scopedClient: jest.fn((account: string) => ({ subscriptions: subscriptions(account), refunds: refunds(account) })),
    platformClient: jest.fn(() => ({ subscriptions: subscriptions('platform') })),
    constructWebhookEvent: jest.fn(),
  };
  return { fake, calls };
}

describeIfDb('School self-close and Franchise notices (Decision 364)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tenantJwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const adminJwt = new JwtService({ secret: process.env.PLATFORM_ADMIN_JWT_SECRET });
  const stripe = makeFakeStripe();
  const PASSCODE = '246810';
  let app: INestApplication;

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const adminIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeClientService)
      .useValue(stripe.fake)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.franchiseJoinRequest.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { franchiseId: { in: franchiseIds } }] } });
    await superuser.transaction.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.paymentAccount.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { franchiseId: { in: franchiseIds } }] } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `self-close-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Close',
        passcodeHash: await bcrypt.hash(PASSCODE, 4),
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function seedFranchise(data: Record<string, unknown> = {}) {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Notice Franchise', ...data } });
    franchiseIds.push(franchise.id);
    const owner = await mkUser('fowner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: franchise.id } });
    const token = tenantJwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }],
    });
    return { franchise, owner, token };
  }

  async function seedSchool(data: Record<string, unknown> = {}, opts: { stripeAccount?: boolean } = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Notice School', ...data } });
    schoolIds.push(school.id);
    const owner = await mkUser('sowner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    const token = tenantJwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }],
    });
    let connectedAccountId: string | null = null;
    if (opts.stripeAccount) {
      connectedAccountId = `acct_fake_${randomUUID()}`;
      await superuser.paymentAccount.create({
        data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: connectedAccountId },
      });
    }
    return { school, owner, token, connectedAccountId };
  }

  /** A Subscription Membership as the Stripe webhook would have created it. */
  async function mkSubscription(schoolId: string) {
    const student = await mkUser('student');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId } });
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId, title: `Monthly ${randomUUID().slice(0, 6)}`, type: 'SUBSCRIPTION', price: 5000, currency: 'GBP' },
    });
    return superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId, frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}` },
    });
  }

  async function fullAdminToken() {
    const admin = await superuser.adminUser.create({
      data: { id: randomUUID(), email: `self-close-admin-${randomUUID()}@example.test`, name: 'Close Admin', subRole: 'FULL_ADMIN', ssoSubject: `sub-${randomUUID()}` },
    });
    adminIds.push(admin.id);
    return adminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (done(v) || Date.now() - start > timeoutMs) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const noticesFor = (userId: string, type: string) =>
    waitFor(
      () => superuser.notification.findMany({ where: { userId, type } }),
      (rows) => rows.length > 0,
    );

  const http = () => request(app.getHttpServer());

  async function stepUp(token: string) {
    const res = await http().post('/v1/auth/step-up/verify').set('Authorization', `Bearer ${token}`).send({ passcode: PASSCODE });
    expect(res.status).toBe(201);
    return res.body.stepUpToken as string;
  }

  const closeSchool = (schoolId: string, token: string, confirmName: string, proof?: string) => {
    const req = http().post(`/v1/schools/${schoolId}/close`).set('Authorization', `Bearer ${token}`);
    if (proof) req.set('x-step-up-token', proof);
    return req.send({ confirmName });
  };

  describe('a School Owner closes their own School', () => {
    it('needs the passcode check and the exact name, then closes for 90 days and stops every subscription', async () => {
      const platformSub = `sub_platform_${randomUUID()}`;
      const { franchise } = await seedFranchise();
      const { school, token, connectedAccountId } = await seedSchool(
        { name: 'Self Closing School', stripePlatformSubscriptionId: platformSub, platformSubscriptionStatus: 'ACTIVE' },
        { stripeAccount: true },
      );
      const membership = await mkSubscription(school.id);
      const asked = await http().post(`/v1/schools/${school.id}/join-franchise`).set('Authorization', `Bearer ${token}`).send({ franchiseId: franchise.id });
      expect(asked.status).toBe(201);

      const noProof = await closeSchool(school.id, token, 'Self Closing School');
      expect(noProof.status).toBe(403);

      const proof = await stepUp(token);
      const wrongName = await closeSchool(school.id, token, 'self closing school', proof);
      expect(wrongName.status).toBe(400);
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).archivedAt).toBeNull();

      const res = await closeSchool(school.id, token, 'Self Closing School', proof);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(school.id);
      const after = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
      expect(after.archivedAt).not.toBeNull();
      const days = (after.purgeAt!.getTime() - after.archivedAt!.getTime()) / (24 * 60 * 60 * 1000);
      expect(Math.round(days)).toBe(90);

      // Students' Subscriptions end at the end of the paid period, no proration (Spec 55 §10.2).
      expect(stripe.calls.update).toContainEqual({ account: connectedAccountId, subscriptionId: membership.stripeSubscriptionId, params: { cancel_at_period_end: true } });
      const m = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(m.cancelAt?.getTime()).toBe(PERIOD_END * 1000);
      expect(m.status).toBe('ACTIVE'); // still usable until the paid period ends
      // The School's own ULTM8 subscription too.
      expect(stripe.calls.update).toContainEqual({ account: 'platform', subscriptionId: platformSub, params: { cancel_at_period_end: true } });
      // An open join request lapses.
      expect((await superuser.franchiseJoinRequest.findUniqueOrThrow({ where: { id: asked.body.id } })).status).toBe('CANCELLED');

      const twice = await closeSchool(school.id, token, 'Self Closing School', proof);
      expect(twice.status).toBe(409);
    });

    it("another user's passcode proof doesn't work, and a Franchise Owner can't close a member School", async () => {
      const { franchise, token: fToken } = await seedFranchise();
      const { school, token } = await seedSchool({ name: 'Guarded School', franchiseId: franchise.id });
      const franchiseProof = await stepUp(fToken);

      const borrowed = await closeSchool(school.id, token, 'Guarded School', franchiseProof);
      expect(borrowed.status).toBe(403);
      const byFranchiseOwner = await closeSchool(school.id, fToken, 'Guarded School', franchiseProof);
      expect([403, 404]).toContain(byFranchiseOwner.status);
      const other = await seedSchool();
      const byOtherOwner = await closeSchool(school.id, other.token, 'Guarded School', await stepUp(other.token));
      expect([403, 404]).toContain(byOtherOwner.status);
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).archivedAt).toBeNull();
    });
  });

  describe('a Platform Admin closing a School also stops billing', () => {
    it("cancels the Students' Subscriptions at period end, with no one named as cancelling", async () => {
      const { school, connectedAccountId } = await seedSchool({ name: 'Admin Closed School' }, { stripeAccount: true });
      const membership = await mkSubscription(school.id);
      const res = await http()
        .post(`/v1/platform-admin/schools/${school.id}/close`)
        .set('Authorization', `Bearer ${await fullAdminToken()}`)
        .send({ confirmName: 'Admin Closed School' });
      expect(res.status).toBe(201);
      expect(stripe.calls.update).toContainEqual({ account: connectedAccountId, subscriptionId: membership.stripeSubscriptionId, params: { cancel_at_period_end: true } });
      const m = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(m.cancelAt).not.toBeNull();
      expect(m.cancelledById).toBeNull();
    });
  });

  describe('a Subscription paid after its School closed (stress test round 3)', () => {
    /** A Subscription bought but not paid yet: its Pending Transaction holds the
     * PaymentIntent and the incomplete Stripe subscription (Decision 6). */
    async function mkPendingSubscription(schoolId: string) {
      const student = await mkUser('payer');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId } });
      const plan = await superuser.membershipPlan.create({
        data: { id: randomUUID(), schoolId, title: `Monthly ${randomUUID().slice(0, 6)}`, type: 'SUBSCRIPTION', price: 5000, currency: 'GBP' },
      });
      const account = await superuser.paymentAccount.findUniqueOrThrow({ where: { schoolId } });
      return superuser.transaction.create({
        data: {
          id: randomUUID(),
          schoolId,
          studentId: student.id,
          paymentAccountId: account.id,
          membershipPlanId: plan.id,
          amount: 5000,
          currency: 'GBP',
          status: 'PENDING',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: `pi_${randomUUID()}`,
          stripeSubscriptionId: `sub_${randomUUID()}`,
        },
      });
    }

    const paid = (paymentIntentId: string) =>
      app.get(StripeWebhookProcessingProcessor).process({
        data: { stripeEventId: `evt_${randomUUID()}`, eventType: 'payment_intent.succeeded', objectId: paymentIntentId },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as never);

    it('closing cancels the unpaid Subscription, and a payment that still arrives is refunded with no Membership', async () => {
      const { school, token, connectedAccountId } = await seedSchool({ name: 'Late Payment School' }, { stripeAccount: true });
      const pending = await mkPendingSubscription(school.id);

      const res = await closeSchool(school.id, token, 'Late Payment School', await stepUp(token));
      expect(res.status).toBe(200);
      expect(stripe.calls.cancel).toContainEqual({ account: connectedAccountId, subscriptionId: pending.stripeSubscriptionId, params: undefined });

      await paid(pending.stripePaymentIntentId!);
      expect(await superuser.membership.count({ where: { schoolId: school.id } })).toBe(0);
      const t = await superuser.transaction.findUniqueOrThrow({ where: { id: pending.id } });
      expect(t.status).toBe('REFUNDED');
      expect(t.refundedAmount).toBe(5000);
      expect(stripe.calls.refund).toContainEqual({ account: connectedAccountId, paymentIntentId: pending.stripePaymentIntentId });
    });

    it('a payment landing while the School closes never leaves a Subscription billing on', async () => {
      for (let i = 0; i < 6; i++) {
        const name = `Racing School ${i} ${randomUUID().slice(0, 6)}`;
        const { school, token } = await seedSchool({ name }, { stripeAccount: true });
        const pending = await mkPendingSubscription(school.id);
        const proof = await stepUp(token);
        const [closed] = await Promise.all([closeSchool(school.id, token, name, proof), paid(pending.stripePaymentIntentId!)]);
        expect(closed.status).toBe(200);

        const t = await superuser.transaction.findUniqueOrThrow({ where: { id: pending.id } });
        const memberships = await superuser.membership.findMany({ where: { schoolId: school.id } });
        if (t.status === 'SUCCESSFUL') {
          // Paid before the close committed: the close then ended it with its paid period.
          expect(memberships).toHaveLength(1);
          expect(memberships[0].cancelAt).not.toBeNull();
        } else {
          expect(t.status).toBe('REFUNDED');
          expect(memberships).toHaveLength(0);
        }
      }
    });
  });

  describe('Franchise membership notices', () => {
    it('asking tells the Franchise Owner; accepting tells the School Owner', async () => {
      const { franchise, owner: fOwner, token: fToken } = await seedFranchise({ name: 'Notice Franchise A' });
      const { school, owner, token } = await seedSchool({ name: 'Asking School A' });
      const asked = await http().post(`/v1/schools/${school.id}/join-franchise`).set('Authorization', `Bearer ${token}`).send({ franchiseId: franchise.id });
      expect(asked.status).toBe(201);

      const [askedNotice] = await noticesFor(fOwner.id, 'FRANCHISE_ASKED');
      expect(askedNotice).toMatchObject({ title: 'School asking to join', body: 'Asking School A has asked to join Notice Franchise A.', targetType: 'FRANCHISE', targetId: franchise.id });

      const accept = await http().post(`/v1/franchises/${franchise.id}/join-requests/${asked.body.id}/accept`).set('Authorization', `Bearer ${fToken}`);
      expect(accept.status).toBe(200);
      const [accepted] = await noticesFor(owner.id, 'FRANCHISE_ACCEPTED');
      expect(accepted).toMatchObject({ title: 'Joined the Franchise', body: "Notice Franchise A accepted Asking School A's request to join.", targetType: 'SCHOOL', targetId: school.id });
    });

    it('declining tells the School Owner they can ask again', async () => {
      const { franchise, token: fToken } = await seedFranchise({ name: 'Notice Franchise B' });
      const { school, owner, token } = await seedSchool({ name: 'Asking School B' });
      const asked = await http().post(`/v1/schools/${school.id}/join-franchise`).set('Authorization', `Bearer ${token}`).send({ franchiseId: franchise.id });
      await http().post(`/v1/franchises/${franchise.id}/join-requests/${asked.body.id}/decline`).set('Authorization', `Bearer ${fToken}`);
      const [declined] = await noticesFor(owner.id, 'FRANCHISE_DECLINED');
      expect(declined.body).toBe('Notice Franchise B declined Asking School B\'s request to join. You can ask again.');
    });

    it('removing a School tells its Owner', async () => {
      const { franchise, token: fToken } = await seedFranchise({ name: 'Notice Franchise C' });
      const { school, owner } = await seedSchool({ name: 'Removed School', franchiseId: franchise.id });
      const res = await http().post(`/v1/franchises/${franchise.id}/schools/${school.id}/remove`).set('Authorization', `Bearer ${fToken}`);
      expect(res.status).toBe(200);
      const [removed] = await noticesFor(owner.id, 'FRANCHISE_REMOVED');
      expect(removed.body).toBe('Notice Franchise C removed Removed School from the Franchise. Its franchise fees have stopped.');
    });

    it("closing the Franchise tells every member School's Owner, and stops the Franchise's platform subscription", async () => {
      const platformSub = `sub_platform_${randomUUID()}`;
      const { franchise, token: fToken } = await seedFranchise({ name: 'Notice Franchise D', stripePlatformSubscriptionId: platformSub, platformSubscriptionStatus: 'ACTIVE' });
      const a = await seedSchool({ name: 'Member A', franchiseId: franchise.id });
      const b = await seedSchool({ name: 'Member B', franchiseId: franchise.id });
      const res = await http()
        .post(`/v1/franchises/${franchise.id}/close`)
        .set('Authorization', `Bearer ${fToken}`)
        .set('x-step-up-token', await stepUp(fToken))
        .send({ confirmName: 'Notice Franchise D' });
      expect(res.status).toBe(200);
      for (const member of [a, b]) {
        const [closed] = await noticesFor(member.owner.id, 'FRANCHISE_FRANCHISE_CLOSED');
        expect(closed).toMatchObject({ title: 'Franchise closed', targetType: 'SCHOOL', targetId: member.school.id });
        expect(closed.body).toBe(`Notice Franchise D has been closed. ${member.school.name} stays open, and its franchise fees have stopped.`);
      }
      expect(stripe.calls.update).toContainEqual({ account: 'platform', subscriptionId: platformSub, params: { cancel_at_period_end: true } });
    });
  });
});
