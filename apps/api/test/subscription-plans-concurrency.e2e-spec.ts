/**
 * V1 Stress Test Round 3 (docs/V1-STRESS-TEST-REPORT-ROUND3.md) — a genuine
 * concurrency gap in SubscriptionPlansService.subscribe() found under real
 * concurrent load against a real Postgres: the pre-Stripe-call "already
 * subscribed" guard (`findTenantSubscriptionState` + an in-memory `if`) and the
 * post-Stripe-call `updateTenantSubscriptionState` write are two separate,
 * unsynchronized steps — a classic check-then-act TOCTOU window. Two concurrent
 * `subscribe()` calls for the SAME School/Franchise (a double-click on the
 * "Subscribe" button, or two browser tabs) can both read the tenant's
 * `platformSubscriptionStatus` as not-yet-ACTIVE, both pass the guard, both call
 * Stripe and create a REAL, separate Stripe Subscription, and both then write
 * their own `stripePlatformSubscriptionId` onto the same School/Franchise row —
 * last write wins. The LOSING call's Stripe Subscription is never recorded
 * anywhere: `cancel()` only ever looks at the single `stripePlatformSubscriptionId`
 * column, so that orphaned Subscription has no code path that can ever cancel it
 * — it keeps invoicing the tenant every month until someone notices it by hand in
 * the Stripe Dashboard. Real money leak, not a cosmetic race.
 *
 * Reproduced and fixed here with StripeClientService stubbed out (the same
 * `overrideProvider(StripeClientService)` technique platform-admin-auth.e2e-spec.ts
 * already uses on a full AppModule compile, and the same "StripeClientService
 * fake, real everything else" shape stripe-webhook-processing.e2e-spec.ts's own
 * Membership-collision describe block uses) — subscription-plans.e2e-spec.ts's own
 * header comment already documents why the real Stripe-calling half of
 * subscribe()/cancel() can't run against this sandbox's dummy STRIPE_SECRET_KEY;
 * this file follows that same documented constraint, not a new one. The race
 * itself is 100% real: both concurrent HTTP requests run through the real
 * NestJS pipeline, real `withTenantContext`/RLS, and a real Postgres row — only
 * the external Stripe network call is substituted, exactly the technique the
 * task brief names for this exact class of gap.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other HTTP-level gate here.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[subscription-plans-concurrency.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'JWT_ACCESS_SECRET not set. This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('SubscriptionPlansService.subscribe() — concurrent double-subscribe race (Round 3)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tenantJwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const planIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  // Every created Subscription id, keyed by the fake customer id passed to
  // `subscriptions.create` — lets each test assert exactly which Subscriptions
  // got created and, for the fix, which ones were cancelled again.
  const createdSubscriptions: Array<{ id: string; cancelled: boolean }> = [];
  let subscriptionCounter = 0;

  const fakeStripeClient = {
    platformClient: jest.fn(() => ({
      customers: { create: jest.fn(async () => ({ id: `cus_fake_${randomUUID()}` })) },
      products: { create: jest.fn(async () => ({ id: `prod_fake_${randomUUID()}` })) },
      subscriptions: {
        create: jest.fn(async () => {
          // Artificial delay — widens the race window deterministically instead
          // of relying on both requests happening to land in the same tick.
          await new Promise((resolve) => setTimeout(resolve, 25));
          subscriptionCounter += 1;
          const id = `sub_fake_${subscriptionCounter}_${randomUUID()}`;
          createdSubscriptions.push({ id, cancelled: false });
          return {
            id,
            latest_invoice: { payment_intent: { id: `pi_fake_${randomUUID()}`, client_secret: `secret_${randomUUID()}` } },
          };
        }),
        cancel: jest.fn(async (id: string) => {
          const record = createdSubscriptions.find((s) => s.id === id);
          if (record) record.cancelled = true;
          return { id, status: 'canceled' };
        }),
        update: jest.fn(async (id: string) => ({ id, cancel_at: Math.floor(Date.now() / 1000) })),
      },
    })),
    scopedClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeClientService)
      .useValue(fakeStripeClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    createdSubscriptions.length = 0;
    subscriptionCounter = 0;
    fakeStripeClient.platformClient.mockClear();
  });

  async function seedPlan() {
    const plan = await superuser.subscriptionPlan.create({
      data: { id: randomUUID(), name: `Concurrency Fixture Plan ${randomUUID()}`, price: 2500 },
    });
    planIds.push(plan.id);
    return plan;
  }

  async function seedSchoolWithOwner() {
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: `Subscribe Race School ${randomUUID()}` },
    });
    schoolIds.push(school.id);
    const owner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `subscribe-race-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Race',
        surname: 'Owner',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
      },
    });
    userIds.push(owner.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    const token = tenantJwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }],
    });
    return { school, owner, token };
  }

  it('two concurrent subscribe() calls for the same School never both win — exactly one Subscription is left active, the other is cancelled, never orphaned', async () => {
    const plan = await seedPlan();
    const { school, token } = await seedSchoolWithOwner();

    const fire = () =>
      request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/subscription-plans/${plan.id}/subscribe`)
        .set('Authorization', `Bearer ${token}`);

    const [resA, resB] = await Promise.all([fire(), fire()]);

    // Both real Stripe Subscriptions were genuinely created — the race happens
    // AFTER the Stripe call, not before it (same reasoning Round 2's Membership
    // collision fix documents: you can't prevent the race from reaching Stripe
    // at all without inventing a lock Spec 55 never asks for; you can only make
    // sure the LOSER'S side effect gets cleaned up, not silently orphaned).
    expect(createdSubscriptions).toHaveLength(2);

    const statuses = [resA.status, resB.status].sort();
    // One call wins (201, gets a real clientSecret to confirm), the other loses
    // and is told clearly that it lost (409) rather than silently appearing to
    // succeed with a Subscription nobody can ever reach again.
    expect(statuses).toEqual([201, 409]);

    // Exactly one of the two Stripe Subscriptions was cancelled (the loser's) —
    // the other (the winner's, the one actually persisted on the School row)
    // was left alone.
    const cancelledCount = createdSubscriptions.filter((s) => s.cancelled).length;
    expect(cancelledCount).toBe(1);

    const persisted = await superuser.school.findUniqueOrThrow({
      where: { id: school.id },
      select: { stripePlatformSubscriptionId: true, platformSubscriptionStatus: true },
    });
    expect(persisted.platformSubscriptionStatus).toBe('ACTIVE');
    // The persisted id is the WINNER's — i.e. the one NOT cancelled — never the
    // loser's now-cancelled Subscription id.
    const winnerSubscription = createdSubscriptions.find((s) => !s.cancelled);
    expect(persisted.stripePlatformSubscriptionId).toBe(winnerSubscription!.id);
  });

  it('a third, later subscribe() attempt after the race has resolved gets the ordinary clean 400, not a second race window', async () => {
    const plan = await seedPlan();
    const { school, token } = await seedSchoolWithOwner();

    await Promise.all([
      request(app.getHttpServer()).post(`/v1/schools/${school.id}/subscription-plans/${plan.id}/subscribe`).set('Authorization', `Bearer ${token}`),
      request(app.getHttpServer()).post(`/v1/schools/${school.id}/subscription-plans/${plan.id}/subscribe`).set('Authorization', `Bearer ${token}`),
    ]);

    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/subscription-plans/${plan.id}/subscribe`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already has an active platform subscription/i);
  });
});
