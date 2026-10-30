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
import { PromotionFeeService } from '../src/ranks/promotion-fee.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import Stripe from 'stripe';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PaymentsService } from '../src/payments/payments.service';
import { NOTIFICATION_FANOUT_QUEUE, CHARGEBACK_PATTERN_RESTRICTION_QUEUE, WAITLIST_CASCADE_PROCESSING_QUEUE } from '../src/jobs/queue.constants';

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
  // Decision 122 — deleted in afterAll BEFORE Membership (Booking.sourceMembershipId
  // FK-references it), and Class deleted after Booking for the same reason.
  const bookingIds: string[] = [];
  const classIds: string[] = [];
  // Phase 54 — deleted in afterAll, AFTER School/Franchise (both FK-reference
  // SubscriptionPlan.id with ON DELETE RESTRICT).
  const subscriptionPlanIds: string[] = [];

  // Decision 122 — controllable fake so the new "cancels future Bookings" tests
  // below can assert what got enqueued; same pattern the dedicated
  // charge.dispute.* describe block already uses for its own queue fakes.
  const fakeWaitlistCascadeQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };

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
      //
      // Decision 122 — the processor also injects WAITLIST_CASCADE_PROCESSING_QUEUE
      // now (cancelling a Membership's future Bookings on force-Expiry notifies the
      // waitlist for each freed seat). Controllable, not a bare no-op, so the
      // dedicated test below can assert on it.
      providers: [
        StripeWebhookProcessingProcessor,
        PrismaJobsService,
        StripeClientService,
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: fakeWaitlistCascadeQueue },
        // None of these pay a promotion fee (backlog 3.6 step 6).
        { provide: PromotionFeeService, useValue: { settlePaidCharges: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    processor = moduleRef.get(StripeWebhookProcessingProcessor);
  });

  afterEach(() => {
    fakeWaitlistCascadeQueue.addBulk.mockClear();
  });

  afterAll(async () => {
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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

  // These rows carry their PaymentIntent id from the start (a fresh-card
  // charge() purchase or a Subscription). A hosted Checkout purchase (Decision
  // 243) has none until the member pays, on the API version the installed SDK
  // pins: its own block at the end of this file covers that, through the real
  // webhook intake.
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

  // Previously uncovered by any e2e test (checked directly — no existing spec
  // exercised this event type at all) — closed here, not only for Decision
  // 241's own "a failed/expired Checkout Session doesn't create anything"
  // requirement, but as a real, previously-unflagged gap in this handler's own
  // coverage. A card declined on a hosted Checkout page (or a plain Stripe
  // Elements fresh-card attempt) fires payment_intent.payment_failed for the
  // SAME PaymentIntent id either way — handlePaymentIntentFailed's own header
  // comment confirms no Membership was ever created for a PENDING Transaction,
  // so there is nothing to undo beyond the status flip itself.
  it('payment_intent.payment_failed flips the Transaction to FAILED and creates no Membership (Decision 243 — a declined/expired Checkout attempt)', async () => {
    const { transaction, stripePaymentIntentId } = await seedPendingTransaction();
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.payment_failed', objectId: stripePaymentIntentId }));

    const updatedTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updatedTransaction.status).toBe('FAILED');
    expect(updatedTransaction.membershipId).toBeNull();
    const membershipCount = await superuser.membership.count({ where: { studentId: transaction.studentId } });
    expect(membershipCount).toBe(0);
  });

  // Decision 339 (T12) — a card payment the Student abandoned: Stripe cancels
  // the PaymentIntent (directly, or when its Checkout Session expires), and the
  // row used to stay Pending for ever.
  it('payment_intent.canceled flips an abandoned Pending card Transaction to FAILED, no Membership (Decision 339)', async () => {
    const { transaction, stripePaymentIntentId } = await seedPendingTransaction();
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.canceled', objectId: stripePaymentIntentId }));

    const updatedTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updatedTransaction.status).toBe('FAILED');
    expect(updatedTransaction.membershipId).toBeNull();
  });

  it('a redelivered payment_intent.payment_failed is a no-op — already-FAILED Transaction untouched, no Membership', async () => {
    const { transaction, stripePaymentIntentId } = await seedPendingTransaction();
    const firstEventId = `evt_fixture_${randomUUID()}`;
    const secondEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(firstEventId, secondEventId);

    await processor.process(fakeJob({ stripeEventId: firstEventId, eventType: 'payment_intent.payment_failed', objectId: stripePaymentIntentId }));
    await expect(
      processor.process(fakeJob({ stripeEventId: secondEventId, eventType: 'payment_intent.payment_failed', objectId: stripePaymentIntentId })),
    ).resolves.not.toThrow();

    const updatedTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updatedTransaction.status).toBe('FAILED');
    const membershipCount = await superuser.membership.count({ where: { studentId: transaction.studentId } });
    expect(membershipCount).toBe(0);
  });

  it('customer.subscription.deleted Expires the matching Active Membership, cancels its future Bookings (Decision 122), and notifies the waitlist for each freed seat', async () => {
    const stripeSubscriptionId = `sub_fixture_${randomUUID()}`;
    const { school, student, transaction, stripePaymentIntentId } = await seedPendingTransaction({ planType: 'SUBSCRIPTION', stripeSubscriptionId });
    const settleEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(settleEventId);
    await processor.process(fakeJob({ stripeEventId: settleEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));

    const settledTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    membershipIds.push(settledTransaction.membershipId!);
    const membershipBefore = await superuser.membership.findUniqueOrThrow({ where: { id: settledTransaction.membershipId! } });
    expect(membershipBefore.status).toBe('ACTIVE');
    expect(membershipBefore.frequency).toBe('RECURRING');

    // Decision 122 fixture — one future Booking this Membership funds (must be
    // cancelled) and one already-Completed Booking it also funded (must be left
    // alone: cancelFutureBookingsFundedByExpiredMembership() only ever touches
    // status: 'UPCOMING', proven here rather than assumed).
    const futureClass = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Fixture Future Class', startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000) },
    });
    classIds.push(futureClass.id);
    const upcomingBooking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: futureClass.id, schoolId: school.id, sourceMembershipId: membershipBefore.id, status: 'UPCOMING' },
    });
    bookingIds.push(upcomingBooking.id);
    const pastClass = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Fixture Past Class', startDate: new Date(Date.now() - 90_000_000), endDate: new Date(Date.now() - 86_400_000) },
    });
    classIds.push(pastClass.id);
    const completedBooking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: pastClass.id, schoolId: school.id, sourceMembershipId: membershipBefore.id, status: 'COMPLETED' },
    });
    bookingIds.push(completedBooking.id);

    const cancelEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(cancelEventId);
    await processor.process(fakeJob({ stripeEventId: cancelEventId, eventType: 'customer.subscription.deleted', objectId: stripeSubscriptionId }));

    const membershipAfter = await superuser.membership.findUniqueOrThrow({ where: { id: membershipBefore.id } });
    expect(membershipAfter.status).toBe('EXPIRED');

    const upcomingAfter = await superuser.booking.findUniqueOrThrow({ where: { id: upcomingBooking.id } });
    expect(upcomingAfter.status).toBe('CANCELLED');
    expect(upcomingAfter.refundResolution).toBe('WITHHELD');

    const completedAfter = await superuser.booking.findUniqueOrThrow({ where: { id: completedBooking.id } });
    expect(completedAfter.status).toBe('COMPLETED');
    expect(completedAfter.refundResolution).toBeNull();

    expect(fakeWaitlistCascadeQueue.addBulk).toHaveBeenCalledTimes(1);
    const seatFreedJobs = fakeWaitlistCascadeQueue.addBulk.mock.calls[0][0] as Array<{ name: string; data: { classId: string } }>;
    expect(seatFreedJobs).toHaveLength(1);
    expect(seatFreedJobs[0]).toMatchObject({ name: 'seat-freed', data: { classId: futureClass.id } });
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
  // Decision 122 — deleted in afterAll before Membership/Class, same FK-ordering
  // reasoning as the suite above.
  const bookingIds: string[] = [];
  const classIds: string[] = [];

  const fakeDisputeRetrieve = jest.fn();
  const fakeSubscriptionCancel = jest.fn().mockResolvedValue({});
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({ disputes: { retrieve: fakeDisputeRetrieve }, subscriptions: { cancel: fakeSubscriptionCancel } })),
    platformClient: jest.fn(() => ({ disputes: { retrieve: fakeDisputeRetrieve }, subscriptions: { cancel: fakeSubscriptionCancel } })),
  };
  const fakeNotificationFanoutQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };
  const fakeChargebackPatternRestrictionQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };
  // Decision 122 — same controllable-fake reasoning as the suite above.
  const fakeWaitlistCascadeQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeWebhookProcessingProcessor,
        PrismaJobsService,
        { provide: StripeClientService, useValue: fakeStripeClient },
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: fakeNotificationFanoutQueue },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: fakeChargebackPatternRestrictionQueue },
        { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: fakeWaitlistCascadeQueue },
        // None of these pay a promotion fee (backlog 3.6 step 6).
        { provide: PromotionFeeService, useValue: { settlePaidCharges: jest.fn().mockResolvedValue(undefined) } },
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
    fakeWaitlistCascadeQueue.addBulk.mockClear();
  });

  afterAll(async () => {
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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

  it('a lost dispute force-Expires the ACTIVE Membership, cancels its Stripe Subscription on the School\'s own connected account, and cancels its future Bookings (Decision 122)', async () => {
    const stripeSubscriptionId = `sub_fixture_${randomUUID()}`;
    const { school, student, transaction, stripePaymentIntentId, membershipId, paymentAccount } = await seedSuccessfulTransaction({ membership: true, stripeSubscriptionId });

    // Decision 122 fixture — same "one future Booking to cancel, one already-Completed
    // Booking to prove is left alone" shape as the subscription.deleted test above.
    const futureClass = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Fixture Future Class', startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000) },
    });
    classIds.push(futureClass.id);
    const upcomingBooking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: futureClass.id, schoolId: school.id, sourceMembershipId: membershipId!, status: 'UPCOMING' },
    });
    bookingIds.push(upcomingBooking.id);

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

    const upcomingAfter = await superuser.booking.findUniqueOrThrow({ where: { id: upcomingBooking.id } });
    expect(upcomingAfter.status).toBe('CANCELLED');
    expect(upcomingAfter.refundResolution).toBe('WITHHELD');

    expect(fakeWaitlistCascadeQueue.addBulk).toHaveBeenCalledTimes(1);
    const seatFreedJobs = fakeWaitlistCascadeQueue.addBulk.mock.calls[0][0] as Array<{ name: string; data: { classId: string } }>;
    expect(seatFreedJobs).toHaveLength(1);
    expect(seatFreedJobs[0]).toMatchObject({ name: 'seat-freed', data: { classId: futureClass.id } });

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

/**
 * Spec 55 §6.1's confirmed Membership-purchase-collision handling
 * (resolveMembershipCollision, closing the TODO handlePaymentIntentSucceeded's own
 * comment used to leave open) — a SEPARATE describeIfDb block for the identical
 * reason the charge.dispute.* block above is separate: this path calls
 * StripeClientService.scopedClient().refunds.create()/subscriptions.cancel(), which
 * needs faking, unlike the main suite above (which never touches Stripe at all).
 */
describeIfDb('stripe-webhook-processing job — Membership-purchase-collision auto-refund', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: StripeWebhookProcessingProcessor;

  const eventIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const paymentAccountIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const transactionIds: string[] = [];

  const fakeRefundsCreate = jest.fn().mockResolvedValue({ id: 're_fixture' });
  const fakeSubscriptionsCancel = jest.fn().mockResolvedValue({});
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({ refunds: { create: fakeRefundsCreate }, subscriptions: { cancel: fakeSubscriptionsCancel } })),
    platformClient: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeWebhookProcessingProcessor,
        PrismaJobsService,
        { provide: StripeClientService, useValue: fakeStripeClient },
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        // Decision 122 — the processor also injects WAITLIST_CASCADE_PROCESSING_QUEUE
        // now (booking-cancellation-on-force-expiry's own waitlist notification) —
        // none of this block's own tests exercise that path (no Membership ever
        // force-Expires here), so a bare faked queue is enough, same reasoning the
        // other two describe blocks above already apply to their own unrelated queues.
        { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        // None of these pay a promotion fee (backlog 3.6 step 6).
        { provide: PromotionFeeService, useValue: { settlePaidCharges: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    processor = moduleRef.get(StripeWebhookProcessingProcessor);
  });

  afterEach(() => {
    fakeRefundsCreate.mockClear();
    fakeSubscriptionsCancel.mockClear();
    fakeStripeClient.scopedClient.mockClear();
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

  function fakeJob(data: { stripeEventId: string; eventType: string; objectId: string }) {
    return { data, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  /** Seeds a School + connected-account PaymentAccount + Student who ALREADY holds
   * an ACTIVE general-access Membership (classesRemaining null — the exact
   * Membership_one_active_general_access_per_school condition), plus a NEW PENDING
   * Transaction for the same Student/School that will collide with it the moment
   * payment_intent.succeeded tries to create a second one. */
  async function seedCollisionFixture(overrides: { withSubscription?: boolean } = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Collision Fixture School' } });
    schoolIds.push(school.id);
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
    });
    paymentAccountIds.push(paymentAccount.id);
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `collision-fixture-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Collision',
        surname: 'Fixture',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(student.id);
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Collision Fixture Plan', price: 1000 },
    });
    membershipPlanIds.push(plan.id);

    const existingMembership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, frequency: 'RECURRING', status: 'ACTIVE', classesRemaining: null },
    });
    membershipIds.push(existingMembership.id);

    const stripePaymentIntentId = `pi_collision_fixture_${randomUUID()}`;
    const stripeSubscriptionId = overrides.withSubscription ? `sub_collision_fixture_${randomUUID()}` : undefined;
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
        stripeSubscriptionId,
      },
    });
    transactionIds.push(transaction.id);
    return { school, student, paymentAccount, existingMembership, transaction, stripePaymentIntentId, stripeSubscriptionId };
  }

  it('a SUBSCRIPTION purchase that loses the race gets refunded AND its Subscription cancelled', async () => {
    const { transaction, paymentAccount, stripePaymentIntentId, stripeSubscriptionId } = await seedCollisionFixture({ withSubscription: true });
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));

    expect(fakeStripeClient.scopedClient).toHaveBeenCalledWith(paymentAccount.stripeConnectedAccountId);
    expect(fakeSubscriptionsCancel).toHaveBeenCalledWith(stripeSubscriptionId, undefined, expect.objectContaining({ idempotencyKey: expect.stringContaining(stripeEventId) }));
    expect(fakeRefundsCreate).toHaveBeenCalledWith({ payment_intent: stripePaymentIntentId }, expect.objectContaining({ idempotencyKey: expect.stringContaining(stripeEventId) }));

    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated.status).toBe('REFUNDED');
    expect(updated.refundedAmount).toBe(transaction.amount);
    expect(updated.membershipId).toBeNull();

    const membershipCount = await superuser.membership.count({ where: { studentId: transaction.studentId } });
    expect(membershipCount).toBe(1); // still only the pre-existing one — no second Membership created

    const dedupRow = await superuser.processedStripeEvent.findUnique({ where: { stripeEventId } });
    expect(dedupRow).not.toBeNull(); // the event IS considered fully handled — no onFailed alarm, no retry
  });

  it('a one-time purchase that loses the race gets refunded with no Subscription to cancel', async () => {
    const { transaction, stripePaymentIntentId } = await seedCollisionFixture({ withSubscription: false });
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));

    expect(fakeSubscriptionsCancel).not.toHaveBeenCalled();
    expect(fakeRefundsCreate).toHaveBeenCalledTimes(1);

    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated.status).toBe('REFUNDED');
    expect(updated.refundedAmount).toBe(transaction.amount);
  });

  it('a redelivered event (same id) is a safe no-op — refund/cancel are not called a second time', async () => {
    const { transaction, stripePaymentIntentId } = await seedCollisionFixture({ withSubscription: true });
    const stripeEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(stripeEventId);

    await processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));
    expect(fakeRefundsCreate).toHaveBeenCalledTimes(1);
    expect(fakeSubscriptionsCancel).toHaveBeenCalledTimes(1);

    // Same event id again — the outer ProcessedStripeEvent dedup (process()'s own
    // main $transaction) catches this before dispatch() is ever reached a second
    // time, exactly as it already does for every other event type in this file.
    await expect(
      processor.process(fakeJob({ stripeEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId })),
    ).resolves.not.toThrow();

    expect(fakeRefundsCreate).toHaveBeenCalledTimes(1);
    expect(fakeSubscriptionsCancel).toHaveBeenCalledTimes(1);
    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated.status).toBe('REFUNDED');
  });

  it("a DIFFERENT event id for an already-REFUNDED Transaction is a clean no-op (handlePaymentIntentSucceeded's own PENDING guard, not a second collision)", async () => {
    const { transaction, stripePaymentIntentId } = await seedCollisionFixture({ withSubscription: false });
    const firstEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(firstEventId);
    await processor.process(fakeJob({ stripeEventId: firstEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId }));
    expect(fakeRefundsCreate).toHaveBeenCalledTimes(1);

    // A second, genuinely different Stripe event for the SAME PaymentIntent —
    // Stripe's own documented rare duplicate-with-a-different-id case
    // (handlePaymentIntentSucceeded's own header comment already accounts for this
    // for the ordinary, non-collision path; this proves it holds post-collision too).
    const secondEventId = `evt_fixture_${randomUUID()}`;
    eventIds.push(secondEventId);
    await expect(
      processor.process(fakeJob({ stripeEventId: secondEventId, eventType: 'payment_intent.succeeded', objectId: stripePaymentIntentId })),
    ).resolves.not.toThrow();

    // No second attempt at either Stripe call — handlePaymentIntentSucceeded's own
    // `transaction.status !== 'PENDING'` check returns early before ever reaching
    // the collision again.
    expect(fakeRefundsCreate).toHaveBeenCalledTimes(1);
    const dedupRow = await superuser.processedStripeEvent.findUnique({ where: { stripeEventId: secondEventId } });
    expect(dedupRow).not.toBeNull();
    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated.status).toBe('REFUNDED');
  });
});

/**
 * Hosted Checkout (Decision 243, and paying charges by Checkout) on the API
 * version the installed SDK pins (2026-08-26.dahlia): a `mode: 'payment'`
 * Checkout Session has no PaymentIntent until the member pays, so the Pending
 * Transaction is written with none, and its id travels in the PaymentIntent's
 * metadata (PaymentsService.createPurchaseCheckoutSession). Unlike the blocks
 * above, these go in through the real webhook intake
 * (PaymentsService.handleIncomingWebhook, a signed event checked by Stripe's own
 * library), then the job it queued is handed to the processor, so the metadata
 * hand-over is covered too. The events are shaped like the real ones the
 * test-mode sandbox sent on 30 Oct 2026 for a PaymentIntent confirmed with
 * pm_card_visa and for an expired Session (trimmed to the fields that matter
 * plus a few neighbours, values as Stripe sends them).
 */
describeIfDb('stripe-webhook-processing job — hosted Checkout matched by its Transaction id (current Stripe API version)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: StripeWebhookProcessingProcessor;
  let payments: PaymentsService;
  const queued: Array<Record<string, unknown>> = [];

  const eventIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const paymentAccountIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const transactionIds: string[] = [];

  const fakeRefundsCreate = jest.fn().mockResolvedValue({ id: 're_fixture', object: 'refund', status: 'succeeded' });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_e2e_hosted_checkout';

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_e2e_hosted_checkout';
    const stripeClient = new StripeClientService();
    // No call reaches Stripe: only a lost race refunds, faked here.
    jest.spyOn(stripeClient, 'scopedClient').mockReturnValue({ refunds: { create: fakeRefundsCreate }, subscriptions: { cancel: jest.fn() } } as never);
    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeWebhookProcessingProcessor,
        PrismaJobsService,
        { provide: StripeClientService, useValue: stripeClient },
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: { add: jest.fn().mockResolvedValue(undefined), addBulk: jest.fn().mockResolvedValue(undefined) } },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: { addBulk: jest.fn().mockResolvedValue(undefined) } },
        { provide: PromotionFeeService, useValue: { settlePaidCharges: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    processor = moduleRef.get(StripeWebhookProcessingProcessor);
    const webhookQueue = { add: jest.fn(async (_name: string, data: Record<string, unknown>) => queued.push(data)) };
    payments = new PaymentsService(null as never, null as never, null as never, null as never, stripeClient, webhookQueue as never, null as never, null as never);
  });

  afterEach(() => {
    fakeRefundsCreate.mockClear();
    queued.length = 0;
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

  /** A School on its own connected account, a Student, and the Pending row a
   * hosted Checkout purchase writes now: no PaymentIntent id. */
  async function seedCheckoutOrder(opts: { planType?: 'CLASS_PACK' | 'WEEKLY_PASS'; surcharge?: number; alreadyHoldsPass?: boolean } = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Hosted Checkout Fixture School' } });
    schoolIds.push(school.id);
    const account = `acct_fixture_${randomUUID().slice(0, 12)}`;
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: account },
    });
    paymentAccountIds.push(paymentAccount.id);
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `hosted-checkout-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Hosted',
        surname: 'Checkout',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(student.id);
    const type = opts.planType ?? 'CLASS_PACK';
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type, title: 'Hosted Checkout Plan', price: 1500, classesIncluded: type === 'CLASS_PACK' ? 5 : null, expiryDurationDays: type === 'WEEKLY_PASS' ? 7 : null },
    });
    membershipPlanIds.push(plan.id);
    if (opts.alreadyHoldsPass) {
      const held = await superuser.membership.create({
        data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, frequency: 'ONE_TIME', status: 'ACTIVE', classesRemaining: null },
      });
      membershipIds.push(held.id);
    }
    const transaction = await superuser.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        studentId: student.id,
        paymentAccountId: paymentAccount.id,
        membershipPlanId: plan.id,
        amount: 1500,
        surchargeAmount: opts.surcharge ?? 0,
        currency: 'GBP',
        status: 'PENDING',
        paymentMethod: 'STRIPE',
      },
    });
    transactionIds.push(transaction.id);
    return { school, student, plan, transaction, account };
  }

  /** A payment_intent.* event as Stripe sends it for the PaymentIntent a paid
   * Checkout Session made, its metadata copied from payment_intent_data. */
  function paymentIntentEvent(type: string, account: string, paymentIntentId: string, metadata: Record<string, string>, amount = 1500) {
    const status = type === 'payment_intent.succeeded' ? 'succeeded' : type === 'payment_intent.canceled' ? 'canceled' : 'requires_payment_method';
    return {
      id: `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'event',
      account,
      api_version: '2026-08-26.dahlia',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          amount,
          amount_capturable: 0,
          amount_received: status === 'succeeded' ? amount : 0,
          capture_method: 'automatic_async',
          client_secret: `${paymentIntentId}_secret_fixture`,
          confirmation_method: 'automatic',
          currency: 'gbp',
          customer: null,
          description: null,
          last_payment_error: null,
          latest_charge: status === 'succeeded' ? `ch_${randomUUID().slice(0, 12)}` : null,
          livemode: false,
          metadata,
          payment_method: 'pm_fixture',
          payment_method_types: ['card'],
          status,
        },
      },
    };
  }

  /** checkout.session.expired as Stripe sends it for a Session nobody paid:
   * `payment_intent` null on this API version. */
  function sessionExpiredEvent(account: string, metadata: Record<string, string>) {
    const id = `cs_test_${randomUUID().replace(/-/g, '')}`;
    return {
      id: `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'event',
      account,
      api_version: '2026-08-26.dahlia',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: 'checkout.session.expired',
      data: {
        object: { id, object: 'checkout.session', amount_total: 1500, currency: 'gbp', metadata, mode: 'payment', payment_intent: null, payment_status: 'unpaid', setup_intent: null, status: 'expired', url: null },
      },
    };
  }

  /** Through the real intake (signature checked), then the queued job. */
  async function deliver(event: { id: string }) {
    eventIds.push(event.id);
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    await payments.handleIncomingWebhook(Buffer.from(payload), signature);
    const job = queued.pop();
    expect(job).toBeDefined();
    await processor.process({ data: job, attemptsMade: 1, opts: { attempts: 3 } } as never);
    return job!;
  }

  it('payment_intent.succeeded finds the Pending row by the Transaction id in its metadata, stores the PaymentIntent id and creates the Membership', async () => {
    const { transaction, account, student } = await seedCheckoutOrder();
    const pi = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    const job = await deliver(paymentIntentEvent('payment_intent.succeeded', account, pi, { transactionId: transaction.id }));

    expect(job).toMatchObject({ eventType: 'payment_intent.succeeded', objectId: pi, stripeAccountId: account, transactionId: transaction.id });
    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated).toMatchObject({ status: 'SUCCESSFUL', stripePaymentIntentId: pi });
    expect(updated.membershipId).not.toBeNull();
    membershipIds.push(updated.membershipId!);
    expect(await superuser.membership.count({ where: { studentId: student.id, status: 'ACTIVE' } })).toBe(1);

    // Stripe's redelivery, and a later event for the same PaymentIntent, now
    // find the row by the stored id: nothing changes.
    await deliver(paymentIntentEvent('payment_intent.succeeded', account, pi, { transactionId: transaction.id }));
    expect(await superuser.membership.count({ where: { studentId: student.id } })).toBe(1);
  });

  it('a declined card then a second card on the same Checkout: Failed, then Successful, on one PaymentIntent', async () => {
    const { transaction, account } = await seedCheckoutOrder();
    const pi = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    await deliver(paymentIntentEvent('payment_intent.payment_failed', account, pi, { transactionId: transaction.id }));
    expect(await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).toMatchObject({ status: 'FAILED', stripePaymentIntentId: pi });

    await deliver(paymentIntentEvent('payment_intent.succeeded', account, pi, { transactionId: transaction.id }));
    const updated = await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(updated).toMatchObject({ status: 'SUCCESSFUL', stripePaymentIntentId: pi });
    membershipIds.push(updated.membershipId!);
  });

  it('metadata naming a row on another School\'s connected account, or a row already paid by another PaymentIntent, is not matched', async () => {
    const mine = await seedCheckoutOrder();
    const other = await seedCheckoutOrder();
    const pi = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    // An event from my account naming the other School's row.
    await deliver(paymentIntentEvent('payment_intent.succeeded', mine.account, pi, { transactionId: other.transaction.id }));
    expect(await superuser.transaction.findUniqueOrThrow({ where: { id: other.transaction.id } })).toMatchObject({ status: 'PENDING', stripePaymentIntentId: null });

    // My row, already linked to its own PaymentIntent: another one naming it is ignored.
    const first = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await deliver(paymentIntentEvent('payment_intent.payment_failed', mine.account, first, { transactionId: mine.transaction.id }));
    await deliver(paymentIntentEvent('payment_intent.succeeded', mine.account, `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`, { transactionId: mine.transaction.id }));
    expect(await superuser.transaction.findUniqueOrThrow({ where: { id: mine.transaction.id } })).toMatchObject({ status: 'FAILED', stripePaymentIntentId: first, membershipId: null });
  });

  it('checkout.session.expired turns an unpaid Checkout\'s Pending row Failed (Decision 339 item 11); a paid one is left alone', async () => {
    const abandoned = await seedCheckoutOrder();
    const job = await deliver(sessionExpiredEvent(abandoned.account, { transactionId: abandoned.transaction.id }));
    expect(job).toMatchObject({ eventType: 'checkout.session.expired', transactionId: abandoned.transaction.id, stripeAccountId: abandoned.account });
    expect(await superuser.transaction.findUniqueOrThrow({ where: { id: abandoned.transaction.id } })).toMatchObject({ status: 'FAILED', membershipId: null });

    const paid = await seedCheckoutOrder();
    const pi = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await deliver(paymentIntentEvent('payment_intent.succeeded', paid.account, pi, { transactionId: paid.transaction.id }));
    await deliver(sessionExpiredEvent(paid.account, { transactionId: paid.transaction.id }));
    const after = await superuser.transaction.findUniqueOrThrow({ where: { id: paid.transaction.id } });
    expect(after.status).toBe('SUCCESSFUL');
    membershipIds.push(after.membershipId!);

    // From another School's account: not matched.
    const elsewhere = await seedCheckoutOrder();
    await deliver(sessionExpiredEvent(abandoned.account, { transactionId: elsewhere.transaction.id }));
    expect((await superuser.transaction.findUniqueOrThrow({ where: { id: elsewhere.transaction.id } })).status).toBe('PENDING');
  });

  it('a hosted Checkout purchase that loses the one-pass race is refunded in full and recorded as such: price and surcharge, with its PaymentIntent id', async () => {
    const { transaction, account, student } = await seedCheckoutOrder({ planType: 'WEEKLY_PASS', surcharge: 30, alreadyHoldsPass: true });
    const pi = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    const job = await deliver(paymentIntentEvent('payment_intent.succeeded', account, pi, { transactionId: transaction.id, surchargeAmount: '30' }, 1530));

    expect(fakeRefundsCreate).toHaveBeenCalledWith({ payment_intent: pi }, expect.objectContaining({ idempotencyKey: expect.stringContaining(job.stripeEventId as string) }));
    expect(await superuser.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).toMatchObject({
      status: 'REFUNDED',
      refundedAmount: 1530,
      stripePaymentIntentId: pi,
      membershipId: null,
    });
    expect(await superuser.membership.count({ where: { studentId: student.id } })).toBe(1);
  });
});
