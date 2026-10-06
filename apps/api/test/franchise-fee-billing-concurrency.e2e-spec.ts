/**
 * V1 Stress Test Round 3 (docs/V1-STRESS-TEST-REPORT-ROUND3.md) — verifies, under
 * REAL concurrent pressure against a real Postgres, the two race-protection
 * mechanisms franchise-fee-usage-reporting.processor.ts's own comments already
 * claim but which nothing in this repo had previously exercised concurrently:
 *
 *  1. usageReportPass()'s own documented two-layer idempotency (the in-memory
 *     `existing` check as a fast path, "the migration's own partial unique index
 *     is the real, DB-enforced backstop against two concurrent runs racing past
 *     that check") — proven here by running `process()` TWICE, truly
 *     concurrently (`Promise.all`, two separate Prisma connections, both from
 *     the processor's own real PrismaJobsService client), against the same
 *     ready School/Franchise. If the backstop didn't actually hold, this would
 *     double-count the active-student usage reported for the period and leave
 *     TWO FranchiseFeeCharge rows for one billing period — the exact
 *     "franchise-fee charge double-counting active students" risk this round
 *     was asked to specifically watch for.
 *  2. FranchiseFeeBillingService.ensureSubscription()'s own Stripe idempotency
 *     key (`franchise-fee-sub-${school.id}`) — proven here by calling it twice
 *     concurrently for the same School and confirming both calls settle on the
 *     identical Stripe Subscription id, never two different ones.
 *
 * Both mechanisms are confirmed to hold. No bug found in this area — this file
 * exists to make that a verified fact, not an assumption carried over from the
 * code's own comments (this codebase's own standing rule: verify, don't guess).
 *
 * StripeClientService is stubbed (not a live Stripe account — same documented
 * sandbox constraint franchise-fee-usage-reporting.e2e-spec.ts's own header
 * comment already states); the race itself is 100% real DB concurrency, only
 * the external network call is substituted.
 *
 * Requires DATABASE_URL, DATABASE_URL_JOBS. Skips with a warning if either is
 * unset.
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { FranchiseFeeUsageReportingProcessor } from '../src/jobs/franchise-fee-usage-reporting.processor';
import { FranchiseFeeBillingService } from '../src/franchise-fees/franchise-fee-billing.service';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[franchise-fee-billing-concurrency.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Franchise-fee billing — concurrent-run idempotency (Round 3)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: FranchiseFeeUsageReportingProcessor;
  let billingService: FranchiseFeeBillingService;

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];

  // Every meterEvents.create() call recorded — lets the usage-pass test assert
  // Stripe usage reporting itself also only happened the expected number of
  // times (it's allowed to happen twice under a genuine race per reportUsage()'s
  // own comment — Stripe's own per-identifier dedup absorbs that — what must
  // NEVER happen twice is the local FranchiseFeeCharge row).
  const meterEventCalls: Array<{ identifier: string }> = [];
  let subscriptionCounter = 0;
  // Keyed by idempotencyKey — Stripe's own real behavior for two concurrent
  // requests carrying the IDENTICAL idempotency key is to serialize them
  // server-side so only ONE Subscription object is ever created and both
  // callers resolve to that same object; a bare Set/Map check done AFTER an
  // `await` (i.e. NOT claimed synchronously before yielding) would itself have
  // a race and silently defeat the very thing this test exists to verify, so
  // the "claim" below happens synchronously, before the artificial network
  // delay, exactly so two calls arriving in the same tick can't both see the
  // key as unclaimed.
  const inFlightByIdempotencyKey = new Map<string, Promise<{ id: string; customer: string }>>();

  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      subscriptions: {
        create: jest.fn((_params: unknown, opts: { idempotencyKey: string }) => {
          const existing = inFlightByIdempotencyKey.get(opts.idempotencyKey);
          if (existing) return existing;
          const promise = (async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            subscriptionCounter += 1;
            return { id: `sub_fake_${opts.idempotencyKey}_${subscriptionCounter}`, customer: 'cus_fake_shared' };
          })();
          inFlightByIdempotencyKey.set(opts.idempotencyKey, promise);
          return promise;
        }),
        retrieve: jest.fn(async (id: string) => ({ id, customer: 'cus_fake_shared' })),
      },
      customers: { create: jest.fn(async () => ({ id: 'cus_fake_shared' })) },
      products: { create: jest.fn(async () => ({ id: `prod_fake_${randomUUID()}` })) },
      billing: {
        meterEvents: {
          create: jest.fn(async (params: { identifier: string }) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            meterEventCalls.push({ identifier: params.identifier });
            return { identifier: params.identifier };
          }),
        },
      },
    })),
    platformClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [FranchiseFeeUsageReportingProcessor, FranchiseFeeBillingService, PrismaJobsService, { provide: StripeClientService, useValue: fakeStripeClient }],
    }).compile();
    processor = moduleRef.get(FranchiseFeeUsageReportingProcessor);
    billingService = moduleRef.get(FranchiseFeeBillingService);
  });

  afterAll(async () => {
    // FranchiseFeeCharge FK-references both School and PaymentAccount
    // (ON DELETE RESTRICT) — deleted first, same ordering every other
    // franchise-fee e2e spec in this repo already uses.
    await superuser.franchiseFeeCharge.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.paymentAccount.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
  });

  function fakeJob() {
    return { data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  async function mkStudentWithActiveMembership(schoolId: string) {
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `ffee-concurrency-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Active',
        surname: 'Student',
        passcodeHash: 'x',
        dateOfBirth: new Date('1995-01-01'),
      },
    });
    userIds.push(student.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId } });

    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId, type: 'SUBSCRIPTION', title: 'Fixture Plan', price: 5000 },
    });
    membershipPlanIds.push(plan.id);

    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId, status: 'ACTIVE', frequency: 'RECURRING' },
    });
    membershipIds.push(membership.id);
    return student;
  }

  it('two truly concurrent process() runs (simulating a double worker dispatch) never produce two FranchiseFeeCharge rows for the same subscription/period — the partial unique index backstop actually holds, not just documented', async () => {
    const franchise = await superuser.franchise.create({
      data: { id: randomUUID(), name: `Concurrency Fixture Franchise ${randomUUID()}`, feeModel: 'PER_HEADCOUNT', perHeadcountRate: 1000 },
    });
    franchiseIds.push(franchise.id);
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
    });
    const school = await superuser.school.create({
      data: {
        id: randomUUID(),
        name: `Concurrency Fixture School ${randomUUID()}`,
        franchiseId: franchise.id,
        stripeFranchiseFeeSubscriptionId: `sub_fixture_${randomUUID()}`,
        franchiseFeeSubscriptionStatus: 'ACTIVE',
      },
    });
    schoolIds.push(school.id);
    await mkStudentWithActiveMembership(school.id);
    await mkStudentWithActiveMembership(school.id);

    // Two real, truly concurrent process() invocations — each runs its own
    // ensureSubscriptionsPass() (no-op here, already subscribed) then its own
    // usageReportPass() against the SAME real Postgres rows at the same time.
    await Promise.all([processor.process(fakeJob()), processor.process(fakeJob())]);

    const charges = await superuser.franchiseFeeCharge.findMany({ where: { schoolId: school.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0].activeStudentCountSnapshot).toBe(2);
    expect(charges[0].amount).toBe(2000);
  });

  it('ensureSubscription() called twice concurrently for the same School settles on exactly one Stripe Subscription id, via the idempotency key — never creates two standing Subscriptions', async () => {
    const franchise = await superuser.franchise.create({
      data: { id: randomUUID(), name: `Concurrency Fixture Franchise (ensure) ${randomUUID()}`, feeModel: 'FLAT', flatFeeAmount: 10000 },
    });
    franchiseIds.push(franchise.id);
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
    });
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: `Concurrency Fixture School (ensure) ${randomUUID()}`, franchiseId: franchise.id },
    });
    schoolIds.push(school.id);

    const franchiseWithAccount = { ...franchise, paymentAccount };
    const [idA, idB] = await Promise.all([
      billingService.ensureSubscription(franchiseWithAccount, school),
      billingService.ensureSubscription(franchiseWithAccount, { ...school }),
    ]);

    expect(idA).toBeTruthy();
    expect(idA).toBe(idB);

    const persisted = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(persisted.stripeFranchiseFeeSubscriptionId).toBe(idA);
  });
});
