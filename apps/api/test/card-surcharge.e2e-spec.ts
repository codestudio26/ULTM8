/**
 * Card surcharge (backlog 3.8, Decision 406) over real HTTP against a real
 * Postgres:
 * - Platform Admin's country allow-list starts empty; Billing & Payments Ops
 *   and Full Admins change it (audit-logged), Support only reads it;
 * - the School owner's setting is refused while the School's country isn't
 *   listed, above 3%, or without the legal confirmation;
 * - a one-off card payment is charged the surcharge as a separate amount
 *   (its own Checkout line, Transaction.surchargeAmount), shown on the plan
 *   before paying; never on cash or a bank transfer;
 * - a Subscription carries it as its own recurring item: its first payment
 *   and each renewal record it apart from the plan's price (from the
 *   invoice's own surcharge line), a refund in Stripe counts it, and the
 *   School changing its rate leaves a running Subscription as it is;
 * - removing the country stops it, keeping the School's stored %.
 *
 * Stripe is faked (StripeClientService.scopedClient), recording what was sent.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * DATABASE_URL_DISCOVERY, PLATFORM_ADMIN_JWT_SECRET, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { Job } from 'bullmq';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { fakeIncompleteSubscription, fakePaymentCheckoutSession, fakeSubscriptionInvoice } from './stripe-fakes';

const DATABASE_URL = process.env.DATABASE_URL;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(
  DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_PLATFORM_ADMIN && process.env.DATABASE_URL_DISCOVERY && PLATFORM_ADMIN_JWT_SECRET && JWT_ACCESS_SECRET,
);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[card-surcharge.e2e-spec] Skipped — database / JWT environment not set.');
}

/** A country nothing else in the suite uses, so a parallel run can't see it listed. */
const COUNTRY = 'UY';

describeIfDb('Card surcharge (Decision 406)', () => {
  let app: INestApplication;
  let processor: StripeWebhookProcessingProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const adminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  const tag = `surcharge-${randomUUID().slice(0, 8)}`;
  const token: Record<string, string> = {};
  const adminIds: string[] = [];
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  let card: { id: string };
  let cash: { id: string };
  let student: { id: string; email: string };
  let pack: { id: string };
  let monthly: { id: string };
  let cashPack: { id: string };

  // Every Stripe call made, for the assertions below.
  const intents: Array<{ amount: number; metadata?: Record<string, string> }> = [];
  const sessions: Array<{ line_items: Array<{ price_data: { unit_amount: number; product_data: { name: string } } }> }> = [];
  type SubscriptionItemParams = { price?: string; price_data?: { unit_amount: number; product: string; currency: string; recurring: { interval: string } } };
  const subscriptions: Array<{ items: SubscriptionItemParams[]; metadata?: Record<string, string> }> = [];
  const products: Array<{ id: string; name: string }> = [];
  /** What invoices.retrieve / charges.retrieve hand the webhook processor, by id. */
  const invoices = new Map<string, object>();
  const charges = new Map<string, object>();
  const subscriptionUpdates: unknown[] = [];
  const subscriptionCancels: string[] = [];
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      paymentIntents: {
        create: jest.fn(async (params: { amount: number; metadata?: Record<string, string>; confirm?: boolean }) => {
          intents.push(params);
          return { id: `pi_${randomUUID()}`, client_secret: 'secret', status: params.confirm ? 'succeeded' : 'requires_payment_method' };
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
      customers: {
        create: jest.fn(async () => ({ id: `cus_${randomUUID()}` })),
        retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })),
      },
      products: {
        create: jest.fn(async (params: { name: string }) => {
          const product = { id: `prod_${randomUUID()}`, name: params.name };
          products.push(product);
          return product;
        }),
      },
      subscriptions: {
        // The first invoice charges each item's price, one line per item.
        create: jest.fn(async (params: (typeof subscriptions)[number]) => {
          subscriptions.push(params);
          return fakeIncompleteSubscription(undefined, params.items.map((i) => ({ amount: i.price_data?.unit_amount ?? 0, product: i.price_data?.product ?? 'prod_plan' })));
        }),
        update: jest.fn(async (...args: unknown[]) => {
          subscriptionUpdates.push(args);
          return {};
        }),
        cancel: jest.fn(async (id: string) => {
          subscriptionCancels.push(id);
          return { id, status: 'canceled' };
        }),
      },
      invoices: { retrieve: jest.fn(async (id: string) => invoices.get(id)) },
      charges: { retrieve: jest.fn(async (id: string) => charges.get(id)) },
    })),
    platformClient: jest.fn(),
  };

  const http = () => request(app.getHttpServer());
  const asAdmin = (label: string) => ({
    get: (path: string) => http().get(`/v1/platform-admin/card-surcharge-countries${path}`).set('Authorization', `Bearer ${token[label]}`),
    post: (body: object) => http().post('/v1/platform-admin/card-surcharge-countries').set('Authorization', `Bearer ${token[label]}`).send(body),
    delete: (code: string) => http().delete(`/v1/platform-admin/card-surcharge-countries/${code}`).set('Authorization', `Bearer ${token[label]}`),
  });
  const setting = (label: string, schoolId = card.id) => ({
    get: () => http().get(`/v1/schools/${schoolId}/card-surcharge`).set('Authorization', `Bearer ${token[label]}`),
    put: (body: object) => http().put(`/v1/schools/${schoolId}/card-surcharge`).set('Authorization', `Bearer ${token[label]}`).send(body),
  });
  const buy = (planId: string, body: object = {}) => http().post(`/v1/membership-plans/${planId}/purchase`).set('Authorization', `Bearer ${token.student}`).send(body);
  const academyPlans = async (schoolId: string) => {
    const res = await http().get(`/v1/academies/${schoolId}`).set('Authorization', `Bearer ${token.student}`);
    expect(res.status).toBe(200);
    return res.body.membershipPlans as Array<{ id: string; price: number; cardSurchargeAmount: number }>;
  };
  const transaction = (id: string) => su.transaction.findUniqueOrThrow({ where: { id } });
  const eventIds: string[] = [];
  /** Runs one Stripe webhook job on the card School's connected account. */
  const webhook = async (eventType: string, objectId: string) => {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    const account = await su.paymentAccount.findUniqueOrThrow({ where: { schoolId: card.id } });
    await processor.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: account.stripeConnectedAccountId } } as unknown as Job);
  };
  const invoiceEvent = (eventType: 'invoice.paid' | 'invoice.payment_failed', invoice: { id: string }) => {
    invoices.set(invoice.id, invoice);
    return webhook(eventType, invoice.id);
  };

  const mkUser = async (label: string) => {
    const u = await su.user.create({
      data: {
        id: randomUUID(), email: `${tag}-${label}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label, surname: 'Surcharge', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  };
  const grant = async (label: string, user: { id: string; email: string }, role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT' | 'BRANCH_STAFF', schoolId: string, branchId: string | null = null) => {
    await su.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId, branchId } });
    token[label] = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId }] });
  };
  const admin = async (label: string, subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN') => {
    const a = await su.adminUser.create({ data: { id: randomUUID(), email: `${tag}-${label}@example.test`, name: label, subRole, ssoSubject: `cognito-sub-${randomUUID()}` } });
    adminIds.push(a.id);
    token[label] = adminJwt.sign({ sub: a.id, email: a.email, subRole });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    processor = app.get(StripeWebhookProcessingProcessor);
    await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });

    card = await su.school.create({ data: { id: randomUUID(), name: `${tag}-card`, addressCountry: COUNTRY, defaultCurrency: 'USD' } });
    cash = await su.school.create({ data: { id: randomUUID(), name: `${tag}-cash`, addressCountry: COUNTRY, defaultCurrency: 'USD' } });
    schoolIds.push(card.id, cash.id);
    const branch = await su.branch.create({ data: { id: randomUUID(), schoolId: card.id, name: 'Main' } });
    await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: card.id, provider: 'STRIPE', accountTitle: 'Card', country: COUNTRY, stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
    });
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: cash.id, provider: 'CASH', accountTitle: 'Cash', country: COUNTRY } });
    pack = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: card.id, type: 'CLASS_PACK', title: '10-Class Pack', price: 1999, classesIncluded: 10, currency: 'USD' } });
    monthly = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: card.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000, currency: 'USD' } });
    cashPack = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: cash.id, type: 'CLASS_PACK', title: 'Cash Pack', price: 1999, classesIncluded: 10, currency: 'USD' } });

    const owner = await mkUser('owner');
    const staff = await mkUser('staff');
    const cashOwner = await mkUser('cashOwner');
    student = await mkUser('student');
    await grant('owner', owner, 'SCHOOL_OWNER_MANAGER', card.id);
    await grant('staff', staff, 'BRANCH_STAFF', card.id, branch.id);
    await grant('cashOwner', cashOwner, 'SCHOOL_OWNER_MANAGER', cash.id);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: cash.id } });
    await grant('student', student, 'STUDENT', card.id);
    await admin('full', 'FULL_ADMIN');
    await admin('billing', 'BILLING_PAYMENTS_OPS');
    await admin('support', 'SUPPORT');
  });

  afterAll(async () => {
    await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
    await su.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    const where = { schoolId: { in: schoolIds } };
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.transaction.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where });
    await su.branch.deleteMany({ where });
    await su.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  it('is off by default: the country is not listed, so the setting is unavailable and refused', async () => {
    const res = await setting('owner').get();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, country: COUNTRY, enabled: false, bps: 0, applies: false });
    const put = await setting('owner').put({ enabled: true, bps: 200, legalConfirmed: true });
    expect(put.status).toBe(400);
    expect(put.body.error.message).toBe("Card surcharges are not allowed in your School's country.");
    expect((await academyPlans(card.id)).find((p) => p.id === pack.id)?.cardSurchargeAmount).toBe(0);
  });

  it('only Billing & Payments Ops and Full Admins change the allow-list; Support reads it; a tenant token gets nothing', async () => {
    expect((await asAdmin('support').post({ countryCode: COUNTRY })).status).toBe(403);
    expect((await asAdmin('support').get('')).status).toBe(200);
    expect((await http().get('/v1/platform-admin/card-surcharge-countries').set('Authorization', `Bearer ${token.owner}`)).status).toBe(401);
    expect((await asAdmin('billing').post({ countryCode: 'XX' })).status).toBe(400);

    const added = await asAdmin('billing').post({ countryCode: COUNTRY.toLowerCase() });
    expect(added.status).toBe(201);
    expect(added.body.countryCode).toBe(COUNTRY);
    // Adding it again changes nothing.
    expect((await asAdmin('full').post({ countryCode: COUNTRY })).status).toBe(201);
    const list = await asAdmin('support').get('');
    expect(list.body.items.map((c: { countryCode: string }) => c.countryCode)).toContain(COUNTRY);

    expect((await asAdmin('support').delete(COUNTRY)).status).toBe(403);
    const logged = await su.auditLogEntry.findMany({ where: { adminUserId: { in: adminIds }, targetId: COUNTRY } });
    expect(logged.map((l) => l.action)).toEqual(['ADD_CARD_SURCHARGE_COUNTRY']);
  });

  it('refuses the School setting above 3%, at 0% when on, without the confirmation, and from anyone but the owner', async () => {
    expect((await setting('owner').get()).body.available).toBe(true);
    expect((await setting('owner').put({ enabled: true, bps: 301, legalConfirmed: true })).status).toBe(400);
    expect((await setting('owner').put({ enabled: true, bps: 0, legalConfirmed: true })).status).toBe(400);
    const unconfirmed = await setting('owner').put({ enabled: true, bps: 250 });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.error.message).toBe('Confirm that card surcharges are legal where your School operates.');
    expect((await setting('owner').put({ enabled: true, bps: 250, legalConfirmed: false })).status).toBe(400);
    expect((await setting('staff').put({ enabled: true, bps: 250, legalConfirmed: true })).status).toBe(403);
    expect((await setting('staff').get()).status).toBe(403);
    expect((await setting('cashOwner', card.id).put({ enabled: true, bps: 250, legalConfirmed: true })).status).toBe(403);

    const saved = await setting('owner').put({ enabled: true, bps: 250, legalConfirmed: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ available: true, enabled: true, bps: 250, applies: true });
    expect(saved.body.confirmedAt).toBeTruthy();
  });

  it('shows the surcharge on each plan before paying, a Subscription\'s monthly one included', async () => {
    const plans = await academyPlans(card.id);
    // 2.5% of 19.99 is 0.49975, charged as 0.50.
    expect(plans.find((p) => p.id === pack.id)?.cardSurchargeAmount).toBe(50);
    // 2.5% of 50.00 a month.
    expect(plans.find((p) => p.id === monthly.id)?.cardSurchargeAmount).toBe(125);
  });

  it('charges it as its own Checkout line and keeps it apart on the Transaction', async () => {
    const res = await buy(pack.id, { useHostedCheckout: true });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('requires_checkout');
    const session = sessions[sessions.length - 1];
    expect(session.line_items.map((l) => l.price_data.unit_amount)).toEqual([1999, 50]);
    expect(session.line_items[1].price_data.product_data.name).toBe('Card surcharge');
    const tx = await transaction(res.body.transactionId);
    expect(tx).toMatchObject({ amount: 1999, surchargeAmount: 50, paymentMethod: 'STRIPE', status: 'PENDING' });

    // The member's own history shows the line.
    const mine = await http().get('/v1/transactions/me').set('Authorization', `Bearer ${token.student}`);
    expect(mine.body.items.find((t: { id: string }) => t.id === tx.id)).toMatchObject({ amount: 1999, surchargeAmount: 50 });
    // And the owner's ledger.
    const ledger = await http().get(`/v1/schools/${card.id}/transactions`).set('Authorization', `Bearer ${token.owner}`);
    expect(ledger.body.items.find((t: { id: string }) => t.id === tx.id)).toMatchObject({ surchargeAmount: 50 });
  });

  it('adds it to a card PaymentIntent too, with the plan price kept apart', async () => {
    const res = await buy(pack.id);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('requires_payment');
    expect(intents[intents.length - 1]).toMatchObject({ amount: 2049, metadata: { surchargeAmount: '50' } });
    expect(await transaction(res.body.transactionId)).toMatchObject({ amount: 1999, surchargeAmount: 50 });
  });

  it('adds it to a saved-card charge', async () => {
    await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: student.id, schoolId: card.id, stripeCustomerId: `cus_${randomUUID()}` } });
    await su.user.update({ where: { id: student.id }, data: { passcodeHash: await bcrypt.hash('246810', 4) } });
    const proof = await http().post('/v1/auth/step-up/verify').set('Authorization', `Bearer ${token.student}`).send({ passcode: '246810' });
    expect(proof.status).toBe(201);
    const res = await buy(pack.id, { payWithSavedCard: true }).set('X-Step-Up-Token', proof.body.stepUpToken);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('active');
    expect(intents[intents.length - 1]).toMatchObject({ amount: 2049, off_session: true });
    expect(await transaction(res.body.transactionId)).toMatchObject({ amount: 1999, surchargeAmount: 50, status: 'SUCCESSFUL' });
  });

  describe('a Subscription', () => {
    let subscriptionId: string;
    let surchargeProduct: string;
    let snapshot: Record<string, string>;
    const renewal = (opts: { id?: string; pi?: string; paid?: boolean } = {}) =>
      fakeSubscriptionInvoice({
        subscriptionId,
        id: opts.id,
        paymentIntentId: opts.pi ?? `pi_${randomUUID()}`,
        paid: opts.paid,
        subscriptionMetadata: snapshot,
        lines: [
          { amount: 5000, product: 'prod_plan' },
          { amount: 125, product: surchargeProduct },
        ],
      });

    it("adds it as its own recurring item, and keeps the first payment's surcharge apart on the Transaction", async () => {
      const res = await buy(monthly.id);
      expect(res.status).toBe(201);
      expect(res.body.outcome).toBe('requires_payment');
      const sent = subscriptions[subscriptions.length - 1];
      expect(sent.items).toHaveLength(2);
      expect(sent.items[0].price_data).toMatchObject({ unit_amount: 5000, recurring: { interval: 'month' } });
      // The surcharge's own monthly item, on its own "Card surcharge" product,
      // so each Stripe invoice and receipt shows it as its own line.
      expect(sent.items[1].price_data).toMatchObject({ unit_amount: 125, currency: 'usd', recurring: { interval: 'month' } });
      surchargeProduct = sent.items[1].price_data!.product;
      expect(products.find((p) => p.id === surchargeProduct)?.name).toBe('Card surcharge');
      // Kept on the Subscription, so each invoice's snapshot names its line.
      expect(sent.metadata).toEqual({ cardSurchargeProduct: surchargeProduct, cardSurchargeBps: '250', surchargeAmount: '125' });
      snapshot = sent.metadata!;

      const tx = await transaction(res.body.transactionId);
      expect(tx).toMatchObject({ amount: 5000, surchargeAmount: 125, paymentMethod: 'STRIPE', status: 'PENDING' });
      subscriptionId = tx.stripeSubscriptionId!;

      // The first payment goes through: the Membership starts, the row keeps both parts.
      await webhook('payment_intent.succeeded', tx.stripePaymentIntentId!);
      expect(await transaction(tx.id)).toMatchObject({ status: 'SUCCESSFUL', amount: 5000, surchargeAmount: 125 });
      expect(await su.membership.count({ where: { stripeSubscriptionId: subscriptionId, status: 'ACTIVE' } })).toBe(1);
      const mine = await http().get('/v1/transactions/me').set('Authorization', `Bearer ${token.student}`);
      expect(mine.body.items.find((t: { id: string }) => t.id === tx.id)).toMatchObject({ amount: 5000, surchargeAmount: 125 });
    });

    it("records each renewal's surcharge line apart from the plan's price", async () => {
      const invoice = renewal();
      await invoiceEvent('invoice.paid', invoice);
      const row = await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } });
      expect(row).toMatchObject({ kind: 'RENEWAL', status: 'SUCCESSFUL', amount: 5000, surchargeAmount: 125, currency: 'USD' });
      const ledger = await http().get(`/v1/schools/${card.id}/transactions`).set('Authorization', `Bearer ${token.owner}`);
      expect(ledger.body.items.find((t: { id: string }) => t.id === row.id)).toMatchObject({ kind: 'RENEWAL', amount: 5000, surchargeAmount: 125 });
    });

    it('a failed renewal keeps both parts, and so does the retry that pays it', async () => {
      const id = `in_${randomUUID()}`;
      const pi = `pi_${randomUUID()}`;
      await invoiceEvent('invoice.payment_failed', renewal({ id, pi, paid: false }));
      expect(await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: id } })).toMatchObject({ status: 'FAILED', amount: 5000, surchargeAmount: 125 });
      await invoiceEvent('invoice.paid', renewal({ id, pi }));
      expect(await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: id } })).toMatchObject({ status: 'SUCCESSFUL', amount: 5000, surchargeAmount: 125 });
    });

    it('the School changing its rate leaves a running Subscription as it is; a new one takes the new rate', async () => {
      const saved = await setting('owner').put({ enabled: true, bps: 100, legalConfirmed: true });
      expect(saved.status).toBe(200);
      expect(subscriptionUpdates).toHaveLength(0);
      // Stripe still charges the item the Subscription started with: recorded from the invoice.
      const invoice = renewal();
      await invoiceEvent('invoice.paid', invoice);
      expect(await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } })).toMatchObject({ amount: 5000, surchargeAmount: 125 });

      // A new Subscription takes 1% (bought, not paid: the purchase only starts
      // it). The running one is set aside meanwhile: one general-access
      // Membership at a time.
      await su.membership.updateMany({ where: { stripeSubscriptionId: subscriptionId }, data: { status: 'EXPIRED' } });
      const res = await buy(monthly.id);
      await su.membership.updateMany({ where: { stripeSubscriptionId: subscriptionId }, data: { status: 'ACTIVE' } });
      expect(res.status).toBe(201);
      const sent = subscriptions[subscriptions.length - 1];
      expect(sent.items[1].price_data?.unit_amount).toBe(50);
      expect(sent.metadata).toMatchObject({ cardSurchargeBps: '100', surchargeAmount: '50' });
      expect(await transaction(res.body.transactionId)).toMatchObject({ amount: 5000, surchargeAmount: 50 });
      await su.transaction.update({ where: { id: res.body.transactionId }, data: { status: 'FAILED' } });
      expect((await setting('owner').put({ enabled: true, bps: 250, legalConfirmed: true })).status).toBe(200);
    });

    it('a renewal refunded in full in Stripe counts the surcharge as refunded', async () => {
      const pi = `pi_${randomUUID()}`;
      const invoice = renewal({ pi });
      await invoiceEvent('invoice.paid', invoice);
      const chargeId = `ch_${randomUUID()}`;
      charges.set(chargeId, { id: chargeId, object: 'charge', payment_intent: pi, amount: 5125, amount_refunded: 5125, currency: 'usd' });
      await webhook('charge.refunded', chargeId);
      expect(await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } })).toMatchObject({
        status: 'REFUNDED',
        refundedAmount: 5125,
        amount: 5000,
        surchargeAmount: 125,
      });
      // A refunded renewal ends the Membership and cancels its Subscription.
      expect(subscriptionCancels).toContain(subscriptionId);
    });

    it('a Subscription started with no surcharge has one item, and its renewals record none', async () => {
      await su.school.update({ where: { id: card.id }, data: { cardSurchargeEnabled: false } });
      const res = await buy(monthly.id);
      expect(res.status).toBe(201);
      const sent = subscriptions[subscriptions.length - 1];
      expect(sent.items).toHaveLength(1);
      expect(sent.metadata).toBeUndefined();
      const tx = await transaction(res.body.transactionId);
      expect(tx).toMatchObject({ amount: 5000, surchargeAmount: 0 });
      await su.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });

      const plain = tx.stripeSubscriptionId!;
      await su.membership.create({
        data: { id: randomUUID(), studentId: student.id, membershipPlanId: monthly.id, schoolId: card.id, frequency: 'RECURRING', stripeSubscriptionId: plain },
      });
      const invoice = fakeSubscriptionInvoice({ subscriptionId: plain, paymentIntentId: `pi_${randomUUID()}`, lines: [{ amount: 5000, product: 'prod_plan' }] });
      await invoiceEvent('invoice.paid', invoice);
      expect(await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } })).toMatchObject({ amount: 5000, surchargeAmount: 0 });
      await su.membership.updateMany({ where: { stripeSubscriptionId: plain }, data: { status: 'EXPIRED' } });
      await su.school.update({ where: { id: card.id }, data: { cardSurchargeEnabled: true } });
    });
  });

  it('never applies to cash or a bank transfer, even with the setting on', async () => {
    await su.school.update({ where: { id: cash.id }, data: { cardSurchargeEnabled: true, cardSurchargeBps: 300 } });
    expect((await academyPlans(cash.id)).find((p) => p.id === cashPack.id)?.cardSurchargeAmount).toBe(0);
    const res = await buy(cashPack.id);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('pending_confirmation');
    expect(await transaction(res.body.transactionId)).toMatchObject({ amount: 1999, surchargeAmount: 0, paymentMethod: 'CASH' });
  });

  it('stops when the country is removed, keeping the School\'s stored %', async () => {
    const removed = await asAdmin('full').delete(COUNTRY);
    expect(removed.status).toBe(204);
    expect((await asAdmin('full').delete(COUNTRY)).status).toBe(404);
    const logged = await su.auditLogEntry.findMany({ where: { adminUserId: { in: adminIds }, targetId: COUNTRY }, orderBy: { createdAt: 'asc' } });
    expect(logged.map((l) => l.action)).toEqual(['ADD_CARD_SURCHARGE_COUNTRY', 'REMOVE_CARD_SURCHARGE_COUNTRY']);

    expect((await setting('owner').get()).body).toMatchObject({ available: false, enabled: true, bps: 250, applies: false });
    expect((await setting('owner').put({ enabled: false, bps: 250 })).status).toBe(400);
    expect((await academyPlans(card.id)).find((p) => p.id === pack.id)?.cardSurchargeAmount).toBe(0);

    const res = await buy(pack.id, { useHostedCheckout: true });
    expect(res.status).toBe(201);
    expect(sessions[sessions.length - 1].line_items.map((l) => l.price_data.unit_amount)).toEqual([1999]);
    expect(await transaction(res.body.transactionId)).toMatchObject({ amount: 1999, surchargeAmount: 0 });
    const stored = await su.school.findUniqueOrThrow({ where: { id: card.id }, select: { cardSurchargeEnabled: true, cardSurchargeBps: true } });
    expect(stored).toEqual({ cardSurchargeEnabled: true, cardSurchargeBps: 250 });
  });
});
