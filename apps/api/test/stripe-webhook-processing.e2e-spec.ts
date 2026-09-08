/**
 * Proves the stripe-webhook-processing job's dedup guarantee (Spec 55 §10.2's own
 * confirmed mechanism: "idempotency is enforced by deduping on Stripe's event id
 * before processing") plus, as of Phase 9, its first real per-event-type handlers
 * (payment_intent.succeeded creating a Membership, customer.subscription.deleted
 * Expiring one) — the pieces of this job a passing build genuinely cannot
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
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const paymentAccountIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const transactionIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StripeWebhookProcessingProcessor, PrismaJobsService],
    }).compile();
    processor = moduleRef.get(StripeWebhookProcessingProcessor);
  });

  afterAll(async () => {
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.transaction.deleteMany({ where: { id: { in: transactionIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.paymentAccount.deleteMany({ where: { id: { in: paymentAccountIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
  });

  function fakeJob(data: { stripeEventId: string; eventType: string; objectId?: string }) {
    return { data: { objectId: '', ...data }, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  /** Seeds School + PaymentAccount + MembershipPlan + Student + a PENDING
   * Transaction — the fixture shape both new handler tests below build on. */
  async function seedPendingTransaction(overrides: { planType?: string; stripeSubscriptionId?: string } = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Webhook Job Fixture School' } });
    schoolIds.push(school.id);
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `webhook-job-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Webhook',
        surname: 'Fixture',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(student.id);
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB' },
    });
    paymentAccountIds.push(paymentAccount.id);
    const plan = await superuser.membershipPlan.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        type: (overrides.planType ?? 'CLASS_PACK') as never,
        title: 'Fixture Plan',
        price: 1000,
        classesIncluded: 3,
      },
    });
    membershipPlanIds.push(plan.id);
    const stripePaymentIntentId = `pi_fixture_${randomUUID()}`;
    const transaction = await superuser.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        studentId: student.id,
        paymentAccountId: paymentAccount.id,
        membershipPlanId: plan.id,
        amount: 1000,
        status: 'PENDING',
        paymentMethod: 'STRIPE',
        stripePaymentIntentId,
        stripeSubscriptionId: overrides.stripeSubscriptionId,
      },
    });
    transactionIds.push(transaction.id);
    return { school, student, plan, transaction, stripePaymentIntentId };
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

  // ---------------------------------------------------------------------------
  // Phase 9 — first real per-event-type handlers.
  // ---------------------------------------------------------------------------

  it('payment_intent.succeeded flips the Transaction to SUCCESSFUL and creates the Membership Active (Decision 6)', async () => {
    const { transaction, plan, student, stripePaymentIntentId } = await seedPendingTransaction();
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));

    const updatedTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updatedTransaction.status).toBe('SUCCESSFUL');
    expect(updatedTransaction.membershipId).not.toBeNull();

    const membership = await superuser.membership.findUniqueOrThrow({ where: { id: updatedTransaction.membershipId! } });
    membershipIds.push(membership.id);
    expect(membership.status).toBe('ACTIVE');
    expect(membership.studentId).toBe(student.id);
    expect(membership.classesRemaining).toBe(plan.classesIncluded);
  });

  it('a redelivered payment_intent.succeeded is a no-op — the dedup row blocks re-processing, no second Membership', async () => {
    const { transaction, stripePaymentIntentId } = await seedPendingTransaction();
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));
    await expect(
      processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId })),
    ).resolves.not.toThrow();

    const finalTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    if (finalTransaction.membershipId) membershipIds.push(finalTransaction.membershipId);
    const membershipCount = await superuser.membership.count({ where: { studentId: transaction.studentId } });
    expect(membershipCount).toBe(1);
  });

  it('customer.subscription.deleted Expires the matching Active Membership', async () => {
    const stripeSubscriptionId = `sub_fixture_${randomUUID()}`;
    const { transaction, stripePaymentIntentId } = await seedPendingTransaction({ planType: 'SUBSCRIPTION', stripeSubscriptionId });
    const settleEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(settleEventId);
    await processor.process(fakeJob({ stripeEventId: settleEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));

    const settledTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    membershipIds.push(settledTransaction.membershipId!);
    const membershipBefore = await superuser.membership.findUniqueOrThrow({ where: { id: settledTransaction.membershipId! } });
    expect(membershipBefore.status).toBe('ACTIVE');
    expect(membershipBefore.frequency).toBe('RECURRING');

    const cancelEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(cancelEventId);
    await processor.process(fakeJob({ stripeEventId: cancelEventId, eventType: 'customer.subscription.deleted', objectId: stripeSubscriptionId }));

    const membershipAfter = await superuser.membership.findUniqueOrThrow({ where: { id: membershipBefore.id } });
    expect(membershipAfter.status).toBe('EXPIRED');
  });

  it('an unrecognized event type is deduped and logged, not thrown', async () => {
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await expect(
      processor.process(fakeJob({ stripeEventId, eventType: 'charge.dispute.created', objectId: 'dp_fixture' })),
    ).resolves.not.toThrow();
    const row = await superuser.processedStripeEvent.findUniqueOrThrow({ where: { stripeEventId } });
    expect(row.eventType).toBe('charge.dispute.created');
  });
});
