/**
 * Proves tenant-lifecycle-purge.processor.ts's own three-way outcome (Phase
 * 56, Decision 110): hard-delete in the common case, anonymize-in-place for
 * the two flagged exceptions (a School that still owns Waiver rows; billing
 * history protected by PlatformCharge/FranchiseFeeCharge's own RESTRICT FKs).
 * Triggers the processor directly (calling .process() against a fake Job),
 * same approach franchise-fee-usage-reporting.e2e-spec.ts/class-occurrence-
 * generation.e2e-spec.ts already established for a scheduled sweep with no
 * HTTP surface of its own.
 *
 * Requires DATABASE_URL, DATABASE_URL_JOBS, DATABASE_URL_APP. Skips with a
 * warning if any are unset, same convention as every other job spec here.
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantLifecyclePurgeProcessor } from '../src/jobs/tenant-lifecycle-purge.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS && DATABASE_URL_APP);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tenant-lifecycle-purge.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS / DATABASE_URL_APP not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('tenant-lifecycle-purge job', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: TenantLifecyclePurgeProcessor;

  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TenantLifecyclePurgeProcessor, PrismaJobsService],
    }).compile();
    processor = moduleRef.get(TenantLifecyclePurgeProcessor);
  });

  afterAll(async () => {
    // Best-effort — several fixtures are deliberately expected to already be
    // gone (the hard-delete case) or to have survived in an anonymized form
    // (the two exception cases); either way `deleteMany` on a leftover id is
    // a safe no-op for ids the processor already removed.
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
  });

  function fakeJob() {
    return { data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

  it('a School past purgeAt with no Waivers and no billing history is hard-deleted', async () => {
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: 'Purge Job — plain delete', archivedAt: PAST, purgeAt: PAST },
    });
    schoolIds.push(school.id);

    await processor.process(fakeJob());

    const after = await superuser.school.findUnique({ where: { id: school.id } });
    expect(after).toBeNull();
  });

  it('a School past purgeAt that still owns a Waiver is anonymized in place, not hard-deleted — Decision 110\'s own flagged exception', async () => {
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: 'Purge Job — has a Waiver', archivedAt: PAST, purgeAt: PAST },
    });
    schoolIds.push(school.id);
    const waiver = await superuser.waiver.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Liability Waiver', body: 'Terms...' },
    });

    await processor.process(fakeJob());

    const after = await superuser.school.findUnique({ where: { id: school.id } });
    expect(after).not.toBeNull();
    expect(after?.name).toBe('[Closed School]');
    expect(after?.mobileNumber).toBeNull();
    expect(after?.purgedAt).toBeTruthy();
    // The Waiver itself survives untouched — the whole point of the exception.
    const waiverAfter = await superuser.waiver.findUnique({ where: { id: waiver.id } });
    expect(waiverAfter).not.toBeNull();
    expect(waiverAfter?.title).toBe('Liability Waiver');

    await superuser.waiver.delete({ where: { id: waiver.id } });
  });

  it('a School past purgeAt with billing history (PlatformCharge, RESTRICT-protected) is anonymized in place, not hard-deleted', async () => {
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: 'Purge Job — has billing history', archivedAt: PAST, purgeAt: PAST },
    });
    schoolIds.push(school.id);
    const charge = await superuser.platformCharge.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        chargeType: 'SUBSCRIPTION_PLAN_FEE',
        amount: 5000,
        status: 'SUCCESSFUL',
      },
    });

    await processor.process(fakeJob());

    const after = await superuser.school.findUnique({ where: { id: school.id } });
    expect(after).not.toBeNull();
    expect(after?.name).toBe('[Closed School]');
    expect(after?.purgedAt).toBeTruthy();
    const chargeAfter = await superuser.platformCharge.findUnique({ where: { id: charge.id } });
    expect(chargeAfter).not.toBeNull();

    await superuser.platformCharge.delete({ where: { id: charge.id } });
  });

  it('a School whose purgeAt has NOT elapsed yet is left completely untouched', async () => {
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: 'Purge Job — not due yet', archivedAt: new Date(), purgeAt: FUTURE },
    });
    schoolIds.push(school.id);

    await processor.process(fakeJob());

    const after = await superuser.school.findUnique({ where: { id: school.id } });
    expect(after).not.toBeNull();
    expect(after?.name).toBe('Purge Job — not due yet');
    expect(after?.purgedAt).toBeNull();
  });

  it('a School already marked purgedAt is never reprocessed', async () => {
    const purgedAt = new Date('2026-01-01T00:00:00Z');
    const school = await superuser.school.create({
      data: {
        id: randomUUID(),
        name: '[Closed School]',
        archivedAt: PAST,
        purgeAt: PAST,
        purgedAt,
      },
    });
    schoolIds.push(school.id);

    await processor.process(fakeJob());

    const after = await superuser.school.findUnique({ where: { id: school.id } });
    expect(after?.purgedAt?.toISOString()).toBe(purgedAt.toISOString());
  });

  it('a Franchise past purgeAt with no billing history is hard-deleted', async () => {
    const franchise = await superuser.franchise.create({
      data: { id: randomUUID(), name: 'Purge Job — Franchise plain delete', archivedAt: PAST, purgeAt: PAST },
    });
    franchiseIds.push(franchise.id);

    await processor.process(fakeJob());

    const after = await superuser.franchise.findUnique({ where: { id: franchise.id } });
    expect(after).toBeNull();
  });

  it('a Franchise past purgeAt with billing history (FranchiseFeeCharge, RESTRICT-protected) is anonymized in place', async () => {
    const franchise = await superuser.franchise.create({
      data: { id: randomUUID(), name: 'Purge Job — Franchise has billing history', archivedAt: PAST, purgeAt: PAST },
    });
    franchiseIds.push(franchise.id);
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: 'Purge Job — Franchise billing school', franchiseId: franchise.id },
    });
    schoolIds.push(school.id);
    const paymentAccount = await superuser.paymentAccount.create({
      data: {
        id: randomUUID(),
        franchiseId: franchise.id,
        provider: 'STRIPE',
        accountTitle: 'Purge Job Test Account',
        country: 'US',
        stripeConnectedAccountId: `acct_${randomUUID()}`,
      },
    });
    const charge = await superuser.franchiseFeeCharge.create({
      data: {
        id: randomUUID(),
        franchiseId: franchise.id,
        schoolId: school.id,
        franchisePaymentAccountId: paymentAccount.id,
        billingPeriodStart: new Date('2026-01-01'),
        billingPeriodEnd: new Date('2026-02-01'),
        feeBasisSnapshot: 'FLAT',
        amount: 1000,
        status: 'SUCCESSFUL',
      },
    });

    await processor.process(fakeJob());

    const after = await superuser.franchise.findUnique({ where: { id: franchise.id } });
    expect(after).not.toBeNull();
    expect(after?.name).toBe('[Closed Franchise]');
    expect(after?.purgedAt).toBeTruthy();

    await superuser.franchiseFeeCharge.delete({ where: { id: charge.id } });
    await superuser.paymentAccount.delete({ where: { id: paymentAccount.id } });
  });
});
