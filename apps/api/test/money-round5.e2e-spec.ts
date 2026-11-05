import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { fakePaymentCheckoutSession } from './stripe-fakes';

/**
 * Decision 430 (stress test round 5, MONEY), over real HTTP against a real
 * Postgres and Redis, with Stripe faked (StripeClientService):
 * - MON-3: zero-decimal amounts with a fraction are refused (400
 *   AMOUNT_NOT_WHOLE_UNIT); MON-2: a yen charge with a % discount rounds to
 *   whole yen; MON-11: the cap answers CHARGE_AMOUNT_TOO_BIG;
 * - MON-4: the same refund sent five times at once is recorded once, for each
 *   destination (card, money back, credit);
 * - MON-6: two named tax lines with registration numbers, a Branch's own
 *   lines, the checks on saving them, and the tax a membership's price
 *   included on its receipt row;
 * - MON-7: the Transactions filter's days are the School's days;
 * - MON-8: refunding a desk sale (owner only, notes, part then the rest,
 *   ending the membership), and Cancel on a taken payment answers 409;
 * - MON-9 and MON-12: a MIGRATE price increase sent five times at once
 *   records and migrates once, and tells the member the new price and date;
 * - MON-14: a desk sale tells the member it was confirmed;
 * - MON-15: several Friend Passes in one action.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.REDIS_URL);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[money-round5.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / REDIS_URL not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describeIfDb('Money fixes (Decision 430, stress test round 5)', () => {
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const acct = `acct_${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const eventIds: string[] = [];
  const tokens: Record<string, string> = {};

  // The fake Stripe.
  const refunds: Array<{ payment_intent: string; amount: number }> = [];
  const pricesCreate = jest.fn(async (args: { product: string }, _opts?: { idempotencyKey?: string }) => ({ id: `price_${randomUUID()}`, product: args.product }));
  const PERIOD_END = Math.floor(Date.UTC(2027, 0, 15, 3, 0, 0) / 1000); // 15 Jan 2027, 12:00 in Tokyo
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      checkout: { sessions: { create: jest.fn(async (params: { metadata?: Record<string, string> }) => fakePaymentCheckoutSession(params)) } },
      refunds: {
        create: jest.fn(async (params: { payment_intent: string; amount: number }) => {
          refunds.push(params);
          return { id: `re_${randomUUID()}` };
        }),
      },
      products: { create: jest.fn(async () => ({ id: `prod_${randomUUID()}` })) },
      prices: { create: pricesCreate },
      subscriptions: {
        retrieve: jest.fn(async (id: string) => ({ id, metadata: {}, items: { data: [{ id: `si_${id}`, current_period_end: PERIOD_END }] } })),
        update: jest.fn(async (id: string) => ({ id, items: { data: [{ id: `si_${id}`, current_period_end: PERIOD_END }] } })),
      },
    })),
    platformClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const sign = (user: { id: string; email: string }, role: string, schoolId: string, branchId: string | null = null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId }] });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `money-r5-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Money',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  /** A School with an owner, a Branch, a Branch Staff member and a Stripe account. */
  async function mkSchool(label: string, data: Record<string, unknown>) {
    const school = await su.school.create({ data: { id: randomUUID(), name: `Money R5 ${label}`, timezone: 'UTC', ...data } });
    schoolIds.push(school.id);
    const branch = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `${label} main` } });
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: label === 'ca' ? acct : `acct_${randomUUID().slice(0, 12)}` },
    });
    const owner = await mkUser(`${label}-owner`);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokens[`${label}-owner`] = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    const staff = await mkUser(`${label}-staff`);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id, branchId: branch.id } });
    tokens[`${label}-staff`] = sign(staff, 'BRANCH_STAFF', school.id, branch.id);
    return { school, branch, account, owner: tokens[`${label}-owner`], staff: tokens[`${label}-staff`] };
  }
  type School = Awaited<ReturnType<typeof mkSchool>>;

  async function mkStudent(s: School, label: string, homeBranchId: string | null = s.branch.id) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: s.school.id } });
    if (homeBranchId) await su.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.school.id, studentId: user.id, branchId: homeBranchId } });
    tokens[label] = sign(user, 'STUDENT', s.school.id);
    return user;
  }

  async function event(eventType: string, objectId: string, transactionId?: string) {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: acct, transactionId }, attemptsMade: 1, opts: { attempts: 3 } } as never);
  }

  async function noticesFor(userId: string, title: string, expected = 1) {
    for (let i = 0; i < 60; i++) {
      const rows = await su.notification.findMany({ where: { userId, title } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return su.notification.findMany({ where: { userId, title } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    webhook = app.get(StripeWebhookProcessingProcessor);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.deskSaleRefund.deleteMany({ where });
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.chargeRefund.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.membershipPlanPriceChange.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.studentHomeBranch.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.branch.deleteMany({ where });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('zero-decimal currencies and the cap (MON-2, MON-3, MON-11)', () => {
    let s: School;
    let studentId: string;
    beforeAll(async () => {
      s = await mkSchool('jp', { defaultCurrency: 'JPY', addressCountry: 'JP', timezone: 'Asia/Tokyo' });
      studentId = (await mkStudent(s, 'jp-student')).id;
    });

    it('refuses a fraction of a yen on a charge, a plan and a desk payment', async () => {
      const charge = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${studentId}/charges`, { description: 'Gi', amount: 99950, dueDate: day(7) });
      expect(charge.status).toBe(400);
      expect(charge.body.error.code).toBe('AMOUNT_NOT_WHOLE_UNIT');
      const plan = await as(s.owner).post(`/v1/schools/${s.school.id}/membership-plans`, { type: 'CLASS_PACK', title: 'Pack', price: 100050, classesIncluded: 3 });
      expect(plan.status).toBe(400);
      expect(plan.body.error.code).toBe('AMOUNT_NOT_WHOLE_UNIT');
      const pay = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${studentId}/charge-payments`, { amount: 150, paymentMethod: 'CASH', sendReceipt: false });
      expect(pay.status).toBe(400);
      expect(pay.body.error.code).toBe('AMOUNT_NOT_WHOLE_UNIT');
    });

    it('rounds a percentage discount on a yen charge to whole yen, so paying it settles it', async () => {
      const res = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${studentId}/charges`, {
        description: 'Seminar',
        amount: 100000,
        discountType: 'PERCENT',
        discountValue: 3333,
        dueDate: day(7),
      });
      expect(res.status).toBe(201);
      expect(res.body.discountAmount % 100).toBe(0);
      expect(res.body.grossAmount % 100).toBe(0);
      expect(res.body.grossAmount).toBe(66700);
      const pay = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${studentId}/charge-payments`, {
        amount: res.body.grossAmount,
        chargeId: res.body.id,
        paymentMethod: 'CASH',
        sendReceipt: false,
      });
      expect(pay.status).toBe(201);
      const view = await as(s.owner).get(`/v1/schools/${s.school.id}/students/${studentId}/charges`);
      expect(view.body.charges.find((c: { id: string }) => c.id === res.body.id)).toMatchObject({ status: 'PAID', owedAmount: 0 });
    });

    it('answers a coded error above the charge cap', async () => {
      const res = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${studentId}/charges`, { description: 'Too big', amount: 100_000_000, dueDate: day(7) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHARGE_AMOUNT_TOO_BIG');
    });
  });

  describe('the same refund sent five times at once (MON-4)', () => {
    let s: School;
    beforeAll(async () => {
      s = await mkSchool('ca', { defaultCurrency: 'CAD', addressCountry: 'CA' });
    });
    const fiveRefunds = (paymentId: string, destination: string) =>
      Promise.all(
        Array.from({ length: 5 }, () =>
          as(s.owner).post(`/v1/schools/${s.school.id}/charge-payments/${paymentId}/refund`, { amount: 5000, destination, notes: 'Double tap' }),
        ),
      );
    const newCharge = async (studentId: string) => {
      const res = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${studentId}/charges`, { description: 'Gear', amount: 15000, dueDate: day(7) });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    it.each(['MONEY_BACK', 'CREDIT'])('%s: one refund recorded, the rest 409 DESK_REPEAT', async (destination) => {
      const student = await mkStudent(s, `ca-${destination}`);
      const chargeId = await newCharge(student.id);
      const pay = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${student.id}/charge-payments`, {
        amount: 15000,
        chargeId,
        paymentMethod: 'CASH',
        sendReceipt: false,
      });
      expect(pay.status).toBe(201);
      const results = await fiveRefunds(pay.body.payment.id, destination);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const refused = results.filter((r) => r.status !== 201);
      expect(refused.every((r) => r.status === 409 && r.body.error.code === 'DESK_REPEAT')).toBe(true);
      expect(await su.chargeRefund.count({ where: { transactionId: pay.body.payment.id } })).toBe(1);
    });

    it('CARD: one Stripe refund, the rest 409 DESK_REPEAT', async () => {
      const student = await mkStudent(s, 'ca-card');
      const chargeId = await newCharge(student.id);
      const checkout = await as(tokens['ca-card']).post(`/v1/students/${student.id}/charges/checkout`, { schoolId: s.school.id, chargeId });
      expect(checkout.status).toBe(201);
      await event('payment_intent.succeeded', `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`, checkout.body.transactionId);
      const before = refunds.length;
      const results = await fiveRefunds(checkout.body.transactionId, 'CARD');
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'DESK_REPEAT')).toBe(true);
      expect(refunds.length - before).toBe(1);
    });
  });

  describe('named tax lines and a Branch override (MON-6)', () => {
    let s: School;
    beforeAll(async () => {
      s = await mkSchool('tax', { defaultCurrency: 'CAD', addressCountry: 'CA', taxCountry: 'CA' });
    });

    it('checks the two lines on saving: a named second line, at most 100% together', async () => {
      const noName = await as(s.owner).patch(`/v1/schools/${s.school.id}`, { taxRateBasisPoints: 500, tax2RateBasisPoints: 700 });
      expect(noName.status).toBe(400);
      expect(noName.body.error.code).toBe('TAX_LINE_NAME_REQUIRED');
      const tooHigh = await as(s.owner).patch(`/v1/schools/${s.school.id}`, { taxRateBasisPoints: 6000, tax2RateBasisPoints: 5000, tax2Name: 'PST' });
      expect(tooHigh.status).toBe(400);
      expect(tooHigh.body.error.code).toBe('TAX_LINES_TOO_HIGH');
      const branch = await as(s.owner).patch(`/v1/branches/${s.branch.id}`, { taxOverride: true, taxRateBasisPoints: 500, tax2RateBasisPoints: 997, tax2Name: '' });
      expect(branch.status).toBe(400);
      expect(branch.body.error.code).toBe('TAX_LINE_NAME_REQUIRED');
    });

    it("a charge gets the School's two named lines, and a member of an overriding Branch gets the Branch's", async () => {
      const save = await as(s.owner).patch(`/v1/schools/${s.school.id}`, {
        taxInclusive: false,
        taxName: 'GST',
        taxRateBasisPoints: 500,
        taxId: '123456789RT0001',
        tax2Name: 'PST',
        tax2RateBasisPoints: 700,
        tax2Id: 'PST-1234-5678',
      });
      expect(save.status).toBe(200);
      expect(save.body).toMatchObject({ taxName: 'GST', tax2Name: 'PST', tax2RateBasisPoints: 700, tax2Id: 'PST-1234-5678' });

      const bc = await mkStudent(s, 'tax-bc');
      const res = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${bc.id}/charges`, { description: 'Gear', amount: 10000, dueDate: day(7) });
      expect(res.status).toBe(201);
      expect(res.body.taxAmount).toBe(1200);
      expect(res.body.taxLines).toEqual([
        { name: 'GST', rateBasisPoints: 500, taxId: '123456789RT0001', amount: 500 },
        { name: 'PST', rateBasisPoints: 700, taxId: 'PST-1234-5678', amount: 700 },
      ]);

      const qc = await su.branch.create({ data: { id: randomUUID(), schoolId: s.school.id, name: 'Montréal' } });
      const override = await as(s.owner).patch(`/v1/branches/${qc.id}`, {
        taxOverride: true,
        taxName: 'GST',
        taxRateBasisPoints: 500,
        taxId: '123456789RT0001',
        tax2Name: 'QST',
        // Rates are whole hundredths of a percent, so QST's 9.975% can't be
        // entered exactly (open point, Decision 430 report).
        tax2RateBasisPoints: 997,
        tax2Id: '1234567890TQ0001',
      });
      expect(override.status).toBe(200);
      expect(override.body).toMatchObject({ taxOverride: true, tax2Name: 'QST', tax2RateBasisPoints: 997 });
      const quebec = await mkStudent(s, 'tax-qc', qc.id);
      const qcCharge = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${quebec.id}/charges`, { description: 'Gear', amount: 10000, dueDate: day(7) });
      expect(qcCharge.status).toBe(201);
      expect(qcCharge.body.taxLines.map((l: { name: string; amount: number }) => [l.name, l.amount])).toEqual([
        ['GST', 500],
        ['QST', 997],
      ]);
      expect(qcCharge.body.taxAmount).toBe(1497);
    });

    it('a membership sold when prices include tax shows the tax its price included', async () => {
      await su.school.update({ where: { id: s.school.id }, data: { taxInclusive: true } });
      const student = await mkStudent(s, 'tax-member');
      const plan = await su.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.school.id, type: 'CLASS_PACK', title: 'Ten classes', price: 11200, classesIncluded: 10, currency: 'CAD' },
      });
      const sale = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${student.id}/memberships/sell`, { membershipPlanId: plan.id, paymentMethod: 'CASH' });
      expect(sale.status).toBe(201);
      const list = await as(s.owner).get(`/v1/schools/${s.school.id}/transactions`);
      const row = list.body.items.find((t: { id: string }) => t.id === sale.body.transactionId);
      expect(row.includedTax).toEqual({
        amount: 1200,
        lines: [
          { name: 'GST', rateBasisPoints: 500, taxId: '123456789RT0001', amount: 500 },
          { name: 'PST', rateBasisPoints: 700, taxId: 'PST-1234-5678', amount: 700 },
        ],
      });
      // The member sees it on their own history too.
      const mine = await as(tokens['tax-member']).get('/v1/transactions/me');
      expect(mine.body.items[0].includedTax.amount).toBe(1200);
    });
  });

  describe("the Transactions filter's days are the School's (MON-7)", () => {
    it('a Tokyo payment at 01:00 on 1 April is on 1 April, not 31 March', async () => {
      const s = await mkSchool('tokyo', { defaultCurrency: 'JPY', timezone: 'Asia/Tokyo' });
      const student = await mkStudent(s, 'tokyo-student');
      const t = await su.transaction.create({
        data: {
          id: randomUUID(),
          schoolId: s.school.id,
          studentId: student.id,
          paymentAccountId: s.account.id,
          amount: 100000,
          currency: 'JPY',
          status: 'SUCCESSFUL',
          paymentMethod: 'CASH',
          billingDate: new Date('2026-03-31T16:00:00.000Z'),
        },
      });
      const on = (d: string) => as(s.owner).get(`/v1/schools/${s.school.id}/transactions?from=${d}&to=${d}`);
      expect((await on('2026-04-01')).body.items.map((r: { id: string }) => r.id)).toEqual([t.id]);
      expect((await on('2026-03-31')).body.items).toEqual([]);
      const summary = await as(s.owner).get(`/v1/schools/${s.school.id}/transactions/summary?from=2026-04-01&to=2026-04-01`);
      expect(summary.body.total).toBe(1);
    });
  });

  describe('refunding a desk sale (MON-8) and the desk sale notice (MON-14)', () => {
    let s: School;
    beforeAll(async () => {
      s = await mkSchool('br', { defaultCurrency: 'BRL', addressCountry: 'BR' });
    });
    const sell = async (label: string) => {
      const student = await mkStudent(s, label);
      const plan = await su.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.school.id, type: 'CLASS_PACK', title: `Pack ${label}`, price: 20000, classesIncluded: 8, currency: 'BRL' },
      });
      const sale = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${student.id}/memberships/sell`, { membershipPlanId: plan.id, paymentMethod: 'PIX' });
      expect(sale.status).toBe(201);
      return { student, transactionId: sale.body.transactionId as string, membershipId: sale.body.membership.id as string };
    };
    const refund = (id: string, body: Record<string, unknown>, token = s.owner) => as(token).post(`/v1/transactions/${id}/refund`, body);

    it('the member hears that a desk sale was confirmed', async () => {
      const { student } = await sell('br-notice');
      expect(await noticesFor(student.id, 'Payment confirmed')).toHaveLength(1);
    });

    it('owner only, notes required, part then the rest, and the membership ends when asked', async () => {
      const { student, transactionId, membershipId } = await sell('br-refund');
      expect((await refund(transactionId, { amount: 5000, notes: 'x' }, s.staff)).status).toBe(403);
      expect((await refund(transactionId, { amount: 5000, notes: 'x' }, tokens['br-refund'])).status).toBe(403);
      const noNotes = await refund(transactionId, { amount: 5000, notes: '  ' });
      expect(noNotes.status).toBe(400);
      expect(noNotes.body.error.code).toBe('REFUND_NOTES_REQUIRED');

      const part = await refund(transactionId, { amount: 5000, notes: 'Gave R$50 back in cash' });
      expect(part.status).toBe(201);
      expect(part.body).toMatchObject({ refundedAmount: 5000, status: 'SUCCESSFUL', membershipEnded: false });
      expect((await su.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe('ACTIVE');
      const again = await refund(transactionId, { amount: 5000, notes: 'Gave R$50 back in cash' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('DESK_REPEAT');
      const tooMuch = await refund(transactionId, { amount: 15001, notes: 'Too much' });
      expect(tooMuch.status).toBe(400);
      expect(tooMuch.body.error.code).toBe('REFUND_MORE_THAN_LEFT');

      const rest = await refund(transactionId, { amount: 15000, notes: 'Left the School', endMembership: true });
      expect(rest.status).toBe(201);
      expect(rest.body).toMatchObject({ refundedAmount: 20000, status: 'REFUNDED', membershipEnded: true });
      expect(await su.transaction.findUniqueOrThrow({ where: { id: transactionId } })).toMatchObject({ status: 'REFUNDED', refundedAmount: 20000 });
      expect((await su.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe('EXPIRED');
      expect(await su.deskSaleRefund.count({ where: { transactionId } })).toBe(2);
      const done = await refund(transactionId, { amount: 100, notes: 'Once more' });
      expect(done.status).toBe(409);
      expect(done.body.error.code).toBe('ALREADY_REFUNDED');
      expect(await noticesFor(student.id, 'Refund', 2)).toHaveLength(2);
    });

    it('Cancel on a payment that was taken answers 409', async () => {
      const { transactionId } = await sell('br-cancel');
      const res = await as(s.owner).patch(`/v1/transactions/${transactionId}/cancel`, { reason: 'Mistake' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_ALREADY_TAKEN');
      expect((await su.transaction.findUniqueOrThrow({ where: { id: transactionId } })).status).toBe('SUCCESSFUL');
    });
  });

  describe('Friend Passes in one action (MON-15)', () => {
    it('gives up to five at once; six is refused', async () => {
      const s = await mkSchool('ng', { defaultCurrency: 'NGN' });
      const student = await mkStudent(s, 'ng-student');
      const plan = await su.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.school.id, type: 'FRIEND_PASS', title: 'Bring a friend', price: 0, classesIncluded: 1 },
      });
      const url = `/v1/schools/${s.school.id}/students/${student.id}/memberships/gift`;
      expect((await as(s.owner).post(url, { membershipPlanId: plan.id, quantity: 6 })).status).toBe(400);
      const res = await as(s.owner).post(url, { membershipPlanId: plan.id, quantity: 3 });
      expect(res.status).toBe(201);
      expect(res.body.memberships).toHaveLength(3);
      expect(await su.membership.count({ where: { studentId: student.id, membershipPlanId: plan.id } })).toBe(3);
      // A second click straight after is still a double tap.
      const again = await as(s.owner).post(url, { membershipPlanId: plan.id });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('DESK_REPEAT');
    });
  });

  describe('a MIGRATE price increase (MON-9, MON-12)', () => {
    it('five at once record and migrate once, and the member is told the new price and its first day', async () => {
      const s = await mkSchool('mig', { defaultCurrency: 'CAD', timezone: 'Asia/Tokyo' });
      const student = await mkStudent(s, 'mig-student');
      const plan = await su.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 10000, currency: 'CAD' },
      });
      await su.membership.create({
        data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: s.school.id, frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}` },
      });
      pricesCreate.mockClear();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => as(s.owner).patch(`/v1/membership-plans/${plan.id}`, { price: 12000, priceChangeStrategy: 'MIGRATE' })),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const others = results.filter((r) => r.status !== 200);
      expect(others.every((r) => r.status === 409 || r.status === 400)).toBe(true);
      expect(await su.membershipPlanPriceChange.count({ where: { membershipPlanId: plan.id } })).toBe(1);
      for (const call of pricesCreate.mock.calls) {
        expect(call[1]).toEqual({ idempotencyKey: `plan:${plan.id}:price:12000:cad` });
      }
      const [notice] = await noticesFor(student.id, 'Membership price going up');
      expect(notice.body).toBe('The price of your Monthly membership is going up to 120.00 CAD. The new price applies from 2027-01-15.');
    });
  });
});
