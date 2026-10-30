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
import { LateFeeProcessor } from '../src/jobs/late-fee.processor';

/**
 * Late fees (v1.3 backlog §3.7; Decision 413). Over real HTTP against a real
 * Postgres, with the real late-fee job, webhook processor, auto-pay job and
 * notification worker; Stripe is faked (invoices for renewals, off-session
 * charges for auto-pay). Each test has its own School, in UTC, so "days" are
 * plain UTC days; the job is run with a chosen date and only for that School.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[late-fees.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const at = (offset: number) => new Date(Date.now() + offset * DAY);
const LEGAL = { legalConfirmed: true };

describeIfDb('Late fees (Decision 413)', () => {
  let app: INestApplication;
  let job: LateFeeProcessor;
  let webhook: StripeWebhookProcessingProcessor;
  let autoPay: ChargeAutoPayProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const eventIds: string[] = [];
  let seq = 0;

  const invoices = new Map<string, object>();
  const intents: Array<{ amount: number }> = [];
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      invoices: { retrieve: jest.fn(async (id: string) => invoices.get(id)) },
      paymentIntents: {
        create: jest.fn(async (params: { amount: number }) => {
          intents.push(params);
          return { id: `pi_${randomUUID()}`, status: 'succeeded' };
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
    put: (url: string, body: Record<string, unknown>) => http().put(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const sign = (user: { id: string; email: string }, role: string, schoolId: string, branchId: string | null = null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId }] });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `late-fees-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'LateFees',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  /** A School (UTC, BRL, card payments) with its owner, a branch, a Branch Staff member and a student. */
  async function seed(opts: { tax?: { rate: number; inclusive: boolean } } = {}) {
    const acct = `acct_${randomUUID().slice(0, 8)}`;
    const school = await su.school.create({
      data: {
        id: randomUUID(),
        name: `Late Fees ${++seq}`,
        defaultCurrency: 'BRL',
        timezone: 'UTC',
        taxRateBasisPoints: opts.tax?.rate ?? 0,
        taxInclusive: opts.tax?.inclusive ?? true,
      },
    });
    schoolIds.push(school.id);
    const branch = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'BR', stripeConnectedAccountId: acct },
    });
    const owner = await mkUser('owner');
    const staff = await mkUser('staff');
    const student = await mkUser('student');
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id, branchId: branch.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
      ],
    });
    await su.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, branchId: branch.id } });
    return {
      school,
      account,
      acct,
      owner,
      staff,
      student,
      ownerToken: sign(owner, 'SCHOOL_OWNER_MANAGER', school.id),
      staffToken: sign(staff, 'BRANCH_STAFF', school.id, branch.id),
      studentToken: sign(student, 'STUDENT', school.id),
    };
  }
  type Seeded = Awaited<ReturnType<typeof seed>>;

  const settingsUrl = (s: Seeded) => `/v1/schools/${s.school.id}/late-fees`;
  const turnOn = (s: Seeded, body: Record<string, unknown>) =>
    as(s.ownerToken).put(settingsUrl(s), { enabled: true, type: 'FIXED', graceDays: 3, ...LEGAL, ...body });
  async function createCharge(s: Seeded, amount: number, dueDate: string) {
    const res = await as(s.ownerToken).post(`/v1/schools/${s.school.id}/students/${s.student.id}/charges`, { description: `Item ${++seq}`, amount, dueDate });
    expect(res.status).toBe(201);
    return res.body as { id: string; invoiceLabel: string; description: string };
  }
  const deskPay = (s: Seeded, amount: number, chargeId?: string) =>
    as(s.ownerToken).post(`/v1/schools/${s.school.id}/students/${s.student.id}/charge-payments`, { amount, paymentMethod: 'CASH', sendReceipt: false, ...(chargeId ? { chargeId } : {}) });
  const run = (s: Seeded, offsetDays: number) => job.run(at(offsetDays), [s.school.id]);
  const feesFor = (s: Seeded) =>
    su.charge.findMany({ where: { schoolId: s.school.id, OR: [{ lateFeeForChargeId: { not: null } }, { lateFeeForTransactionId: { not: null } }] }, orderBy: { invoiceNumber: 'asc' } });
  const staffView = (s: Seeded, token = s.ownerToken) => as(token).get(`/v1/schools/${s.school.id}/students/${s.student.id}/charges`);

  async function notices(userId: string, title: string, expected: number) {
    for (let i = 0; i < 60; i++) {
      const rows = await su.notification.findMany({ where: { userId, type: 'CHARGE', title }, orderBy: { createdAt: 'asc' } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return su.notification.findMany({ where: { userId, type: 'CHARGE', title }, orderBy: { createdAt: 'asc' } });
  }

  /** A card Subscription membership, its first payment already on the ledger, as a purchase leaves it. */
  async function subscribe(s: Seeded) {
    const plan = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 6000, currency: 'BRL' } });
    const subscriptionId = `sub_${randomUUID()}`;
    const membership = await su.membership.create({
      data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.school.id, frequency: 'RECURRING', stripeSubscriptionId: subscriptionId },
    });
    await su.transaction.create({
      data: {
        id: randomUUID(), schoolId: s.school.id, studentId: s.student.id, paymentAccountId: s.account.id, membershipPlanId: plan.id, membershipId: membership.id,
        amount: 6000, currency: 'BRL', status: 'SUCCESSFUL', paymentMethod: 'STRIPE', stripePaymentIntentId: `pi_first_${randomUUID()}`,
        stripeSubscriptionId: subscriptionId, billingDate: at(-31),
      },
    });
    return subscriptionId;
  }
  async function invoiceEvent(s: Seeded, eventType: 'invoice.paid' | 'invoice.payment_failed', invoice: Record<string, unknown>) {
    invoices.set(invoice.id as string, invoice);
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType, objectId: invoice.id, stripeAccountId: s.acct }, attemptsMade: 1, opts: { attempts: 3 } } as never);
  }
  const renewalInvoice = (subscriptionId: string, id: string, paid: boolean) => ({
    id,
    billing_reason: 'subscription_cycle',
    amount_paid: paid ? 6000 : 0,
    amount_due: 6000,
    currency: 'brl',
    created: Math.floor(Date.now() / 1000),
    status_transitions: { paid_at: paid ? Math.floor(Date.now() / 1000) : null },
    parent: { subscription_details: { subscription: subscriptionId } },
    payments: { data: [{ payment: { type: 'payment_intent', payment_intent: `pi_${id}` } }] },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    job = app.get(LateFeeProcessor);
    webhook = app.get(StripeWebhookProcessingProcessor);
    autoPay = app.get(ChargeAutoPayProcessor);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    // Late fees first: they point at the charges and renewals they are for.
    await su.charge.deleteMany({ where: { ...where, OR: [{ lateFeeForChargeId: { not: null } }, { lateFeeForTransactionId: { not: null } }] } });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.staffPermission.deleteMany({ where });
    await su.staffActivity.deleteMany({ where });
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

  describe('the School setting', () => {
    it('is off by default, and nothing happens while it is off', async () => {
      const s = await seed();
      const res = await as(s.ownerToken).get(settingsUrl(s));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ enabled: false, type: 'FIXED', fixedAmount: null, percentBps: null, graceDays: 3, currency: 'BRL', confirmedAt: null, enabledAt: null });
      await createCharge(s, 10000, day(1));
      expect(await run(s, 30)).toEqual({ added: 0, skipped: 0 });
      expect(await feesFor(s)).toHaveLength(0);
    });

    it('turning it on needs the legal tick and a value; the owner only', async () => {
      const s = await seed();
      const other = await seed();
      expect((await turnOn(s, { fixedAmount: 1500, legalConfirmed: false })).status).toBe(400);
      expect((await turnOn(s, { fixedAmount: 1500, legalConfirmed: undefined })).status).toBe(400);
      expect((await turnOn(s, { fixedAmount: null })).status).toBe(400);
      expect((await turnOn(s, { type: 'PERCENT', percentBps: null })).status).toBe(400);
      // 0 < % ≤ 100 with up to two decimals (basis points), fixed > 0, grace 0-30.
      expect((await turnOn(s, { type: 'PERCENT', percentBps: 10001 })).status).toBe(400);
      expect((await turnOn(s, { type: 'PERCENT', percentBps: 0 })).status).toBe(400);
      expect((await turnOn(s, { type: 'PERCENT', percentBps: 2.5 })).status).toBe(400);
      expect((await turnOn(s, { fixedAmount: 0 })).status).toBe(400);
      expect((await turnOn(s, { fixedAmount: 1500, graceDays: 31 })).status).toBe(400);
      expect((await turnOn(s, { fixedAmount: 1500, graceDays: -1 })).status).toBe(400);
      // Branch Staff, the student, and another School's owner are refused.
      expect((await as(s.staffToken).put(settingsUrl(s), { enabled: true, type: 'FIXED', fixedAmount: 1500, graceDays: 3, ...LEGAL })).status).toBe(403);
      expect((await as(s.staffToken).get(settingsUrl(s))).status).toBe(403);
      expect((await as(s.studentToken).get(settingsUrl(s))).status).toBe(403);
      expect((await as(other.ownerToken).get(settingsUrl(s))).status).toBe(403);
      expect((await as(other.ownerToken).put(settingsUrl(s), { enabled: true, type: 'FIXED', fixedAmount: 1500, graceDays: 3, ...LEGAL })).status).toBe(403);
      expect((await su.school.findUniqueOrThrow({ where: { id: s.school.id } })).lateFeeEnabled).toBe(false);

      const on = await turnOn(s, { type: 'PERCENT', percentBps: 250, graceDays: 0 });
      expect(on.status).toBe(200);
      expect(on.body).toMatchObject({ enabled: true, type: 'PERCENT', percentBps: 250, graceDays: 0 });
      expect(on.body.confirmedAt).toBeTruthy();
      expect(on.body.enabledAt).toBeTruthy();
      // Switching off needs no tick, and keeps the values.
      const off = await as(s.ownerToken).put(settingsUrl(s), { enabled: false, type: 'PERCENT', graceDays: 0 });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ enabled: false, percentBps: 250, enabledAt: null });
    });

    it('a fixed fee needs the School currency', async () => {
      const s = await seed();
      await su.school.update({ where: { id: s.school.id }, data: { defaultCurrency: null } });
      expect((await turnOn(s, { fixedAmount: 1500 })).status).toBe(400);
      expect((await turnOn(s, { type: 'PERCENT', percentBps: 200 })).status).toBe(200);
    });
  });

  describe('the daily job', () => {
    it('a fixed fee after 3 grace days, once; the member is told; never on a late fee itself', async () => {
      const s = await seed();
      expect((await turnOn(s, { fixedAmount: 1500 })).status).toBe(200);
      const c = await createCharge(s, 10000, day(1));
      // Due day 1; days 2, 3, 4 are grace; the fee comes on day 5.
      expect((await run(s, 4)).added).toBe(0);
      expect((await run(s, 5)).added).toBe(1);
      expect((await run(s, 5)).added).toBe(0); // a rerun never doubles
      const [a, b] = await Promise.all([run(s, 6), run(s, 6)]); // nor do two runs at once
      expect(a.added + b.added).toBe(0);
      // Later runs: still one fee for the charge, and none for the fee itself.
      expect((await run(s, 40)).added).toBe(0);
      const fees = await feesFor(s);
      expect(fees).toHaveLength(1);
      expect(fees[0]).toMatchObject({
        lateFeeForChargeId: c.id,
        lateFeeOverdueAmount: 10000,
        lateFeePercentBps: null,
        grossAmount: 1500,
        currency: 'BRL',
        description: `Late fee: invoice ${c.invoiceLabel}`,
        createdById: null,
      });
      expect(fees[0].dueDate.toISOString().slice(0, 10)).toBe(day(5));

      const view = await as(s.studentToken).get(`/v1/students/${s.student.id}/charges`);
      const school = view.body.schools.find((x: { schoolId: string }) => x.schoolId === s.school.id);
      const fee = school.charges.find((x: { id: string }) => x.id === fees[0].id);
      expect(fee.lateFee).toEqual({
        forType: 'CHARGE',
        forInvoiceLabel: c.invoiceLabel,
        forDescription: c.description,
        forPlanTitle: null,
        forDueDate: day(1),
        overdueAmount: 10000,
        overdueCurrency: 'BRL',
        percentBps: null,
        waived: false,
      });
      expect(school.charges.find((x: { id: string }) => x.id === c.id).lateFee).toBeNull();
      expect(school.balances[0].net).toBe(11500);

      const rows = await notices(s.student.id, 'Late fee added', 1);
      expect(rows).toHaveLength(1);
      expect(rows[0].body).toBe(`A late fee of 15.00 BRL was added to your balance because invoice ${c.invoiceLabel} (${c.description}) is overdue. Pay it in the app or at the front desk.`);

      // The database refuses a late fee for a late fee, whatever writes it.
      await expect(su.charge.update({ where: { id: c.id }, data: { lateFeeForChargeId: fees[0].id, lateFeeOverdueAmount: 1500 } })).rejects.toThrow(
        /never gets its own late fee/,
      );
    });

    it('grace 0: the day after the due date', async () => {
      const s = await seed();
      expect((await turnOn(s, { fixedAmount: 500, graceDays: 0 })).status).toBe(200);
      await createCharge(s, 2000, day(1));
      expect((await run(s, 1)).added).toBe(0);
      expect((await run(s, 2)).added).toBe(1);
    });

    it('a % is of what is still owed on a part-paid charge, and the School tax applies to the fee', async () => {
      const s = await seed({ tax: { rate: 1000, inclusive: false } }); // 10% added on top
      expect((await turnOn(s, { type: 'PERCENT', percentBps: 250 })).status).toBe(200);
      const c = await createCharge(s, 10000, day(1)); // 100.00 + 10% = 110.00 owed
      expect((await deskPay(s, 4000, c.id)).status).toBe(201); // 70.00 still owed
      expect((await run(s, 5)).added).toBe(1);
      const [fee] = await feesFor(s);
      // 2.5% of 70.00 = 1.75; tax added on top: 0.18 (half up); 1.93 owed.
      expect(fee).toMatchObject({ lateFeeOverdueAmount: 7000, lateFeePercentBps: 250, unitAmount: 175, netAmount: 175, taxRateBasisPoints: 1000, taxAmount: 18, grossAmount: 193 });
    });

    it('a charge paid (or cancelled) within the grace period gets nothing', async () => {
      const s = await seed();
      expect((await turnOn(s, { fixedAmount: 1500 })).status).toBe(200);
      const paid = await createCharge(s, 3000, day(1));
      const cancelled = await createCharge(s, 3000, day(1));
      expect((await deskPay(s, 3000, paid.id)).status).toBe(201);
      expect((await as(s.ownerToken).post(`/v1/schools/${s.school.id}/charges/${cancelled.id}/cancel`, { reason: 'Gift' })).status).toBe(201);
      expect((await run(s, 10)).added).toBe(0);
    });

    it('a payment already late before late fees were switched on never gets one', async () => {
      const s = await seed();
      await createCharge(s, 3000, day(-10));
      expect((await turnOn(s, { fixedAmount: 1500 })).status).toBe(200);
      expect((await run(s, 0)).added).toBe(0);
      expect((await run(s, 30)).added).toBe(0);
      // Due in the grace window when switched on: its grace ends after, so it does.
      await createCharge(s, 3000, day(-1));
      expect((await run(s, 3)).added).toBe(1);
    });

    it('skips a closed School, a degraded School and a former student', async () => {
      const closed = await seed();
      expect((await turnOn(closed, { fixedAmount: 1500 })).status).toBe(200);
      await createCharge(closed, 3000, day(1));
      await su.school.update({ where: { id: closed.school.id }, data: { archivedAt: new Date() } });
      expect((await run(closed, 10)).added).toBe(0);

      const degraded = await seed();
      expect((await turnOn(degraded, { fixedAmount: 1500 })).status).toBe(200);
      await createCharge(degraded, 3000, day(1));
      await su.school.update({ where: { id: degraded.school.id }, data: { platformSubscriptionStatus: 'CANCELED' } });
      expect((await run(degraded, 10)).added).toBe(0);
      await su.school.update({ where: { id: degraded.school.id }, data: { platformSubscriptionStatus: null } });
      expect((await run(degraded, 10)).added).toBe(1);

      const left = await seed();
      expect((await turnOn(left, { fixedAmount: 1500 })).status).toBe(200);
      await createCharge(left, 3000, day(1));
      await su.roleGrant.updateMany({ where: { userId: left.student.id, schoolId: left.school.id, role: 'STUDENT' }, data: { revokedAt: new Date() } });
      expect((await run(left, 10)).added).toBe(0);
      expect(await feesFor(left)).toHaveLength(0);
    });

    it('charge-auto-pay never charges a late fee to the saved card', async () => {
      const s = await seed();
      expect((await turnOn(s, { fixedAmount: 1500 })).status).toBe(200);
      const c = await createCharge(s, 3000, day(1));
      expect((await run(s, 5)).added).toBe(1);
      expect((await deskPay(s, 3000, c.id)).status).toBe(201); // the charge itself is paid at the desk
      await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: s.student.id, schoolId: s.school.id, stripeCustomerId: `cus_${randomUUID()}`, autoPayCharges: true } });
      const before = intents.length;
      await autoPay.run(at(10));
      expect(intents.length).toBe(before);
      const [fee] = await feesFor(s);
      expect(await su.transaction.count({ where: { chargeId: fee.id } })).toBe(0);
      const view = await staffView(s);
      expect(view.body.charges.find((x: { id: string }) => x.id === fee.id)).toMatchObject({ status: 'OPEN', owedAmount: 1500 });
    });
  });

  describe('card renewals Stripe could not collect', () => {
    it('paid within the grace period: no fee', async () => {
      const s = await seed();
      expect((await turnOn(s, { fixedAmount: 1000 })).status).toBe(200);
      const sub = await subscribe(s);
      const id = `in_${randomUUID()}`;
      await invoiceEvent(s, 'invoice.payment_failed', renewalInvoice(sub, id, false));
      expect((await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: id } })).status).toBe('FAILED');
      expect((await run(s, 2)).added).toBe(0);
      await invoiceEvent(s, 'invoice.paid', renewalInvoice(sub, id, true));
      expect((await run(s, 10)).added).toBe(0);
      expect(await feesFor(s)).toHaveLength(0);
    });

    it('still unpaid after the grace period: one fee, a % of the amount due', async () => {
      const s = await seed();
      expect((await turnOn(s, { type: 'PERCENT', percentBps: 250 })).status).toBe(200);
      const sub = await subscribe(s);
      const id = `in_${randomUUID()}`;
      await invoiceEvent(s, 'invoice.payment_failed', renewalInvoice(sub, id, false));
      await invoiceEvent(s, 'invoice.payment_failed', renewalInvoice(sub, id, false)); // Stripe's retry fails again
      const renewal = await su.transaction.findUniqueOrThrow({ where: { stripeInvoiceId: id } });
      // Invoice dated today; days 1-3 are grace; the fee comes on day 4.
      expect((await run(s, 3)).added).toBe(0);
      expect((await run(s, 4)).added).toBe(1);
      expect((await run(s, 4)).added).toBe(0);
      expect((await run(s, 30)).added).toBe(0);
      const fees = await feesFor(s);
      expect(fees).toHaveLength(1);
      expect(fees[0]).toMatchObject({ lateFeeForTransactionId: renewal.id, lateFeeOverdueAmount: 6000, grossAmount: 150, currency: 'BRL', description: 'Late fee: Monthly membership payment' });
      const view = await staffView(s);
      expect(view.body.charges.find((x: { id: string }) => x.id === fees[0].id).lateFee).toMatchObject({ forType: 'RENEWAL', forPlanTitle: 'Monthly', forDueDate: day(0), overdueAmount: 6000 });
      const rows = await notices(s.student.id, 'Late fee added', 1);
      expect(rows[0].body).toBe('A late fee of 1.50 BRL was added to your balance because your Monthly membership payment of 60.00 BRL is overdue. Pay it in the app or at the front desk.');
      // Paid later, after the fee: the fee stands (staff may waive it).
      await invoiceEvent(s, 'invoice.paid', renewalInvoice(sub, id, true));
      expect(await su.charge.count({ where: { id: fees[0].id, cancelledAt: null } })).toBe(1);
    });
  });

  describe('waiving a late fee', () => {
    it('the owner, or staff with "Can cancel charges"; it is cancelled, marked waived, and the member is told', async () => {
      const s = await seed();
      const other = await seed();
      expect((await turnOn(s, { fixedAmount: 1500 })).status).toBe(200);
      const c = await createCharge(s, 3000, day(1));
      await run(s, 5);
      const [fee] = await feesFor(s);
      const waive = (token: string, id = fee.id, schoolId = s.school.id) => as(token).post(`/v1/schools/${schoolId}/charges/${id}/waive-late-fee`);

      expect((await waive(s.staffToken)).status).toBe(403); // "Can cancel charges" is off by default
      expect((await waive(s.studentToken)).status).toBe(403);
      expect((await waive(other.ownerToken)).status).toBe(403); // another School's owner
      expect((await waive(other.ownerToken, fee.id, other.school.id)).status).toBe(404); // not a charge of their School
      expect((await waive(s.ownerToken, c.id)).status).toBe(400); // not a late fee

      expect((await as(s.ownerToken).put(`/v1/schools/${s.school.id}/charge-permissions/${s.staff.id}`, { canCreateCharges: true, canCancelCharges: true })).status).toBe(200);
      const res = await waive(s.staffToken);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'CANCELLED', owedAmount: 0, cancelReason: null });
      expect(res.body.lateFee).toMatchObject({ waived: true, forInvoiceLabel: c.invoiceLabel });
      expect((await waive(s.ownerToken)).status).toBe(409);

      const view = await staffView(s);
      expect(view.body.balances[0].net).toBe(3000);
      const rows = await notices(s.student.id, 'Late fee waived', 1);
      expect(rows[0].body).toBe('Your late fee of 15.00 BRL was waived. Nothing to pay.');
      // Waived: the job never adds another for the same charge.
      expect((await run(s, 20)).added).toBe(0);
    });

    it('a part-paid late fee waived: what was paid becomes credit', async () => {
      const s = await seed();
      expect((await turnOn(s, { fixedAmount: 1500 })).status).toBe(200);
      const c = await createCharge(s, 3000, day(1));
      await run(s, 5);
      const [fee] = await feesFor(s);
      expect((await deskPay(s, 500, fee.id)).status).toBe(201);
      expect((await as(s.ownerToken).post(`/v1/schools/${s.school.id}/charges/${fee.id}/waive-late-fee`)).status).toBe(201);
      // The 5.00 paid on the fee goes on to the charge it was for.
      const view = await staffView(s);
      expect(view.body.charges.find((x: { id: string }) => x.id === c.id)).toMatchObject({ paidAmount: 500, owedAmount: 2500 });
      const rows = await notices(s.student.id, 'Late fee waived', 1);
      expect(rows[0].body).toBe('Your late fee of 15.00 BRL was waived. Nothing to pay. The 5.00 BRL already paid is now credit on your balance.');
    });
  });
});
