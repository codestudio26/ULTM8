/**
 * Decision 451 item 1 (stress test round 7, D-1): refunding a fee in full in
 * the Stripe dashboard, or losing a dispute on one, only changes that fee's
 * own row. The member's plan stays Active and its future bookings are kept,
 * even when the fee's row carries the plan's id (a freeze fee does). The
 * plan's own purchase and renewal still end it, as Decisions 55 and 382 say.
 * Real Postgres; Stripe faked (charges.retrieve, disputes.retrieve,
 * subscriptions.cancel return what each test sets).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET, REDIS_URL.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, TransactionKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Job } from 'bullmq';
import { AppModule } from '../src/app.module';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

const FEE_KINDS: TransactionKind[] = ['FREEZE_FEE', 'LATE_CANCEL_FEE', 'NO_SHOW_FEE'];
const PLAN_KINDS: TransactionKind[] = ['MEMBERSHIP', 'RENEWAL'];

describeIfDb('Decision 451 item 1: a fee refund or lost dispute never touches the plan', () => {
  let app: INestApplication;
  let processor: StripeWebhookProcessingProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const schoolIds: string[] = [];
  const eventIds: string[] = [];
  const TAG = 'd451-fee-refunds-';

  const charges = new Map<string, object>();
  const disputes = new Map<string, object>();
  const subscriptionsCancel = jest.fn(async (id: string) => ({ id, status: 'canceled' }));
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      charges: { retrieve: jest.fn(async (id: string) => charges.get(id)) },
      disputes: { retrieve: jest.fn(async (id: string) => disputes.get(id)) },
      subscriptions: { cancel: subscriptionsCancel },
    })),
    platformClient: jest.fn(),
  };

  const mkUser = (label: string) =>
    su.user.create({
      data: {
        id: randomUUID(),
        email: `${TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tester',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });

  /** A member on an Active monthly plan (a Stripe Subscription) with one
   * future booking it pays for, and a card payment of `kind` that carries the
   * plan's id: its purchase, a renewal, or a fee. A late-cancel or no-show fee
   * is tied to its own (past) booking, as the API writes it. */
  async function seed(kind: TransactionKind) {
    const school = await su.school.create({ data: { id: randomUUID(), name: `D451 ${randomUUID().slice(0, 6)}` } });
    schoolIds.push(school.id);
    const owner = await mkUser('owner');
    const student = await mkUser('student');
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
      ],
    });
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeAccountReady: true, stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
    });
    const plan = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 4000, currency: 'GBP' },
    });
    const stripeSubscriptionId = `sub_${randomUUID()}`;
    const membership = await su.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', stripeSubscriptionId },
    });
    const futureClass = await su.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Future class', startDate: new Date(Date.now() + 20 * 86_400_000), endDate: new Date(Date.now() + 20 * 86_400_000 + 3_600_000) },
    });
    const futureBooking = await su.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: futureClass.id, schoolId: school.id, sourceMembershipId: membership.id, status: 'UPCOMING' },
    });
    let feeBookingId: string | undefined;
    if (kind === 'LATE_CANCEL_FEE' || kind === 'NO_SHOW_FEE') {
      const pastClass = await su.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Past class', startDate: new Date(Date.now() - 2 * 86_400_000), endDate: new Date(Date.now() - 2 * 86_400_000 + 3_600_000) },
      });
      const feeBooking = await su.booking.create({
        data: { id: randomUUID(), studentId: student.id, classId: pastClass.id, schoolId: school.id, sourceMembershipId: membership.id, status: kind === 'NO_SHOW_FEE' ? 'NO_SHOW' : 'CANCELLED' },
      });
      feeBookingId = feeBooking.id;
    }
    const isPlan = PLAN_KINDS.includes(kind);
    const amount = isPlan ? 4000 : 700;
    const pi = `pi_${randomUUID()}`;
    const transaction = await su.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        studentId: student.id,
        paymentAccountId: account.id,
        membershipPlanId: isPlan ? plan.id : undefined,
        membershipId: membership.id,
        bookingId: feeBookingId,
        kind,
        amount,
        currency: 'GBP',
        status: 'SUCCESSFUL',
        paymentMethod: 'STRIPE',
        stripePaymentIntentId: pi,
      },
    });
    return { account, membership, futureBooking, transaction, pi, amount, stripeSubscriptionId };
  }
  type Seeded = Awaited<ReturnType<typeof seed>>;

  async function webhook(s: Seeded, eventType: string, objectId: string) {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await processor.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: s.account.stripeConnectedAccountId } } as unknown as Job);
  }

  async function refundInFull(s: Seeded) {
    const id = `ch_${s.pi}`;
    charges.set(id, { id, object: 'charge', amount: s.amount, amount_refunded: s.amount, currency: 'gbp', payment_intent: s.pi });
    await webhook(s, 'charge.refunded', id);
  }

  async function loseDispute(s: Seeded) {
    const id = `dp_${randomUUID()}`;
    disputes.set(id, { id, object: 'dispute', payment_intent: s.pi, status: 'lost', amount: s.amount, currency: 'gbp' });
    await webhook(s, 'charge.dispute.closed', id);
  }

  const state = async (s: Seeded) => ({
    row: await su.transaction.findUniqueOrThrow({ where: { id: s.transaction.id } }),
    membership: (await su.membership.findUniqueOrThrow({ where: { id: s.membership.id } })).status,
    booking: (await su.booking.findUniqueOrThrow({ where: { id: s.futureBooking.id } })).status,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    processor = app.get(StripeWebhookProcessingProcessor);
  });

  beforeEach(() => subscriptionsCancel.mockClear());

  afterAll(async () => {
    await app.close();
    const where = { schoolId: { in: schoolIds } };
    await su.transaction.deleteMany({ where });
    await su.booking.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.roleGrant.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.notification.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
    await su.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
  });

  it.each(FEE_KINDS)('a %s refunded in full in Stripe is Refunded; the plan stays Active and its bookings are kept', async (kind) => {
    const s = await seed(kind);
    await refundInFull(s);
    const after = await state(s);
    expect(after.row).toMatchObject({ status: 'REFUNDED', refundedAmount: s.amount });
    expect(after.membership).toBe('ACTIVE');
    expect(after.booking).toBe('UPCOMING');
    expect(subscriptionsCancel).not.toHaveBeenCalled();
  });

  it.each(FEE_KINDS)('a dispute lost on a %s marks only the fee lost; the plan stays Active and its bookings are kept', async (kind) => {
    const s = await seed(kind);
    await loseDispute(s);
    const after = await state(s);
    expect(after.row).toMatchObject({ status: 'DISPUTED', disputedAmount: s.amount });
    expect(after.row.disputeLostAt).not.toBeNull();
    expect(after.membership).toBe('ACTIVE');
    expect(after.booking).toBe('UPCOMING');
    expect(subscriptionsCancel).not.toHaveBeenCalled();
  });

  it.each(PLAN_KINDS)('unchanged: a %s payment refunded in full ends the plan (Decision 382)', async (kind) => {
    const s = await seed(kind);
    await refundInFull(s);
    const after = await state(s);
    expect(after.row).toMatchObject({ status: 'REFUNDED', refundedAmount: s.amount });
    expect(after.membership).toBe('EXPIRED');
    expect(after.booking).toBe('CANCELLED');
    expect(subscriptionsCancel).toHaveBeenCalledWith(s.stripeSubscriptionId);
  });

  it.each(PLAN_KINDS)('unchanged: a dispute lost on a %s payment ends the plan (Decision 55)', async (kind) => {
    const s = await seed(kind);
    await loseDispute(s);
    const after = await state(s);
    expect(after.row).toMatchObject({ status: 'DISPUTED', disputedAmount: s.amount });
    expect(after.membership).toBe('EXPIRED');
    expect(after.booking).toBe('CANCELLED');
    expect(subscriptionsCancel).toHaveBeenCalledWith(s.stripeSubscriptionId);
  });
});
