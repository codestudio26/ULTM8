import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ChargeRecurringProcessor } from '../src/jobs/charge-recurring.processor';

/**
 * Decision 441 item 1: a monthly plan (SUBSCRIPTION) at a School that takes no
 * cards (Decisions 437/439). The member buys it like any plan there (a Pix or
 * cash order staff confirm), or staff sell it at the desk; the months after
 * the first are charges on the member's balance, made by a recurring charge
 * (Decision 412) tied to the membership, which follows the membership.
 * A School that takes cards is unchanged (memberships-desk-and-cancel and
 * transactions-followups keep refusing a desk Subscription there).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[no-card-monthly-plans.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const PRICE = 15000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** Noon UTC on a YYYY-MM-DD day (the School's zone is UTC). */
const noon = (day: string) => new Date(`${day}T12:00:00.000Z`);

describeIfDb('Monthly plans at a School without cards (Decision 441 item 1)', () => {
  let app: INestApplication;
  let job: ChargeRecurringProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  let school: { id: string };
  let cardSchool: { id: string };
  let ownerToken: string;
  let otherOwnerToken: string;
  let monthly: { id: string };

  const sign = (user: { id: string; email: string }, role: string, schoolId: string) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
  const http = () => request(app.getHttpServer());

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `no-card-monthly-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Monthly',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkStudent(label: string, schoolId = school.id) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    return { user, token: sign(user, 'STUDENT', schoolId) };
  }

  async function mkPlan(schoolId: string, token: string) {
    const res = await http()
      .post(`/v1/schools/${schoolId}/membership-plans`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'SUBSCRIPTION', title: `Mensal ${randomUUID().slice(0, 6)}`, price: PRICE, currency: 'brl' });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  const buy = (planId: string, token: string) => http().post(`/v1/membership-plans/${planId}/purchase`).set('Authorization', `Bearer ${token}`).send({});
  const confirm = (transactionId: string, token = ownerToken) => http().patch(`/v1/transactions/${transactionId}/confirm`).set('Authorization', `Bearer ${token}`);
  const sell = (schoolId: string, studentId: string, planId: string, token = ownerToken) =>
    http().post(`/v1/schools/${schoolId}/students/${studentId}/memberships/sell`).set('Authorization', `Bearer ${token}`).send({ membershipPlanId: planId, paymentMethod: 'PIX' });
  const cancel = (membershipId: string, token: string) => http().post(`/v1/memberships/${membershipId}/cancel`).set('Authorization', `Bearer ${token}`).send({});
  const seriesOf = (membershipId: string) => su.recurringCharge.findUnique({ where: { membershipId } });

  /** Buys the monthly plan in the app and has the owner confirm it. */
  async function buyAndConfirm(label: string) {
    const student = await mkStudent(label);
    const order = await buy(monthly.id, student.token);
    expect(order.status).toBe(201);
    expect(order.body.outcome).toBe('pending_confirmation');
    const confirmed = await confirm(order.body.transactionId);
    expect(confirmed.status).toBe(200);
    const membership = await su.membership.findFirstOrThrow({ where: { studentId: student.user.id } });
    return { student, membership, transactionId: order.body.transactionId as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    job = app.get(ChargeRecurringProcessor);

    school = await su.school.create({ data: { id: randomUUID(), name: 'Escola Sem Cartão', defaultCurrency: 'BRL', timezone: 'UTC', addressCountry: 'BR' } });
    cardSchool = await su.school.create({ data: { id: randomUUID(), name: 'Card School', defaultCurrency: 'BRL', timezone: 'UTC' } });
    schoolIds.push(school.id, cardSchool.id);
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' } });
    await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: cardSchool.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
    });
    const owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    ownerToken = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    const otherOwner = await mkUser('other-owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: cardSchool.id, isMainOwner: true } });
    otherOwnerToken = sign(otherOwner, 'SCHOOL_OWNER_MANAGER', cardSchool.id);
    monthly = await mkPlan(school.id, ownerToken);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.recurringCharge.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await app.close();
    await su.$disconnect();
  });

  afterEach(async () => {
    await su.school.update({ where: { id: school.id }, data: { taxCountry: null, taxRateBasisPoints: 0, taxInclusive: true } });
  });

  it('the member buys it as a Pix/cash order; once confirmed, the months after the first go on the balance', async () => {
    const { student, membership, transactionId } = await buyAndConfirm('buyer');
    expect(membership).toMatchObject({ frequency: 'RECURRING', billedToBalance: true, stripeSubscriptionId: null, expiryDate: null, cancelAt: null, status: 'ACTIVE' });
    expect(await su.transaction.findUniqueOrThrow({ where: { id: transactionId } })).toMatchObject({ status: 'SUCCESSFUL', amount: PRICE, membershipId: membership.id });

    const series = await seriesOf(membership.id);
    const start = dayOf(membership.startDate);
    expect(series).toMatchObject({ studentId: student.user.id, schoolId: school.id, unitAmount: PRICE, currency: 'BRL', frequency: 'MONTHLY', nextIndex: 1, createdCount: 0, stoppedAt: null, endDate: null });
    expect(dayOf(series!.firstDate)).toBe(start);
    expect(series!.nextDate!.getTime()).toBeGreaterThan(series!.firstDate.getTime());
    // Nothing is charged for the first month: it was the order.
    expect(await su.charge.count({ where: { recurringChargeId: series!.id } })).toBe(0);

    // Next month: a normal charge on the balance, the plan's price. With the
    // School's prices excluding tax, nothing is added on top of a membership.
    await su.school.update({ where: { id: school.id }, data: { taxCountry: 'BR', taxRateBasisPoints: 1000, taxInclusive: false } });
    const next = dayOf(series!.nextDate!);
    await job.run(noon(next));
    const [charge] = await su.charge.findMany({ where: { recurringChargeId: series!.id } });
    expect(charge).toMatchObject({ studentId: student.user.id, grossAmount: PRICE, taxAmount: 0, currency: 'BRL', createdById: null });
    expect(dayOf(charge.dueDate)).toBe(next);
    // The student sees it among their charges, as any charge.
    const mine = await http().get(`/v1/students/${student.user.id}/charges`).set('Authorization', `Bearer ${student.token}`);
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).toContain(charge.id);
  });

  it('with prices including tax, the month shows the tax it includes, still at the plan price', async () => {
    const { membership } = await buyAndConfirm('inclusive');
    await su.school.update({ where: { id: school.id }, data: { taxCountry: 'BR', taxRateBasisPoints: 1000, taxInclusive: true } });
    const series = (await seriesOf(membership.id))!;
    await job.run(noon(dayOf(series.nextDate!)));
    const [charge] = await su.charge.findMany({ where: { recurringChargeId: series.id } });
    expect(charge.grossAmount).toBe(PRICE);
    expect(charge.taxAmount).toBeGreaterThan(0);
  });

  it('cancelling ends it at the next billing day: no further month is charged', async () => {
    const { student, membership } = await buyAndConfirm('canceller');
    const before = (await seriesOf(membership.id))!;
    const res = await cancel(membership.id, student.token);
    expect(res.status).toBe(201);
    expect(res.body.billedToBalance).toBe(true);
    const nextDay = dayOf(before.nextDate!);
    expect(res.body.cancelAt).toBe(new Date(`${nextDay}T00:00:00.000Z`).toISOString());
    expect(res.body.expiryDate).toBe(res.body.cancelAt);
    // The series ends the day before, so it shows as ended.
    const after = (await seriesOf(membership.id))!;
    expect(after.nextDate).toBeNull();
    expect(after.endDate && dayOf(after.endDate) < nextDay).toBe(true);
    await job.run(noon(nextDay));
    expect(await su.charge.count({ where: { recurringChargeId: before.id } })).toBe(0);
    // Asking again changes nothing.
    expect((await cancel(membership.id, student.token)).body.cancelAt).toBe(res.body.cancelAt);
  });

  it('the series follows the membership even if it was not ended when the membership was', async () => {
    const { membership } = await buyAndConfirm('follows');
    const series = (await seriesOf(membership.id))!;
    const end = new Date(`${dayOf(series.nextDate!)}T00:00:00.000Z`);
    await su.membership.update({ where: { id: membership.id }, data: { cancelAt: end, expiryDate: end } });
    await job.run(noon(dayOf(series.nextDate!)));
    expect(await su.charge.count({ where: { recurringChargeId: series.id } })).toBe(0);
    expect((await seriesOf(membership.id))!.nextDate).toBeNull();
  });

  it('staff sell it at the desk, paid by Pix; the desk payment options list it', async () => {
    const { user } = await mkStudent('desk');
    const options = await http().get(`/v1/schools/${school.id}/desk-payments/options`).set('Authorization', `Bearer ${ownerToken}`);
    expect(options.status).toBe(200);
    expect(options.body.plans.map((p: { id: string }) => p.id)).toContain(monthly.id);

    const sold = await sell(school.id, user.id, monthly.id);
    expect(sold.status).toBe(201);
    const membership = await su.membership.findUniqueOrThrow({ where: { id: sold.body.membership.id } });
    expect(membership).toMatchObject({ frequency: 'RECURRING', billedToBalance: true, stripeSubscriptionId: null });
    expect(await su.transaction.findUniqueOrThrow({ where: { id: sold.body.transactionId } })).toMatchObject({ status: 'SUCCESSFUL', paymentMethod: 'PIX', amount: PRICE });
    expect(await seriesOf(membership.id)).toMatchObject({ unitAmount: PRICE, nextIndex: 1, frequency: 'MONTHLY' });
  });

  it('a series missed right after the sale is set up by the next job run', async () => {
    const { membership } = await buyAndConfirm('healed');
    const lost = (await seriesOf(membership.id))!;
    await su.recurringCharge.delete({ where: { id: lost.id } });
    await job.run(new Date());
    const again = (await seriesOf(membership.id))!;
    expect(again).toMatchObject({ unitAmount: PRICE, nextIndex: 1 });
    expect(dayOf(again.nextDate!)).toBe(dayOf(lost.nextDate!));
  });

  it('a School that takes cards is unchanged: no desk sale, and no balance billing', async () => {
    const plan = await mkPlan(cardSchool.id, otherOwnerToken);
    const { user } = await mkStudent('card-desk', cardSchool.id);
    expect((await sell(cardSchool.id, user.id, plan.id, otherOwnerToken)).status).toBe(400);
    const options = await http().get(`/v1/schools/${cardSchool.id}/desk-payments/options`).set('Authorization', `Bearer ${otherOwnerToken}`);
    expect(options.body.plans.map((p: { id: string }) => p.id)).not.toContain(plan.id);
    expect(await su.membership.count({ where: { studentId: user.id } })).toBe(0);
  });

  it("another School's owner can neither confirm the order nor cancel the membership", async () => {
    const student = await mkStudent('isolated');
    const order = await buy(monthly.id, student.token);
    expect(order.status).toBe(201);
    expect([403, 404]).toContain((await confirm(order.body.transactionId, otherOwnerToken)).status);
    expect(await su.membership.count({ where: { studentId: student.user.id } })).toBe(0);
    await confirm(order.body.transactionId);
    const membership = await su.membership.findFirstOrThrow({ where: { studentId: student.user.id } });
    expect([403, 404]).toContain((await cancel(membership.id, otherOwnerToken)).status);
    expect((await su.membership.findUniqueOrThrow({ where: { id: membership.id } })).cancelAt).toBeNull();
  });
});
