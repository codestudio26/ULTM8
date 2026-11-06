/**
 * Decision 442 items 2 and 3 over real HTTP and Postgres.
 *
 * Item 2: a School takes card payments only once Stripe says its connected
 * account is ready (PaymentAccount.stripeAccountReady). Until then it behaves
 * as a School that takes no cards: its public profile says so, a card
 * purchase, saving a card and paying charges by card are refused with
 * CARD_PAYMENTS_NOT_READY, a purchase that asks for no card is a cash order
 * staff confirm, a monthly plan is billed to the balance, the desk sells
 * monthly plans, and off-session charges take nothing.
 *
 * Item 3: the School's owners (co-owners too) and Branch Staff given "Can
 * connect Stripe" create the Stripe payment account, start onboarding and
 * read the connection status. Nobody else; the switch is off by default and
 * any owner sets it, as every other access switch.
 *
 * Stripe is faked (no live key in CI).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { CardPaymentsNotReadyError, NoSavedPaymentMethodError, PaymentsService } from '../src/payments/payments.service';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[stripe-ready-card-payments.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const NOT_READY = 'CARD_PAYMENTS_NOT_READY';

describeIfDb('Card payments wait for a ready Stripe account; who may connect Stripe (Decision 442 items 2 and 3)', () => {
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const scoped = {
    checkout: { sessions: { create: jest.fn(async () => ({ id: `cs_${randomUUID()}`, url: 'https://checkout.stripe.test/session' })) } },
    customers: { retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })) },
    paymentIntents: { create: jest.fn(async () => ({ id: `pi_${randomUUID()}`, status: 'succeeded' })) },
  };
  const platform = {
    accounts: {
      retrieve: jest.fn(async (id: string) => ({ id, details_submitted: false, charges_enabled: false, capabilities: { card_payments: 'inactive' } })),
      create: jest.fn(async () => ({ id: `acct_perm_${randomUUID()}` })),
      update: jest.fn(),
      del: jest.fn(),
    },
    accountLinks: { create: jest.fn(async () => ({ url: 'https://connect.stripe.test/onboarding' })) },
  };
  const stripeFake = { platformClient: jest.fn(() => platform), scopedClient: jest.fn(() => scoped), constructWebhookEvent: jest.fn() };
  let app: INestApplication;
  let payments: PaymentsService;
  const env = { ret: process.env.STRIPE_CONNECT_RETURN_URL, refresh: process.env.STRIPE_CONNECT_REFRESH_URL };

  const schoolIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.STRIPE_CONNECT_RETURN_URL = 'https://portal.example.test/payments/connect/return';
    process.env.STRIPE_CONNECT_REFRESH_URL = 'https://portal.example.test/payments/connect/refresh';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(stripeFake).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    payments = app.get(PaymentsService);
  });

  afterAll(async () => {
    process.env.STRIPE_CONNECT_RETURN_URL = env.ret;
    process.env.STRIPE_CONNECT_REFRESH_URL = env.refresh;
    const where = { schoolId: { in: schoolIds } };
    await su.recurringCharge.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.staffActivity.deleteMany({ where });
    await su.staffPermission.deleteMany({ where });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

  async function person(role: Role, schoolId: string, extra: { isMainOwner?: boolean } = {}) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `stripe-ready-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: role,
        surname: 'Ready',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    await su.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId, ...extra } });
    return { id: user.id, token: jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] }) };
  }

  async function school() {
    const row = await su.school.create({
      data: { id: randomUUID(), name: `Ready Card School ${randomUUID().slice(0, 8)}`, addressCountry: 'GB', defaultCurrency: 'GBP', timezone: 'UTC' },
    });
    schoolIds.push(row.id);
    const owner = await person('SCHOOL_OWNER_MANAGER', row.id, { isMainOwner: true });
    return { schoolId: row.id, owner };
  }

  /** A School connected to Stripe, whose account Stripe hasn't said is ready. */
  async function connectedSchool() {
    const s = await school();
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_notready_${randomUUID()}` },
    });
    const pack = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Five classes', price: 5000, currency: 'GBP', classesIncluded: 5 } });
    const monthly = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Monthly', price: 8000, currency: 'GBP' } });
    return { ...s, account, pack, monthly };
  }

  const http = () => request(app.getHttpServer());
  const get = (path: string, token: string) => http().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string, body: object = {}) => http().post(path).set('Authorization', `Bearer ${token}`).send(body);
  const put = (path: string, token: string, body: object) => http().put(path).set('Authorization', `Bearer ${token}`).send(body);
  const buy = (planId: string, token: string, body: object = {}) => post(`/v1/membership-plans/${planId}/purchase`, token, body);

  describe('item 2: until Stripe says the account is ready, the School takes no cards', () => {
    it('the public profile and the payment account say no cards; ready, they say cards', async () => {
      const s = await connectedSchool();
      const student = await person('STUDENT', s.schoolId);
      const profile = () => get(`/v1/academies/${s.schoolId}`, student.token);
      expect((await profile()).body).toEqual(expect.objectContaining({ cardPayments: false, inBrazil: false }));
      expect((await get(`/v1/schools/${s.schoolId}/payment-account`, s.owner.token)).body).toEqual(expect.objectContaining({ cardPayments: false, stripeAccountReady: false }));

      await su.paymentAccount.update({ where: { id: s.account.id }, data: { stripeAccountReady: true } });
      expect((await profile()).body.cardPayments).toBe(true);
      expect((await get(`/v1/schools/${s.schoolId}/payment-account`, s.owner.token)).body.cardPayments).toBe(true);
    });

    it('a card purchase, saving a card and paying charges by card are refused with a clear code; ready, hosted Checkout goes ahead', async () => {
      const s = await connectedSchool();
      const student = await person('STUDENT', s.schoolId);
      for (const body of [{ useHostedCheckout: true }, { payWithSavedCard: true }]) {
        const res = await buy(s.pack.id, student.token, body);
        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe(NOT_READY);
      }
      const setup = await post(`/v1/schools/${s.schoolId}/payment-methods/setup-session`, student.token);
      expect(setup.status).toBe(400);
      expect(setup.body.error?.code).toBe(NOT_READY);
      const charges = await post(`/v1/students/${student.id}/charges/checkout`, student.token, { schoolId: s.schoolId });
      expect(charges.status).toBe(400);
      expect(charges.body.error?.code).toBe(NOT_READY);
      expect(scoped.checkout.sessions.create).not.toHaveBeenCalled();
      expect(await su.transaction.count({ where: { schoolId: s.schoolId } })).toBe(0);

      await su.paymentAccount.update({ where: { id: s.account.id }, data: { stripeAccountReady: true } });
      const card = await buy(s.pack.id, student.token, { useHostedCheckout: true });
      expect(card.status).toBe(201);
      expect(card.body).toEqual(expect.objectContaining({ outcome: 'requires_checkout', checkoutUrl: 'https://checkout.stripe.test/session' }));
      expect((await post(`/v1/schools/${s.schoolId}/payment-methods/setup-session`, student.token)).status).toBe(201);
    });

    it('a purchase that asks for no card is an order paid at the School, confirmed by staff', async () => {
      const s = await connectedSchool();
      const student = await person('STUDENT', s.schoolId);
      const order = await buy(s.pack.id, student.token);
      expect(order.status).toBe(201);
      expect(order.body.outcome).toBe('pending_confirmation');
      expect(await su.transaction.findUniqueOrThrow({ where: { id: order.body.transactionId } })).toMatchObject({ status: 'PENDING', paymentMethod: 'CASH', amount: 5000 });
      // A second tap returns the same order.
      expect((await buy(s.pack.id, student.token)).body.transactionId).toBe(order.body.transactionId);
      const confirmed = await http().patch(`/v1/transactions/${order.body.transactionId}/confirm`).set('Authorization', `Bearer ${s.owner.token}`);
      expect(confirmed.status).toBe(200);
      expect(await su.membership.findFirstOrThrow({ where: { studentId: student.id, schoolId: s.schoolId } })).toMatchObject({ status: 'ACTIVE', billedToBalance: false });
    });

    it('a monthly plan is a first-month order, then billed to the balance (Decision 441 item 1); the desk sells it too', async () => {
      const s = await connectedSchool();
      const student = await person('STUDENT', s.schoolId);
      const order = await buy(s.monthly.id, student.token);
      expect(order.status).toBe(201);
      expect(order.body.outcome).toBe('pending_confirmation');
      expect((await http().patch(`/v1/transactions/${order.body.transactionId}/confirm`).set('Authorization', `Bearer ${s.owner.token}`)).status).toBe(200);
      const membership = await su.membership.findFirstOrThrow({ where: { studentId: student.id, schoolId: s.schoolId } });
      expect(membership).toMatchObject({ billedToBalance: true, stripeSubscriptionId: null, frequency: 'RECURRING' });
      expect(await su.recurringCharge.findUnique({ where: { membershipId: membership.id } })).toEqual(expect.objectContaining({ unitAmount: 8000 }));

      const options = await get(`/v1/schools/${s.schoolId}/desk-payments/options`, s.owner.token);
      expect(options.status).toBe(200);
      expect((options.body.plans as Array<{ id: string }>).map((p) => p.id)).toContain(s.monthly.id);

      // Ready: the desk no longer sells monthly plans; they are card Subscriptions in the app.
      await su.paymentAccount.update({ where: { id: s.account.id }, data: { stripeAccountReady: true } });
      const later = await get(`/v1/schools/${s.schoolId}/desk-payments/options`, s.owner.token);
      expect((later.body.plans as Array<{ id: string }>).map((p) => p.id)).not.toContain(s.monthly.id);
      // The member already billed to the balance stays so (Decision 442 item 5's "kept as built").
      expect(await su.membership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ billedToBalance: true, status: 'ACTIVE' });
    });

    it('a plan switch (charged to a saved card) can\'t be set until the account is ready', async () => {
      const s = await connectedSchool();
      const next = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Ten classes', price: 9000, currency: 'GBP', classesIncluded: 10 } });
      const term = await su.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Trial pack', price: 1000, currency: 'GBP', classesIncluded: 2, expiryDurationDays: 30 },
      });
      const set = () => http().patch(`/v1/membership-plans/${term.id}`).set('Authorization', `Bearer ${s.owner.token}`).send({ switchToPlanId: next.id });
      const refused = await set();
      expect(refused.status).toBe(400);
      expect(refused.body.error?.code).toBe('SWITCH_NEEDS_CARDS');
      await su.paymentAccount.update({ where: { id: s.account.id }, data: { stripeAccountReady: true } });
      expect((await set()).status).toBe(200);
    });

    it('an off-session charge (late-cancel, no-show and freeze fees, plan switches) takes nothing: "no card here"', async () => {
      const s = await connectedSchool();
      const student = await person('STUDENT', s.schoolId);
      await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: student.id, schoolId: s.schoolId, stripeCustomerId: `cus_${randomUUID()}` } });
      const attempt = payments.chargeOffSession(student.id, s.schoolId, 500, 'GBP', 'No-show fee');
      await expect(attempt).rejects.toBeInstanceOf(CardPaymentsNotReadyError);
      await expect(payments.chargeOffSession(student.id, s.schoolId, 500, 'GBP', 'No-show fee')).rejects.toBeInstanceOf(NoSavedPaymentMethodError);
      expect(scoped.paymentIntents.create).not.toHaveBeenCalled();

      await su.paymentAccount.update({ where: { id: s.account.id }, data: { stripeAccountReady: true } });
      expect(await payments.chargeOffSession(student.id, s.schoolId, 500, 'GBP', 'No-show fee')).toEqual(expect.objectContaining({ succeeded: true }));
    });

    it('a School that only takes cash or bank transfer keeps its own refusals', async () => {
      const s = await school();
      await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'BANK_TRANSFER', accountTitle: 'Bank', country: 'GB' } });
      const pack = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Pack', price: 5000, currency: 'GBP', classesIncluded: 5 } });
      const student = await person('STUDENT', s.schoolId);
      const res = await buy(pack.id, student.token, { useHostedCheckout: true });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).not.toBe(NOT_READY);
      const charges = await post(`/v1/students/${student.id}/charges/checkout`, student.token, { schoolId: s.schoolId });
      expect(charges.body.error?.code).toBe('CHARGE_NO_CARD_PAYMENTS');
      expect((await get(`/v1/schools/${s.schoolId}/payment-account`, s.owner.token)).body.cardPayments).toBe(false);
    });
  });

  describe('item 3: who can connect Stripe', () => {
    const ACCESS = {
      classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, disciplines: false, checkInRules: false, exportStudents: false,
      freezeMemberships: false, attendanceStats: false, memberFiles: false, importData: false, seeMedicalInfo: false, payroll: false, connectStripe: false,
    };

    /** Create the Stripe account, start onboarding, read the status, as `token`. */
    async function tryConnect(schoolId: string, token: string) {
      const created = await post(`/v1/schools/${schoolId}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'Card', country: 'GB' });
      const id = created.status === 201 ? (created.body.id as string) : (await su.paymentAccount.findUnique({ where: { schoolId } }))?.id;
      const onboard = id ? await post(`/v1/payment-accounts/${id}/connect/onboard`, token) : null;
      const status = await get(`/v1/schools/${schoolId}/payment-account/connect-status`, token);
      return { created: created.status, onboard: onboard?.status ?? null, status: status.status, body: { created: created.body, status: status.body } };
    }

    it('Branch Staff need "Can connect Stripe", off by default; with it they connect, without it they are refused', async () => {
      const s = await school();
      const staff = await person('BRANCH_STAFF', s.schoolId);
      const off = await tryConnect(s.schoolId, staff.token);
      expect(off).toMatchObject({ created: 403, onboard: null, status: 403 });
      expect(off.body.created.error?.code).toBe('STAFF_ACCESS_OFF');
      expect(off.body.created.error?.message).toBe("The School owner hasn't let you connect Stripe.");
      expect((await get(`/v1/schools/${s.schoolId}/staff/me/access`, staff.token)).body.access.connectStripe).toBe(false);

      // An owner switches it on, as any access switch.
      const set = await put(`/v1/schools/${s.schoolId}/staff/${staff.id}/access`, s.owner.token, { ...ACCESS, connectStripe: true });
      expect(set.status).toBe(200);
      expect(set.body.access.connectStripe).toBe(true);
      expect((await get(`/v1/schools/${s.schoolId}/staff/me/access`, staff.token)).body.access.connectStripe).toBe(true);
      expect(await su.staffActivity.count({ where: { schoolId: s.schoolId, targetUserId: staff.id, action: 'ACCESS_CHANGED' } })).toBe(1);

      const on = await tryConnect(s.schoolId, staff.token);
      expect(on).toMatchObject({ created: 201, onboard: 201, status: 200 });
      expect(on.body.status.status).toBe('ACTION_NEEDED');
      const account = await su.paymentAccount.findUniqueOrThrow({ where: { schoolId: s.schoolId } });
      expect(account).toMatchObject({ provider: 'STRIPE', stripeAccountReady: false });
      expect(account.stripeConnectedAccountId).toMatch(/^acct_perm_/);

      // Switched off again: refused again.
      await put(`/v1/schools/${s.schoolId}/staff/${staff.id}/access`, s.owner.token, ACCESS);
      expect((await post(`/v1/payment-accounts/${account.id}/connect/onboard`, staff.token)).status).toBe(403);
      expect((await get(`/v1/schools/${s.schoolId}/payment-account/connect-status`, staff.token)).status).toBe(403);
    });

    it('the switch never lets staff set up cash or bank transfer, which stays the owners\'', async () => {
      const s = await school();
      const staff = await person('BRANCH_STAFF', s.schoolId);
      await put(`/v1/schools/${s.schoolId}/staff/${staff.id}/access`, s.owner.token, { ...ACCESS, connectStripe: true });
      const res = await post(`/v1/schools/${s.schoolId}/payment-accounts`, staff.token, { provider: 'BANK_TRANSFER', accountTitle: 'Bank', country: 'GB' });
      expect(res.status).toBe(403);
      expect(await su.paymentAccount.count({ where: { schoolId: s.schoolId } })).toBe(0);
    });

    it('co-owners connect as the main owner does, and may give the switch; coaches, members, other Schools and their staff cannot connect', async () => {
      const s = await school();
      const coOwner = await person('SCHOOL_OWNER_MANAGER', s.schoolId);
      expect(await tryConnect(s.schoolId, coOwner.token)).toMatchObject({ created: 201, onboard: 201, status: 200 });

      const staff = await person('BRANCH_STAFF', s.schoolId);
      expect((await put(`/v1/schools/${s.schoolId}/staff/${staff.id}/access`, coOwner.token, { ...ACCESS, connectStripe: true })).status).toBe(200);
      // Staff can't give it to themselves or anyone.
      expect((await put(`/v1/schools/${s.schoolId}/staff/${staff.id}/access`, staff.token, { ...ACCESS, connectStripe: true })).status).toBe(403);

      const accountId = (await su.paymentAccount.findUniqueOrThrow({ where: { schoolId: s.schoolId } })).id;
      for (const role of ['INSTRUCTOR', 'STUDENT'] as const) {
        const someone = await person(role, s.schoolId);
        expect((await post(`/v1/payment-accounts/${accountId}/connect/onboard`, someone.token)).status).toBe(403);
        expect((await get(`/v1/schools/${s.schoolId}/payment-account/connect-status`, someone.token)).status).toBe(403);
      }

      // Another School's owner, and its staff with the switch on there.
      const other = await school();
      const otherStaff = await person('BRANCH_STAFF', other.schoolId);
      await put(`/v1/schools/${other.schoolId}/staff/${otherStaff.id}/access`, other.owner.token, { ...ACCESS, connectStripe: true });
      for (const token of [other.owner.token, otherStaff.token]) {
        expect([403, 404]).toContain((await post(`/v1/payment-accounts/${accountId}/connect/onboard`, token)).status);
        expect([403, 404]).toContain((await get(`/v1/schools/${s.schoolId}/payment-account/connect-status`, token)).status);
        expect([403, 404]).toContain((await post(`/v1/schools/${s.schoolId}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'x', country: 'GB' })).status);
      }
      // A switch on at another School gives nothing here, even for someone on staff at both.
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: otherStaff.id, schoolId: s.schoolId } });
      const both = jwt.sign({ sub: otherStaff.id, email: 'x@example.test', grants: [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: s.schoolId, branchId: null }] });
      expect((await get(`/v1/schools/${s.schoolId}/payment-account/connect-status`, both)).status).toBe(403);
    });
  });
});
