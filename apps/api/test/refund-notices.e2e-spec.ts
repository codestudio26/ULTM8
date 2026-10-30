import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PaymentsService } from '../src/payments/payments.service';
import { StepUpService } from '../src/auth/step-up.service';
import { MembershipsService } from '../src/memberships/memberships.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';

/**
 * Decision 415 item 4: every refund sends the member the "Refund" notice
 * (Decision 414 item 4), under the School's refund-notice switch
 * (School.chargeNoticeRefund), once per refund, after it commits, with a
 * Guardian's usual copy. Refunds of payments toward charges are covered by
 * charges-refunds-reports.e2e-spec.ts; this covers the rest, over real HTTP
 * against a real Postgres with the real webhook processor and notification
 * worker (Stripe faked):
 * - a Class Pack's share when a booking is cancelled: refunded to the card
 *   (Auto-refund, or the Owner's "Refund"), or a cash share marked paid out;
 * - a membership payment refunded in the Stripe dashboard (charge.refunded);
 * - a refused membership purchase refunded in full: by the webhook
 *   (resolveMembershipCollision) and by a saved-card purchase.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[refund-notices.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const TAG = 'refund-notices-';

describeIfDb('The "Refund" notice for every refund (Decision 415 item 4)', () => {
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const eventIds: string[] = [];

  /** Stripe's Charges by id, for charge.refunded. */
  const charges = new Map<string, object>();
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      charges: { retrieve: jest.fn(async (id: string) => charges.get(id)) },
      refunds: { create: jest.fn(async () => ({ id: `re_${randomUUID()}` })) },
      subscriptions: { cancel: jest.fn(async (id: string) => ({ id, status: 'canceled' })) },
    })),
    platformClient: jest.fn(),
  };

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `${TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Refunds',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }
  const sign = (user: { id: string; email: string }, role: string, schoolId: string) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });

  /** A School with a connected Stripe account, its Owner, a Student and a
   * 5-class pack (30.00 GBP). */
  async function seedSchool(label: string) {
    const school = await su.school.create({ data: { id: randomUUID(), name: `Refund notices ${label}`, defaultCurrency: 'GBP' } });
    schoolIds.push(school.id);
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
    });
    const owner = await mkUser(`${label}Owner`);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    const pack = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5, currency: 'GBP' },
    });
    return { school, account, owner, ownerToken: sign(owner, 'SCHOOL_OWNER_MANAGER', school.id), pack };
  }
  type Seeded = Awaited<ReturnType<typeof seedSchool>>;

  async function mkStudent(s: Seeded, label: string) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: s.school.id } });
    return { ...user, token: sign(user, 'STUDENT', s.school.id) };
  }

  /** A paid 5-class pack: its Membership and its purchase Transaction. */
  async function mkPack(s: Seeded, studentId: string, method: 'CASH' | 'STRIPE') {
    const membership = await su.membership.create({
      data: { id: randomUUID(), studentId, membershipPlanId: s.pack.id, schoolId: s.school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 5 },
    });
    const transaction = await su.transaction.create({
      data: {
        id: randomUUID(), schoolId: s.school.id, studentId, paymentAccountId: s.account.id, membershipPlanId: s.pack.id, membershipId: membership.id,
        amount: 3000, currency: 'GBP', status: 'SUCCESSFUL', paymentMethod: method, stripePaymentIntentId: method === 'STRIPE' ? `pi_${randomUUID()}` : null,
      },
    });
    return { membership, transaction };
  }

  async function bookAndCancel(s: Seeded, token: string) {
    const start = new Date(Date.now() + 24 * 3_600_000);
    const cls = await su.class.create({
      data: { id: randomUUID(), schoolId: s.school.id, title: `Class ${randomUUID().slice(0, 6)}`, startDate: start, endDate: new Date(start.getTime() + 3_600_000), membershipInclusion: true },
    });
    const booked = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${token}`).send({});
    expect(booked.status).toBe(201);
    const cancelled = await request(app.getHttpServer()).patch(`/v1/bookings/${booked.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({});
    expect(cancelled.status).toBe(200);
    return cancelled.body as { id: string; refundResolution: string; refundAmount: number };
  }
  const resolve = (s: Seeded, bookingId: string, action: string) =>
    request(app.getHttpServer()).patch(`/v1/bookings/${bookingId}/resolution`).set('Authorization', `Bearer ${s.ownerToken}`).send({ action });

  async function event(s: Seeded, eventType: string, objectId: string, stripeEventId = `evt_${randomUUID()}`) {
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: s.account.stripeConnectedAccountId }, attemptsMade: 1, opts: { attempts: 3 } } as never);
    return stripeEventId;
  }

  async function refundNotices(userId: string, expected: number) {
    for (let i = 0; i < 60; i++) {
      const rows = await su.notification.findMany({ where: { userId, title: 'Refund' }, orderBy: { createdAt: 'asc' } });
      if (rows.length >= expected) return rows.map((n) => n.body);
      await new Promise((r) => setTimeout(r, 100));
    }
    return (await su.notification.findMany({ where: { userId, title: 'Refund' }, orderBy: { createdAt: 'asc' } })).map((n) => n.body);
  }
  /** Lets the notification worker catch up before checking that nothing came. */
  const settle = () => new Promise((r) => setTimeout(r, 1500));
  const countRefundNotices = (userId: string) => su.notification.count({ where: { userId, title: 'Refund' } });
  const setSwitch = (s: Seeded, on: boolean) => su.school.update({ where: { id: s.school.id }, data: { chargeNoticeRefund: on } });

  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    webhook = app.get(StripeWebhookProcessingProcessor);
    // Stripe itself is not reached: a Class Pack share's refund is faked here.
    jest.spyOn(app.get(PaymentsService), 'refundPayment').mockImplementation(async () => `re_${randomUUID()}`);
    a = await seedSchool('A');
    b = await seedSchool('B');
    await su.school.updateMany({ where: { id: { in: [a.school.id, b.school.id] } }, data: { classCancellationPolicy: 'AUTO_REFUND' } });
  });

  afterEach(async () => {
    await su.school.updateMany({ where: { id: { in: schoolIds } }, data: { chargeNoticeRefund: true, classCancellationPolicy: 'AUTO_REFUND' } });
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.guardianLink.deleteMany({ where: { studentId: { in: userIds } } });
    await su.bookingAttendee.deleteMany({ where });
    await su.booking.deleteMany({ where });
    await su.waitlistEntry.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('a Class Pack share when a booking is cancelled', () => {
    it('refunded to the card by Auto-refund: told once, and a Guardian gets the usual copy', async () => {
      const student = await mkStudent(a, 'packCard');
      const guardian = await mkUser('packGuardian');
      await su.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: student.id } });
      await mkPack(a, student.id, 'STRIPE');
      const cancelled = await bookAndCancel(a, student.token);
      expect(cancelled).toMatchObject({ refundResolution: 'MONEY_REFUNDED', refundAmount: 600 });
      expect(await refundNotices(student.id, 1)).toEqual(['6.00 GBP was refunded to your card.']);
      expect(await refundNotices(guardian.id, 1)).toEqual(['For packCard: 6.00 GBP was refunded to your card.']);
      // Nothing left to resolve: not refunded, nor told, twice.
      expect((await resolve(a, cancelled.id, 'REFUND')).status).toBe(409);
      await settle();
      expect(await countRefundNotices(student.id)).toBe(1);
    });

    it("refunded to the card by the Owner's decision on a waiting seat", async () => {
      await su.school.update({ where: { id: a.school.id }, data: { classCancellationPolicy: 'MANUAL' } });
      const student = await mkStudent(a, 'packOwner');
      await mkPack(a, student.id, 'STRIPE');
      const cancelled = await bookAndCancel(a, student.token);
      expect(cancelled.refundResolution).toBe('PENDING');
      await settle();
      expect(await countRefundNotices(student.id)).toBe(0);
      expect((await resolve(a, cancelled.id, 'REFUND')).status).toBe(200);
      expect(await refundNotices(student.id, 1)).toEqual(['6.00 GBP was refunded to your card.']);
    });

    it('a cash share marked paid out: the money was given back', async () => {
      const student = await mkStudent(a, 'packCash');
      await mkPack(a, student.id, 'CASH');
      const cancelled = await bookAndCancel(a, student.token);
      expect(cancelled.refundResolution).toBe('REFUND_OWED');
      await settle();
      expect(await countRefundNotices(student.id)).toBe(0);
      expect((await resolve(a, cancelled.id, 'MARK_PAID')).status).toBe(200);
      expect(await refundNotices(student.id, 1)).toEqual(['6.00 GBP was given back to you.']);
    });

    it("switched off: no notice for either; another School's members are still told", async () => {
      await setSwitch(a, false);
      const card = await mkStudent(a, 'packQuietCard');
      await mkPack(a, card.id, 'STRIPE');
      expect((await bookAndCancel(a, card.token)).refundResolution).toBe('MONEY_REFUNDED');
      const cash = await mkStudent(a, 'packQuietCash');
      await mkPack(a, cash.id, 'CASH');
      const owed = await bookAndCancel(a, cash.token);
      expect((await resolve(a, owed.id, 'MARK_PAID')).status).toBe(200);

      const elsewhere = await mkStudent(b, 'packElsewhere');
      await mkPack(b, elsewhere.id, 'STRIPE');
      expect((await bookAndCancel(b, elsewhere.token)).refundResolution).toBe('MONEY_REFUNDED');
      expect(await refundNotices(elsewhere.id, 1)).toEqual(['6.00 GBP was refunded to your card.']);
      await settle();
      expect(await countRefundNotices(card.id)).toBe(0);
      expect(await countRefundNotices(cash.id)).toBe(0);
    });
  });

  describe('a membership payment refunded in the Stripe dashboard', () => {
    it('tells the member what is new, once per amount; a redelivery or a repeat of the same total tells nothing', async () => {
      const student = await mkStudent(a, 'dash');
      const { transaction } = await mkPack(a, student.id, 'STRIPE');
      const chargeId = `ch_${randomUUID()}`;
      charges.set(chargeId, { id: chargeId, object: 'charge', amount: 3000, amount_refunded: 1000, payment_intent: transaction.stripePaymentIntentId });
      const first = await event(a, 'charge.refunded', chargeId);
      await event(a, 'charge.refunded', chargeId, first); // the same event delivered again
      await event(a, 'charge.refunded', chargeId); // another event, same total
      expect(await refundNotices(student.id, 1)).toEqual(['10.00 GBP was refunded to your card.']);
      await settle();
      expect(await countRefundNotices(student.id)).toBe(1);

      charges.set(chargeId, { id: chargeId, object: 'charge', amount: 3000, amount_refunded: 3000, payment_intent: transaction.stripePaymentIntentId });
      await event(a, 'charge.refunded', chargeId);
      expect(await refundNotices(student.id, 2)).toEqual(['10.00 GBP was refunded to your card.', '20.00 GBP was refunded to your card.']);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).toMatchObject({ status: 'REFUNDED', refundedAmount: 3000 });
    });

    it("a Class Pack share ULTM8 refunded itself is not told twice when Stripe's charge.refunded follows", async () => {
      const student = await mkStudent(a, 'dashOwn');
      const { transaction } = await mkPack(a, student.id, 'STRIPE');
      expect((await bookAndCancel(a, student.token)).refundResolution).toBe('MONEY_REFUNDED');
      expect(await refundNotices(student.id, 1)).toHaveLength(1);
      const chargeId = `ch_${randomUUID()}`;
      charges.set(chargeId, { id: chargeId, object: 'charge', amount: 3000, amount_refunded: 600, payment_intent: transaction.stripePaymentIntentId });
      await event(a, 'charge.refunded', chargeId);
      await settle();
      expect(await countRefundNotices(student.id)).toBe(1);
    });

    it("switched off, none; another School's member is still told", async () => {
      await setSwitch(a, false);
      const quiet = await mkStudent(a, 'dashQuiet');
      const q = await mkPack(a, quiet.id, 'STRIPE');
      const qCharge = `ch_${randomUUID()}`;
      charges.set(qCharge, { id: qCharge, object: 'charge', amount: 3000, amount_refunded: 3000, payment_intent: q.transaction.stripePaymentIntentId });
      await event(a, 'charge.refunded', qCharge);
      expect((await su.transaction.findUniqueOrThrow({ where: { id: q.transaction.id } })).status).toBe('REFUNDED');

      const elsewhere = await mkStudent(b, 'dashElsewhere');
      const e = await mkPack(b, elsewhere.id, 'STRIPE');
      const eCharge = `ch_${randomUUID()}`;
      charges.set(eCharge, { id: eCharge, object: 'charge', amount: 3000, amount_refunded: 3000, payment_intent: e.transaction.stripePaymentIntentId });
      await event(b, 'charge.refunded', eCharge);
      expect(await refundNotices(elsewhere.id, 1)).toEqual(['30.00 GBP was refunded to your card.']);
      await settle();
      expect(await countRefundNotices(quiet.id)).toBe(0);
    });
  });

  describe('a refused membership purchase, refunded in full', () => {
    /** A student who already holds an active general-access membership, and a
     * second purchase of it waiting for its payment (30.00 GBP + 0.90 surcharge). */
    async function collision(s: Seeded, label: string) {
      const student = await mkStudent(s, label);
      const plan = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 3000, currency: 'GBP' } });
      await su.membership.create({ data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: s.school.id, frequency: 'RECURRING', status: 'ACTIVE', classesRemaining: null } });
      const pi = `pi_${randomUUID()}`;
      const transaction = await su.transaction.create({
        data: {
          id: randomUUID(), schoolId: s.school.id, studentId: student.id, paymentAccountId: s.account.id, membershipPlanId: plan.id,
          amount: 3000, surchargeAmount: 90, currency: 'GBP', status: 'PENDING', paymentMethod: 'STRIPE', stripePaymentIntentId: pi,
        },
      });
      return { student, transaction, pi };
    }

    it('by the webhook: the member is told why, once', async () => {
      const c = await collision(a, 'refused');
      const evt = await event(a, 'payment_intent.succeeded', c.pi);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: c.transaction.id } })).toMatchObject({ status: 'REFUNDED', refundedAmount: 3000 });
      await event(a, 'payment_intent.succeeded', c.pi, evt); // redelivered
      await event(a, 'payment_intent.succeeded', c.pi); // a duplicate event
      // Stripe's own charge.refunded for that refund adds nothing.
      const chargeId = `ch_${randomUUID()}`;
      charges.set(chargeId, { id: chargeId, object: 'charge', amount: 3090, amount_refunded: 3090, payment_intent: c.pi });
      await event(a, 'charge.refunded', chargeId);
      expect(await refundNotices(c.student.id, 1)).toEqual(["30.90 GBP was refunded to your card: Unlimited couldn't be bought."]);
      await settle();
      expect(await countRefundNotices(c.student.id)).toBe(1);
    });

    it("by the webhook, switched off: none; another School's member is still told", async () => {
      await setSwitch(a, false);
      const quiet = await collision(a, 'refusedQuiet');
      await event(a, 'payment_intent.succeeded', quiet.pi);
      expect((await su.transaction.findUniqueOrThrow({ where: { id: quiet.transaction.id } })).status).toBe('REFUNDED');
      const elsewhere = await collision(b, 'refusedElsewhere');
      await event(b, 'payment_intent.succeeded', elsewhere.pi);
      expect(await refundNotices(elsewhere.student.id, 1)).toEqual(["30.90 GBP was refunded to your card: Unlimited couldn't be bought."]);
      await settle();
      expect(await countRefundNotices(quiet.student.id)).toBe(0);
    });

    describe('paying with the saved card', () => {
      let memberships: MembershipsService;
      const spies: jest.SpyInstance[] = [];
      beforeAll(() => {
        memberships = app.get(MembershipsService);
        const payments = app.get(PaymentsService);
        spies.push(
          jest.spyOn(app.get(StepUpService), 'assertVerified').mockImplementation(() => undefined),
          jest.spyOn(payments, 'chargeOffSession').mockImplementation(async () => ({ succeeded: true, paymentIntentId: `pi_${randomUUID()}` }) as never),
          jest.spyOn(payments, 'refundOffSessionCharge').mockResolvedValue(undefined),
          // The race this path guards against: another membership created
          // between the checks and this one.
          jest.spyOn(memberships as never as { createMembershipAndReturn: () => Promise<unknown> }, 'createMembershipAndReturn').mockRejectedValue(new ConflictException('Already has one.')),
        );
      });
      afterAll(() => spies.forEach((s) => s.mockRestore()));

      it('the member is told the card was refunded and why; switched off, nothing', async () => {
        const student = await mkStudent(a, 'savedCard');
        await expect(memberships.purchase(student.id, a.pack.id, { payWithSavedCard: true } as never, 'step-up')).rejects.toBeInstanceOf(ConflictException);
        const row = await su.transaction.findFirstOrThrow({ where: { studentId: student.id } });
        expect(row).toMatchObject({ status: 'REFUNDED', refundedAmount: 3000 });
        expect(await refundNotices(student.id, 1)).toEqual(["30.00 GBP was refunded to your card: 5-Class Pack couldn't be bought."]);

        await setSwitch(a, false);
        const quiet = await mkStudent(a, 'savedCardQuiet');
        await expect(memberships.purchase(quiet.id, a.pack.id, { payWithSavedCard: true } as never, 'step-up')).rejects.toBeInstanceOf(ConflictException);
        await settle();
        expect(await countRefundNotices(quiet.id)).toBe(0);
      });
    });
  });
});
