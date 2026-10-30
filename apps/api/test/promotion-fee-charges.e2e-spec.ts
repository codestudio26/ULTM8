/**
 * Paying a promotion fee as a charge (v1.3 backlog §3.6 step 6; Decision 303
 * item 5, with Decisions 300, 307, 411, 413): accepting makes one charge, with
 * the School's tax; credit pays it at once; a desk payment, a card payment in
 * the app (the webhook) and automatic payment each settle it, marking the fee
 * Paid and applying the waiting promotion once; waiving or cancelling the fee
 * cancels its charge (paid money becomes credit), and the Payments card can't
 * cancel it; declining makes none; a Guardian accepts for a child; a late fee
 * applies to it; the daily catch-up makes the charges of fees accepted before
 * this change; and another School sees nothing. A fee paid after the
 * student's rank or the ladder changed (its promotion can't apply) is put to
 * the owner once (Decision 414 item 1): cancelling it gives the money back as
 * credit, and grading again cancels it the same way, so the money pays the new
 * grade's fee (Decision 415 item 1). Real HTTP, real Postgres
 * roles and RLS, the real webhook and job processors; Stripe is faked.
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
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { ChargeAutoPayProcessor } from '../src/jobs/charge-auto-pay.processor';
import { LateFeeProcessor } from '../src/jobs/late-fee.processor';
import { PromotionFeeService } from '../src/ranks/promotion-fee.service';
import { giveLiveMembership } from './live-membership';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && process.env.REDIS_URL && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[promotion-fee-charges.e2e-spec] Skipped — database / Redis / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

describeIfDb('Paying a promotion fee as a charge (backlog 3.6 step 6)', () => {
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  let autoPay: ChargeAutoPayProcessor;
  let fees: PromotionFeeService;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const acct = `acct_${randomUUID().slice(0, 8)}`;

  let school: { id: string };
  let schoolB: { id: string };
  let bjj: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const user: Record<string, { id: string; email: string }> = {};
  const token: Record<string, string> = {};
  const userIds: string[] = [];
  const eventIds: string[] = [];

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
      paymentIntents: { create: jest.fn(async () => ({ id: `pi_${randomUUID()}`, status: 'succeeded' })) },
      customers: { retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })) },
    })),
    platformClient: jest.fn(),
  };

  async function mkUser(label: string) {
    const u = await su.user.create({
      data: {
        id: randomUUID(),
        email: `promo-charge-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Charge',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    user[label] = u;
    return u;
  }
  function sign(label: string, role: string | null, schoolId: string | null) {
    token[label] = jwt.sign({
      sub: user[label].id,
      email: user[label].email,
      grants: role ? [{ role, franchiseId: null, schoolId, branchId: null }] : [],
    });
  }
  /** A student on `at`, with a live membership (Decision 283). */
  async function mkStudent(label: string, at: string) {
    const u = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
    await giveLiveMembership(su, school.id, u.id);
    await su.studentRank.create({
      data: {
        id: randomUUID(), studentId: u.id, disciplineId: bjj.id, schoolId: school.id,
        currentRankId: rung[at].rankId, currentStripeId: rung[at].id,
        classesAttendedTowardCheckpoint: 3, dateOfCurrentRank: new Date(Date.now() - 30 * DAY),
      },
    });
    sign(label, 'STUDENT', school.id);
    return u;
  }

  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({ Authorization: `Bearer ${token[label]}` });
  /** The owner awards the next stripe: white-0 → white-1, priced 15.00. */
  async function gradeToPricedStripe(label: string) {
    const res = await http().post(`/v1/students/${user[label].id}/ranks/${bjj.id}/stripe-award`).set(as('owner')).send({});
    expect(res.status).toBe(201);
    expect(res.body.feeRequest).toBeTruthy();
    return res.body.feeRequest.id as string;
  }
  const feeAction = (by: string, id: string, action: 'accept' | 'decline' | 'waive' | 'cancel') =>
    http().post(`/v1/promotion-fee-requests/${id}/${action}`).set(as(by)).send({});
  const chargeOf = (requestId: string) => su.charge.findUnique({ where: { promotionFeeRequestId: requestId }, include: { allocations: true } });
  const paidOn = (c: { allocations: Array<{ amount: number }> }) => c.allocations.reduce((n, a) => n + a.amount, 0);
  const requestRow = (id: string) => su.promotionFeeRequest.findUniqueOrThrow({ where: { id } });
  const stripeOf = async (label: string) =>
    (await su.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: user[label].id, disciplineId: bjj.id } } })).currentStripeId;
  const deskPay = (studentId: string, amount: number, chargeId?: string) =>
    http()
      .post(`/v1/schools/${school.id}/students/${studentId}/charge-payments`)
      .set(as('owner'))
      .send({ amount, paymentMethod: 'CASH', sendReceipt: false, ...(chargeId ? { chargeId } : {}) });
  const promotionsOf = (label: string) => su.promotionEvent.count({ where: { studentId: user[label].id, toStripeTierId: rung['white-1'].id } });

  async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (done(v) || Date.now() - start > timeoutMs) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    webhook = app.get(StripeWebhookProcessingProcessor);
    autoPay = app.get(ChargeAutoPayProcessor);
    fees = app.get(PromotionFeeService);

    // 20% tax added on top (Decision 411), so the charge differs from the price.
    school = await su.school.create({
      data: {
        id: randomUUID(), name: 'Promotion Charge School', ranksToggle: true, defaultCurrency: 'GBP', timezone: 'UTC',
        taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: false, promotionFeeEnabled: true, promotionFeeGradeBeforePaid: false,
      },
    });
    schoolB = await su.school.create({ data: { id: randomUUID(), name: 'Other Charge School', ranksToggle: true, defaultCurrency: 'GBP' } });
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: acct } });
    bjj = await su.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
    // white-0 → white-1 (a stripe priced 15.00) → blue-0.
    for (const [name, order, tiers] of [['white', 0, 2], ['blue', 1, 1]] as Array<[string, number, number]>) {
      const rank = await su.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t < tiers; t++) {
        const tier = await su.rankStripeTier.create({
          data: {
            id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name}-${t}`,
            stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], classesRequired: 3,
            promotionFeeMinor: name === 'white' && t === 1 ? 1500 : null,
          },
        });
        rung[`${name}-${t}`] = { id: tier.id, rankId: rank.id };
      }
    }
    await mkUser('owner');
    await mkUser('ownerB');
    await mkUser('desk'); // Branch Staff with "Can cancel charges"
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner.id, schoolId: school.id, isMainOwner: true },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.ownerB.id, schoolId: schoolB.id, isMainOwner: true },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: user.desk.id, schoolId: school.id },
      ],
    });
    await su.staffPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: user.desk.id, canCreateCharges: true, canCancelCharges: true } });
    sign('owner', 'SCHOOL_OWNER_MANAGER', school.id);
    sign('ownerB', 'SCHOOL_OWNER_MANAGER', schoolB.id);
    sign('desk', 'BRANCH_STAFF', school.id);
  });

  afterAll(async () => {
    const where = { schoolId: { in: [school.id, schoolB.id] } };
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.charge.deleteMany({ where: { ...where, lateFeeForChargeId: { not: null } } });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.promotionFeeRequest.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.staffPermission.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.promotionEvent.deleteMany({ where });
    await su.studentRank.deleteMany({ where });
    await su.rankStripeTier.deleteMany({ where });
    await su.rank.deleteMany({ where });
    await su.discipline.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.guardianLink.deleteMany({ where: { studentId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where });
    for (let attempt = 0; ; attempt++) {
      await su.notification.deleteMany({ where: { userId: { in: userIds } } });
      try {
        await su.user.deleteMany({ where: { id: { in: userIds } } });
        break;
      } catch (err) {
        if (attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await su.school.deleteMany({ where: { id: { in: [school.id, schoolB.id] } } });
    await su.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  it('accepting makes one charge: the rank as description, the price with the School\'s tax, due today', async () => {
    await mkStudent('ann', 'white-0');
    const id = await gradeToPricedStripe('ann');
    // Before accepting, the app shows what accepting would charge.
    const listed = await http().get(`/v1/students/${user.ann.id}/promotion-fee-requests`).set(as('ann'));
    expect(listed.body.items[0]).toMatchObject({ status: 'PENDING', charge: null, taxPreview: { netAmount: 1500, taxAmount: 300, grossAmount: 1800, taxInclusive: false, currency: 'GBP' } });

    const res = await feeAction('ann', id, 'accept');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'ACCEPTED', taxPreview: null, charge: { status: 'OPEN', netAmount: 1500, taxAmount: 300, grossAmount: 1800, owedAmount: 1800, currency: 'GBP', dueDate: today() } });
    const c = await chargeOf(id);
    expect(c).toMatchObject({
      schoolId: school.id, studentId: user.ann.id, description: 'white-1', unitAmount: 1500, discountAmount: 0,
      taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: false, netAmount: 1500, taxAmount: 300, grossAmount: 1800, currency: 'GBP', createdById: null,
    });
    expect(c!.dueDate.toISOString().slice(0, 10)).toBe(today());
    expect(await su.charge.count({ where: { promotionFeeRequestId: id } })).toBe(1);
    // Nothing applies yet: the promotion waits for the fee.
    expect(await stripeOf('ann')).toBe(rung['white-0'].id);
    // Accepting again is refused, and still one charge.
    expect((await feeAction('ann', id, 'accept')).status).toBe(409);
    expect(await su.charge.count({ where: { promotionFeeRequestId: id } })).toBe(1);
    // The usual "New invoice" notice.
    const n = await waitFor(() => su.notification.findUnique({ where: { id: `charge-created-${c!.id}` } }), (v) => v !== null);
    expect(n?.body).toMatch(/^Invoice #\d{7} for white-1: 18\.00 GBP, due \d{4}-\d{2}-\d{2}\.$/);

    // The Payments card labels it a promotion fee, linked to grading.
    const staff = await http().get(`/v1/schools/${school.id}/students/${user.ann.id}/charges`).set(as('owner'));
    expect(staff.status).toBe(200);
    expect(staff.body.charges[0].promotionFee).toEqual({ requestId: id, disciplineId: bjj.id, disciplineName: 'BJJ', toRungName: 'white-1', status: 'ACCEPTED' });
  });

  it('the Payments card cannot cancel a promotion fee\'s charge, for the owner or staff with "Can cancel charges"', async () => {
    const id = (await su.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.ann.id } })).id;
    const c = (await chargeOf(id))!;
    for (const who of ['owner', 'desk']) {
      const res = await http().post(`/v1/schools/${school.id}/charges/${c.id}/cancel`).set(as(who)).send({ reason: 'x' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CHARGE_IS_PROMOTION_FEE');
    }
    expect((await chargeOf(id))!.cancelledAt).toBeNull();
  });

  it('a desk payment that pays it in full marks the fee Paid and applies the waiting promotion once', async () => {
    const id = (await su.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.ann.id } })).id;
    const c = (await chargeOf(id))!;
    // A part payment leaves it Accepted, and the promotion still waits.
    expect((await deskPay(user.ann.id, 1000, c.id)).status).toBe(201);
    expect((await requestRow(id)).status).toBe('ACCEPTED');
    expect(await stripeOf('ann')).toBe(rung['white-0'].id);
    // The rest pays it.
    expect((await deskPay(user.ann.id, 800, c.id)).status).toBe(201);
    const row = await requestRow(id);
    expect(row.status).toBe('PAID');
    expect(row.paidAt).not.toBeNull();
    expect(row.promotionEventId).not.toBeNull();
    expect(await stripeOf('ann')).toBe(rung['white-1'].id);
    expect(await promotionsOf('ann')).toBe(1);
    // Settling again changes nothing.
    await fees.settlePaidCharges(school.id, user.ann.id);
    await fees.reconcile();
    expect(await promotionsOf('ann')).toBe(1);
    const listed = await http().get(`/v1/students/${user.ann.id}/promotion-fee-requests`).set(as('ann'));
    expect(listed.body.items[0]).toMatchObject({ status: 'PAID', promotionApplied: true, charge: { status: 'PAID', owedAmount: 0, paidAmount: 1800 } });
  });

  it('credit on the balance pays it at once when accepted', async () => {
    await mkStudent('ben', 'white-0');
    // 20.00 paid in with nothing owed: credit.
    expect((await deskPay(user.ben.id, 2000)).status).toBe(201);
    const id = await gradeToPricedStripe('ben');
    const res = await feeAction('ben', id, 'accept');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PAID', promotionApplied: true, charge: { status: 'PAID', owedAmount: 0 } });
    expect(paidOn((await chargeOf(id))!)).toBe(1800);
    expect(await stripeOf('ben')).toBe(rung['white-1'].id);
    expect(await promotionsOf('ben')).toBe(1);
  });

  it('credit the owner adds, or a refund kept as credit, pays it and settles it (step 4)', async () => {
    await mkStudent('ivy', 'white-0');
    const id = await gradeToPricedStripe('ivy');
    expect((await feeAction('ivy', id, 'accept')).status).toBe(201);
    // Part paid at the desk, then the owner adds credit for the rest.
    const c = (await chargeOf(id))!;
    expect((await deskPay(user.ivy.id, 500, c.id)).status).toBe(201);
    expect((await requestRow(id)).status).toBe('ACCEPTED');
    const credit = await http().post(`/v1/schools/${school.id}/students/${user.ivy.id}/credits`).set(as('owner')).send({ amount: 1300, note: 'Goodwill' });
    expect(credit.status).toBe(201);
    expect((await requestRow(id)).status).toBe('PAID');
    expect(await stripeOf('ivy')).toBe(rung['white-1'].id);
    expect(await promotionsOf('ivy')).toBe(1);
  });

  it('a card payment in the app (Checkout, then the webhook) settles it the same way', async () => {
    await mkStudent('cat', 'white-0');
    const id = await gradeToPricedStripe('cat');
    await feeAction('cat', id, 'accept');
    const c = (await chargeOf(id))!;
    const started = await http().post(`/v1/students/${user.cat.id}/charges/checkout`).set(as('cat')).send({ schoolId: school.id, chargeId: c.id });
    expect(started.status).toBe(201);
    expect(started.body.amount).toBe(1800);
    expect((await requestRow(id)).status).toBe('ACCEPTED');
    const pi = (await su.transaction.findUniqueOrThrow({ where: { id: started.body.transactionId } })).stripePaymentIntentId!;
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType: 'payment_intent.succeeded', objectId: pi, stripeAccountId: acct }, attemptsMade: 1, opts: { attempts: 3 } } as never);
    expect((await requestRow(id)).status).toBe('PAID');
    expect(await stripeOf('cat')).toBe(rung['white-1'].id);
    expect(await promotionsOf('cat')).toBe(1);
  });

  it('automatic payment with a saved card pays it and settles it (Decision 300 item 2: "by saved card")', async () => {
    await mkStudent('dan', 'white-0');
    await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: user.dan.id, schoolId: school.id, stripeCustomerId: `cus_${randomUUID()}`, autoPayCharges: true } });
    const id = await gradeToPricedStripe('dan');
    await feeAction('dan', id, 'accept');
    await autoPay.run(new Date());
    const c = (await chargeOf(id))!;
    expect(paidOn(c)).toBe(1800);
    expect(await su.transaction.count({ where: { chargeId: c.id, chargePaymentChannel: 'AUTOMATIC', status: 'SUCCESSFUL' } })).toBe(1);
    expect((await requestRow(id)).status).toBe('PAID');
    expect(await stripeOf('dan')).toBe(rung['white-1'].id);
    expect(await promotionsOf('dan')).toBe(1);
  });

  it('waiving the fee cancels its charge; what was paid becomes credit, and the waiting promotion applies', async () => {
    await mkStudent('eve', 'white-0');
    const id = await gradeToPricedStripe('eve');
    await feeAction('eve', id, 'accept');
    const c = (await chargeOf(id))!;
    expect((await deskPay(user.eve.id, 500, c.id)).status).toBe(201);
    const res = await feeAction('owner', id, 'waive');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'WAIVED', promotionApplied: true, charge: { status: 'CANCELLED', owedAmount: 0 } });
    const after = (await chargeOf(id))!;
    expect(after.cancelledAt).not.toBeNull();
    expect(after.cancelledById).toBe(user.owner.id);
    expect(await stripeOf('eve')).toBe(rung['white-1'].id);
    const view = await http().get(`/v1/schools/${school.id}/students/${user.eve.id}/charges`).set(as('owner'));
    expect(view.body.balances[0]).toMatchObject({ currency: 'GBP', owed: 0, credit: 500 });
    const n = await waitFor(() => su.notification.findUnique({ where: { id: `charge-cancelled-${c.id}` } }), (v) => v !== null);
    expect(n?.body).toBe("Your charge 'white-1, 18.00 GBP' was cancelled. Nothing to pay. The 5.00 GBP already paid is now credit on your balance.");
  });

  it('cancelling the fee cancels its charge and leaves the promotion "to decide" (Decision 307)', async () => {
    await mkStudent('fay', 'white-0');
    const id = await gradeToPricedStripe('fay');
    await feeAction('fay', id, 'accept');
    const res = await feeAction('owner', id, 'cancel');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CANCELLED', toDecide: true, promotionApplied: false, charge: { status: 'CANCELLED' } });
    expect(await stripeOf('fay')).toBe(rung['white-0'].id);
    // Nothing owed any more.
    const view = await http().get(`/v1/schools/${school.id}/students/${user.fay.id}/charges`).set(as('owner'));
    expect(view.body.balances[0]).toMatchObject({ owed: 0, net: 0 });
  });

  it('declining makes no charge', async () => {
    await mkStudent('gus', 'white-0');
    const id = await gradeToPricedStripe('gus');
    expect((await feeAction('gus', id, 'decline')).status).toBe(201);
    expect(await chargeOf(id)).toBeNull();
    expect(await su.charge.count({ where: { studentId: user.gus.id } })).toBe(0);
  });

  it('a Guardian accepts for a child: the charge is on the child\'s balance and the Guardian sees it', async () => {
    await mkStudent('kid', 'white-0');
    await mkUser('parent');
    await su.guardianLink.create({ data: { id: randomUUID(), guardianId: user.parent.id, studentId: user.kid.id } });
    sign('parent', null, null);
    const id = await gradeToPricedStripe('kid');
    const res = await feeAction('parent', id, 'accept');
    expect(res.status).toBe(201);
    expect(res.body.charge).toMatchObject({ status: 'OPEN', grossAmount: 1800 });
    const c = (await chargeOf(id))!;
    expect(c.studentId).toBe(user.kid.id);
    const mine = await http().get(`/v1/students/${user.kid.id}/charges`).set(as('parent'));
    expect(mine.status).toBe(200);
    const at = mine.body.schools.find((s: { schoolId: string }) => s.schoolId === school.id);
    expect(at.charges[0]).toMatchObject({ id: c.id, description: 'white-1', promotionFee: { requestId: id, toRungName: 'white-1', disciplineName: 'BJJ' } });
  });

  it('a late fee applies to an overdue promotion fee charge like any charge (Decision 413)', async () => {
    const id = (await su.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.kid.id } })).id;
    const c = (await chargeOf(id))!;
    const old = new Date(Date.now() - 10 * DAY);
    await su.school.update({
      where: { id: school.id },
      data: { lateFeeEnabled: true, lateFeeType: 'FIXED', lateFeeFixedAmount: 500, lateFeeGraceDays: 0, lateFeeEnabledAt: old, lateFeeConfirmedAt: old, lateFeeConfirmedById: user.owner.id },
    });
    await su.charge.update({ where: { id: c.id }, data: { dueDate: new Date(`${new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`) } });
    try {
      await app.get(LateFeeProcessor).run(new Date(), [school.id]);
      expect(await su.charge.count({ where: { lateFeeForChargeId: c.id } })).toBe(1);
    } finally {
      await su.school.update({ where: { id: school.id }, data: { lateFeeEnabled: false } });
    }
  });

  it('the daily catch-up makes the charge of a fee accepted before this change, once', async () => {
    await mkStudent('hal', 'white-0');
    const id = await gradeToPricedStripe('hal');
    // As if accepted before charges existed: Accepted, with no charge.
    await su.promotionFeeRequest.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date(Date.now() - 5 * DAY), respondedById: user.hal.id } });
    expect(await chargeOf(id)).toBeNull();
    const first = await fees.reconcile();
    expect(first.created).toBeGreaterThanOrEqual(1);
    const c = (await chargeOf(id))!;
    expect(c).toMatchObject({ description: 'white-1', grossAmount: 1800, studentId: user.hal.id });
    await fees.reconcile();
    expect(await su.charge.count({ where: { promotionFeeRequestId: id } })).toBe(1);
    // Paid at the desk, it then settles as any other.
    await deskPay(user.hal.id, 1800, c.id);
    expect((await requestRow(id)).status).toBe('PAID');
    expect(await stripeOf('hal')).toBe(rung['white-1'].id);
  });

  describe('a paid fee whose promotion can no longer apply is put to the owner (Decision 414 item 1)', () => {
    const blockedNotices = (id: string) => su.notification.findMany({ where: { id: { startsWith: `promotion-fee-blocked-${id}-` } } });
    const boardCard = async (label: string) => {
      const res = await http().get(`/v1/schools/${school.id}/grading-board?disciplineId=${bjj.id}`).set(as('owner'));
      expect(res.status).toBe(200);
      return (res.body.items as Array<{ studentId: string; feeStatus: string | null; feeRequest: Record<string, unknown> | null }>).find((i) => i.studentId === user[label].id);
    };
    const ownerView = async (label: string, id: string) => {
      const res = await http().get(`/v1/schools/${school.id}/promotion-fee-requests?studentId=${user[label].id}`).set(as('owner'));
      expect(res.status).toBe(200);
      return res.body.items.find((r: { id: string }) => r.id === id);
    };
    /** Graded (the promotion waits), accepted, then the student's rank changes
     * (here: corrected straight to the rung the grade was for), then paid. */
    async function paidAfterRankChange(label: string) {
      await mkStudent(label, 'white-0');
      const id = await gradeToPricedStripe(label);
      expect((await feeAction(label, id, 'accept')).status).toBe(201);
      await su.studentRank.update({
        where: { studentId_disciplineId: { studentId: user[label].id, disciplineId: bjj.id } },
        data: { currentRankId: rung['white-1'].rankId, currentStripeId: rung['white-1'].id },
      });
      const c = (await chargeOf(id))!;
      expect((await deskPay(user[label].id, 1800, c.id)).status).toBe(201);
      return { id, chargeId: c.id };
    }

    it('flagged once, the owner told once; the daily catch-up neither retries it nor tells them again; waiving is refused', async () => {
      const { id, chargeId } = await paidAfterRankChange('jon');
      const row = await requestRow(id);
      expect(row).toMatchObject({ status: 'ACCEPTED', promotionEventId: null, paidAt: null, toDecideAt: null });
      expect(row.promotionBlockedAt).not.toBeNull();
      // The money stays paid: nothing happens to it on its own.
      const c = (await chargeOf(id))!;
      expect(c.cancelledAt).toBeNull();
      expect(paidOn(c)).toBe(1800);
      expect(await promotionsOf('jon')).toBe(0);

      const notices = await waitFor(() => blockedNotices(id), (v) => v.length > 0);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        userId: user.owner.id,
        title: "Promotion can't apply",
        body: "jon Charge's fee for white-1 (BJJ) is paid, but the promotion can't apply: their rank or the belt ladder changed since the grade. Cancel the fee (what was paid becomes credit) or grade them again.",
        type: 'GRADING_FEE_BLOCKED',
        schoolId: school.id,
      });

      // Shown to the owner on grading: the card's fee box and the board.
      expect(await ownerView('jon', id)).toMatchObject({ status: 'ACCEPTED', promotionBlocked: true, charge: { id: chargeId, status: 'PAID', owedAmount: 0 } });
      expect(await boardCard('jon')).toMatchObject({ feeStatus: 'blocked', feeRequest: { id, status: 'ACCEPTED', promotionApplied: false } });
      // The member's own view: Accepted, its charge Paid.
      const mine = await http().get(`/v1/students/${user.jon.id}/promotion-fee-requests`).set(as('jon'));
      expect(mine.body.items.find((r: { id: string }) => r.id === id)).toMatchObject({ status: 'ACCEPTED', charge: { status: 'PAID' } });

      // Settling again and the daily catch-up: no retry, no second flag, no second notice.
      const flaggedAt = row.promotionBlockedAt!.getTime();
      await fees.settlePaidCharges(school.id, user.jon.id);
      await fees.reconcile();
      await fees.reconcile();
      expect((await requestRow(id)).promotionBlockedAt!.getTime()).toBe(flaggedAt);
      await new Promise((r) => setTimeout(r, 500));
      expect(await blockedNotices(id)).toHaveLength(1);

      // Waiving isn't one of the owner's two choices.
      const waived = await feeAction('owner', id, 'waive');
      expect(waived.status).toBe(409);
      expect(waived.body.error.message).toBe('This fee is paid, but its promotion can no longer apply. Cancel the fee (what was paid becomes credit), or grade the student again.');
      expect((await requestRow(id)).status).toBe('ACCEPTED');
    });

    const balanceOf = async (label: string) => {
      const view = await http().get(`/v1/schools/${school.id}/students/${user[label].id}/charges`).set(as('owner'));
      expect(view.status).toBe(200);
      return view.body.balances[0];
    };

    it('grading again is not held up: the old fee is cancelled and what was paid pays a new fee of the same price (Decision 415 item 1)', async () => {
      const id = (await su.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.jon.id } })).id;
      const oldCharge = (await chargeOf(id))!;
      // The rank is put back to white-0, and the owner grades again: the same stripe, the same price.
      await su.studentRank.update({
        where: { studentId_disciplineId: { studentId: user.jon.id, disciplineId: bjj.id } },
        data: { currentRankId: rung['white-0'].rankId, currentStripeId: rung['white-0'].id },
      });
      const newId = await gradeToPricedStripe('jon');
      expect(newId).not.toBe(id);
      // The old fee is cancelled (by whoever graded), not left "to decide", and its charge cancelled: 18.00 credit.
      const row = await requestRow(id);
      expect(row).toMatchObject({ status: 'CANCELLED', promotionEventId: null, paidAt: null, toDecideAt: null, closedById: user.owner.id });
      expect(row.cancelledAt).not.toBeNull();
      const c = (await chargeOf(id))!;
      expect(c.cancelledAt).not.toBeNull();
      expect(await balanceOf('jon')).toMatchObject({ currency: 'GBP', owed: 0, credit: 1800 });
      const n = await waitFor(() => su.notification.findUnique({ where: { id: `charge-cancelled-${oldCharge.id}` } }), (v) => v !== null);
      expect(n?.body).toBe("Your charge 'white-1, 18.00 GBP' was cancelled. Nothing to pay. The 18.00 GBP already paid is now credit on your balance.");
      expect(await ownerView('jon', id)).toMatchObject({ status: 'CANCELLED', promotionBlocked: false, toDecide: false });

      // The new fee, once accepted, is paid by that credit: nothing more to pay, and the promotion applies.
      const accepted = await feeAction('jon', newId, 'accept');
      expect(accepted.status).toBe(201);
      expect(accepted.body).toMatchObject({ status: 'PAID', promotionApplied: true, charge: { status: 'PAID', owedAmount: 0, paidAmount: 1800 } });
      expect(await stripeOf('jon')).toBe(rung['white-1'].id);
      expect(await balanceOf('jon')).toMatchObject({ owed: 0, credit: 0 });
      // Closed: the owner can no longer cancel the old fee, and nobody is told again.
      expect((await feeAction('owner', id, 'cancel')).status).toBe(409);
      await fees.reconcile();
      expect(await blockedNotices(id)).toHaveLength(1);
    });

    it('graded again to a higher-priced rank, only the difference is left to pay', async () => {
      // blue-0 priced 25.00 (30.00 with the 20% tax) for this test.
      await su.rankStripeTier.update({ where: { id: rung['blue-0'].id }, data: { promotionFeeMinor: 2500 } });
      try {
        const { id } = await paidAfterRankChange('nat');
        await waitFor(() => blockedNotices(id), (v) => v.length > 0);
        // From white-1 (where the rank was changed to), the normal Promote to blue-0.
        const res = await http().post(`/v1/students/${user.nat.id}/ranks/${bjj.id}/promote`).set(as('owner')).send({});
        expect(res.status).toBe(201);
        const newId = res.body.feeRequest.id as string;
        expect((await requestRow(id)).status).toBe('CANCELLED');
        expect(await balanceOf('nat')).toMatchObject({ owed: 0, credit: 1800 });
        const accepted = await feeAction('nat', newId, 'accept');
        expect(accepted.status).toBe(201);
        expect(accepted.body).toMatchObject({ status: 'ACCEPTED', charge: { status: 'PART_PAID', grossAmount: 3000, paidAmount: 1800, owedAmount: 1200 } });
        expect(await balanceOf('nat')).toMatchObject({ owed: 1200, credit: 0 });
        expect(await stripeOf('nat')).toBe(rung['white-1'].id);
        // Paying the difference applies the promotion.
        expect((await deskPay(user.nat.id, 1200, (await chargeOf(newId))!.id)).status).toBe(201);
        expect((await requestRow(newId)).status).toBe('PAID');
        expect(await stripeOf('nat')).toBe(rung['blue-0'].id);
      } finally {
        await su.rankStripeTier.update({ where: { id: rung['blue-0'].id }, data: { promotionFeeMinor: null } });
      }
    });

    it('the owner cancels the fee: its charge is cancelled, what was paid becomes credit, and nothing is left "to decide"', async () => {
      const { id, chargeId } = await paidAfterRankChange('kai');
      await waitFor(() => blockedNotices(id), (v) => v.length > 0);
      // Owner only, and another School sees nothing.
      expect((await feeAction('desk', id, 'cancel')).status).toBe(403);
      expect((await feeAction('ownerB', id, 'cancel')).status).toBe(404);
      const otherSchool = await http().get(`/v1/schools/${schoolB.id}/promotion-fee-requests`).set(as('ownerB'));
      expect(otherSchool.body.items.find((r: { id: string }) => r.id === id)).toBeUndefined();
      expect(await su.notification.count({ where: { userId: user.ownerB.id, id: { startsWith: 'promotion-fee-blocked-' } } })).toBe(0);

      const res = await feeAction('owner', id, 'cancel');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'CANCELLED', toDecide: false, promotionBlocked: false, promotionApplied: false, charge: { status: 'CANCELLED' } });
      const row = await requestRow(id);
      expect(row.toDecideAt).toBeNull();
      expect(row.closedById).toBe(user.owner.id);
      const c = (await chargeOf(id))!;
      expect(c.cancelledAt).not.toBeNull();
      expect(c.cancelledById).toBe(user.owner.id);
      const view = await http().get(`/v1/schools/${school.id}/students/${user.kai.id}/charges`).set(as('owner'));
      expect(view.body.balances[0]).toMatchObject({ currency: 'GBP', owed: 0, credit: 1800 });
      const n = await waitFor(() => su.notification.findUnique({ where: { id: `charge-cancelled-${chargeId}` } }), (v) => v !== null);
      expect(n?.body).toBe("Your charge 'white-1, 18.00 GBP' was cancelled. Nothing to pay. The 18.00 GBP already paid is now credit on your balance.");
      expect(await boardCard('kai')).toMatchObject({ feeStatus: null });
      await fees.reconcile();
      expect(await blockedNotices(id)).toHaveLength(1);
    });

    it('a passing failure is not mistaken for it: a fee whose promotion can still apply is never flagged', async () => {
      // Paid while the student is still where the grade was made from: it applies, as before.
      await mkStudent('lia', 'white-0');
      const id = await gradeToPricedStripe('lia');
      await feeAction('lia', id, 'accept');
      await deskPay(user.lia.id, 1800, (await chargeOf(id))!.id);
      const row = await requestRow(id);
      expect(row).toMatchObject({ status: 'PAID', promotionBlockedAt: null });
      expect(row.promotionEventId).not.toBeNull();
    });

    it('the belt ladder changing after the grade is caught the same way', async () => {
      await mkStudent('max', 'white-0');
      const id = await gradeToPricedStripe('max');
      await feeAction('max', id, 'accept');
      // A new stripe goes in between: the stripe award would now land on it, not on white-1.
      const white1 = await su.rankStripeTier.findUniqueOrThrow({ where: { id: rung['white-1'].id } });
      await su.rankStripeTier.update({ where: { id: white1.id }, data: { order: 2 } });
      const inserted = await su.rankStripeTier.create({
        data: {
          id: randomUUID(), rankId: white1.rankId, schoolId: school.id, order: 1, count: 1, colour: '#000000', name: 'white-new',
          stripeSegments: [{ count: 1, colour: '#000000' }], classesRequired: 3,
        },
      });
      try {
        await deskPay(user.max.id, 1800, (await chargeOf(id))!.id);
        const row = await requestRow(id);
        expect(row).toMatchObject({ status: 'ACCEPTED', promotionEventId: null });
        expect(row.promotionBlockedAt).not.toBeNull();
        expect(await stripeOf('max')).toBe(rung['white-0'].id);
        expect(await waitFor(() => blockedNotices(id), (v) => v.length > 0)).toHaveLength(1);
      } finally {
        await su.rankStripeTier.delete({ where: { id: inserted.id } });
        await su.rankStripeTier.update({ where: { id: white1.id }, data: { order: 1 } });
      }
    });
  });

  it('another School never sees or acts on these fees or charges (API and RLS)', async () => {
    const id = (await su.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.kid.id } })).id;
    const c = (await chargeOf(id))!;
    for (const action of ['accept', 'waive', 'cancel'] as const) {
      expect((await feeAction('ownerB', id, action)).status).toBe(404);
    }
    expect((await http().get(`/v1/schools/${school.id}/students/${user.kid.id}/charges`).set(as('ownerB'))).status).toBe(403);
    expect((await http().post(`/v1/schools/${schoolB.id}/charges/${c.id}/cancel`).set(as('ownerB')).send({ reason: 'x' })).status).toBe(404);
    const withUser = <T>(userId: string, fn: (tx: PrismaClient) => Promise<T>) =>
      appDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
        return fn(tx as unknown as PrismaClient);
      });
    expect(await withUser(user.ownerB.id, (tx) => tx.charge.count({ where: { promotionFeeRequestId: { not: null }, schoolId: school.id } }))).toBe(0);
    expect(await withUser(user.owner.id, (tx) => tx.charge.count({ where: { promotionFeeRequestId: id } }))).toBe(1);
    // A charge can't be tied to another student's (or another School's) fee.
    const otherStudent = await mkUser('zed');
    await expect(su.charge.update({ where: { id: c.id }, data: { studentId: otherStudent.id } })).rejects.toThrow(/belongs to the School and student of its request/);
    await expect(su.charge.update({ where: { id: c.id }, data: { schoolId: schoolB.id } })).rejects.toThrow(/belongs to the School and student of its request/);
  });
});
