/**
 * Proves the franchise-fee-usage-reporting job's own guard/skip logic (Phase
 * 16b-ii) — the one piece of this job genuinely reachable without live Stripe
 * access. Triggers the processor directly (calling .process() against a fake
 * Job), same approach class-occurrence-generation.e2e-spec.ts and
 * stripe-webhook-processing.e2e-spec.ts already established for their own jobs.
 *
 * Deliberately does NOT test the "happy path" (a fully-configured
 * Franchise/School pair actually getting a standing Stripe Subscription
 * created, or a Per-Headcount Franchise's usage actually getting reported) —
 * both require live Stripe API calls
 * (FranchiseFeeBillingService.ensureSubscription/reportUsage), which this
 * sandbox has no real credentials for (CI's own STRIPE_SECRET_KEY is a
 * documented dummy value). What IS fully testable without Stripe: every
 * precondition-not-met case returns null/skips cleanly rather than crashing,
 * and the usage-report pass's own WHERE filter correctly never even reaches a
 * School with no standing Subscription yet — same accepted gap
 * MembershipsService.purchase()'s own Stripe-calling code already has zero
 * e2e coverage for.
 *
 * Requires DATABASE_URL, DATABASE_URL_JOBS, DATABASE_URL_APP (for RLS-scoped
 * fixture cleanup reads). Skips with a warning if any are unset.
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
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS && DATABASE_URL_APP);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[franchise-fee-usage-reporting.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS / DATABASE_URL_APP not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('franchise-fee-usage-reporting job', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: FranchiseFeeUsageReportingProcessor;

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [FranchiseFeeUsageReportingProcessor, FranchiseFeeBillingService, StripeClientService, PrismaJobsService],
    }).compile();
    processor = moduleRef.get(FranchiseFeeUsageReportingProcessor);
  });

  afterAll(async () => {
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
  });

  function fakeJob() {
    return { data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  it('skips ensuring a Subscription for a Franchise with no PaymentAccount — no error, School stays unsubscribed', async () => {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Usage-Reporting Fixture Franchise (no PaymentAccount)', feeModel: 'FLAT', flatFeeAmount: 10000 } });
    franchiseIds.push(franchise.id);
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Usage-Reporting Fixture School A', franchiseId: franchise.id } });
    schoolIds.push(school.id);

    await expect(processor.process(fakeJob())).resolves.not.toThrow();

    const updated = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(updated.stripeFranchiseFeeSubscriptionId).toBeNull();
  });

  it('skips ensuring a Subscription for a FLAT Franchise with no flatFeeAmount configured — no error, School stays unsubscribed', async () => {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Usage-Reporting Fixture Franchise (no rate)', feeModel: 'FLAT' } });
    franchiseIds.push(franchise.id);
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
    });
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Usage-Reporting Fixture School B', franchiseId: franchise.id } });
    schoolIds.push(school.id);

    await expect(processor.process(fakeJob())).resolves.not.toThrow();

    const updated = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(updated.stripeFranchiseFeeSubscriptionId).toBeNull();
  });

  it('the usage-report pass never touches a School with no standing Subscription yet — no FranchiseFeeCharge row created', async () => {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Usage-Reporting Fixture Franchise (unsubscribed)', feeModel: 'PER_HEADCOUNT', perHeadcountRate: 500 } });
    franchiseIds.push(franchise.id);
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Usage-Reporting Fixture School C', franchiseId: franchise.id } });
    schoolIds.push(school.id);

    await processor.process(fakeJob());

    const chargeCount = await superuser.franchiseFeeCharge.count({ where: { schoolId: school.id } });
    expect(chargeCount).toBe(0);
  });

  it('an independent School (no franchiseId) is never touched by either pass', async () => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Usage-Reporting Fixture School D (independent)' } });
    schoolIds.push(school.id);

    await expect(processor.process(fakeJob())).resolves.not.toThrow();

    const updated = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(updated.stripeFranchiseFeeSubscriptionId).toBeNull();
    expect(updated.franchiseFeeSubscriptionStatus).toBeNull();
  });
});
