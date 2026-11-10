import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { StepUpService } from '../src/auth/step-up.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { PrismaAppService } from '../src/common/prisma/prisma-app.service';
import { MembershipsService } from '../src/memberships/memberships.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { ChargeAutoPayProcessor } from '../src/jobs/charge-auto-pay.processor';
import { BookingNoShowProcessingProcessor } from '../src/jobs/booking-no-show-processing.processor';
import { PlanSwitchProcessor } from '../src/jobs/plan-switch.processor';

/**
 * Decision 448 items 1, 3, 5, 18 and 19 (stress test round 6, the owner's
 * answers on money), over a real Postgres with Stripe faked:
 *
 * - item 1: the card surcharge is its own line in revenue, on the billing
 *   overview and the Transactions page alike; the price figures leave it out.
 * - item 3: a plan switch never charges more than its 7-day notice quoted.
 * - item 5: Pix only at a School in Brazil: the API refuses it elsewhere.
 * - item 18: no-show fees are rows on the Transactions page, written with the
 *   Booking's outcome by whoever saves it (the job, Stripe's webhook, the sweep).
 * - item 19: a saved-card purchase settled late sends "Payment confirmed", once
 *   (Decision 450 item 8: type CARD_PAYMENT_CONFIRMED, with its own School switch).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.REDIS_URL);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[decision-448-money.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / REDIS_URL not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** A country on no other test's surcharge allow-list, outside Brazil. */
const COUNTRY = 'CR';

type MadeIntent = { id: string; status: string; customer?: string; created: number; metadata: Record<string, string>; idempotencyKey?: string; amount: number };

describeIfDb('Decision 448: money (surcharge revenue, plan-switch quote, Pix in Brazil, no-show fees, late "Payment confirmed")', () => {
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  let autoPay: ChargeAutoPayProcessor;
  let noShows: BookingNoShowProcessingProcessor;
  let switcher: PlanSwitchProcessor;
  let memberships: MembershipsService;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  const eventIds: string[] = [];
  const schools: Array<{ id: string; acct: string; token: string; accountId: string }> = [];

  // The fake Stripe. A key used again gets the same PaymentIntent, as on Stripe.
  const madeIntents: MadeIntent[] = [];
  const stripeCharges = new Map<string, { id: string; payment_intent: string; amount_refunded: number; currency: string }>();
  let stripeUnreachable = false;
  let crashAfterStripe = false;
  let crashNextWrite = false;
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      paymentIntents: {
        create: jest.fn(async (params: { amount: number; customer?: string; metadata?: Record<string, string> }, opts?: { idempotencyKey?: string }) => {
          if (stripeUnreachable) throw new Error('connect ETIMEDOUT');
          const again = opts?.idempotencyKey ? madeIntents.find((i) => i.idempotencyKey === opts.idempotencyKey) : undefined;
          const made: MadeIntent = again ?? {
            id: `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
            status: 'succeeded',
            customer: params.customer,
            created: Math.floor(Date.now() / 1000),
            metadata: params.metadata ?? {},
            idempotencyKey: opts?.idempotencyKey,
            amount: params.amount,
          };
          if (!again) madeIntents.push(made);
          if (crashAfterStripe) {
            crashAfterStripe = false;
            crashNextWrite = true;
          }
          return { id: made.id, status: made.status };
        }),
        retrieve: jest.fn(async (id: string) => madeIntents.find((i) => i.id === id)),
        list: jest.fn(async (params: { customer: string; created: { gte: number } }) => ({
          data: madeIntents.filter((i) => i.customer === params.customer && i.created >= params.created.gte).reverse(),
          has_more: false,
        })),
      },
      charges: { retrieve: jest.fn(async (id: string) => stripeCharges.get(id)) },
      customers: { retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })) },
      refunds: { create: jest.fn(async () => ({ id: `re_${randomUUID()}` })) },
    })),
    platformClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };

  /** The crash: the next write on this client after Stripe answered throws. */
  function crashOn<T extends object>(client: T, method: keyof T) {
    const real = (client[method] as unknown as (...a: unknown[]) => unknown).bind(client);
    jest.spyOn(client, method as never).mockImplementation(((...args: unknown[]) => {
      if (crashNextWrite) {
        crashNextWrite = false;
        return Promise.reject(new Error('worker killed (simulated)'));
      }
      return real(...args);
    }) as never);
  }

  const http = () => request(app.getHttpServer());
  const sign = (user: { id: string; email: string }, role: string, schoolId: string) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `d448-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Money',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }
  async function mkSchool(label: string, data: Record<string, unknown> = {}) {
    const acct = `acct_${randomUUID().slice(0, 8)}`;
    const school = await su.school.create({
      data: { id: randomUUID(), name: `D448 ${label}`, defaultCurrency: 'USD', addressCountry: COUNTRY, timezone: 'UTC', ...data } as never,
    });
    const accountId = (
      await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeAccountReady: true, stripeConnectedAccountId: acct } })
    ).id;
    const owner = await mkUser(`${label}-owner`);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    const s = { id: school.id, acct, accountId, token: sign(owner, 'SCHOOL_OWNER_MANAGER', school.id) };
    schools.push(s);
    return s;
  }
  type S = Awaited<ReturnType<typeof mkSchool>>;
  async function mkStudent(s: S, label: string, savedCard = true) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: s.id } });
    if (savedCard) await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: user.id, schoolId: s.id, stripeCustomerId: `cus_${randomUUID().slice(0, 12)}` } });
    return user;
  }
  const mkPlan = (s: S, data: Record<string, unknown>) =>
    su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.id, title: `Plan ${randomUUID().slice(0, 6)}`, currency: 'USD', price: 3000, type: 'CLASS_PACK', classesIncluded: 5, ...data } as never });

  async function event(s: S, eventType: string, objectId: string, metadata: Record<string, string> = {}) {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: s.acct, ...metadata }, attemptsMade: 1, opts: { attempts: 3 } } as never);
  }
  /** A refund made in the Stripe dashboard, `refunded` in all so far. */
  async function dashboardRefund(s: S, paymentIntentId: string, refunded: number) {
    const id = `ch_${paymentIntentId}`;
    stripeCharges.set(id, { id, payment_intent: paymentIntentId, amount_refunded: refunded, currency: 'usd' });
    await event(s, 'charge.refunded', id);
  }
  const madeFor = (key: string, value: string) => madeIntents.filter((i) => i.metadata[key] === value);
  async function notices(userId: string, title: string, atLeast = 1) {
    let rows: Array<{ body: string }> = [];
    for (let i = 0; i < 50 && rows.length < atLeast; i++) {
      rows = await su.notification.findMany({ where: { userId, title }, select: { body: true } });
      if (rows.length < atLeast) await new Promise((r) => setTimeout(r, 100));
    }
    return rows;
  }
  /** Nothing more arrives (the fanout runs in the background). */
  async function settledNotices(userId: string, title: string) {
    await new Promise((r) => setTimeout(r, 1500));
    return su.notification.findMany({ where: { userId, title }, select: { id: true, body: true } });
  }
  const later = () => new Date(Date.now() + 2 * HOUR);
  const get = (s: S, path: string) => http().get(`/v1/schools/${s.id}${path}`).set('Authorization', `Bearer ${s.token}`);
  const post = (s: S, path: string, body: object) => http().post(`/v1/schools/${s.id}${path}`).set('Authorization', `Bearer ${s.token}`).send(body);
  const buy = (studentId: string, planId: string) => memberships.purchase(studentId, planId, { payWithSavedCard: true } as never, 'step-up');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    webhook = app.get(StripeWebhookProcessingProcessor);
    autoPay = app.get(ChargeAutoPayProcessor);
    noShows = app.get(BookingNoShowProcessingProcessor);
    switcher = app.get(PlanSwitchProcessor);
    memberships = app.get(MembershipsService);
    jest.spyOn(app.get(StepUpService), 'assertVerified').mockImplementation(() => undefined);
    const jobsOf = (o: object) => (o as { prismaJobs: PrismaJobsService }).prismaJobs;
    for (const client of new Set([jobsOf(noShows), jobsOf(switcher)])) crashOn(client, '$transaction');
    crashOn((memberships as unknown as { prismaApp: PrismaAppService }).prismaApp, 'withTenantContext');
    await su.cardSurchargeCountry.upsert({ where: { countryCode: COUNTRY }, create: { countryCode: COUNTRY }, update: {} });
  });

  afterEach(() => {
    stripeUnreachable = false;
    crashAfterStripe = false;
    crashNextWrite = false;
  });

  afterAll(async () => {
    const where = { schoolId: { in: schools.map((s) => s.id) } };
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.balanceEntry.deleteMany({ where });
    await su.chargeAllocation.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.booking.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.membership.updateMany({ where, data: { switchedToMembershipId: null } });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.updateMany({ where, data: { switchToPlanId: null } });
    await su.membershipPlan.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schools.map((s) => s.id) } } });
    await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
    await su.$disconnect();
    await app.close();
  });

  describe('item 1: the card surcharge is its own line in revenue', () => {
    it('the billing overview and the Transactions page show the same surcharge, apart from the price, refunds taken off the price first', async () => {
      const s = await mkSchool('revenue', { cardSurchargeEnabled: true, cardSurchargeBps: 300 });
      const plan = await mkPlan(s, { price: 3000 });
      // Two members buy the plan with their saved card: 30.00 + 0.90 surcharge each.
      const a = await mkStudent(s, 'surchargeA');
      const b = await mkStudent(s, 'surchargeB');
      for (const m of [a, b]) expect(((await buy(m.id, plan.id)) as { outcome: string }).outcome).toBe('active');
      const rowA = await su.transaction.findFirstOrThrow({ where: { studentId: a.id } });
      const rowB = await su.transaction.findFirstOrThrow({ where: { studentId: b.id } });
      expect(rowA).toMatchObject({ amount: 3000, surchargeAmount: 90, status: 'SUCCESSFUL' });

      // A paid toward their balance with their card in the app, with its surcharge.
      await su.transaction.create({
        data: {
          id: randomUUID(), schoolId: s.id, studentId: a.id, paymentAccountId: s.accountId, kind: 'CHARGE_PAYMENT', chargePaymentChannel: 'APP',
          amount: 2000, surchargeAmount: 60, currency: 'USD', status: 'SUCCESSFUL', paymentMethod: 'STRIPE',
        },
      });

      // B's payment is refunded in the Stripe dashboard: the whole price and 0.40
      // of the surcharge come back, 0.50 of the surcharge is kept.
      await dashboardRefund(s, rowB.stripePaymentIntentId!, 3040);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: rowB.id } })).toMatchObject({ status: 'REFUNDED', refundedAmount: 3040 });

      const summary = await get(s, '/transactions/summary');
      expect(summary.status).toBe(200);
      // Price: A's plan 30.00 and the charge payment's 20.00; B's price came back.
      expect(summary.body.revenue).toEqual([{ currency: 'USD', amount: 5000 }]);
      expect(summary.body.surcharges).toEqual([{ currency: 'USD', amount: 90 + 60 + 50 }]);

      const overview = await get(s, '/charge-reports/overview?months=1');
      expect(overview.status).toBe(200);
      const [usd] = overview.body.currencies;
      // The charge payment's price is the ledger's (none here: it was written
      // straight to the ledger table), its surcharge is counted.
      expect(usd).toMatchObject({ currency: 'USD', memberships: 3000, surcharges: 200, total: usd.paid + 3000 + 200 });
      expect(usd.revenueByMonth[0]).toMatchObject({ memberships: 3000, surcharges: 200 });
      expect(usd.surcharges).toBe(summary.body.surcharges[0].amount);
    });
  });

  describe('item 3: a plan switch never costs more than its notice said', () => {
    async function agreedSwitch(s: S, label: string, next: { id: string }, endsIn: number) {
      const student = await mkStudent(s, label);
      const intro = await mkPlan(s, { type: 'WEEKLY_PASS', classesIncluded: null, expiryDurationDays: 7, price: 2000, switchToPlanId: next.id, title: `${label} intro` });
      return su.membership.create({
        data: {
          id: randomUUID(), studentId: student.id, membershipPlanId: intro.id, schoolId: s.id, frequency: 'ONE_TIME',
          startDate: new Date(Date.now() - 7 * DAY), expiryDate: new Date(Date.now() + endsIn), switchToPlanId: next.id, switchAgreedAt: new Date(Date.now() - 7 * DAY),
        },
      });
    }
    const endNow = (id: string) => su.membership.update({ where: { id }, data: { expiryDate: new Date(Date.now() - 60_000) } });
    const switchRow = (membershipId: string) => su.transaction.findFirstOrThrow({ where: { planSwitchFromMembershipId: membershipId } });

    it('the notice keeps what it quoted; a surcharge switched on later and a price rise are not charged', async () => {
      const s = await mkSchool('switchCap');
      const next = await mkPlan(s, { price: 6000, classesIncluded: 10, title: 'Ten classes' });
      const m = await agreedSwitch(s, 'switchCap', next, 3 * DAY);
      await switcher.run(new Date());
      expect(await su.membership.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ switchNoticeAmount: 6000, switchNoticeCurrency: 'USD' });
      expect((await notices(m.studentId, 'Your plan is about to change'))[0].body).toContain('60.00 USD');

      // Before switch day: the owner switches a 3% card surcharge on and the price goes up.
      await su.school.update({ where: { id: s.id }, data: { cardSurchargeEnabled: true, cardSurchargeBps: 300 } });
      await su.membershipPlan.update({ where: { id: next.id }, data: { price: 6500 } });
      await endNow(m.id);
      await switcher.run(new Date(Date.now() + 1000));

      const row = await switchRow(m.id);
      expect(row).toMatchObject({ status: 'SUCCESSFUL', amount: 6000, surchargeAmount: 0 });
      expect(madeFor('transactionId', row.id)[0].amount).toBe(6000);
      expect((await su.membership.findUniqueOrThrow({ where: { id: m.id } })).switchOutcome).toBe('SWITCHED');
      expect((await notices(m.studentId, 'Your plan has changed'))[0].body).toContain('60.00 USD');
    });

    it('a quote with a surcharge: the price now, and only as much surcharge as still fits; a lower price now is what is charged', async () => {
      const s = await mkSchool('switchSurcharge', { cardSurchargeEnabled: true, cardSurchargeBps: 300 });
      const next = await mkPlan(s, { price: 6000, classesIncluded: 10, title: 'Ten classes' });
      const rising = await agreedSwitch(s, 'switchRising', next, 3 * DAY);
      const cheaper = await agreedSwitch(s, 'switchCheaper', next, 3 * DAY);
      await switcher.run(new Date());
      expect(await su.membership.findUniqueOrThrow({ where: { id: rising.id } })).toMatchObject({ switchNoticeAmount: 6180 });

      // The price rises to 61.00 (61.00 + 1.83 now): 61.00 and 0.80 of surcharge.
      await su.membershipPlan.update({ where: { id: next.id }, data: { price: 6100 } });
      await endNow(rising.id);
      await switcher.run(new Date(Date.now() + 1000));
      expect(await switchRow(rising.id)).toMatchObject({ status: 'SUCCESSFUL', amount: 6100, surchargeAmount: 80 });

      // Then it falls to 50.00 (+ 1.50): the lower amount now is charged.
      await su.membershipPlan.update({ where: { id: next.id }, data: { price: 5000 } });
      await endNow(cheaper.id);
      await switcher.run(new Date(Date.now() + 2000));
      expect(await switchRow(cheaper.id)).toMatchObject({ status: 'SUCCESSFUL', amount: 5000, surchargeAmount: 150 });
    });
  });

  describe('item 5: Pix only at a School in Brazil', () => {
    it('a desk sale and a desk payment toward charges by Pix are refused outside Brazil, and taken in Brazil', async () => {
      const outside = await mkSchool('pixOutside');
      const brazil = await mkSchool('pixBrazil', { addressCountry: 'BR', defaultCurrency: 'BRL' });
      for (const s of [outside, brazil]) {
        const plan = await mkPlan(s, { currency: s === brazil ? 'BRL' : 'USD' });
        const student = await mkStudent(s, 'pixMember', false);
        const sale = await post(s, `/students/${student.id}/memberships/sell`, { membershipPlanId: plan.id, paymentMethod: 'PIX' });
        const payment = await post(s, `/students/${student.id}/charge-payments`, { amount: 1000, paymentMethod: 'PIX', sendReceipt: false });
        if (s === outside) {
          for (const res of [sale, payment]) {
            expect(res.status).toBe(400);
            expect(res.body.error.message).toBe('Pix can only be used by a School in Brazil. Choose another way to pay.');
          }
          expect(await su.transaction.count({ where: { studentId: student.id } })).toBe(0);
          expect(await su.membership.count({ where: { studentId: student.id } })).toBe(0);
          // Other desk methods are taken as before.
          expect((await post(s, `/students/${student.id}/memberships/sell`, { membershipPlanId: plan.id, paymentMethod: 'CASH' })).status).toBe(201);
        } else {
          expect(sale.status).toBe(201);
          expect(payment.status).toBe(201);
          expect(await su.transaction.count({ where: { studentId: student.id, paymentMethod: 'PIX' } })).toBe(2);
        }
      }
    });
  });

  describe('item 18: no-show fees on the Transactions page', () => {
    let s: S;
    beforeAll(async () => {
      s = await mkSchool('noShow', { noShowFee: 800 });
    });
    async function overdueBooking(label: string, savedCard = true) {
      const student = await mkStudent(s, label, savedCard);
      const cls = await su.class.create({
        data: { id: randomUUID(), schoolId: s.id, title: `Missed ${label}`, startDate: new Date(Date.now() - 3 * HOUR), endDate: new Date(Date.now() - 2 * HOUR) },
      });
      return su.booking.create({ data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: s.id, status: 'UPCOMING' } });
    }
    const feeRows = (bookingId: string) => su.transaction.findMany({ where: { bookingId } });

    it('a fee charged is a Successful NO_SHOW_FEE row, listed with its class and counted in revenue', async () => {
      const b = await overdueBooking('noShowCharged');
      await noShows.process({} as never);
      const [made] = madeFor('noShowBookingId', b.id);
      const rows = await feeRows(b.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'NO_SHOW_FEE', status: 'SUCCESSFUL', amount: 800, currency: 'USD', paymentMethod: 'STRIPE', stripePaymentIntentId: made.id, studentId: b.studentId });

      const list = await get(s, '/transactions?kind=NO_SHOW_FEE');
      expect(list.status).toBe(200);
      expect(list.body.items.find((t: { id: string }) => t.id === rows[0].id)).toMatchObject({ kind: 'NO_SHOW_FEE', bookingId: b.id, bookingClassTitle: 'Missed noShowCharged', amount: 800 });
      const summary = await get(s, `/transactions/summary?kind=NO_SHOW_FEE`);
      expect(summary.body).toMatchObject({ successful: 1, revenue: [{ currency: 'USD', amount: 800 }] });
      const overview = await get(s, '/charge-reports/overview?months=1');
      // Decision 449 item 10: on the "Fees" line, not in memberships.
      expect(overview.body.currencies[0]).toMatchObject({ memberships: 0, fees: 800, total: 800 });

      // Refunded in the Stripe dashboard: the row says so, and revenue drops.
      await dashboardRefund(s, made.id, 800);
      expect((await feeRows(b.id))[0]).toMatchObject({ status: 'REFUNDED', refundedAmount: 800 });
      // Nothing kept: no revenue figure at all, as for any payment refunded in full.
      expect((await get(s, `/transactions/summary?kind=NO_SHOW_FEE`)).body.revenue).toEqual([]);
    });

    it("a crash after Stripe took the fee: no row until Stripe's webhook saves the outcome, then one, whatever comes after", async () => {
      const b = await overdueBooking('noShowCrash');
      crashAfterStripe = true;
      await expect(noShows.process({} as never)).rejects.toThrow('worker killed');
      expect(await feeRows(b.id)).toHaveLength(0);
      const [made] = madeFor('noShowBookingId', b.id);
      await event(s, 'payment_intent.succeeded', made.id, { noShowBookingId: b.id });
      await event(s, 'payment_intent.succeeded', made.id, { noShowBookingId: b.id });
      await autoPay.resolveStaleAttempts(later());
      const rows = await feeRows(b.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'NO_SHOW_FEE', status: 'SUCCESSFUL', stripePaymentIntentId: made.id });
    });

    it('the sweep finds no payment: a Failed row; Stripe later says it was paid: the same row turns Successful', async () => {
      const b = await overdueBooking('noShowLate');
      stripeUnreachable = true;
      await noShows.process({} as never);
      stripeUnreachable = false;
      expect(await feeRows(b.id)).toHaveLength(0);
      await autoPay.resolveStaleAttempts(later());
      const [failed] = await feeRows(b.id);
      expect(failed).toMatchObject({ kind: 'NO_SHOW_FEE', status: 'FAILED', stripePaymentIntentId: null });

      const paid = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      await event(s, 'payment_intent.succeeded', paid, { noShowBookingId: b.id });
      expect(await su.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ noShowFeeOutcome: 'CHARGED', stripeNoShowPaymentIntentId: paid });
      const rows = await feeRows(b.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: failed.id, status: 'SUCCESSFUL', stripePaymentIntentId: paid });
    });

    it('no saved card: nothing tried, and no row', async () => {
      const b = await overdueBooking('noShowNoCard', false);
      await noShows.process({} as never);
      expect(await su.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: 'NO_SHOW', noShowFeeOutcome: 'NO_SAVED_PAYMENT_METHOD' });
      expect(await feeRows(b.id)).toHaveLength(0);
    });
  });

  describe('item 19: a saved-card purchase settled late says "Payment confirmed", once', () => {
    let s: S;
    beforeAll(async () => {
      s = await mkSchool('confirmed');
    });

    it("settled by Stripe's webhook after a crash: one notice, also after a redelivery and the sweep", async () => {
      const plan = await mkPlan(s, { title: 'Five classes' });
      const student = await mkStudent(s, 'confirmedWebhook');
      crashAfterStripe = true;
      await expect(buy(student.id, plan.id)).rejects.toThrow('worker killed');
      const row = await su.transaction.findFirstOrThrow({ where: { studentId: student.id } });
      const [made] = madeFor('transactionId', row.id);
      await event(s, 'payment_intent.succeeded', made.id, { transactionId: row.id });
      await event(s, 'payment_intent.succeeded', made.id, { transactionId: row.id });
      await autoPay.resolveStaleAttempts(later());
      // Decision 449 item 11: its own text: the same payment, charged once.
      expect((await notices(student.id, 'Payment confirmed')).map((n) => n.body)).toEqual([
        'Your payment of 30.00 USD for Five classes is complete. This is the same payment you made when you bought it, not a new one: you have been charged only once. Your membership is now active.',
      ]);
      expect(await settledNotices(student.id, 'Payment confirmed')).toHaveLength(1);
      // Decision 450 item 8: its own type, not the cash notice's.
      expect((await su.notification.findMany({ where: { userId: student.id, title: 'Payment confirmed' }, select: { type: true } })).map((n) => n.type)).toEqual(['CARD_PAYMENT_CONFIRMED']);
    });

    it("Decision 450 item 8: the School's own switch for it, off: no notice, the payment still settles", async () => {
      const off = await mkSchool('confirmedOff', { chargeNoticeCardConfirmed: false });
      const plan = await mkPlan(off, { title: 'Quiet pack' });
      const student = await mkStudent(off, 'confirmedOff');
      crashAfterStripe = true;
      await expect(buy(student.id, plan.id)).rejects.toThrow('worker killed');
      await autoPay.resolveStaleAttempts(later());
      expect(await su.transaction.findFirstOrThrow({ where: { studentId: student.id } })).toMatchObject({ status: 'SUCCESSFUL' });
      expect(await settledNotices(student.id, 'Payment confirmed')).toHaveLength(0);
    });

    it('settled by the sweep: one notice', async () => {
      const plan = await mkPlan(s, { title: 'Swept pack' });
      const student = await mkStudent(s, 'confirmedSweep');
      crashAfterStripe = true;
      await expect(buy(student.id, plan.id)).rejects.toThrow('worker killed');
      await autoPay.resolveStaleAttempts(later());
      await autoPay.resolveStaleAttempts(later());
      expect(await notices(student.id, 'Payment confirmed')).toHaveLength(1);
      expect(await settledNotices(student.id, 'Payment confirmed')).toHaveLength(1);
    });

    it('answered at the time (no crash): no notice, the member saw it', async () => {
      const plan = await mkPlan(s, { title: 'Answered pack' });
      const student = await mkStudent(s, 'confirmedAnswered');
      expect(((await buy(student.id, plan.id)) as { outcome: string }).outcome).toBe('active');
      expect(await settledNotices(student.id, 'Payment confirmed')).toHaveLength(0);
    });
  });
});
