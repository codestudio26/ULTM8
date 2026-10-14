/**
 * Decision 99's own follow-up — the real rate-migration mechanism replacing
 * FranchisesService.update()'s former outright rejection once franchise-fee
 * billing has started for at least one School under a Franchise.
 *
 * Follows the exact `overrideProvider(StripeClientService)` + full `AppModule`
 * technique `membership-plan-archive-and-price-change.e2e-spec.ts` already
 * establishes: real HTTP, real `withTenantContext`/RLS, real Postgres, real
 * BullMQ/Redis (JobsModule is part of the full AppModule, so
 * FranchiseFeeRateMigrationProcessor genuinely runs against real Redis here —
 * only the external Stripe network call is substituted). MIGRATE assertions
 * poll for the job's own async completion (`waitForRateChangeStatus` below)
 * rather than assuming it finished by the time the HTTP response returns.
 *
 * PER_HEADCOUNT + MIGRATE_NEXT_CYCLE's own deferred `deferred-swap` job is
 * NOT waited out in real time (it carries a deliberate 15-minute buffer past
 * the Subscription Item's own `current_period_end` — see the processor's own
 * header comment) — instead this asserts the delayed job was actually
 * enqueued on the real queue with the right data/delay, via
 * `getQueueToken`/`queue.getJob()`, same "prove it was scheduled correctly
 * without waiting for it to fire" posture a cron-based job's own repeat
 * options would get, not a shortcut unique to this file.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET, REDIS_URL.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { FRANCHISE_FEE_RATE_MIGRATION_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REDIS_URL = process.env.REDIS_URL;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && REDIS_URL);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[franchise-fee-rate-migration.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / ' +
      'REDIS_URL not set. This gate MUST run against a real Postgres+Redis in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Franchise fee-rate migration (Decision 99 follow-up)', () => {
  let app: INestApplication;
  let rateMigrationQueue: Queue;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const paymentAccountIds: string[] = [];

  // Fake Stripe — scoped client only (Direct-charge pattern, Decision 86).
  // `subscriptionFixtures` keys each fake Subscription id to a deterministic
  // item/price/product/current_period_end, so retrieve() calls made from
  // different places in the processor (migrateOneSchool, then again inside
  // swapSubscriptionPrice) see the same underlying "Subscription" each time.
  let priceCounter = 0;
  const subscriptionFixtures = new Map<string, { itemId: string; priceId: string; productId: string; currentPeriodEnd: number }>();

  const fakePricesCreate = jest.fn(async (args: { product: string; unit_amount: number; currency: string }) => {
    priceCounter += 1;
    return { id: `price_fake_${priceCounter}_${randomUUID()}`, product: args.product };
  });
  const fakeProductsCreate = jest.fn(async () => ({ id: `prod_fake_${randomUUID()}` }));
  const fakeSubscriptionsRetrieve = jest.fn(async (id: string) => {
    const fixture = subscriptionFixtures.get(id);
    if (!fixture) {
      throw new Error(`No fixture registered for fake Subscription ${id}`);
    }
    return {
      id,
      items: { data: [{ id: fixture.itemId, price: { id: fixture.priceId, product: fixture.productId }, current_period_end: fixture.currentPeriodEnd }] },
    };
  });
  const fakeSubscriptionsUpdate = jest.fn(async (id: string, params: unknown) => ({ id, ...(params as object) }));
  const fakeStripeClient = {
    platformClient: jest.fn(),
    scopedClient: jest.fn(() => ({
      products: { create: fakeProductsCreate },
      prices: { create: fakePricesCreate },
      subscriptions: { retrieve: fakeSubscriptionsRetrieve, update: fakeSubscriptionsUpdate },
    })),
    constructWebhookEvent: jest.fn(),
  };

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    rateMigrationQueue = moduleRef.get<Queue>(getQueueToken(FRANCHISE_FEE_RATE_MIGRATION_QUEUE));
  });

  afterAll(async () => {
    await superuser.franchiseFeeRateChange.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.paymentAccount.deleteMany({ where: { id: { in: paymentAccountIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    fakePricesCreate.mockClear();
    fakeProductsCreate.mockClear();
    fakeSubscriptionsRetrieve.mockClear();
    fakeSubscriptionsUpdate.mockClear();
  });

  async function mkOwner(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `fee-rate-migration-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Fixture',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
      },
    });
    userIds.push(user.id);
    return user;
  }

  /** Seeds a Franchise + FRANCHISE_OWNER + a Stripe PaymentAccount, plus
   * `schoolCount` Schools already billing (stripeFranchiseFeeSubscriptionId
   * set, each registered in `subscriptionFixtures` so the fake Stripe client
   * can answer retrieve() for it) — the same direct-seed technique
   * tenants.e2e-spec.ts's own "Rate-Lock Test Franchise" test already uses:
   * no code path in this sandbox can create a REAL standing Stripe
   * Subscription (no live credentials), so what's under test is purely this
   * feature's own guard/migration logic against a correlator column, not a
   * real Stripe object behind it. */
  async function seedBillingFranchise(feeModel: 'FLAT' | 'PER_HEADCOUNT', rate: number, schoolCount = 1, currentPeriodEndOffsetSeconds = -10) {
    const owner = await mkOwner('owner');
    const franchise = await superuser.franchise.create({
      data: {
        id: randomUUID(),
        name: `Fee-Rate-Migration Fixture Franchise ${randomUUID()}`,
        feeModel,
        flatFeeAmount: feeModel === 'FLAT' ? rate : undefined,
        perHeadcountRate: feeModel === 'PER_HEADCOUNT' ? rate : undefined,
        // Simulates ensureMeterAndPrice() having already run (PER_HEADCOUNT
        // only) — see createReplacementMeteredPrice's own header comment on
        // why a missing Meter at migration time would be a real
        // inconsistency, not an ordinary unconfigured state.
        stripeMeterId: feeModel === 'PER_HEADCOUNT' ? `meter_fixture_${randomUUID()}` : undefined,
        stripeUsagePriceId: feeModel === 'PER_HEADCOUNT' ? `price_fixture_initial_${randomUUID()}` : undefined,
      },
    });
    franchiseIds.push(franchise.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: franchise.id, grantedById: owner.id } });
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fake_${randomUUID()}` },
    });
    paymentAccountIds.push(paymentAccount.id);

    const schools: { id: string; stripeFranchiseFeeSubscriptionId: string }[] = [];
    for (let i = 0; i < schoolCount; i++) {
      const subscriptionId = `sub_fixture_${randomUUID()}`;
      const school = await superuser.school.create({
        data: { id: randomUUID(), name: `Fee-Rate-Migration Fixture School ${i} ${randomUUID()}`, franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: subscriptionId },
      });
      schoolIds.push(school.id);
      subscriptionFixtures.set(subscriptionId, {
        itemId: `si_fake_${subscriptionId}`,
        priceId: `price_existing_${subscriptionId}`,
        productId: `prod_existing_${subscriptionId}`,
        currentPeriodEnd: Math.floor(Date.now() / 1000) + currentPeriodEndOffsetSeconds,
      });
      schools.push({ id: school.id, stripeFranchiseFeeSubscriptionId: subscriptionId });
    }

    return {
      franchise,
      owner,
      schools,
      tokenOwner: signAccessToken(owner, [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }]),
    };
  }

  async function waitForRateChangeStatus(id: string, timeoutMs = 10_000): Promise<{ status: string; migratedCount: number; failedCount: number }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await superuser.franchiseFeeRateChange.findUniqueOrThrow({ where: { id } });
      if (row.status === 'COMPLETED' || row.status === 'FAILED') {
        return { status: row.status, migratedCount: row.migratedCount, failedCount: row.failedCount };
      }
      if (Date.now() > deadline) {
        throw new Error(`FranchiseFeeRateChange ${id} did not reach a terminal status within ${timeoutMs}ms (last status: ${row.status})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async function latestRateChangeFor(franchiseId: string) {
    return superuser.franchiseFeeRateChange.findFirstOrThrow({ where: { franchiseId }, orderBy: { createdAt: 'desc' } });
  }

  it('400s a rate change once billing has started, without a feeRateChangeStrategy — and 400s a strategy sent when nothing needs one', async () => {
    const { franchise, tokenOwner } = await seedBillingFranchise('FLAT', 5000);

    const blockedRes = await request(app.getHttpServer()).patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${tokenOwner}`).send({ flatFeeAmount: 9999 });
    expect(blockedRes.status).toBe(400);
    expect(blockedRes.body.error.message).toContain('feeRateChangeStrategy');
    const unchanged = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id } });
    expect(unchanged.flatFeeAmount).toBe(5000);

    // Re-sending the same value is a no-op, not a change — no strategy needed.
    const noopRes = await request(app.getHttpServer()).patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${tokenOwner}`).send({ flatFeeAmount: 5000 });
    expect(noopRes.status).toBe(200);

    // A strategy sent for an edit that changes nothing about the rate is a
    // caller mistake, surfaced rather than silently ignored.
    const spuriousStrategyRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchise.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ description: 'just a profile edit', feeRateChangeStrategy: 'MIGRATE_IMMEDIATE' });
    expect(spuriousStrategyRes.status).toBe(400);

    expect(fakeSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(fakeSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('FLAT + MIGRATE_NEXT_CYCLE: creates a new persisted Price on the School\'s existing Product, swaps the Subscription Item with proration_behavior "none"', async () => {
    const { franchise, schools, tokenOwner } = await seedBillingFranchise('FLAT', 5000);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchise.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ flatFeeAmount: 7500, feeRateChangeStrategy: 'MIGRATE_NEXT_CYCLE' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.flatFeeAmount).toBe(7500);

    const rateChange = await latestRateChangeFor(franchise.id);
    expect(rateChange).toMatchObject({ feeModel: 'FLAT', oldFlatFeeAmount: 5000, newFlatFeeAmount: 7500, strategy: 'MIGRATE_NEXT_CYCLE', affectedSchoolCount: 1 });

    const settled = await waitForRateChangeStatus(rateChange.id);
    expect(settled).toEqual({ status: 'COMPLETED', migratedCount: 1, failedCount: 0 });

    const subscriptionId = schools[0].stripeFranchiseFeeSubscriptionId;
    const fixture = subscriptionFixtures.get(subscriptionId)!;
    expect(fakePricesCreate).toHaveBeenCalledWith(expect.objectContaining({ product: fixture.productId, unit_amount: 7500 }));
    expect(fakeSubscriptionsUpdate).toHaveBeenCalledWith(
      subscriptionId,
      expect.objectContaining({ items: [{ id: fixture.itemId, price: expect.stringContaining('price_fake_') }], proration_behavior: 'none' }),
    );
  });

  it('FLAT + MIGRATE_IMMEDIATE: swaps with proration_behavior "always_invoice" (a real, immediate prorated charge)', async () => {
    const { franchise, schools, tokenOwner } = await seedBillingFranchise('FLAT', 5000);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchise.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ flatFeeAmount: 8000, feeRateChangeStrategy: 'MIGRATE_IMMEDIATE' });
    expect(patchRes.status).toBe(200);

    const rateChange = await latestRateChangeFor(franchise.id);
    const settled = await waitForRateChangeStatus(rateChange.id);
    expect(settled).toEqual({ status: 'COMPLETED', migratedCount: 1, failedCount: 0 });

    const subscriptionId = schools[0].stripeFranchiseFeeSubscriptionId;
    expect(fakeSubscriptionsUpdate).toHaveBeenCalledWith(subscriptionId, expect.objectContaining({ proration_behavior: 'always_invoice' }));
  });

  it('PER_HEADCOUNT + MIGRATE_IMMEDIATE: creates ONE new metered Price on the existing Meter, swaps every already-billing School to it, and updates Franchise.stripeUsagePriceId', async () => {
    const { franchise, schools, tokenOwner } = await seedBillingFranchise('PER_HEADCOUNT', 500, 2);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchise.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ perHeadcountRate: 750, feeRateChangeStrategy: 'MIGRATE_IMMEDIATE' });
    expect(patchRes.status).toBe(200);

    const rateChange = await latestRateChangeFor(franchise.id);
    expect(rateChange).toMatchObject({ feeModel: 'PER_HEADCOUNT', oldPerHeadcountRate: 500, newPerHeadcountRate: 750, affectedSchoolCount: 2 });

    const settled = await waitForRateChangeStatus(rateChange.id);
    expect(settled).toEqual({ status: 'COMPLETED', migratedCount: 2, failedCount: 0 });

    // Exactly ONE new metered Price was created (shared across both Schools),
    // on the Franchise's EXISTING Meter — not a new one.
    const meteredPriceCalls = fakePricesCreate.mock.calls.filter(([args]) => (args as { recurring?: { usage_type?: string } }).recurring?.usage_type === 'metered');
    expect(meteredPriceCalls).toHaveLength(1);
    expect(meteredPriceCalls[0][0]).toMatchObject({ unit_amount: 750, recurring: { interval: 'month', usage_type: 'metered', meter: franchise.stripeMeterId } });

    const updatedFranchise = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id } });
    expect(updatedFranchise.stripeUsagePriceId).not.toBe(franchise.stripeUsagePriceId);

    for (const school of schools) {
      expect(fakeSubscriptionsUpdate).toHaveBeenCalledWith(school.stripeFranchiseFeeSubscriptionId, expect.objectContaining({ items: [expect.objectContaining({ price: updatedFranchise.stripeUsagePriceId })] }));
    }
  });

  it('PER_HEADCOUNT + MIGRATE_NEXT_CYCLE: does NOT swap immediately — schedules one deferred-swap job per School, delayed past current_period_end', async () => {
    const { franchise, schools, tokenOwner } = await seedBillingFranchise('PER_HEADCOUNT', 500, 2, 60); // current_period_end 60s from now

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchise.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ perHeadcountRate: 750, feeRateChangeStrategy: 'MIGRATE_NEXT_CYCLE' });
    expect(patchRes.status).toBe(200);

    const rateChange = await latestRateChangeFor(franchise.id);
    const settled = await waitForRateChangeStatus(rateChange.id);
    // "COMPLETED" here means every School's deferred swap was successfully
    // SCHEDULED — see FranchiseFeeRateMigrationProcessor's own header comment.
    expect(settled).toEqual({ status: 'COMPLETED', migratedCount: 2, failedCount: 0 });

    // The immediate swap must NEVER have happened for either School.
    expect(fakeSubscriptionsUpdate).not.toHaveBeenCalled();

    for (const school of schools) {
      const jobId = `${rateChange.id}-${school.id}-deferred`;
      const job = await rateMigrationQueue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.name).toBe('deferred-swap');
      expect(job!.data).toMatchObject({ rateChangeId: rateChange.id, schoolId: school.id, stripeSubscriptionId: school.stripeFranchiseFeeSubscriptionId });
      // Buffer alone is 15 minutes (900_000ms) — current_period_end was only
      // 60s out, so the computed delay should sit just above that buffer,
      // never below it and never wildly above it.
      expect(job!.opts.delay).toBeGreaterThanOrEqual(900_000);
      expect(job!.opts.delay).toBeLessThan(970_000);
    }
  });

  it('a Franchise with no PaymentAccount fails the migration loudly (FAILED), rather than silently doing nothing', async () => {
    const owner = await mkOwner('owner-no-account');
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: `No-PaymentAccount Fixture ${randomUUID()}`, feeModel: 'FLAT', flatFeeAmount: 5000 } });
    franchiseIds.push(franchise.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: franchise.id, grantedById: owner.id } });
    const subscriptionId = `sub_fixture_${randomUUID()}`;
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `No-PaymentAccount Fixture School ${randomUUID()}`, franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: subscriptionId } });
    schoolIds.push(school.id);
    const tokenOwner = signAccessToken(owner, [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }]);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchise.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ flatFeeAmount: 9000, feeRateChangeStrategy: 'MIGRATE_IMMEDIATE' });
    expect(patchRes.status).toBe(200);

    const rateChange = await latestRateChangeFor(franchise.id);
    const settled = await waitForRateChangeStatus(rateChange.id);
    expect(settled.status).toBe('FAILED');
  });
});
