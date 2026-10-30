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
import { ChargeAutoPayProcessor } from '../src/jobs/charge-auto-pay.processor';

/**
 * Charges and the member balance, step 2 of 6: paying in the app (v1.3
 * backlog §3.6; Decision 303 items 2 and 4, Decision 338 item 8, Decision
 * 406). Over real HTTP against a real Postgres, with the real webhook
 * processor and notification worker; Stripe is faked
 * (StripeClientService.scopedClient), recording what was sent:
 * - one charge, or the whole balance (oldest due first), by hosted Checkout;
 *   the amount asked is what is owed after credit;
 * - Pending until the payment_intent.succeeded webhook, Failed on
 *   payment_intent.canceled; two sessions never over-pay a charge;
 * - a Guardian pays for a child; strangers, another School and a restricted
 *   account are refused;
 * - the card surcharge as its own line, kept off the balance;
 * - "Pay charges automatically with my saved card" (step-up to turn on) and
 *   the daily charge-auto-pay job: due today, overdue and never tried, tried
 *   once only, switched off, covered by credit.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[charges-pay-in-app.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
/** A country no other suite lists for card surcharges. */
const COUNTRY = 'BO';

type Session = { line_items: Array<{ price_data: { unit_amount: number; product_data: { name: string } } }>; success_url: string; payment_intent_data?: unknown };
type Intent = { amount: number; off_session?: boolean; customer?: string };

describeIfDb('Paying charges in the app (backlog 3.6 step 2)', () => {
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  let autoPay: ChargeAutoPayProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const acct = `acct_${randomUUID().slice(0, 8)}`;

  let card: { id: string };
  let cash: { id: string };
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const eventIds: string[] = [];
  let seq = 0;

  // The fake Stripe: what was sent, and how the next off-session charge ends.
  const sessions: Session[] = [];
  const intents: Intent[] = [];
  const sessionByKey = new Map<string, string>();
  let offSessionStatus: 'succeeded' | 'requires_payment_method' = 'succeeded';
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      checkout: {
        sessions: {
          create: jest.fn(async (params: Session, opts?: { idempotencyKey?: string }) => {
            const key = opts?.idempotencyKey;
            const known = key ? sessionByKey.get(key) : undefined;
            if (known) return { url: `https://checkout.example.test/${known}`, payment_intent: { id: known } };
            sessions.push(params);
            const id = `pi_${randomUUID()}`;
            if (key) sessionByKey.set(key, id);
            return { url: `https://checkout.example.test/${id}`, payment_intent: { id } };
          }),
        },
      },
      paymentIntents: {
        create: jest.fn(async (params: Intent) => {
          intents.push(params);
          return { id: `pi_${randomUUID()}`, status: offSessionStatus };
        }),
      },
      customers: { retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })) },
    })),
    platformClient: jest.fn(),
  };

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: Record<string, unknown>, stepUp?: string) => {
      const req = http().put(url).set('Authorization', `Bearer ${token}`);
      return (stepUp ? req.set('X-Step-Up-Token', stepUp) : req).send(body);
    },
  });
  const sign = (user: { id: string; email: string }, role: string | null, schoolId: string | null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: role ? [{ role, franchiseId: null, schoolId, branchId: null }] : [] });
  const stepUp = (userId: string) => jwt.sign({ sub: userId, scope: 'GUARDIAN_SENSITIVE_ACTION' }, { expiresIn: 300 });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `pay-in-app-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'PayInApp',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }
  async function mkStudent(label: string, schoolId = card.id) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    tokens[label] = sign(user, 'STUDENT', schoolId);
    return user;
  }
  const saveCard = (studentId: string, autoPayCharges = false) =>
    su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId, schoolId: card.id, stripeCustomerId: `cus_${randomUUID()}`, autoPayCharges } });

  const createCharge = async (studentId: string, amount: number, dueDate = day(7), schoolId = card.id) => {
    const res = await as(tokens.owner).post(`/v1/schools/${schoolId}/students/${studentId}/charges`, { description: `Item ${++seq}`, amount, dueDate });
    expect(res.status).toBe(201);
    return res.body as { id: string; invoiceLabel: string; status: string };
  };
  const deskPay = (studentId: string, amount: number) =>
    as(tokens.owner).post(`/v1/schools/${card.id}/students/${studentId}/charge-payments`, { amount, paymentMethod: 'CASH', sendReceipt: false });
  const checkout = (label: string, studentId: string, body: Record<string, unknown> = {}) =>
    as(tokens[label]).post(`/v1/students/${studentId}/charges/checkout`, { schoolId: card.id, ...body });
  const memberView = async (label: string, studentId: string) => {
    const res = await as(tokens[label]).get(`/v1/students/${studentId}/charges`);
    expect(res.status).toBe(200);
    return res.body.schools.find((s: { schoolId: string }) => s.schoolId === card.id);
  };
  const tx = (id: string) => su.transaction.findUniqueOrThrow({ where: { id } });
  const charge = (id: string) => su.charge.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
  const paid = async (id: string) => (await charge(id)).allocations.reduce((n, a) => n + a.amount, 0);

  async function event(eventType: string, paymentIntentId: string) {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType, objectId: paymentIntentId, stripeAccountId: acct }, attemptsMade: 1, opts: { attempts: 3 } } as never);
  }
  const succeed = async (transactionId: string) => event('payment_intent.succeeded', (await tx(transactionId)).stripePaymentIntentId!);

  async function notices(userId: string, expected: number) {
    for (let i = 0; i < 60; i++) {
      const rows = await su.notification.findMany({ where: { userId, type: 'CHARGE' }, orderBy: { createdAt: 'asc' } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return su.notification.findMany({ where: { userId, type: 'CHARGE' }, orderBy: { createdAt: 'asc' } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    webhook = app.get(StripeWebhookProcessingProcessor);
    autoPay = app.get(ChargeAutoPayProcessor);
    await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });

    card = await su.school.create({ data: { id: randomUUID(), name: 'Pay In App School', defaultCurrency: 'BRL', addressCountry: COUNTRY, timezone: 'UTC' } });
    cash = await su.school.create({ data: { id: randomUUID(), name: 'Cash Only School', defaultCurrency: 'BRL', timezone: 'UTC' } });
    schoolIds.push(card.id, cash.id);
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: card.id, provider: 'STRIPE', accountTitle: 'Card', country: COUNTRY, stripeConnectedAccountId: acct } });
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: cash.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });

    const owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: card.id, isMainOwner: true } });
    tokens.owner = sign(owner, 'SCHOOL_OWNER_MANAGER', card.id);
    const cashOwner = await mkUser('cashOwner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: cashOwner.id, schoolId: cash.id, isMainOwner: true } });
    tokens.cashOwner = sign(cashOwner, 'SCHOOL_OWNER_MANAGER', cash.id);
  });

  afterEach(() => {
    offSessionStatus = 'succeeded';
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('Checkout (Decision 303 item 4)', () => {
    it('pays one charge: Pending until the webhook, then paid, with a receipt', async () => {
      const student = await mkStudent('one');
      const c = await createCharge(student.id, 10000);
      const res = await checkout('one', student.id, { chargeId: c.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ amount: 10000, surchargeAmount: 0, currency: 'BRL' });
      expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.example\.test\//);
      const session = sessions[sessions.length - 1];
      expect(session.line_items.map((l) => l.price_data.unit_amount)).toEqual([10000]);
      expect(session.line_items[0].price_data.product_data.name).toBe(`Invoice ${c.invoiceLabel}: Item ${seq}`);
      expect(session.success_url).toBe('ultm8-student://charge-payment/complete');

      expect(await tx(res.body.transactionId)).toMatchObject({ status: 'PENDING', kind: 'CHARGE_PAYMENT', chargePaymentChannel: 'APP', chargeId: c.id, paymentMethod: 'STRIPE', amount: 10000 });
      // Nothing on the balance yet: the client's return is not a payment.
      let view = await memberView('one', student.id);
      expect(view.balances[0]).toMatchObject({ net: 10000, payableAmount: 10000 });
      expect(view.payments).toEqual([expect.objectContaining({ id: res.body.transactionId, status: 'PENDING', channel: 'APP', invoiceLabel: c.invoiceLabel })]);
      const staff = await as(tokens.owner).get(`/v1/schools/${card.id}/students/${student.id}/charges`);
      expect(staff.body.payments[0]).toMatchObject({ status: 'PENDING', channel: 'APP' });

      await succeed(res.body.transactionId);
      expect((await tx(res.body.transactionId)).status).toBe('SUCCESSFUL');
      expect(await paid(c.id)).toBe(10000);
      view = await memberView('one', student.id);
      expect(view.charges[0].status).toBe('PAID');
      expect(view.balances[0]).toMatchObject({ net: 0, payableAmount: 0 });
      expect(view.payments[0]).toMatchObject({ status: 'SUCCESSFUL', channel: 'APP', paymentMethod: 'STRIPE', allocations: [{ chargeId: c.id, amount: 10000 }] });
      // A redelivered event changes nothing.
      await succeed(res.body.transactionId);
      expect(await su.balanceEntry.count({ where: { studentId: student.id, kind: 'PAYMENT' } })).toBe(1);
      const rows = await notices(student.id, 2);
      expect(rows.map((r) => r.body)).toContain('Your payment of 100.00 BRL was received.');
    });

    it('pays the whole balance, oldest due first', async () => {
      const student = await mkStudent('balance');
      const later = await createCharge(student.id, 3000, day(9));
      const sooner = await createCharge(student.id, 5000, day(2));
      const res = await checkout('balance', student.id);
      expect(res.status).toBe(201);
      expect(res.body.amount).toBe(8000);
      expect(sessions[sessions.length - 1].line_items[0].price_data.product_data.name).toBe('Balance payment');
      expect((await tx(res.body.transactionId)).chargeId).toBeNull();
      await succeed(res.body.transactionId);
      const allocations = await su.chargeAllocation.findMany({ where: { transactionId: res.body.transactionId }, orderBy: { createdAt: 'asc' } });
      expect(allocations.map((a) => [a.chargeId, a.amount])).toEqual([
        [sooner.id, 5000],
        [later.id, 3000],
      ]);
    });

    it('asks only for what is owed after credit', async () => {
      const student = await mkStudent('credit');
      await createCharge(student.id, 5000);
      expect((await deskPay(student.id, 7000)).status).toBe(201);
      const c = await createCharge(student.id, 5000);
      expect(await paid(c.id)).toBe(2000);
      expect((await memberView('credit', student.id)).balances[0]).toMatchObject({ net: 3000, payableAmount: 3000 });
      expect((await checkout('credit', student.id, { chargeId: c.id })).body.amount).toBe(3000);
      expect((await checkout('credit', student.id)).body.amount).toBe(3000);
    });

    it('refuses a paid, cancelled or unknown charge and an empty balance', async () => {
      const student = await mkStudent('nothing');
      expect((await checkout('nothing', student.id)).body.error.code).toBe('CHARGE_NOTHING_OWED');
      const c = await createCharge(student.id, 1000);
      await deskPay(student.id, 1000);
      expect((await checkout('nothing', student.id, { chargeId: c.id })).body.error.code).toBe('CHARGE_ALREADY_PAID');
      const d = await createCharge(student.id, 1000);
      await as(tokens.owner).post(`/v1/schools/${card.id}/charges/${d.id}/cancel`, { reason: 'Wrong' });
      expect((await checkout('nothing', student.id, { chargeId: d.id })).body.error.code).toBe('CHARGE_ALREADY_CANCELLED');
      expect((await checkout('nothing', student.id, { chargeId: randomUUID() })).status).toBe(404);
    });

    it('an abandoned or expired Checkout turns Failed and is not shown; another card can still pay it', async () => {
      const student = await mkStudent('abandon');
      const c = await createCharge(student.id, 2500);
      const res = await checkout('abandon', student.id, { chargeId: c.id });
      await event('payment_intent.canceled', (await tx(res.body.transactionId)).stripePaymentIntentId!);
      expect((await tx(res.body.transactionId)).status).toBe('FAILED');
      const view = await memberView('abandon', student.id);
      expect(view.payments).toEqual([]);
      expect(view.balances[0].net).toBe(2500);

      const again = await checkout('abandon', student.id, { chargeId: c.id });
      await event('payment_intent.payment_failed', (await tx(again.body.transactionId)).stripePaymentIntentId!);
      expect((await tx(again.body.transactionId)).status).toBe('FAILED');
      await succeed(again.body.transactionId);
      expect((await tx(again.body.transactionId)).status).toBe('SUCCESSFUL');
      expect(await paid(c.id)).toBe(2500);
    });

    it('two sessions paid for one charge never over-pay it: the second becomes credit', async () => {
      const student = await mkStudent('twice');
      const c = await createCharge(student.id, 4000);
      const first = await checkout('twice', student.id, { chargeId: c.id });
      // A repeated tap gets the same session and Transaction back.
      const repeat = await checkout('twice', student.id, { chargeId: c.id });
      expect(repeat.body.transactionId).toBe(first.body.transactionId);
      const second = await checkout('twice', student.id);
      expect(second.body.transactionId).not.toBe(first.body.transactionId);
      await Promise.all([succeed(first.body.transactionId), succeed(second.body.transactionId)]);
      expect(await paid(c.id)).toBe(4000);
      const view = await memberView('twice', student.id);
      expect(view.balances[0]).toMatchObject({ owed: 0, credit: 4000, net: -4000, payableAmount: 0 });
      expect(view.payments.map((p: { creditAmount: number }) => p.creditAmount).sort()).toEqual([0, 4000]);
    });
  });

  describe('who may pay', () => {
    it('a Guardian pays for their child; a stranger and another School cannot', async () => {
      const child = await mkStudent('child');
      const guardian = await mkUser('guardian');
      await su.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: child.id } });
      tokens.guardian = sign(guardian, null, null);
      const c = await createCharge(child.id, 1500);
      const res = await checkout('guardian', child.id, { chargeId: c.id });
      expect(res.status).toBe(201);
      expect(await tx(res.body.transactionId)).toMatchObject({ studentId: child.id, chargePaymentChannel: 'APP' });
      await succeed(res.body.transactionId);
      expect(await paid(c.id)).toBe(1500);
      // The Guardian sees no automatic-payment switch they could use.
      expect((await memberView('guardian', child.id)).payInApp).toMatchObject({ available: true, savedCard: false, canSetAutoPay: false });

      const stranger = await mkStudent('stranger');
      expect((await checkout('stranger', child.id)).status).toBe(403);
      expect((await as(tokens.cashOwner).post(`/v1/students/${child.id}/charges/checkout`, { schoolId: card.id })).status).toBe(403);
      // A student of another School asking at this one has nothing here.
      const elsewhere = await mkStudent('elsewhere', cash.id);
      expect((await checkout('elsewhere', elsewhere.id)).status).toBe(404);
      // Someone else's charge is not found.
      const other = await createCharge(stranger.id, 900);
      expect((await checkout('child', child.id, { chargeId: other.id })).status).toBe(404);
    });

    it('a School without Stripe, and an account restricted to cash, are told to pay at the desk', async () => {
      const student = await mkStudent('cashOnly', cash.id);
      const c = await as(tokens.cashOwner).post(`/v1/schools/${cash.id}/students/${student.id}/charges`, { description: 'Belt', amount: 1000, dueDate: day(3) });
      expect(c.status).toBe(201);
      const res = await as(tokens.cashOnly).post(`/v1/students/${student.id}/charges/checkout`, { schoolId: cash.id });
      expect(res.body.error.code).toBe('CHARGE_NO_CARD_PAYMENTS');
      const view = (await as(tokens.cashOnly).get(`/v1/students/${student.id}/charges`)).body.schools[0];
      expect(view.payInApp).toMatchObject({ available: false, blockedReason: 'NO_CARD_PAYMENTS' });

      const restricted = await mkStudent('restricted');
      await createCharge(restricted.id, 1000);
      await su.user.update({ where: { id: restricted.id }, data: { paymentRestrictedAt: new Date() } });
      const refused = await checkout('restricted', restricted.id);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('CHARGE_PAYMENT_RESTRICTED');
      expect((await memberView('restricted', restricted.id)).payInApp).toMatchObject({ available: false, blockedReason: 'RESTRICTED' });
    });
  });

  describe('card surcharge (Decision 406)', () => {
    afterAll(async () => {
      await su.school.update({ where: { id: card.id }, data: { cardSurchargeEnabled: false, cardSurchargeBps: 0 } });
      await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
    });

    it('is shown before paying, charged as its own line and kept off the balance', async () => {
      await su.cardSurchargeCountry.create({ data: { countryCode: COUNTRY } });
      await su.school.update({ where: { id: card.id }, data: { cardSurchargeEnabled: true, cardSurchargeBps: 250 } });
      const student = await mkStudent('surcharge');
      const c = await createCharge(student.id, 1999);
      const view = await memberView('surcharge', student.id);
      // 2.5% of 19.99 is 0.49975, charged as 0.50.
      expect(view.charges[0].cardSurchargeAmount).toBe(50);
      expect(view.balances[0].cardSurchargeAmount).toBe(50);

      const res = await checkout('surcharge', student.id, { chargeId: c.id });
      expect(res.body).toMatchObject({ amount: 1999, surchargeAmount: 50 });
      const session = sessions[sessions.length - 1];
      expect(session.line_items.map((l) => [l.price_data.product_data.name, l.price_data.unit_amount])).toEqual([
        [`Invoice ${c.invoiceLabel}: Item ${seq}`, 1999],
        ['Card surcharge', 50],
      ]);
      expect((await tx(res.body.transactionId)).surchargeAmount).toBe(50);
      await succeed(res.body.transactionId);
      expect(await paid(c.id)).toBe(1999);
      const after = await memberView('surcharge', student.id);
      expect(after.balances[0]).toMatchObject({ net: 0, credit: 0 });
      expect(after.payments[0]).toMatchObject({ amount: 1999, surchargeAmount: 50 });
      const rows = await notices(student.id, 2);
      expect(rows.map((r) => r.body)).toContain('Your payment of 20.49 BRL was received.');
      // Never on a desk payment.
      expect((await su.transaction.findMany({ where: { studentId: student.id, chargePaymentChannel: 'DESK' } })).every((t) => t.surchargeAmount === 0)).toBe(true);
    });
  });

  describe('automatic payment with the saved card (Decision 338 item 8)', () => {
    it('the switch: the member only, needs a saved card, and the passcode to turn on', async () => {
      const student = await mkStudent('switch');
      const url = `/v1/students/${student.id}/charge-auto-pay`;
      expect((await as(tokens.switch).put(url, { schoolId: card.id, enabled: true }, stepUp(student.id))).body.error.code).toBe('CHARGE_AUTO_PAY_NO_CARD');
      await saveCard(student.id);
      const noProof = await as(tokens.switch).put(url, { schoolId: card.id, enabled: true });
      expect(noProof.status).toBe(403);
      expect(noProof.body.error.code).toBe('STEP_UP_REQUIRED');
      expect((await as(tokens.switch).put(url, { schoolId: card.id, enabled: true }, stepUp(randomUUID()))).status).toBe(403);
      const on = await as(tokens.switch).put(url, { schoolId: card.id, enabled: true }, stepUp(student.id));
      expect(on.status).toBe(200);
      expect(on.body).toEqual({ schoolId: card.id, enabled: true });
      await createCharge(student.id, 1000);
      expect((await memberView('switch', student.id)).payInApp).toMatchObject({ savedCard: true, autoPay: true, canSetAutoPay: true });
      // Off needs no passcode.
      expect((await as(tokens.switch).put(url, { schoolId: card.id, enabled: false })).status).toBe(200);
      expect((await su.studentPaymentMethod.findFirstOrThrow({ where: { studentId: student.id } })).autoPayCharges).toBe(false);

      const kid = await mkStudent('kid');
      const parent = await mkUser('parent');
      await su.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: kid.id } });
      const byParent = await as(sign(parent, null, null)).put(`/v1/students/${kid.id}/charge-auto-pay`, { schoolId: card.id, enabled: true }, stepUp(parent.id));
      expect(byParent.body.error.code).toBe('CHARGE_AUTO_PAY_SELF_ONLY');
      expect((await as(tokens.stranger).put(url, { schoolId: card.id, enabled: false })).status).toBe(403);
    });

    it('the daily job charges what is due today and overdue, once, never what is not due or covered by credit', async () => {
      const auto = await mkStudent('auto');
      await saveCard(auto.id, true);
      const today = await createCharge(auto.id, 2000, day(0));
      const overdue = await createCharge(auto.id, 1200, day(-3));
      const tomorrow = await createCharge(auto.id, 1500, day(1));

      const credited = await mkStudent('credited');
      await saveCard(credited.id, true);
      await deskPay(credited.id, 2500);
      const covered = await createCharge(credited.id, 2000, day(0));
      const partly = await createCharge(credited.id, 1000, day(0));
      expect(covered.status).toBe('PAID');
      expect(await paid(partly.id)).toBe(500);

      const off = await mkStudent('autoOff');
      await saveCard(off.id, false);
      const notOn = await createCharge(off.id, 900, day(0));

      const before = intents.length;
      await autoPay.run(new Date());
      const sent = intents.slice(before);
      expect(sent.every((i) => i.off_session === true)).toBe(true);

      const autoRows = await su.transaction.findMany({ where: { studentId: auto.id, chargePaymentChannel: 'AUTOMATIC' } });
      expect(autoRows.map((t) => [t.chargeId, t.amount, t.status]).sort()).toEqual(
        [
          [overdue.id, 1200, 'SUCCESSFUL'],
          [today.id, 2000, 'SUCCESSFUL'],
        ].sort(),
      );
      expect(await paid(today.id)).toBe(2000);
      expect(await paid(overdue.id)).toBe(1200);
      expect(await paid(tomorrow.id)).toBe(0);
      // Only what credit didn't cover.
      expect(await su.transaction.findMany({ where: { studentId: credited.id, chargePaymentChannel: 'AUTOMATIC' } })).toEqual([
        expect.objectContaining({ chargeId: partly.id, amount: 500, status: 'SUCCESSFUL' }),
      ]);
      expect(await su.transaction.count({ where: { chargeId: notOn.id } })).toBe(0);

      // A second run the same day charges nothing more.
      const again = intents.length;
      await autoPay.run(new Date());
      expect(await su.transaction.count({ where: { studentId: { in: [auto.id, credited.id, off.id] }, chargePaymentChannel: 'AUTOMATIC' } })).toBe(3);
      expect(intents.slice(again).filter((i) => [2000, 1200, 500].includes(i.amount))).toHaveLength(0);

      const staff = await as(tokens.owner).get(`/v1/schools/${card.id}/students/${auto.id}/charges`);
      expect(staff.body.payments.map((p: { channel: string }) => p.channel)).toEqual(['AUTOMATIC', 'AUTOMATIC']);
      const rows = await notices(auto.id, 5);
      expect(rows.filter((r) => r.title === 'Payment received')).toHaveLength(2);
    });

    it('a declined card is recorded Failed, the member is told, and it is not tried again', async () => {
      const student = await mkStudent('declined');
      await saveCard(student.id, true);
      const c = await createCharge(student.id, 3300, day(0));
      offSessionStatus = 'requires_payment_method';
      await autoPay.run(new Date());
      const [row] = await su.transaction.findMany({ where: { chargeId: c.id } });
      expect(row).toMatchObject({ status: 'FAILED', chargePaymentChannel: 'AUTOMATIC', amount: 3300 });
      expect(await paid(c.id)).toBe(0);
      const view = await memberView('declined', student.id);
      expect(view.payments[0]).toMatchObject({ status: 'FAILED', channel: 'AUTOMATIC', invoiceLabel: c.invoiceLabel });
      const rows = await notices(student.id, 2);
      expect(rows.map((r) => [r.title, r.body])).toContainEqual([
        'Automatic payment failed',
        `We couldn't charge your saved card for invoice ${c.invoiceLabel} (Item ${seq}, 33.00 BRL). Pay it in the app or at the front desk.`,
      ]);

      offSessionStatus = 'succeeded';
      await autoPay.run(new Date(Date.now() + DAY));
      expect(await su.transaction.count({ where: { chargeId: c.id } })).toBe(1);
      // The member can still pay it in the app.
      const res = await checkout('declined', student.id, { chargeId: c.id });
      expect(res.body.amount).toBe(3300);
    });

    it('skips a member restricted to cash and a member with a Checkout in progress', async () => {
      const restricted = await mkStudent('autoRestricted');
      await saveCard(restricted.id, true);
      const r = await createCharge(restricted.id, 700, day(0));
      await su.user.update({ where: { id: restricted.id }, data: { paymentRestrictedAt: new Date() } });

      const busy = await mkStudent('autoBusy');
      await saveCard(busy.id, true);
      const b = await createCharge(busy.id, 800, day(0));
      expect((await checkout('autoBusy', busy.id, { chargeId: b.id })).status).toBe(201);

      await autoPay.run(new Date());
      expect(await su.transaction.count({ where: { chargeId: r.id } })).toBe(0);
      expect(await su.transaction.count({ where: { chargeId: b.id, chargePaymentChannel: 'AUTOMATIC' } })).toBe(0);
    });
  });
});
