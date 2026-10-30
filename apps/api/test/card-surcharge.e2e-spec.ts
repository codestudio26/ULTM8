/**
 * Card surcharge (backlog 3.8, Decision 406) over real HTTP against a real
 * Postgres:
 * - Platform Admin's country allow-list starts empty; Billing & Payments Ops
 *   and Full Admins change it (audit-logged), Support only reads it;
 * - the School owner's setting is refused while the School's country isn't
 *   listed, above 3%, or without the legal confirmation;
 * - a one-off card payment is charged the surcharge as a separate amount
 *   (its own Checkout line, Transaction.surchargeAmount), shown on the plan
 *   before paying; never on cash or a bank transfer, nor on a Subscription;
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
import { StripeClientService } from '../src/payments/stripe-client.service';
import { fakeIncompleteSubscription, fakePaymentCheckoutSession } from './stripe-fakes';

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
  const subscriptions: Array<{ items: Array<{ price_data?: { unit_amount: number } }> }> = [];
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
      products: { create: jest.fn(async () => ({ id: `prod_${randomUUID()}` })) },
      subscriptions: {
        create: jest.fn(async (params: (typeof subscriptions)[number]) => {
          subscriptions.push(params);
          return fakeIncompleteSubscription();
        }),
      },
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

  it('shows the surcharge on each one-off plan before paying, never on a Subscription', async () => {
    const plans = await academyPlans(card.id);
    // 2.5% of 19.99 is 0.49975, charged as 0.50.
    expect(plans.find((p) => p.id === pack.id)?.cardSurchargeAmount).toBe(50);
    expect(plans.find((p) => p.id === monthly.id)?.cardSurchargeAmount).toBe(0);
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

  it('never applies to a Subscription', async () => {
    const res = await buy(monthly.id);
    expect(res.status).toBe(201);
    expect(subscriptions[subscriptions.length - 1].items[0].price_data?.unit_amount).toBe(5000);
    expect(subscriptions[subscriptions.length - 1].items).toHaveLength(1);
    expect(await transaction(res.body.transactionId)).toMatchObject({ amount: 5000, surchargeAmount: 0 });
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
