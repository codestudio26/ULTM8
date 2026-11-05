import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { fakeIncompleteSubscription, fakePaymentCheckoutSession } from './stripe-fakes';

/**
 * Decision 316 item 3, as answered by Decision 435 items 1-6: the joining fee
 * on a plan, over real HTTP against a real Postgres, with Stripe faked:
 * - the School switches joining fees on or off; off, the amounts stay on the
 *   plans and nothing is charged or shown;
 * - only a paid plan can carry one;
 * - it is added to a member's first-ever plan at the School only (not a rejoin,
 *   not after a waiting Cash order with the fee), by card (PaymentIntent,
 *   hosted Checkout, a Subscription's first invoice), in the app's Cash order
 *   and at the desk, with the card surcharge worked out on it too;
 * - a Friend Pass the School gave doesn't make the next plan a rejoin;
 * - the preview the app and the desk show, and who may ask for it;
 * - a non-refundable fee is left out of a desk refund; a refundable one isn't.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.REDIS_URL);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[plan-joining-fee.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / REDIS_URL not set.');
}

/** A country on the card-surcharge allow-list for this file only. */
const COUNTRY = 'PY';

describeIfDb('Joining fee on plans (Decision 316 item 3, Decision 435 items 1-6)', () => {
  let app: INestApplication;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const tokens: Record<string, string> = {};
  let addedCountry = false;

  // The fake Stripe: what each create was sent.
  const intents: Array<{ amount: number }> = [];
  const sessions: Array<{ line_items: Array<{ price_data: { unit_amount: number; product_data: { name: string } } }> }> = [];
  const subscriptions: Array<{ items: Array<{ price_data: { unit_amount: number; product: string } }>; add_invoice_items?: Array<{ price_data: { unit_amount: number; product: string } }> }> = [];
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      paymentIntents: {
        create: jest.fn(async (params: { amount: number }) => {
          intents.push(params);
          const id = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          return { id, client_secret: `${id}_secret`, status: 'requires_payment_method' };
        }),
      },
      checkout: {
        sessions: {
          create: jest.fn(async (params: (typeof sessions)[number] & { metadata?: Record<string, string> }) => {
            sessions.push(params);
            return fakePaymentCheckoutSession(params);
          }),
        },
      },
      customers: { create: jest.fn(async () => ({ id: `cus_${randomUUID().slice(0, 12)}` })) },
      products: { create: jest.fn(async (params: { name: string }) => ({ id: `prod_${params.name.replace(/\s/g, '_')}_${randomUUID().slice(0, 8)}` })) },
      subscriptions: {
        create: jest.fn(async (params: (typeof subscriptions)[number]) => {
          subscriptions.push(params);
          const lines = [...params.items, ...(params.add_invoice_items ?? [])].map((i) => ({ amount: i.price_data.unit_amount, product: i.price_data.product }));
          return fakeIncompleteSubscription(undefined, lines);
        }),
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
  const sign = (user: { id: string; email: string }, role: string, schoolId: string | null, branchId: string | null = null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: schoolId ? [{ role, franchiseId: null, schoolId, branchId }] : [] });

  async function mkUser(label: string, dateOfBirth = new Date('1990-01-01')) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `joining-fee-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Joiner',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkSchool(label: string, provider: 'STRIPE' | 'CASH', data: Record<string, unknown>) {
    const school = await su.school.create({ data: { id: randomUUID(), name: `Joining fee ${label}`, timezone: 'UTC', ...data } });
    schoolIds.push(school.id);
    await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider, accountTitle: provider, country: COUNTRY, stripeConnectedAccountId: provider === 'STRIPE' ? `acct_${randomUUID().slice(0, 12)}` : undefined },
    });
    const owner = await mkUser(`${label}-owner`);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokens[`${label}-owner`] = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    return { school, owner: tokens[`${label}-owner`] };
  }
  type School = Awaited<ReturnType<typeof mkSchool>>;

  async function mkStudent(s: School, label: string) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: s.school.id } });
    tokens[label] = sign(user, 'STUDENT', s.school.id);
    return user;
  }

  const mkPlan = (s: School, data: Record<string, unknown>) =>
    su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, title: `Plan ${randomUUID().slice(0, 6)}`, ...data } as never });
  const preview = (token: string, planId: string, studentId?: string) =>
    as(token).get(`/v1/membership-plans/${planId}/joining-fee${studentId ? `?studentId=${studentId}` : ''}`);
  const buy = (token: string, planId: string, body: Record<string, unknown> = {}) => as(token).post(`/v1/membership-plans/${planId}/purchase`, body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    if (!(await su.cardSurchargeCountry.findUnique({ where: { countryCode: COUNTRY } }))) {
      await su.cardSurchargeCountry.create({ data: { countryCode: COUNTRY } });
      addedCountry = true;
    }
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.deskSaleRefund.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    if (addedCountry) await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
    await su.$disconnect();
    await app.close();
  });

  describe('on the plan and the School', () => {
    let s: School;
    beforeAll(async () => {
      s = await mkSchool('settings', 'CASH', { defaultCurrency: 'GBP', addressCountry: 'GB' });
    });

    it('saves a fee and whether it is refundable on a paid plan, and clears it with null', async () => {
      const created = await as(s.owner).post(`/v1/schools/${s.school.id}/membership-plans`, {
        type: 'CLASS_PACK',
        title: 'Ten',
        price: 5000,
        classesIncluded: 10,
        joiningFee: 2500,
        joiningFeeRefundable: true,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ joiningFee: 2500, joiningFeeRefundable: true });
      const cleared = await as(s.owner).patch(`/v1/membership-plans/${created.body.id}`, { joiningFee: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.joiningFee).toBeNull();
    });

    it('refuses a fee on a free plan or a Friend Pass, and a plan made free while it has one', async () => {
      const free = await as(s.owner).post(`/v1/schools/${s.school.id}/membership-plans`, { type: 'TRIAL_MEMBERSHIP', title: 'Free trial', price: 0, expiryDurationDays: 7, joiningFee: 1000 });
      expect(free.status).toBe(400);
      expect(free.body.error.code).toBe('JOINING_FEE_NEEDS_PRICE');
      const friend = await as(s.owner).post(`/v1/schools/${s.school.id}/membership-plans`, { type: 'FRIEND_PASS', title: 'Friend', price: 0, classesIncluded: 1, joiningFee: 1000 });
      expect(friend.status).toBe(400);
      const paid = await as(s.owner).post(`/v1/schools/${s.school.id}/membership-plans`, { type: 'CLASS_PACK', title: 'Five', price: 3000, classesIncluded: 5, joiningFee: 1000 });
      expect(paid.status).toBe(201);
      const madeFree = await as(s.owner).patch(`/v1/membership-plans/${paid.body.id}`, { price: 0 });
      expect(madeFree.status).toBe(400);
      expect(madeFree.body.error.code).toBe('JOINING_FEE_NEEDS_PRICE');
    });

    it('switches joining fees on and off for the School (off by default), owner only', async () => {
      const before = await as(s.owner).get(`/v1/schools/${s.school.id}`);
      expect(before.body.joiningFeesEnabled).toBe(false);
      const on = await as(s.owner).patch(`/v1/schools/${s.school.id}`, { joiningFeesEnabled: true });
      expect(on.status).toBe(200);
      expect(on.body.joiningFeesEnabled).toBe(true);
      const student = await mkStudent(s, 'settings-student');
      expect((await as(tokens['settings-student']).patch(`/v1/schools/${s.school.id}`, { joiningFeesEnabled: false })).status).toBe(403);
      expect(student.id).toBeTruthy();
    });
  });

  describe('paid by card in the app', () => {
    let s: School;
    let pack: { id: string };
    let monthly: { id: string };
    beforeAll(async () => {
      s = await mkSchool('card', 'STRIPE', { defaultCurrency: 'USD', addressCountry: COUNTRY, cardSurchargeEnabled: true, cardSurchargeBps: 250 });
      pack = await mkPlan(s, { type: 'CLASS_PACK', price: 1999, currency: 'USD', classesIncluded: 10, joiningFee: 1000 });
      monthly = await mkPlan(s, { type: 'SUBSCRIPTION', price: 5000, currency: 'USD', joiningFee: 2000 });
    });

    it('with joining fees off: no fee shown, previewed or charged', async () => {
      const student = await mkStudent(s, 'card-off');
      const academy = await as(tokens['card-off']).get(`/v1/academies/${s.school.id}`);
      expect(academy.body.membershipPlans.find((p: { id: string }) => p.id === pack.id).joiningFee).toBeNull();
      expect((await preview(tokens['card-off'], pack.id)).body).toEqual({ joiningFee: 0, refundable: false, cardSurchargeAmount: 0 });
      const res = await buy(tokens['card-off'], pack.id);
      expect(res.status).toBe(201);
      // 1999 + 2.5% surcharge (50).
      expect(intents.at(-1)!.amount).toBe(2049);
      const t = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
      expect(t).toMatchObject({ studentId: student.id, amount: 1999, joiningFeeAmount: 0, surchargeAmount: 50 });
    });

    describe('with joining fees on', () => {
      beforeAll(async () => {
        await su.school.update({ where: { id: s.school.id }, data: { joiningFeesEnabled: true } });
      });

      it('shows the fee on the School page and previews it with its surcharge', async () => {
        await mkStudent(s, 'card-first');
        const academy = await as(tokens['card-first']).get(`/v1/academies/${s.school.id}`);
        expect(academy.body.membershipPlans.find((p: { id: string }) => p.id === pack.id)).toMatchObject({ joiningFee: 1000, joiningFeeRefundable: false });
        // 2.5% of 2999 is 75, of 1999 is 50: the fee adds 25.
        expect((await preview(tokens['card-first'], pack.id)).body).toEqual({ joiningFee: 1000, refundable: false, cardSurchargeAmount: 25 });
      });

      it('adds it to a first card payment, with the surcharge on price and fee together', async () => {
        const res = await buy(tokens['card-first'], pack.id);
        expect(res.status).toBe(201);
        expect(intents.at(-1)!.amount).toBe(3074);
        const t = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
        expect(t).toMatchObject({ amount: 2999, joiningFeeAmount: 1000, joiningFeeRefundable: false, surchargeAmount: 75 });
      });

      it('puts it on its own line in hosted Checkout', async () => {
        await mkStudent(s, 'card-checkout');
        const res = await buy(tokens['card-checkout'], pack.id, { useHostedCheckout: true });
        expect(res.status).toBe(201);
        const lines = sessions.at(-1)!.line_items.map((l) => [l.price_data.product_data.name, l.price_data.unit_amount]);
        expect(lines).toEqual([
          [expect.any(String), 1999],
          ['Joining fee', 1000],
          ['Card surcharge', 75],
        ]);
        expect(await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } })).toMatchObject({ amount: 2999, joiningFeeAmount: 1000 });
      });

      it("puts it on a Subscription's first invoice only, with its own surcharge", async () => {
        await mkStudent(s, 'card-monthly');
        const res = await buy(tokens['card-monthly'], monthly.id);
        expect(res.status).toBe(201);
        const sent = subscriptions.at(-1)!;
        // The plan and its monthly surcharge recur; the fee and its surcharge are one-off.
        expect(sent.items.map((i) => i.price_data.unit_amount)).toEqual([5000, 125]);
        expect(sent.add_invoice_items!.map((i) => [i.price_data.product.startsWith('prod_Joining_fee'), i.price_data.unit_amount])).toEqual([
          [true, 2000],
          [false, 50],
        ]);
        expect(sent.add_invoice_items![1].price_data.product).toBe(sent.items[1].price_data.product);
        const t = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
        expect(t).toMatchObject({ amount: 7000, joiningFeeAmount: 2000, surchargeAmount: 175 });
      });

      it('is not charged on a rejoin after a gap', async () => {
        const student = await mkStudent(s, 'card-rejoin');
        await su.membership.create({
          data: { id: randomUUID(), studentId: student.id, membershipPlanId: pack.id, schoolId: s.school.id, frequency: 'ONE_TIME', status: 'EXPIRED', classesRemaining: 0 },
        });
        expect((await preview(tokens['card-rejoin'], pack.id)).body.joiningFee).toBe(0);
        const res = await buy(tokens['card-rejoin'], pack.id);
        expect(await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } })).toMatchObject({ amount: 1999, joiningFeeAmount: 0 });
      });

      it('still charges it after only a Friend Pass the School gave', async () => {
        const student = await mkStudent(s, 'card-friend');
        const friend = await mkPlan(s, { type: 'FRIEND_PASS', price: 0, classesIncluded: 1 });
        await su.membership.create({ data: { id: randomUUID(), studentId: student.id, membershipPlanId: friend.id, schoolId: s.school.id, frequency: 'ONE_TIME', classesRemaining: 1 } });
        expect((await preview(tokens['card-friend'], pack.id)).body.joiningFee).toBe(1000);
      });

      it("previews a child's fee for their parent, and refuses anyone else", async () => {
        const child = await mkStudent(s, 'card-child');
        await su.user.update({ where: { id: child.id }, data: { dateOfBirth: new Date(Date.now() - 10 * 365 * 24 * 3600 * 1000) } });
        const parent = await mkUser('card-parent');
        await su.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: child.id } });
        tokens['card-parent'] = sign(parent, 'STUDENT', null);
        expect((await preview(tokens['card-parent'], pack.id, child.id)).body.joiningFee).toBe(1000);
        const other = await mkStudent(s, 'card-other');
        expect((await preview(tokens['card-other'], pack.id, child.id)).status).toBe(403);
        expect(other.id).toBeTruthy();
        expect((await preview(s.owner, pack.id, child.id)).body.joiningFee).toBe(1000);
      });
    });
  });

  describe('paid in cash', () => {
    let s: School;
    let pack: { id: string };
    let refundablePack: { id: string };
    let weekly: { id: string };
    beforeAll(async () => {
      s = await mkSchool('cash', 'CASH', { defaultCurrency: 'GBP', addressCountry: 'GB', joiningFeesEnabled: true });
      pack = await mkPlan(s, { type: 'CLASS_PACK', price: 4000, currency: 'GBP', classesIncluded: 10, joiningFee: 1500 });
      refundablePack = await mkPlan(s, { type: 'CLASS_PACK', price: 4000, currency: 'GBP', classesIncluded: 10, joiningFee: 1500, joiningFeeRefundable: true });
      weekly = await mkPlan(s, { type: 'WEEKLY_PASS', price: 2000, currency: 'GBP', expiryDurationDays: 7, joiningFee: 1500 });
    });

    it('adds it to a first desk sale, and not to the next plan sold', async () => {
      const student = await mkStudent(s, 'desk-first');
      expect((await preview(s.owner, pack.id, student.id)).body).toEqual({ joiningFee: 1500, refundable: false, cardSurchargeAmount: 0 });
      const sale = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${student.id}/memberships/sell`, { membershipPlanId: pack.id, paymentMethod: 'CASH' });
      expect(sale.status).toBe(201);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: sale.body.transactionId } })).toMatchObject({ amount: 5500, joiningFeeAmount: 1500, joiningFeeRefundable: false });
      const next = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${student.id}/memberships/sell`, { membershipPlanId: weekly.id, paymentMethod: 'CASH' });
      expect(next.status).toBe(201);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: next.body.transactionId } })).toMatchObject({ amount: 2000, joiningFeeAmount: 0 });

      // A non-refundable fee is left out of the refund: 4000 can go back, no more.
      const tooMuch = await as(s.owner).post(`/v1/transactions/${sale.body.transactionId}/refund`, { amount: 4001, notes: 'Moved away' });
      expect(tooMuch.status).toBe(400);
      expect(tooMuch.body.error.code).toBe('REFUND_MORE_THAN_LEFT');
      const back = await as(s.owner).post(`/v1/transactions/${sale.body.transactionId}/refund`, { amount: 4000, notes: 'Moved away' });
      expect(back.status).toBe(201);
      expect(back.body).toMatchObject({ refundedAmount: 4000, status: 'REFUNDED' });
    });

    it('refunds a refundable fee with the payment', async () => {
      const student = await mkStudent(s, 'desk-refundable');
      const sale = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${student.id}/memberships/sell`, { membershipPlanId: refundablePack.id, paymentMethod: 'CASH' });
      expect(await su.transaction.findUniqueOrThrow({ where: { id: sale.body.transactionId } })).toMatchObject({ amount: 5500, joiningFeeAmount: 1500, joiningFeeRefundable: true });
      const back = await as(s.owner).post(`/v1/transactions/${sale.body.transactionId}/refund`, { amount: 5500, notes: 'Changed mind' });
      expect(back.status).toBe(201);
      expect(back.body).toMatchObject({ refundedAmount: 5500, status: 'REFUNDED' });
    });

    it("adds it to the member's own Cash order, which then counts as their first plan", async () => {
      await mkStudent(s, 'cash-order');
      const first = await buy(tokens['cash-order'], pack.id);
      expect(first.status).toBe(201);
      expect(first.body.outcome).toBe('pending_confirmation');
      expect(await su.transaction.findUniqueOrThrow({ where: { id: first.body.transactionId } })).toMatchObject({ amount: 5500, joiningFeeAmount: 1500, status: 'PENDING' });
      expect((await preview(tokens['cash-order'], weekly.id)).body.joiningFee).toBe(0);
      const second = await buy(tokens['cash-order'], weekly.id);
      expect(await su.transaction.findUniqueOrThrow({ where: { id: second.body.transactionId } })).toMatchObject({ amount: 2000, joiningFeeAmount: 0 });
    });

    it('charges nothing while joining fees are off, keeping the amounts on the plans', async () => {
      await su.school.update({ where: { id: s.school.id }, data: { joiningFeesEnabled: false } });
      try {
        const student = await mkStudent(s, 'desk-off');
        const sale = await as(s.owner).post(`/v1/schools/${s.school.id}/students/${student.id}/memberships/sell`, { membershipPlanId: pack.id, paymentMethod: 'CASH' });
        expect(await su.transaction.findUniqueOrThrow({ where: { id: sale.body.transactionId } })).toMatchObject({ amount: 4000, joiningFeeAmount: 0 });
        expect((await su.membershipPlan.findUniqueOrThrow({ where: { id: pack.id } })).joiningFee).toBe(1500);
      } finally {
        await su.school.update({ where: { id: s.school.id }, data: { joiningFeesEnabled: true } });
      }
    });
  });
});
