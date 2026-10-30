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
import { ChargeOverdueNoticeProcessor } from '../src/jobs/charge-overdue-notice.processor';
import { ChargeDueReminderProcessor } from '../src/jobs/charge-due-reminder.processor';
import { LateFeeProcessor } from '../src/jobs/late-fee.processor';

/**
 * Charges and the member balance, step 4 of 6 (v1.3 backlog §3.6; Decision
 * 303 item 3, Decision 338 items 3, 5, 6, 10, 11). Over real HTTP against a
 * real Postgres, with the real webhook processor, jobs and notification
 * worker; Stripe is faked (StripeClientService.scopedClient):
 * - refunds (owner only): to the card in full and in part, as credit, a cash
 *   payment given back (records only), never more than is left; the ledger
 *   never re-opens a paid charge; notes required unless switched off;
 * - a lost dispute on a card payment, and a refund made in the Stripe dashboard;
 * - owner-given credit;
 * - the Overview and Member balances reports, with Branch Staff scoped to
 *   their branches;
 * - the payment notification switches, the overdue notice job, resending an
 *   invoice, the receipt's address and payment instructions;
 * - another School refused.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[charges-refunds-reports.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
/** A country no other suite lists for card surcharges. */
const COUNTRY = 'PY';

type Refund = { payment_intent: string; amount: number };

describeIfDb('Charges step 4: refunds, credit, reports and notices (backlog 3.6)', () => {
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  let autoPay: ChargeAutoPayProcessor;
  let overdueJob: ChargeOverdueNoticeProcessor;
  let dueReminder: ChargeDueReminderProcessor;
  let lateFees: LateFeeProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const acct = `acct_${randomUUID().slice(0, 8)}`;

  let school: { id: string };
  let other: { id: string };
  let branchA: { id: string };
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const eventIds: string[] = [];
  let seq = 0;

  // The fake Stripe.
  const refunds: Refund[] = [];
  let offSessionStatus: 'succeeded' | 'requires_payment_method' = 'succeeded';
  let nextDispute: { id: string; status: string; amount: number; currency: string; payment_intent: string } | null = null;
  let nextCharge: { id: string; amount_refunded: number; payment_intent: string } | null = null;
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      checkout: {
        sessions: {
          create: jest.fn(async () => {
            const id = `pi_${randomUUID()}`;
            return { url: `https://checkout.example.test/${id}`, payment_intent: { id } };
          }),
        },
      },
      paymentIntents: { create: jest.fn(async () => ({ id: `pi_${randomUUID()}`, status: offSessionStatus })) },
      customers: { retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })) },
      refunds: {
        create: jest.fn(async (params: Refund) => {
          refunds.push(params);
          return { id: `re_${randomUUID()}` };
        }),
      },
      disputes: { retrieve: jest.fn(async () => nextDispute) },
      charges: { retrieve: jest.fn(async () => nextCharge) },
    })),
    platformClient: jest.fn(),
  };

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const sign = (user: { id: string; email: string }, role: string | null, schoolId: string | null, branchId: string | null = null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: role ? [{ role, franchiseId: null, schoolId, branchId }] : [] });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `refunds-${label}-${randomUUID()}@example.test`,
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
  async function mkStudent(label: string, homeBranchId: string | null = branchA.id, schoolId = school.id) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    if (homeBranchId) await su.studentHomeBranch.create({ data: { id: randomUUID(), schoolId, studentId: user.id, branchId: homeBranchId } });
    tokens[label] = sign(user, 'STUDENT', schoolId);
    return user;
  }
  async function mkStaff(label: string, role: 'BRANCH_STAFF' | 'INSTRUCTOR', branchId: string) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId } });
    tokens[label] = sign(user, role, school.id, branchId);
    return user;
  }

  const createCharge = async (studentId: string, amount: number, dueDate = day(7)) => {
    const res = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${studentId}/charges`, { description: `Item ${++seq}`, amount, dueDate });
    expect(res.status).toBe(201);
    return res.body as { id: string; invoiceLabel: string };
  };
  const deskPay = async (studentId: string, amount: number, chargeId: string | null = null, paymentMethod = 'CASH') => {
    const res = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${studentId}/charge-payments`, { amount, chargeId, paymentMethod, sendReceipt: false });
    expect(res.status).toBe(201);
    return res.body.payment.id as string;
  };
  /** A card payment made in the app, settled by its webhook. */
  async function cardPay(label: string, studentId: string, chargeId: string) {
    const res = await as(tokens[label]).post(`/v1/students/${studentId}/charges/checkout`, { schoolId: school.id, chargeId });
    expect(res.status).toBe(201);
    await event('payment_intent.succeeded', (await tx(res.body.transactionId)).stripePaymentIntentId!);
    expect((await tx(res.body.transactionId)).status).toBe('SUCCESSFUL');
    return res.body.transactionId as string;
  }
  const refund = (transactionId: string, body: Record<string, unknown>, token = tokens.owner, schoolId = school.id) =>
    as(token).post(`/v1/schools/${schoolId}/charge-payments/${transactionId}/refund`, { notes: 'Returned item', ...body });
  const staffView = async (studentId: string, token = tokens.owner) => {
    const res = await as(token).get(`/v1/schools/${school.id}/students/${studentId}/charges`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const memberView = async (label: string, studentId: string) => {
    const res = await as(tokens[label]).get(`/v1/students/${studentId}/charges`);
    expect(res.status).toBe(200);
    return res.body.schools.find((s: { schoolId: string }) => s.schoolId === school.id);
  };
  const tx = (id: string) => su.transaction.findUniqueOrThrow({ where: { id } });
  const balanceSum = async (studentId: string) => (await su.balanceEntry.aggregate({ where: { schoolId: school.id, studentId }, _sum: { amount: true } }))._sum.amount ?? 0;

  async function event(eventType: string, objectId: string) {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: acct }, attemptsMade: 1, opts: { attempts: 3 } } as never);
  }

  async function notices(userId: string, expected: number, title?: string) {
    const where = { userId, type: 'CHARGE', ...(title ? { title } : {}) };
    for (let i = 0; i < 60; i++) {
      const rows = await su.notification.findMany({ where, orderBy: { createdAt: 'asc' } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return su.notification.findMany({ where, orderBy: { createdAt: 'asc' } });
  }
  /** Lets the notification worker catch up before checking that nothing came. */
  const settle = () => new Promise((r) => setTimeout(r, 1500));
  const setSchool = (data: Record<string, unknown>) => su.school.update({ where: { id: school.id }, data });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    webhook = app.get(StripeWebhookProcessingProcessor);
    autoPay = app.get(ChargeAutoPayProcessor);
    overdueJob = app.get(ChargeOverdueNoticeProcessor);
    dueReminder = app.get(ChargeDueReminderProcessor);
    lateFees = app.get(LateFeeProcessor);
    await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });

    school = await su.school.create({ data: { id: randomUUID(), name: 'Refunds School', defaultCurrency: 'BRL', addressCountry: COUNTRY, timezone: 'UTC' } });
    other = await su.school.create({ data: { id: randomUUID(), name: 'Other Refunds School', defaultCurrency: 'BRL', timezone: 'UTC' } });
    schoolIds.push(school.id, other.id);
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: COUNTRY, stripeConnectedAccountId: acct } });
    branchA = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch A' } });

    const owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokens.owner = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    const otherOwner = await mkUser('otherOwner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: other.id, isMainOwner: true } });
    tokens.otherOwner = sign(otherOwner, 'SCHOOL_OWNER_MANAGER', other.id);
    await mkStaff('staffA', 'BRANCH_STAFF', branchA.id);
    await mkStaff('coachA', 'INSTRUCTOR', branchA.id);
  });

  afterEach(() => {
    offSessionStatus = 'succeeded';
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.chargeRefund.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    // Late fees point at the charge they are for: those go first.
    await su.charge.deleteMany({ where: { ...where, lateFeeForChargeId: { not: null } } });
    await su.charge.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.studentHomeBranch.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.staffPermission.deleteMany({ where });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.branch.deleteMany({ where });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('Refunds (Decision 338 item 3)', () => {
    it('refunds a card payment in full to the card: Refunded, and the charge is not re-opened', async () => {
      const student = await mkStudent('cardFull');
      const c = await createCharge(student.id, 10000);
      const paymentId = await cardPay('cardFull', student.id, c.id);
      const intent = (await tx(paymentId)).stripePaymentIntentId!;

      const res = await refund(paymentId, { amount: 10000, destination: 'CARD' });
      expect(res.status).toBe(201);
      expect(refunds[refunds.length - 1]).toEqual({ payment_intent: intent, amount: 10000 });
      expect(await tx(paymentId)).toMatchObject({ status: 'REFUNDED', refundedAmount: 10000 });
      expect(res.body.payment).toMatchObject({ refundedAmount: 10000, refundStatus: 'REFUNDED', refundable: null });
      expect(res.body.payment.refunds).toEqual([expect.objectContaining({ kind: 'CARD', amount: 10000, notes: 'Returned item' })]);

      const charge = await su.charge.findUniqueOrThrow({ where: { id: c.id } });
      expect(charge.refundedAmount).toBe(10000);
      expect(await balanceSum(student.id)).toBe(0);
      const view = await memberView('cardFull', student.id);
      expect(view.charges[0]).toMatchObject({ status: 'PAID', owedAmount: 0, refundStatus: 'REFUNDED', refundedAmount: 10000 });
      expect(view.payments[0]).toMatchObject({ refundStatus: 'REFUNDED', refundable: null });
      // The member never sees the notes.
      expect(view.payments[0].refunds[0]).toMatchObject({ kind: 'CARD', amount: 10000, notes: null, refundedByName: null });
      expect(view.balances[0]).toMatchObject({ net: 0, owed: 0, credit: 0 });
    });

    it('refunds part of a card payment, and refuses more than is left', async () => {
      const student = await mkStudent('cardPart');
      const c = await createCharge(student.id, 10000);
      const paymentId = await cardPay('cardPart', student.id, c.id);

      let view = await staffView(student.id);
      expect(view.payments[0].refundable).toEqual({ asMoney: 10000, asCredit: 10000 });
      expect((await refund(paymentId, { amount: 3000, destination: 'CARD' })).status).toBe(201);
      expect(await tx(paymentId)).toMatchObject({ status: 'SUCCESSFUL', refundedAmount: 3000 });
      view = await staffView(student.id);
      expect(view.charges[0]).toMatchObject({ status: 'PAID', owedAmount: 0, refundStatus: 'PART_REFUNDED', refundedAmount: 3000, paidAmount: 7000 });
      expect(view.payments[0]).toMatchObject({ refundStatus: 'PART_REFUNDED', refundable: { asMoney: 7000, asCredit: 7000 } });
      expect(view.balances[0]).toMatchObject({ net: 0 });

      const over = await refund(paymentId, { amount: 7001, destination: 'CARD' });
      expect(over.status).toBe(400);
      expect(over.body.error.code).toBe('CHARGE_REFUND_TOO_MUCH');
      expect(refunds.filter((r) => r.amount === 7001)).toHaveLength(0);

      // Cancelling it afterwards: only what the School kept becomes credit.
      const cancel = await as(tokens.owner).post(`/v1/schools/${school.id}/charges/${c.id}/cancel`, { reason: 'Changed mind' });
      expect(cancel.status).toBe(201);
      view = await staffView(student.id);
      expect(view.balances[0]).toMatchObject({ net: -7000, credit: 7000 });
    });

    it('turns a payment into credit: the charge comes down, the credit pays the next charge', async () => {
      const student = await mkStudent('asCredit');
      const c = await createCharge(student.id, 10000);
      const paymentId = await deskPay(student.id, 10000, c.id);

      const res = await refund(paymentId, { amount: 4000, destination: 'CREDIT' });
      expect(res.status).toBe(201);
      // Not money given back: the Transaction is unchanged.
      expect(await tx(paymentId)).toMatchObject({ status: 'SUCCESSFUL', refundedAmount: null });
      let view = await staffView(student.id);
      expect(view.charges[0]).toMatchObject({ status: 'PAID', owedAmount: 0, refundStatus: 'PART_REFUNDED', refundedAmount: 4000 });
      expect(view.balances[0]).toMatchObject({ net: -4000, credit: 4000 });

      // Only the part on charges can become credit.
      const tooMuch = await refund(paymentId, { amount: 6001, destination: 'CREDIT' });
      expect(tooMuch.status).toBe(400);

      const next = await createCharge(student.id, 5000);
      view = await staffView(student.id);
      expect(view.charges.find((x: { id: string }) => x.id === next.id)).toMatchObject({ owedAmount: 1000, status: 'PART_PAID' });
      expect(view.balances[0]).toMatchObject({ net: 1000, credit: 0 });
    });

    it('a cash payment can only be given back (records only) or turned into credit', async () => {
      const student = await mkStudent('cashBack');
      const c = await createCharge(student.id, 8000);
      const paymentId = await deskPay(student.id, 8000, c.id, 'PIX');
      const before = refunds.length;

      const toCard = await refund(paymentId, { amount: 1000, destination: 'CARD' });
      expect(toCard.status).toBe(400);
      expect(toCard.body.error.code).toBe('CHARGE_REFUND_NOT_A_CARD_PAYMENT');

      expect((await refund(paymentId, { amount: 8000, destination: 'MONEY_BACK' })).status).toBe(201);
      expect(refunds.length).toBe(before);
      expect(await tx(paymentId)).toMatchObject({ status: 'REFUNDED', refundedAmount: 8000 });
      const view = await staffView(student.id);
      expect(view.charges[0]).toMatchObject({ owedAmount: 0, refundStatus: 'REFUNDED' });
      expect(view.balances[0]).toMatchObject({ net: 0 });
      // Fully refunded: nothing more.
      expect((await refund(paymentId, { amount: 1, destination: 'MONEY_BACK' })).status).toBe(409);
    });

    it('a card payment is never "given back in cash"', async () => {
      const student = await mkStudent('cardNotCash');
      const c = await createCharge(student.id, 3000);
      const paymentId = await cardPay('cardNotCash', student.id, c.id);
      const res = await refund(paymentId, { amount: 1000, destination: 'MONEY_BACK' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHARGE_REFUND_CARD_PAYMENT');
    });

    it('an overpayment is given back from the credit first, leaving the charge paid', async () => {
      const student = await mkStudent('overpaid');
      const c = await createCharge(student.id, 10000);
      const paymentId = await deskPay(student.id, 15000, c.id);
      expect((await staffView(student.id)).balances[0]).toMatchObject({ credit: 5000 });
      expect((await refund(paymentId, { amount: 5000, destination: 'MONEY_BACK' })).status).toBe(201);
      const view = await staffView(student.id);
      expect(view.charges[0]).toMatchObject({ status: 'PAID', refundedAmount: 0, refundStatus: null });
      expect(view.balances[0]).toMatchObject({ net: 0, credit: 0 });
      expect(view.payments[0]).toMatchObject({ refundStatus: 'PART_REFUNDED', refundable: { asMoney: 10000, asCredit: 10000 } });
    });

    it('owner only; notes required unless the owner makes them optional', async () => {
      const student = await mkStudent('whoRefunds');
      const c = await createCharge(student.id, 2000);
      const paymentId = await deskPay(student.id, 2000, c.id);
      await setSchool({ branchStaffCanRecordPayments: true });
      try {
        expect((await refund(paymentId, { amount: 500, destination: 'MONEY_BACK' }, tokens.staffA)).status).toBe(403);
        expect((await refund(paymentId, { amount: 500, destination: 'MONEY_BACK' }, tokens.coachA)).status).toBe(403);
        expect((await refund(paymentId, { amount: 500, destination: 'MONEY_BACK' }, tokens.whoRefunds)).status).toBe(403);
        // Staff never get the refund action.
        expect((await staffView(student.id, tokens.staffA)).can).toMatchObject({ refund: false, addCredit: false, recordPayment: true });
      } finally {
        await setSchool({ branchStaffCanRecordPayments: false });
      }

      const noNotes = await refund(paymentId, { amount: 500, destination: 'MONEY_BACK', notes: '  ' });
      expect(noNotes.status).toBe(400);
      expect(noNotes.body.error.code).toBe('CHARGE_REFUND_NOTES_REQUIRED');
      await setSchool({ chargeRefundNotesRequired: false });
      try {
        const ok = await as(tokens.owner).post(`/v1/schools/${school.id}/charge-payments/${paymentId}/refund`, { amount: 500, destination: 'MONEY_BACK' });
        expect(ok.status).toBe(201);
        expect(ok.body.payment.refunds[0]).toMatchObject({ notes: null });
      } finally {
        await setSchool({ chargeRefundNotesRequired: true });
      }
    });

    it('another School can neither refund nor see the payment', async () => {
      const student = await mkStudent('otherSchool');
      const c = await createCharge(student.id, 2000);
      const paymentId = await deskPay(student.id, 2000, c.id);
      expect((await refund(paymentId, { amount: 500, destination: 'MONEY_BACK' }, tokens.otherOwner)).status).toBe(403);
      // Through its own School's URL the payment doesn't exist.
      const res = await refund(paymentId, { amount: 500, destination: 'MONEY_BACK' }, tokens.otherOwner, other.id);
      expect(res.status).toBe(404);
      expect(await su.chargeRefund.count({ where: { transactionId: paymentId } })).toBe(0);
    });
  });

  describe('Stripe: a lost dispute and a refund made in the dashboard', () => {
    it('a lost dispute is a refund to the card of the disputed amount; the member is told', async () => {
      const student = await mkStudent('disputed');
      const c = await createCharge(student.id, 6000);
      const paymentId = await cardPay('disputed', student.id, c.id);
      const intent = (await tx(paymentId)).stripePaymentIntentId!;
      const before = (await notices(student.id, 1)).length;

      nextDispute = { id: `dp_${randomUUID()}`, status: 'needs_response', amount: 6000, currency: 'brl', payment_intent: intent };
      await event('charge.dispute.created', nextDispute.id);
      expect((await tx(paymentId)).status).toBe('DISPUTED');
      // Disputed: not refundable meanwhile.
      expect((await refund(paymentId, { amount: 100, destination: 'CREDIT' })).status).toBe(409);
      nextDispute = { ...nextDispute, status: 'lost' };
      await event('charge.dispute.closed', nextDispute.id);
      await event('charge.dispute.closed', nextDispute.id);

      const rows = await su.chargeRefund.findMany({ where: { transactionId: paymentId } });
      expect(rows).toEqual([expect.objectContaining({ kind: 'DISPUTE_LOST', amount: 6000, refundedById: null })]);
      expect(await tx(paymentId)).toMatchObject({ status: 'DISPUTED', refundedAmount: null });
      const view = await memberView('disputed', student.id);
      expect(view.charges[0]).toMatchObject({ status: 'PAID', owedAmount: 0, refundStatus: 'REFUNDED' });
      expect(view.balances[0]).toMatchObject({ net: 0 });
      const disputeNotices = await notices(student.id, 2, 'Payment dispute');
      expect(disputeNotices.map((n) => n.body)).toEqual([
        'Your card payment of 60.00 BRL is being disputed with your bank.',
        'The dispute on your card payment of 60.00 BRL was decided in your favour. The money goes back to your card.',
      ]);
      expect((await notices(student.id, before + 2)).length).toBe(before + 2);
    });

    it('no dispute notice to the member when the School switched it off', async () => {
      const student = await mkStudent('disputeQuiet');
      const c = await createCharge(student.id, 1000);
      const paymentId = await cardPay('disputeQuiet', student.id, c.id);
      await setSchool({ chargeNoticeDispute: false });
      try {
        nextDispute = { id: `dp_${randomUUID()}`, status: 'lost', amount: 1000, currency: 'brl', payment_intent: (await tx(paymentId)).stripePaymentIntentId! };
        await event('charge.dispute.closed', nextDispute.id);
        await settle();
        expect(await su.notification.count({ where: { userId: student.id, title: 'Payment dispute' } })).toBe(0);
        expect(await su.chargeRefund.count({ where: { transactionId: paymentId, kind: 'DISPUTE_LOST' } })).toBe(1);
      } finally {
        await setSchool({ chargeNoticeDispute: true });
      }
    });

    it('a refund made in the Stripe dashboard goes on the ledger once; refunds sent from ULTM8 are not counted twice', async () => {
      const student = await mkStudent('dashboard');
      const c = await createCharge(student.id, 9000);
      const paymentId = await cardPay('dashboard', student.id, c.id);
      const intent = (await tx(paymentId)).stripePaymentIntentId!;

      nextCharge = { id: `ch_${randomUUID()}`, amount_refunded: 2000, payment_intent: intent };
      await event('charge.refunded', nextCharge.id);
      await event('charge.refunded', nextCharge.id);
      expect(await su.chargeRefund.findMany({ where: { transactionId: paymentId } })).toEqual([expect.objectContaining({ kind: 'STRIPE', amount: 2000 })]);
      expect(await tx(paymentId)).toMatchObject({ refundedAmount: 2000, status: 'SUCCESSFUL' });

      expect((await refund(paymentId, { amount: 1000, destination: 'CARD' })).status).toBe(201);
      nextCharge = { ...nextCharge, amount_refunded: 3000 };
      await event('charge.refunded', nextCharge.id);
      expect(await su.chargeRefund.count({ where: { transactionId: paymentId } })).toBe(2);
      expect(await tx(paymentId)).toMatchObject({ refundedAmount: 3000 });
      const view = await staffView(student.id);
      expect(view.charges[0]).toMatchObject({ owedAmount: 0, refundedAmount: 3000, refundStatus: 'PART_REFUNDED' });
      expect(view.balances[0]).toMatchObject({ net: 0 });
    });
  });

  describe('Credit the owner gives', () => {
    it('adds credit with a note, which pays the next charge; owner only', async () => {
      const student = await mkStudent('goodwill');
      const res = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${student.id}/credits`, { amount: 2500, note: 'Sorry for the cancelled class' });
      expect(res.status).toBe(201);
      expect(res.body.balances[0]).toMatchObject({ net: -2500, credit: 2500 });
      const missing = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${student.id}/credits`, { amount: 100, note: ' ' });
      expect(missing.status).toBe(400);
      await setSchool({ branchStaffCanRecordPayments: true });
      try {
        expect((await as(tokens.staffA).post(`/v1/schools/${school.id}/students/${student.id}/credits`, { amount: 100, note: 'x' })).status).toBe(403);
      } finally {
        await setSchool({ branchStaffCanRecordPayments: false });
      }
      expect((await as(tokens.otherOwner).post(`/v1/schools/${school.id}/students/${student.id}/credits`, { amount: 100, note: 'x' })).status).toBe(403);

      let view = await staffView(student.id);
      expect(view.credits).toEqual([expect.objectContaining({ amount: 2500, note: 'Sorry for the cancelled class' })]);
      const member = await memberView('goodwill', student.id);
      expect(member.credits).toEqual([expect.objectContaining({ amount: 2500, note: null, givenByName: null })]);

      await createCharge(student.id, 2000);
      view = await staffView(student.id);
      expect(view.charges[0]).toMatchObject({ status: 'PAID' });
      expect(view.balances[0]).toMatchObject({ net: -500, credit: 500 });
    });
  });

  describe('Reports (Decision 338 item 11)', () => {
    it('Overview and Member balances: the owner sees the School; Branch Staff their branches when they may take payments', async () => {
      const r = await su.school.create({ data: { id: randomUUID(), name: 'Reports School', defaultCurrency: 'BRL', timezone: 'UTC' } });
      schoolIds.push(r.id);
      await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: r.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });
      const rA = await su.branch.create({ data: { id: randomUUID(), schoolId: r.id, name: 'North' } });
      const rB = await su.branch.create({ data: { id: randomUUID(), schoolId: r.id, name: 'South' } });
      const owner = await mkUser('reportsOwner');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: r.id, isMainOwner: true } });
      const ownerToken = sign(owner, 'SCHOOL_OWNER_MANAGER', r.id);
      const staff = await mkUser('reportsStaff');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: r.id, branchId: rA.id } });
      const staffToken = sign(staff, 'BRANCH_STAFF', r.id, rA.id);
      const coach = await mkUser('reportsCoach');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: r.id, branchId: rA.id } });
      const coachToken = sign(coach, 'INSTRUCTOR', r.id, rA.id);

      const north = await mkStudent('north', rA.id, r.id);
      const south = await mkStudent('south', rB.id, r.id);
      const settled = await mkStudent('settled', rA.id, r.id);
      const post = (url: string, body: Record<string, unknown>) => as(ownerToken).post(`/v1/schools/${r.id}${url}`, body);
      // North owes 50 overdue and 30 not yet due; South is 20 in credit; Settled paid in full.
      expect((await post(`/students/${north.id}/charges`, { description: 'Old', amount: 5000, dueDate: day(-3) })).status).toBe(201);
      expect((await post(`/students/${north.id}/charges`, { description: 'New', amount: 3000, dueDate: day(10) })).status).toBe(201);
      expect((await post(`/students/${south.id}/charge-payments`, { amount: 2000, paymentMethod: 'CASH', sendReceipt: false })).status).toBe(201);
      const paid = await post(`/students/${settled.id}/charges`, { description: 'Gi', amount: 4000, dueDate: day(1) });
      const payRes = await post(`/students/${settled.id}/charge-payments`, { amount: 4000, chargeId: paid.body.id, paymentMethod: 'CASH', sendReceipt: false });
      expect(payRes.status).toBe(201);
      expect((await as(ownerToken).post(`/v1/schools/${r.id}/charge-payments/${payRes.body.payment.id}/refund`, { amount: 1000, destination: 'MONEY_BACK', notes: 'Wrong size' })).status).toBe(201);

      const overview = await as(ownerToken).get(`/v1/schools/${r.id}/charge-reports/overview?months=3`);
      expect(overview.status).toBe(200);
      expect(overview.body).toMatchObject({ months: 3, wholeSchool: true });
      const brl = overview.body.currencies[0];
      expect(brl).toMatchObject({ currency: 'BRL', scheduled: 3000, overdue: 5000, paid: 5000 });
      expect(brl.revenueByMonth).toHaveLength(3);
      expect(brl.revenueByMonth[2]).toMatchObject({ month: day(0).slice(0, 7), received: 6000, refunded: 1000, net: 5000 });

      const balances = await as(ownerToken).get(`/v1/schools/${r.id}/charge-reports/member-balances`);
      expect(balances.status).toBe(200);
      expect(balances.body.items).toEqual([
        expect.objectContaining({ studentId: north.id, owed: 8000, overdue: 5000, net: 8000, credit: 0 }),
        expect.objectContaining({ studentId: south.id, owed: 0, credit: 2000, net: -2000 }),
      ]);

      // Branch Staff: refused until the School lets them take payments, then their branch only.
      expect((await as(staffToken).get(`/v1/schools/${r.id}/charge-reports/member-balances`)).status).toBe(403);
      await su.school.update({ where: { id: r.id }, data: { branchStaffCanRecordPayments: true } });
      const scoped = await as(staffToken).get(`/v1/schools/${r.id}/charge-reports/member-balances`);
      expect(scoped.status).toBe(200);
      expect(scoped.body.wholeSchool).toBe(false);
      expect(scoped.body.items.map((i: { studentId: string }) => i.studentId)).toEqual([north.id]);
      const scopedOverview = await as(staffToken).get(`/v1/schools/${r.id}/charge-reports/overview`);
      expect(scopedOverview.body.currencies[0]).toMatchObject({ scheduled: 3000, overdue: 5000, paid: 3000 });
      expect((await as(coachToken).get(`/v1/schools/${r.id}/charge-reports/overview`)).status).toBe(403);
      expect((await as(tokens.owner).get(`/v1/schools/${r.id}/charge-reports/overview`)).status).toBe(403);
      expect((await as(tokens.north).get(`/v1/schools/${r.id}/charge-reports/member-balances`)).status).toBe(403);
    });

    it('Overview revenue: charges, memberships and the total (Decision 414 item 3), with no payment counted twice', async () => {
      const r = await su.school.create({ data: { id: randomUUID(), name: 'Revenue School', defaultCurrency: 'BRL', timezone: 'UTC' } });
      const x = await su.school.create({ data: { id: randomUUID(), name: 'Other Revenue School', defaultCurrency: 'BRL', timezone: 'UTC' } });
      schoolIds.push(r.id, x.id);
      const account = await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: r.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });
      const xAccount = await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: x.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });
      const rA = await su.branch.create({ data: { id: randomUUID(), schoolId: r.id, name: 'North' } });
      const rB = await su.branch.create({ data: { id: randomUUID(), schoolId: r.id, name: 'South' } });
      const owner = await mkUser('revenueOwner');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: r.id, isMainOwner: true } });
      const ownerToken = sign(owner, 'SCHOOL_OWNER_MANAGER', r.id);
      const staff = await mkUser('revenueStaff');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: r.id, branchId: rA.id } });
      const staffToken = sign(staff, 'BRANCH_STAFF', r.id, rA.id);
      const north = await mkStudent('revNorth', rA.id, r.id);
      const south = await mkStudent('revSouth', rB.id, r.id);
      const outsider = await mkStudent('revOutsider', null, x.id);
      const plan = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: r.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 10000, currency: 'BRL' } });
      const pack = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: r.id, type: 'CLASS_PACK', title: '10 classes', price: 6000, currency: 'BRL' } });
      const xPlan = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: x.id, type: 'SUBSCRIPTION', title: 'Other', price: 99999, currency: 'BRL' } });

      const now = new Date();
      const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));
      const longAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 15, 12));
      const row = (data: {
        studentId: string;
        amount: number;
        kind?: 'MEMBERSHIP' | 'RENEWAL' | 'LATE_CANCEL_FEE' | 'FREEZE_FEE';
        status?: 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'DISPUTED';
        currency?: string;
        refundedAmount?: number;
        billingDate?: Date;
        planId?: string | null;
        schoolId?: string;
      }) =>
        su.transaction.create({
          data: {
            id: randomUUID(),
            schoolId: data.schoolId ?? r.id,
            studentId: data.studentId,
            paymentAccountId: data.schoolId === x.id ? xAccount.id : account.id,
            membershipPlanId: data.planId === undefined ? plan.id : data.planId,
            kind: data.kind ?? 'MEMBERSHIP',
            amount: data.amount,
            currency: data.currency ?? 'BRL',
            status: data.status ?? 'SUCCESSFUL',
            paymentMethod: 'CASH',
            refundedAmount: data.refundedAmount ?? null,
            billingDate: data.billingDate ?? now,
          },
        });
      // Counted: a plan bought (North), a renewal partly refunded (North, 100 − 25),
      // a Class Pack sold at the desk with its currency in lower case (South),
      // last month's renewal (North), and a late-cancellation fee and a freeze
      // fee (North; Decision 415 item 2).
      await row({ studentId: north.id, amount: 10000 });
      await row({ studentId: north.id, amount: 10000, kind: 'RENEWAL', refundedAmount: 2500 });
      await row({ studentId: south.id, amount: 6000, planId: pack.id, currency: 'brl' });
      await row({ studentId: north.id, amount: 3000, kind: 'RENEWAL', billingDate: lastMonth });
      await row({ studentId: north.id, amount: 500, kind: 'LATE_CANCEL_FEE', planId: null });
      await row({ studentId: north.id, amount: 700, kind: 'FREEZE_FEE' });
      // Not counted: refunded in full, waiting, failed (or cancelled), disputed,
      // older than the period, and another School.
      await row({ studentId: north.id, amount: 4000, status: 'REFUNDED', refundedAmount: 4000 });
      await row({ studentId: north.id, amount: 3000, status: 'PENDING' });
      await row({ studentId: north.id, amount: 3000, status: 'FAILED' });
      await row({ studentId: north.id, amount: 3000, status: 'DISPUTED' });
      await row({ studentId: north.id, amount: 2000, kind: 'RENEWAL', billingDate: longAgo });
      await row({ studentId: outsider.id, amount: 99999, schoolId: x.id, planId: xPlan.id });
      // Another currency stays apart (South).
      await row({ studentId: south.id, amount: 1500, currency: 'USD' });

      // A charge paid at the desk (a CHARGE_PAYMENT Transaction) and 10 given back:
      // counted once, in charges.
      const post = (url: string, body: Record<string, unknown>) => as(ownerToken).post(`/v1/schools/${r.id}${url}`, body);
      const charge = await post(`/students/${north.id}/charges`, { description: 'Gi', amount: 5000, dueDate: day(1) });
      expect(charge.status).toBe(201);
      const payRes = await post(`/students/${north.id}/charge-payments`, { amount: 5000, chargeId: charge.body.id, paymentMethod: 'CASH', sendReceipt: false });
      expect(payRes.status).toBe(201);
      expect((await post(`/charge-payments/${payRes.body.payment.id}/refund`, { amount: 1000, destination: 'MONEY_BACK', notes: 'Wrong size' })).status).toBe(201);
      expect(await su.transaction.count({ where: { schoolId: r.id, kind: 'CHARGE_PAYMENT', status: 'SUCCESSFUL' } })).toBe(1);

      const thisMonth = day(0).slice(0, 7);
      const overview = await as(ownerToken).get(`/v1/schools/${r.id}/charge-reports/overview?months=3`);
      expect(overview.status).toBe(200);
      expect(overview.body.currencies.map((c: { currency: string }) => c.currency)).toEqual(['BRL', 'USD']);
      const [brl, usd] = overview.body.currencies;
      expect(brl).toMatchObject({ currency: 'BRL', paid: 4000, memberships: 27700, total: 31700 });
      expect(brl.revenueByMonth[2]).toEqual({ month: thisMonth, received: 5000, refunded: 1000, net: 4000, memberships: 24700, total: 28700 });
      expect(brl.revenueByMonth[1]).toMatchObject({ received: 0, net: 0, memberships: 3000, total: 3000 });
      expect(brl.revenueByMonth[0]).toMatchObject({ memberships: 0, total: 0 });
      expect(usd).toMatchObject({ currency: 'USD', scheduled: 0, overdue: 0, paid: 0, memberships: 1500, total: 1500 });

      // One month: last month's renewal is outside it.
      const oneMonth = await as(ownerToken).get(`/v1/schools/${r.id}/charge-reports/overview?months=1`);
      expect(oneMonth.body.currencies[0]).toMatchObject({ currency: 'BRL', paid: 4000, memberships: 24700, total: 28700 });

      // Branch Staff (North only, once they may take payments): North's memberships, no South, no USD.
      await su.school.update({ where: { id: r.id }, data: { branchStaffCanRecordPayments: true } });
      const scoped = await as(staffToken).get(`/v1/schools/${r.id}/charge-reports/overview?months=3`);
      expect(scoped.status).toBe(200);
      expect(scoped.body.wholeSchool).toBe(false);
      expect(scoped.body.currencies).toHaveLength(1);
      expect(scoped.body.currencies[0]).toMatchObject({ currency: 'BRL', paid: 4000, memberships: 21700, total: 25700 });
      expect(scoped.body.currencies[0].revenueByMonth[2]).toMatchObject({ net: 4000, memberships: 18700, total: 22700 });

      // The other School sees only its own membership.
      const xOwner = await mkUser('revenueOtherOwner');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: xOwner.id, schoolId: x.id, isMainOwner: true } });
      const xView = await as(sign(xOwner, 'SCHOOL_OWNER_MANAGER', x.id)).get(`/v1/schools/${x.id}/charge-reports/overview?months=3`);
      expect(xView.body.currencies).toEqual([expect.objectContaining({ currency: 'BRL', paid: 0, memberships: 99999, total: 99999 })]);
      expect((await as(ownerToken).get(`/v1/schools/${x.id}/charge-reports/overview`)).status).toBe(403);
    });
  });

  describe('Payment notifications (Decision 338 items 5 and 10)', () => {
    it('receipts can be switched off; "New invoice" is always sent', async () => {
      const student = await mkStudent('quietReceipt');
      await setSchool({ chargeNoticeReceipt: false });
      try {
        const c = await createCharge(student.id, 1500);
        const res = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${student.id}/charge-payments`, { amount: 1500, chargeId: c.id, paymentMethod: 'CASH', sendReceipt: true });
        expect(res.status).toBe(201);
        expect((await staffView(student.id)).settings.receiptNotice).toBe(false);
        await settle();
        const rows = await su.notification.findMany({ where: { userId: student.id, type: 'CHARGE' } });
        expect(rows.map((n) => n.title)).toEqual(['New invoice']);
      } finally {
        await setSchool({ chargeNoticeReceipt: true });
      }
    });

    it('"Automatic payment failed" follows the failed-or-overdue switch', async () => {
      const student = await mkStudent('quietAutoPay');
      await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: student.id, schoolId: school.id, stripeCustomerId: `cus_${randomUUID()}`, autoPayCharges: true } });
      await createCharge(student.id, 1200, day(0));
      offSessionStatus = 'requires_payment_method';
      await setSchool({ chargeNoticeFailedOverdue: false });
      try {
        await autoPay.run(new Date());
        await settle();
        expect(await su.notification.count({ where: { userId: student.id, title: 'Automatic payment failed' } })).toBe(0);
        expect(await su.transaction.count({ where: { studentId: student.id, status: 'FAILED', chargePaymentChannel: 'AUTOMATIC' } })).toBe(1);
      } finally {
        await setSchool({ chargeNoticeFailedOverdue: true });
      }
    });

    it('"Payment overdue" goes once per charge, the day after its due date, unless switched off', async () => {
      const student = await mkStudent('overdue');
      const late = await createCharge(student.id, 3000, day(-1));
      const today = await createCharge(student.id, 1000, day(0));
      const paidLate = await createCharge(student.id, 2000, day(-2));
      await deskPay(student.id, 2000, paidLate.id);

      await overdueJob.run(new Date());
      await overdueJob.run(new Date());
      const rows = await notices(student.id, 1, 'Payment overdue');
      await settle();
      expect(await su.notification.count({ where: { userId: student.id, title: 'Payment overdue' } })).toBe(1);
      expect(rows[0].body).toBe(`Invoice ${late.invoiceLabel} for Item ${seq - 2} was due on ${day(-1)}. 30.00 BRL is still to pay.`);
      expect((await su.charge.findUniqueOrThrow({ where: { id: today.id } })).overdueNoticeAt).toBeNull();
      expect((await su.charge.findUniqueOrThrow({ where: { id: paidLate.id } })).overdueNoticeAt).toBeNull();

      const quiet = await mkStudent('overdueQuiet');
      const q = await createCharge(quiet.id, 3000, day(-1));
      await setSchool({ chargeNoticeFailedOverdue: false });
      try {
        await overdueJob.run(new Date());
      } finally {
        await setSchool({ chargeNoticeFailedOverdue: true });
      }
      // Marked handled, so turning the switch back on sends nothing old.
      await overdueJob.run(new Date());
      await settle();
      expect((await su.charge.findUniqueOrThrow({ where: { id: q.id } })).overdueNoticeAt).not.toBeNull();
      expect(await su.notification.count({ where: { userId: quiet.id, title: 'Payment overdue' } })).toBe(0);
    });

    it('staff who may create charges resend an invoice; a cancelled one is not resent', async () => {
      const student = await mkStudent('resend');
      const c = await createCharge(student.id, 4500);
      await notices(student.id, 1);
      const res = await as(tokens.staffA).post(`/v1/schools/${school.id}/charges/${c.id}/resend-invoice`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ sent: true });
      const rows = await notices(student.id, 2, 'New invoice');
      expect(rows).toHaveLength(2);
      expect(rows[1].body).toBe(rows[0].body);
      expect((await as(tokens.coachA).post(`/v1/schools/${school.id}/charges/${c.id}/resend-invoice`)).status).toBe(403);
      expect((await as(tokens.otherOwner).post(`/v1/schools/${school.id}/charges/${c.id}/resend-invoice`)).status).toBe(403);
      await as(tokens.owner).post(`/v1/schools/${school.id}/charges/${c.id}/cancel`, { reason: 'Mistake' });
      expect((await as(tokens.owner).post(`/v1/schools/${school.id}/charges/${c.id}/resend-invoice`)).status).toBe(409);
    });
  });

  describe('Refunds and the other jobs: what a charge owes is after refunds', () => {
    it('a late fee is never charged on a refunded part', async () => {
      const lf = await su.school.create({
        data: {
          id: randomUUID(), name: 'Late Fee Refunds School', defaultCurrency: 'BRL', timezone: 'UTC',
          lateFeeEnabled: true, lateFeeType: 'PERCENT', lateFeePercentBps: 1000, lateFeeGraceDays: 0,
          lateFeeEnabledAt: new Date('2026-01-01T00:00:00Z'), lateFeeConfirmedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      schoolIds.push(lf.id);
      await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: lf.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });
      const owner = await mkUser('lfOwner');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: lf.id, isMainOwner: true } });
      const token = sign(owner, 'SCHOOL_OWNER_MANAGER', lf.id);
      const post = (url: string, body: Record<string, unknown>) => as(token).post(`/v1/schools/${lf.id}${url}`, body);
      const pay = async (studentId: string, chargeId: string, amount: number) =>
        (await post(`/students/${studentId}/charge-payments`, { amount, chargeId, paymentMethod: 'CASH', sendReceipt: false })).body.payment.id as string;

      // Paid in full, then 30.00 given back: nothing is owed, so no late fee.
      const full = await mkStudent('lfFull', null, lf.id);
      const c1 = (await post(`/students/${full.id}/charges`, { description: 'Gi', amount: 10000, dueDate: day(-3) })).body;
      const p1 = await pay(full.id, c1.id, 10000);
      expect((await post(`/charge-payments/${p1}/refund`, { amount: 3000, destination: 'MONEY_BACK', notes: 'x' })).status).toBe(201);
      // Part paid (60.00 of 100.00), then 20.00 of it given back: 40.00 still owed, and 10% of that.
      const part = await mkStudent('lfPart', null, lf.id);
      const c2 = (await post(`/students/${part.id}/charges`, { description: 'Belt', amount: 10000, dueDate: day(-3) })).body;
      const p2 = await pay(part.id, c2.id, 6000);
      expect((await post(`/charge-payments/${p2}/refund`, { amount: 2000, destination: 'MONEY_BACK', notes: 'x' })).status).toBe(201);
      // Paid in full, then 50.00 turned into credit: nothing owed either.
      const credited = await mkStudent('lfCredit', null, lf.id);
      const c3 = (await post(`/students/${credited.id}/charges`, { description: 'Patch', amount: 10000, dueDate: day(-3) })).body;
      const p3 = await pay(credited.id, c3.id, 10000);
      expect((await post(`/charge-payments/${p3}/refund`, { amount: 5000, destination: 'CREDIT', notes: 'x' })).status).toBe(201);

      await lateFees.run(new Date(), [lf.id]);
      const fees = await su.charge.findMany({ where: { schoolId: lf.id, lateFeeForChargeId: { not: null } } });
      expect(fees).toEqual([expect.objectContaining({ lateFeeForChargeId: c2.id, lateFeeOverdueAmount: 4000, grossAmount: 400 })]);
    });

    it('automatic payment never charges a refunded part', async () => {
      const student = await mkStudent('autoRefunded');
      await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: student.id, schoolId: school.id, stripeCustomerId: `cus_${randomUUID()}`, autoPayCharges: true } });
      const c = await createCharge(student.id, 10000, day(0));
      const paymentId = await deskPay(student.id, 10000, c.id);
      expect((await refund(paymentId, { amount: 3000, destination: 'MONEY_BACK' })).status).toBe(201);
      await autoPay.run(new Date());
      expect(await su.transaction.count({ where: { chargeId: c.id, chargePaymentChannel: 'AUTOMATIC' } })).toBe(0);
    });
  });

  describe('"Payment due soon" (Decision 338 item 10; 3 days before, product owner 30 Oct 2026)', () => {
    it('goes once, 3 days before the due date, to a charge still owed; not to one created later than that, paid, or switched off', async () => {
      const student = await mkStudent('dueSoon');
      const inThree = await createCharge(student.id, 2500, day(3));
      const inTwo = await createCharge(student.id, 1000, day(2)); // created 2 days before: no reminder
      const paid = await createCharge(student.id, 1500, day(3));
      await deskPay(student.id, 1500, paid.id);
      const later = await createCharge(student.id, 1200, day(5));

      await dueReminder.run(new Date());
      await dueReminder.run(new Date());
      const rows = await notices(student.id, 1, 'Payment due soon');
      await settle();
      expect(await su.notification.count({ where: { userId: student.id, title: 'Payment due soon' } })).toBe(1);
      expect(rows[0].body).toBe(`Invoice ${inThree.invoiceLabel} for Item ${seq - 3}: 25.00 BRL is due on ${day(3)}.`);
      expect((await su.charge.findUniqueOrThrow({ where: { id: inTwo.id } })).dueReminderAt).toBeNull();
      expect((await su.charge.findUniqueOrThrow({ where: { id: paid.id } })).dueReminderAt).toBeNull();
      expect((await su.charge.findUniqueOrThrow({ where: { id: later.id } })).dueReminderAt).toBeNull();
      // Two days on, the later one is 3 days away.
      await dueReminder.run(new Date(Date.now() + 2 * DAY));
      expect(await notices(student.id, 2, 'Payment due soon')).toHaveLength(2);

      const quiet = await mkStudent('dueSoonQuiet');
      const q = await createCharge(quiet.id, 2500, day(3));
      await setSchool({ chargeNoticeDueReminder: false });
      try {
        await dueReminder.run(new Date());
      } finally {
        await setSchool({ chargeNoticeDueReminder: true });
      }
      await dueReminder.run(new Date());
      await settle();
      expect((await su.charge.findUniqueOrThrow({ where: { id: q.id } })).dueReminderAt).not.toBeNull();
      expect(await su.notification.count({ where: { userId: quiet.id, title: 'Payment due soon' } })).toBe(0);
    });
  });

  describe('Receipts (Decision 338 item 6)', () => {
    it('the School\'s address and payment instructions show on the member\'s invoices', async () => {
      const res = await http()
        .patch(`/v1/schools/${school.id}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ receiptAddress: ' Rua A, 1 - São Paulo ', receiptPaymentInstructions: 'Pix key: refunds@example.test', chargeRefundNotesRequired: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ receiptAddress: 'Rua A, 1 - São Paulo', receiptPaymentInstructions: 'Pix key: refunds@example.test', chargeNoticeReceipt: true });
      const student = await mkStudent('receipt');
      await createCharge(student.id, 1000);
      const view = await memberView('receipt', student.id);
      expect(view).toMatchObject({ receiptAddress: 'Rua A, 1 - São Paulo', receiptPaymentInstructions: 'Pix key: refunds@example.test' });
      // Only the owner changes them.
      expect((await http().patch(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${tokens.staffA}`).send({ chargeNoticeReceipt: false })).status).toBe(403);
    });
  });
});
