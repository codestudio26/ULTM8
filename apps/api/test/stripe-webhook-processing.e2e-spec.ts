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
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { NOTIFICATION_FANOUT_QUEUE, CHARGEBACK_PATTERN_RESTRICTION_QUEUE } from '../src/jobs/queue.constants';

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
  const franchiseIds: string[] = [];
  const userIds: string[] = [];
  const paymentAccountIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const transactionIds: string[] = [];
  // Phase 54 — deleted in afterAll, AFTER School/Franchise (both FK-reference
  // SubscriptionPlan.id with ON DELETE RESTRICT).
  const subscriptionPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // FOUND ON REVIEW: StripeWebhookProcessingProcessor gained a StripeClientService
      // dependency this phase (invoice.paid/invoice.payment_failed need to retrieve the
      // Invoice via stripe.invoices.retrieve()) — this module wasn't updated at the same
      // time, which broke Nest DI for the whole suite, not just the new test. No mock
      // needed: none of these tests exercise a path that actually calls Stripe, same
      // "plain provider, no live key required until a method that needs one is actually
      // invoked" pattern franchise-fee-usage-reporting.e2e-spec.ts's own module already
      // uses for the same service.
      //
      // Decision 111 — the processor also injects NOTIFICATION_FANOUT_QUEUE now (its
      // new charge.dispute.* handling). A bare faked queue is enough here too: none of
      // the event types this describe block exercises ever produce a notification (see
      // the dedicated "charge.dispute.* handling" describe block below for real
      // dispute-notification coverage, with its own fully-controllable fake).
      //
      // Decision 112 — same reasoning, now also for CHARGEBACK_PATTERN_RESTRICTION_QUEUE.
      providers: [
        StripeWebhookProcessingProcessor,
        PrismaJobsService,
        StripeClientService,
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
      ],
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
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    // Phase 54 — after School/Franchise, both FK-reference this with ON DELETE RESTRICT.
    await superuser.subscriptionPlan.deleteMany({ where: { id: { in: subscriptionPlanIds } } });
    await superuser.$disconnect();
  });

  function fakeJob(data: { stripeEventId: string; eventType: string; objectId?: string; stripeAccountId?: string }) {
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

  // ---------------------------------------------------------------------------
  // Phase 16b-ii — customer.subscription.deleted's new franchise-fee branch.
  // Fully testable via .process() without live Stripe access (same as the
  // existing Membership case above): it only ever matches an already-known id
  // against a stored correlator column, never calls back into Stripe. The two
  // NEW invoice.paid/invoice.payment_failed handlers are deliberately NOT
  // tested here — unlike every other handler in this file, both require a
  // live Stripe API fetch (stripe.invoices.retrieve, inside process() itself)
  // before they ever run, which this sandbox has no real credentials for —
  // the same accepted gap MembershipsService.purchase()'s own Stripe charge()/
  // subscribe() calls already have zero e2e coverage for (grepped
  // memberships.e2e-spec.ts to confirm before treating this as acceptable
  // rather than an oversight).
  // ---------------------------------------------------------------------------

  it('customer.subscription.deleted Cancels the matching School\'s franchise-fee subscription status', async () => {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Webhook Job Fixture Franchise' } });
    const stripeSubscriptionId = `sub_franchise_fixture_${randomUUID()}`;
    const school = await superuser.school.create({
      data: {
        id: randomUUID(),
        name: 'Webhook Job Franchise-Fee School',
        franchiseId: franchise.id,
        stripeFranchiseFeeSubscriptionId: stripeSubscriptionId,
        franchiseFeeSubscriptionStatus: 'ACTIVE',
      },
    });
    schoolIds.push(school.id);

    const cancelEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(cancelEventId);
    await processor.process(fakeJob({ stripeEventId: cancelEventId, eventType: 'customer.subscription.deleted', objectId: stripeSubscriptionId }));

    const updated = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(updated.franchiseFeeSubscriptionStatus).toBe('CANCELED');
    // The correlator id itself is kept, not cleared — same "never clear a
    // Stripe id after cancellation, only flip status" convention the existing
    // Membership.stripeSubscriptionId case above already follows.
    expect(updated.stripeFranchiseFeeSubscriptionId).toBe(stripeSubscriptionId);

    await superuser.franchise.delete({ where: { id: franchise.id } });
  });

  // ---------------------------------------------------------------------------
  // Phase 54 — customer.subscription.deleted's new platform SubscriptionPlan
  // branch (School- and Franchise-side, tried after the franchise-fee branch
  // above doesn't match). Same "no live Stripe API access needed" reasoning as
  // every case in this file — a correlator-column match only. invoice.paid/
  // invoice.payment_failed's own new platform-subscription branches are
  // deliberately NOT tested here either, for the identical accepted-gap reason
  // already documented above this file's franchise-fee section.
  // ---------------------------------------------------------------------------

  it('customer.subscription.deleted Cancels the matching School\'s platform SubscriptionPlan status, portal access now read-only', async () => {
    const plan = await superuser.subscriptionPlan.create({ data: { id: randomUUID(), name: 'Webhook Job Fixture Plan', price: 3000 } });
    subscriptionPlanIds.push(plan.id);
    const stripeSubscriptionId = `sub_platform_fixture_${randomUUID()}`;
    const school = await superuser.school.create({
      data: {
        id: randomUUID(),
        name: 'Webhook Job Platform-Subscription School',
        subscriptionPlanId: plan.id,
        stripePlatformSubscriptionId: stripeSubscriptionId,
        platformSubscriptionStatus: 'ACTIVE',
      },
    });
    schoolIds.push(school.id);

    const cancelEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(cancelEventId);
    await processor.process(fakeJob({ stripeEventId: cancelEventId, eventType: 'customer.subscription.deleted', objectId: stripeSubscriptionId }));

    const updated = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(updated.platformSubscriptionStatus).toBe('CANCELED');
    expect(updated.stripePlatformSubscriptionId).toBe(stripeSubscriptionId);
  });

  it('customer.subscription.deleted Cancels the matching Franchise\'s platform SubscriptionPlan status', async () => {
    const plan = await superuser.subscriptionPlan.create({ data: { id: randomUUID(), name: 'Webhook Job Fixture Plan (Franchise)', price: 5000 } });
    subscriptionPlanIds.push(plan.id);
    const stripeSubscriptionId = `sub_platform_franchise_fixture_${randomUUID()}`;
    const franchise = await superuser.franchise.create({
      data: {
        id: randomUUID(),
        name: 'Webhook Job Platform-Subscription Franchise',
        subscriptionPlanId: plan.id,
        stripePlatformSubscriptionId: stripeSubscriptionId,
        platformSubscriptionStatus: 'ACTIVE',
      },
    });
    franchiseIds.push(franchise.id);

    const cancelEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(cancelEventId);
    await processor.process(fakeJob({ stripeEventId: cancelEventId, eventType: 'customer.subscription.deleted', objectId: stripeSubscriptionId }));

    const updated = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id } });
    expect(updated.platformSubscriptionStatus).toBe('CANCELED');
    expect(updated.stripePlatformSubscriptionId).toBe(stripeSubscriptionId);
  });

  it('an unrecognized event type is deduped and logged, not thrown', async () => {
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    // customer.subscription.updated, not charge.dispute.created — Decision 111
    // made the latter a real handler (see the dedicated section below), so it no
    // longer belongs in this file as an example of an UNrecognized type.
    await expect(
      processor.process(fakeJob({ stripeEventId, eventType: 'customer.subscription.updated', objectId: 'sub_fixture' })),
    ).resolves.not.toThrow();
    const row = await superuser.processedStripeEvent.findUniqueOrThrow({ where: { stripeEventId } });
    expect(row.eventType).toBe('customer.subscription.updated');
  });
});

/**
 * Decision 111 — charge.dispute.created/updated/closed handling. A SEPARATE
 * describeIfDb block (its own module, fixtures, lifecycle) rather than folded into
 * the suite above: this handler needs StripeClientService.scopedClient()/
 * platformClient() to actually return something (real Dispute retrieval), unlike
 * every event type tested above, which only ever matches an id against a stored
 * correlator column and never touches Stripe. Faked here — same "fake the external
 * boundary, exercise the real business logic" pattern notifications.e2e-spec.ts
 * already established for NOTIFICATION_FANOUT_QUEUE (getQueueToken override) — NOT
 * a live Stripe call, so no real credentials are needed and none of this is
 * skipped the way invoice.paid/invoice.payment_failed's own Stripe-touching path
 * still is (this file's own header comment, unchanged).
 */
describeIfDb('stripe-webhook-processing job — charge.dispute.* handling (Decision 111)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: StripeWebhookProcessingProcessor;

  const eventIds: string[] = [];
  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];
  const userIds: string[] = [];
  const paymentAccountIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const transactionIds: string[] = [];
  const franchiseFeeChargeIds: string[] = [];
  const platformChargeIds: string[] = [];

  const fakeDisputeRetrieve = jest.fn();
  const fakeSubscriptionCancel = jest.fn().mockResolvedValue({});
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({ disputes: { retrieve: fakeDisputeRetrieve }, subscriptions: { cancel: fakeSubscriptionCancel } })),
    platformClient: jest.fn(() => ({ disputes: { retrieve: fakeDisputeRetrieve }, subscriptions: { cancel: fakeSubscriptionCancel } })),
  };
  const fakeNotificationFanoutQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };
  const fakeChargebackPatternRestrictionQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeWebhookProcessingProcessor,
        PrismaJobsService,
        { provide: StripeClientService, useValue: fakeStripeClient },
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: fakeNotificationFanoutQueue },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: fakeChargebackPatternRestrictionQueue },
      ],
    }).compile();
    processor = moduleRef.get(StripeWebhookProcessingProcessor);
  });

  afterEach(() => {
    fakeDisputeRetrieve.mockReset();
    fakeSubscriptionCancel.mockClear();
    fakeSubscriptionCancel.mockResolvedValue({});
    fakeStripeClient.scopedClient.mockClear();
    fakeStripeClient.platformClient.mockClear();
    fakeNotificationFanoutQueue.addBulk.mockClear();
    fakeChargebackPatternRestrictionQueue.addBulk.mockClear();
  });

  afterAll(async () => {
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.franchiseFeeCharge.deleteMany({ where: { id: { in: franchiseFeeChargeIds } } });
    await superuser.platformCharge.deleteMany({ where: { id: { in: platformChargeIds } } });
    await superuser.transaction.deleteMany({ where: { id: { in: transactionIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.paymentAccount.deleteMany({ where: { id: { in: paymentAccountIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
  });

  function fakeJob(data: { stripeEventId: string; eventType: string; objectId: string; stripeAccountId?: string }) {
    return { data, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  function fakeDispute(overrides: Partial<{ id: string; payment_intent: string; status: string; amount: number; currency: string }> = {}) {
    return {
      id: overrides.id ?? `dp_fixture_${randomUUID()}`,
      payment_intent: overrides.payment_intent,
      status: overrides.status ?? 'needs_response',
      amount: overrides.amount ?? 1000,
      currency: overrides.currency ?? 'usd',
    };
  }

  async function mkOwner(role: 'SCHOOL_OWNER_MANAGER' | 'FRANCHISE_OWNER', scope: { schoolId?: string; franchiseId?: string }) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `dispute-owner-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Dispute',
        surname: 'Owner',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(user.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, ...scope } });
    return user;
  }

  /** School + PaymentAccount(schoolId) + MembershipPlan + Student + SUCCESSFUL
   * Transaction — the fixture shape the Transaction-dispute tests build on. */
  async function seedSuccessfulTransaction(overrides: { membership?: boolean; stripeSubscriptionId?: string } = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Dispute Fixture School' } });
    schoolIds.push(school.id);
    const owner = await mkOwner('SCHOOL_OWNER_MANAGER', { schoolId: school.id });
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `dispute-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Dispute',
        surname: 'Student',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(student.id);
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
    });
    paymentAccountIds.push(paymentAccount.id);
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: overrides.membership ? 'SUBSCRIPTION' : 'CLASS_PACK', title: 'Fixture Plan', price: 1000 },
    });
    membershipPlanIds.push(plan.id);

    let membershipId: string | undefined;
    if (overrides.membership) {
      const membership = await superuser.membership.create({
        data: {
          id: randomUUID(),
          studentId: student.id,
          membershipPlanId: plan.id,
          schoolId: school.id,
          status: 'ACTIVE',
          frequency: 'RECURRING',
          stripeSubscriptionId: overrides.stripeSubscriptionId,
        },
      });
      membershipIds.push(membership.id);
      membershipId = membership.id;
    }

    const stripePaymentIntentId = `pi_fixture_${randomUUID()}`;
    const transaction = await superuser.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        studentId: student.id,
        paymentAccountId: paymentAccount.id,
        membershipPlanId: plan.id,
        membershipId,
        amount: 1000,
        status: 'SUCCESSFUL',
        paymentMethod: 'STRIPE',
        stripePaymentIntentId,
      },
    });
    transactionIds.push(transaction.id);
    return { school, owner, student, paymentAccount, transaction, stripePaymentIntentId, membershipId };
  }

  it('an in-progress dispute (needs_response) sets Transaction DISPUTED + disputedAmount and notifies the School Owner/Manager, no Membership/Subscription action', async () => {
    const { transaction, stripePaymentIntentId, owner } = await seedSuccessfulTransaction();
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    fakeDisputeRetrieve.mockResolvedValue(fakeDispute({ payment_intent: stripePaymentIntentId, status: 'needs_response', amount: 1000 }));

    await processor.process(fakeJob({ stripeEventId, eventType: 'charge.dispute.created', objectId: 'dp_fixture', stripeAccountId: 'acct_fixture' }));

    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated.status).toBe('DISPUTED');
    expect(updated.disputedAmount).toBe(1000);
    expect(fakeSubscriptionCancel).not.toHaveBeenCalled();
    expect(fakeNotificationFanoutQueue.addBulk).toHaveBeenCalledTimes(1);
    const jobs = fakeNotificationFanoutQueue.addBulk.mock.calls[0][0] as Array<{ data: { userId: string } }>;
    expect(jobs.map((j) => j.data.userId)).toContain(owner.id);
  });

  it('a lost dispute force-Expires the ACTIVE Membership and cancels its Stripe Subscription on the School\'s own connected account', async () => {
    const stripeSubscriptionId = `sub_fixture_${randomUUID()}`;
    const { transaction, stripePaymentIntentId, membershipId, paymentAccount } = await seedSuccessfulTransaction({ membership: true, stripeSubscriptionId });
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    fakeDisputeRetrieve.mockResolvedValue(fakeDispute({ payment_intent: stripePaymentIntentId, status: 'lost', amount: 1000 }));

    await processor.process(fakeJob({ stripeEventId, eventType: 'charge.dispute.closed', objectId: 'dp_fixture', stripeAccountId: 'acct_fixture' }));

    const updatedTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updatedTransaction.status).toBe('DISPUTED');
    expect(updatedTransaction.disputedAmount).toBe(1000);
    expect(updatedTransaction.disputeLostAt).not.toBeNull();

    const updatedMembership = await superuser.membership.findUniqueOrThrow({ where: { id: membershipId! } });
    expect(updatedMembership.status).toBe('EXPIRED');

    expect(fakeStripeClient.scopedClient).toHaveBeenCalledWith(paymentAccount.stripeConnectedAccountId);
    expect(fakeSubscriptionCancel).toHaveBeenCalledWith(stripeSubscriptionId);

    // Decision 112 — a newly-recorded lost dispute enqueues exactly one
    // chargeback-pattern-restriction check, for this Transaction's own Student.
    expect(fakeChargebackPatternRestrictionQueue.addBulk).toHaveBeenCalledTimes(1);
    const checks = fakeChargebackPatternRestrictionQueue.addBulk.mock.calls[0][0] as Array<{ data: { studentId: string } }>;
    expect(checks.map((c) => c.data.studentId)).toEqual([transaction.studentId]);
  });

  it('a won dispute reverts Transaction to SUCCESSFUL with disputedAmount cleared', async () => {
    const { transaction, stripePaymentIntentId } = await seedSuccessfulTransaction();
    // Simulate an already-open dispute before it resolves won.
    await superuser.transaction.update({ where: { id: transaction.id }, data: { status: 'DISPUTED', disputedAmount: 1000 } });

    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    fakeDisputeRetrieve.mockResolvedValue(fakeDispute({ payment_intent: stripePaymentIntentId, status: 'won', amount: 1000 }));

    await processor.process(fakeJob({ stripeEventId, eventType: 'charge.dispute.closed', objectId: 'dp_fixture', stripeAccountId: 'acct_fixture' }));

    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated.status).toBe('SUCCESSFUL');
    expect(updated.disputedAmount).toBeNull();
    expect(updated.disputeLostAt).toBeNull();
    // A won outcome never enqueues a chargeback-pattern-restriction check — there's
    // no new lost dispute to count.
    expect(fakeChargebackPatternRestrictionQueue.addBulk).not.toHaveBeenCalled();
  });

  it('a lost FranchiseFeeCharge dispute sets DISPUTED with no forced consequence, and notifies the Franchise Owner', async () => {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Dispute Fixture Franchise' } });
    franchiseIds.push(franchise.id);
    const owner = await mkOwner('FRANCHISE_OWNER', { franchiseId: franchise.id });
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Dispute Fixture FF School', franchiseId: franchise.id } });
    schoolIds.push(school.id);
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB' },
    });
    paymentAccountIds.push(paymentAccount.id);
    const stripePaymentIntentId = `pi_fixture_${randomUUID()}`;
    const charge = await superuser.franchiseFeeCharge.create({
      data: {
        id: randomUUID(),
        franchiseId: franchise.id,
        schoolId: school.id,
        franchisePaymentAccountId: paymentAccount.id,
        billingPeriodStart: new Date('2026-09-01'),
        billingPeriodEnd: new Date('2026-09-30'),
        feeBasisSnapshot: 'FLAT',
        amount: 5000,
        currency: 'USD',
        status: 'SUCCESSFUL',
        stripePaymentIntentId,
      },
    });
    franchiseFeeChargeIds.push(charge.id);

    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    fakeDisputeRetrieve.mockResolvedValue(fakeDispute({ payment_intent: stripePaymentIntentId, status: 'lost', amount: 5000 }));

    await processor.process(fakeJob({ stripeEventId, eventType: 'charge.dispute.closed', objectId: 'dp_fixture', stripeAccountId: 'acct_fixture' }));

    const updated = await superuser.franchiseFeeCharge.findUniqueOrThrow({ where: { id: charge.id } });
    expect(updated.status).toBe('DISPUTED');
    expect(updated.disputedAmount).toBe(5000);
    expect(fakeSubscriptionCancel).not.toHaveBeenCalled();
    expect(fakeNotificationFanoutQueue.addBulk).toHaveBeenCalledTimes(1);
    const jobs = fakeNotificationFanoutQueue.addBulk.mock.calls[0][0] as Array<{ data: { userId: string } }>;
    expect(jobs.map((j) => j.data.userId)).toContain(owner.id);
  });

  it('a lost PlatformCharge dispute sets DISPUTED — no notification channel exists, so nothing is enqueued (a loud log line only)', async () => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Dispute Fixture Platform School' } });
    schoolIds.push(school.id);
    const stripePaymentIntentId = `pi_fixture_${randomUUID()}`;
    const charge = await superuser.platformCharge.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        chargeType: 'SUBSCRIPTION_PLAN_FEE',
        amount: 3000,
        currency: 'USD',
        status: 'SUCCESSFUL',
        stripePaymentIntentId,
      },
    });
    platformChargeIds.push(charge.id);

    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    // No stripeAccountId — platform-billed, the expected case for PlatformCharge.
    fakeDisputeRetrieve.mockResolvedValue(fakeDispute({ payment_intent: stripePaymentIntentId, status: 'lost', amount: 3000 }));

    await processor.process(fakeJob({ stripeEventId, eventType: 'charge.dispute.closed', objectId: 'dp_fixture' }));

    const updated = await superuser.platformCharge.findUniqueOrThrow({ where: { id: charge.id } });
    expect(updated.status).toBe('DISPUTED');
    expect(updated.disputedAmount).toBe(3000);
    expect(fakeStripeClient.platformClient).toHaveBeenCalled();
    expect(fakeStripeClient.scopedClient).not.toHaveBeenCalled();
    expect(fakeNotificationFanoutQueue.addBulk).not.toHaveBeenCalled();
  });

  it('a dispute with no matching Transaction/FranchiseFeeCharge/PlatformCharge is ignored, not thrown', async () => {
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);
    fakeDisputeRetrieve.mockResolvedValue(fakeDispute({ payment_intent: `pi_unmatched_${randomUUID()}`, status: 'needs_response' }));

    await expect(
      processor.process(fakeJob({ stripeEventId, eventType: 'charge.dispute.created', objectId: 'dp_fixture', stripeAccountId: 'acct_fixture' })),
    ).resolves.not.toThrow();
    expect(fakeNotificationFanoutQueue.addBulk).not.toHaveBeenCalled();
  });
});
