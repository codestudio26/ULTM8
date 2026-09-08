/**
 * Proves the stripe-webhook-processing job's dedup guarantee (Spec 55 §10.2's own
 * confirmed mechanism: "idempotency is enforced by deduping on Stripe's event id
 * before processing") — the one piece of this job a passing build genuinely cannot
 * substitute for, same reasoning class-occurrence-generation.e2e-spec.ts already
 * established for its own job. Triggers the processor directly (calling .process()
 * against a fake Job) rather than going through a real queue/Redis connection, same
 * approach that file uses.
 *
 * Requires DATABASE_URL and DATABASE_URL_JOBS — corrected on code review from an
 * earlier draft requiring DATABASE_URL_APP: the processor was switched from the bare
 * PrismaAppService client to PrismaJobsService (ultm8_jobs role), matching
 * class-occurrence-generation's own established pattern for a no-single-caller
 * background job (see the processor's own header comment for the full reasoning).
 * Skips with a warning if either is unset.
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[stripe-webhook-processing.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('stripe-webhook-processing job', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: StripeWebhookProcessingProcessor;

  const eventIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StripeWebhookProcessingProcessor, PrismaJobsService],
    }).compile();
    processor = moduleRef.get(StripeWebhookProcessingProcessor);
  });

  afterAll(async () => {
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.$disconnect();
  });

  function fakeJob(data: { stripeEventId: string; eventType: string }) {
    return { data, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  it('records a new Stripe event as processed', async () => {
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'account.updated' }));

    const row = await superuser.processedStripeEvent.findUniqueOrThrow({ where: { stripeEventId } });
    expect(row.eventType).toBe('account.updated');
  });

  it('a redelivered event (same id) is skipped, not double-recorded or double-thrown', async () => {
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'account.updated' }));
    // The redelivery — same event id, processed a second time. Must not throw (a
    // naive `create()` with no pre-check would hit the table's own PK uniqueness
    // constraint and throw P2002 here) and must not create a second row.
    await expect(processor.process(fakeJob({ stripeEventId, eventType: 'account.updated' }))).resolves.not.toThrow();

    const count = await superuser.processedStripeEvent.count({ where: { stripeEventId } });
    expect(count).toBe(1);
  });
});
