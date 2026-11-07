/**
 * Decision 446 items 1–4 (stress test round 6, findings M-1 to M-5), over real
 * HTTP against a real Postgres. The repros are the round's own scripts
 * (apps/api/scripts/stress/round6/money/ on test/stress-round6-m: confirm.mjs,
 * confirm2.mjs, contract-delete.mjs, freeze.mjs, switch-fees.mjs).
 *
 * Item 1 (M-1): a freeze inside a contract's minimum term moves the term's end
 * along the billing schedule, so a 3-month term is still 3 monthly payments.
 * Item 2 (M-2): ending a freeze early moves a cancel date the freeze pushed
 * back, as it moves the end date.
 * Item 3 (M-3): a balance-billed plan's monthly series ends however the plan
 * ends: a desk refund that ends it, Delete my account, the end of the minimum
 * term, and (the charge-recurring job's catch-all) any other way.
 * Item 4 (M-4, M-5): revenue counts what was kept, the same on the billing
 * overview and on Transactions.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS, JWT_ACCESS_SECRET, REDIS_URL.
 */
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ChargeRecurringProcessor } from '../src/jobs/charge-recurring.processor';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import { addDays, occurrenceDay } from '../src/charges/recurring-schedule';
import { runSeries } from '../src/charges/recurring-occurrences';
import { applyDueMinimumTermEnds } from '../src/memberships/contracts/minimum-term';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { StripeClientService } from '../src/payments/stripe-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[round6-money-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

const TAG = 'd446m-';
const PASSCODE = '424242';
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** Noon UTC on a YYYY-MM-DD day (the Schools' zone is UTC). */
const noon = (day: string) => new Date(`${day}T12:00:00.000Z`);
const midnight = (day: string) => new Date(`${day}T00:00:00.000Z`);
const addMonths = (day: string, n: number) => occurrenceDay(day, 'MONTHLY', n);
const today = () => dayOf(new Date());

describeIfDb('Decision 446 items 1–4: the round 6 money fixes', () => {
  let app: INestApplication;
  let job: ChargeRecurringProcessor;
  let jobs: PrismaJobsService;
  let passcodeHash: string;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];

  type Person = { id: string; email: string };
  const token = (u: Person, role: string, schoolId: string) => jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
  const mkUser = (label: string) =>
    su.user.create({
      data: {
        id: randomUUID(),
        email: `${TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tester',
        passcodeHash,
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  const http = () => request(app.getHttpServer());

  /** A School that takes no cards (Brazil, Decision 437): Pix and cash only. */
  async function mkSchool(name: string) {
    const school = await su.school.create({
      data: { id: randomUUID(), name: `${name} ${randomUUID().slice(0, 6)}`, defaultCurrency: 'BRL', timezone: 'UTC', addressCountry: 'BR', joiningFeesEnabled: true },
    });
    schoolIds.push(school.id);
    const account = await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' } });
    const owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    return { school, account, owner, ownerToken: token(owner, 'SCHOOL_OWNER_MANAGER', school.id) };
  }
  type School = Awaited<ReturnType<typeof mkSchool>>;

  async function mkStudent(label: string, schoolId: string) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    return { user, token: token(user, 'STUDENT', schoolId) };
  }

  const seriesOf = (membershipId: string) => su.recurringCharge.findUniqueOrThrow({ where: { membershipId } });
  const chargesOf = (seriesId: string) => su.charge.findMany({ where: { recurringChargeId: seriesId }, orderBy: { dueDate: 'asc' } });

  /** Buys a monthly plan in the app and has the owner confirm it: the months
   * after the first are on the balance. */
  async function member(s: School, planId: string, label: string) {
    const student = await mkStudent(label, s.school.id);
    const res = await http().post(`/v1/membership-plans/${planId}/purchase`).set('Authorization', `Bearer ${student.token}`).send({});
    expect(res.status).toBe(201);
    expect((await http().patch(`/v1/transactions/${res.body.transactionId}/confirm`).set('Authorization', `Bearer ${s.ownerToken}`)).status).toBe(200);
    const membership = await su.membership.findFirstOrThrow({ where: { studentId: student.user.id } });
    expect(membership.billedToBalance).toBe(true);
    const series = await seriesOf(membership.id);
    return { student, membership, series, next: dayOf(series.nextDate!), transactionId: res.body.transactionId as string };
  }

  const freeze = (s: School, membershipId: string, startsAt: string, endsAt: string) =>
    http().post(`/v1/schools/${s.school.id}/memberships/${membershipId}/freezes`).set('Authorization', `Bearer ${s.ownerToken}`).send({ startsAt, endsAt });
  const endFreeze = (s: School, freezeId: string) => http().post(`/v1/schools/${s.school.id}/freezes/${freezeId}/end`).set('Authorization', `Bearer ${s.ownerToken}`);
  const recurringRow = async (s: School, studentId: string, seriesId: string) => {
    const res = await http().get(`/v1/schools/${s.school.id}/students/${studentId}/recurring-charges`).set('Authorization', `Bearer ${s.ownerToken}`);
    expect(res.status).toBe(200);
    return (res.body.items as Array<{ id: string; status: string; nextDate: string | null; endDate: string | null }>).find((r) => r.id === seriesId);
  };

  beforeAll(async () => {
    passcodeHash = await bcrypt.hash(PASSCODE, 4);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    job = app.get(ChargeRecurringProcessor);
    jobs = app.get(PrismaJobsService);
    jest.spyOn(app.get<Queue>(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    await app.close();
    const where = { schoolId: { in: schoolIds } };
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.deskSaleRefund.deleteMany({ where });
    await su.planContractSignature.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.recurringCharge.deleteMany({ where });
    await su.membershipFreeze.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    const people = (await su.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    await su.accountErasureLog.deleteMany({ where: { userId: { in: people } } });
    await su.refreshToken.deleteMany({ where: { userId: { in: people } } });
    await su.notification.deleteMany({ where: { userId: { in: people } } });
    await su.roleGrant.deleteMany({ where });
    await su.user.deleteMany({ where: { id: { in: people } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
  });

  describe('items 1–3 on a School without cards', () => {
    let s: School;
    let monthly: { id: string; price: number; title: string };

    beforeAll(async () => {
      s = await mkSchool('Mensal');
      monthly = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, type: 'SUBSCRIPTION', title: 'Mensal', price: 15000, currency: 'BRL' } });
    });

    it('item 1 (M-1): a 30-day freeze inside a 3-month "ends after the term" contract still bills 3 months, and the term ends on a billing day', async () => {
      const { student, membership, series, next, transactionId } = await member(s, monthly.id, 'contract');
      await su.planContractSignature.create({
        data: {
          id: randomUUID(), schoolId: s.school.id, membershipPlanId: monthly.id, studentId: student.user.id, signedById: student.user.id, signerFullName: 'Eva Um', signatureText: 'Eva',
          planTitle: monthly.title, planType: 'SUBSCRIPTION', contractBody: 'Contrato.', minimumTermMonths: 3, earlyExitFee: null, endsAfterMinimumTerm: true,
          currency: 'BRL', contractVersion: 1, contractSha256: 'x'.repeat(64), usedAt: new Date(), transactionId,
        },
      });
      // Frozen for 30 days from just before the first monthly charge: it moves 30 days.
      const startsAt = addDays(next, -6);
      expect((await freeze(s, membership.id, startsAt, addDays(startsAt, 30))).status).toBe(201);
      const moved = addDays(next, 30);
      const termEnd = addMonths(moved, 2);

      // Every day to past the term's end, as the jobs would run.
      const stripe = app.get(StripeClientService);
      const logger = new Logger('round6-money-fixes');
      for (let day = today(); day <= addDays(termEnd, 3); day = addDays(day, 1)) {
        await runSeries(jobs, series.id, noon(day));
        await applyDueMinimumTermEnds(jobs, stripe, logger, noon(day));
      }

      // The order and 2 monthly charges: 3 payments for 3 months.
      expect((await chargesOf(series.id)).map((c) => dayOf(c.dueDate))).toEqual([moved, addMonths(moved, 1)]);
      const ended = await su.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(dayOf(ended.cancelAt!)).toBe(termEnd);
      expect(ended.expiryDate?.getTime()).toBe(ended.cancelAt!.getTime());
      // Its series shows it ending (item 3: the end of the minimum term).
      expect(await seriesOf(membership.id)).toMatchObject({ endDate: midnight(addDays(termEnd, -1)), nextDate: null });
    });

    it('item 2 (M-2): cancelled during a freeze, then the freeze is ended early the same day: one end date, the billing day already paid to', async () => {
      const { student, membership, next } = await member(s, monthly.id, 'cancel-then-unfreeze');
      const f = await freeze(s, membership.id, today(), addDays(today(), 30));
      expect(f.status).toBe(201);
      const cancelled = await http().post(`/v1/memberships/${membership.id}/cancel`).set('Authorization', `Bearer ${student.token}`).send({});
      expect(cancelled.status).toBe(201);
      expect(cancelled.body.cancelAt).toBe(midnight(addDays(next, 30)).toISOString());

      expect((await endFreeze(s, f.body.id)).status).toBe(201);
      const after = await su.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(after.cancelAt?.toISOString()).toBe(midnight(next).toISOString());
      expect(after.expiryDate?.toISOString()).toBe(midnight(next).toISOString());
      // The staff screens: the series ends before that day too.
      expect(await seriesOf(membership.id)).toMatchObject({ endDate: midnight(addDays(next, -1)), nextDate: null });
      const card = await http().get(`/v1/schools/${s.school.id}/students/${student.user.id}/memberships`).set('Authorization', `Bearer ${s.ownerToken}`);
      expect(card.status).toBe(200);
      const rows = (Array.isArray(card.body) ? card.body : (card.body.items ?? card.body.memberships)) as Array<{ id: string; cancelAt: string | null }>;
      expect(rows.find((r) => r.id === membership.id)?.cancelAt).toBe(midnight(next).toISOString());
    });

    it('item 2: a cancel date on a billing day before the freeze was never pushed by it, so ending the freeze leaves it', async () => {
      const { student, membership, next } = await member(s, monthly.id, 'cancel-before-freeze');
      const f = await freeze(s, membership.id, addDays(next, 2), addDays(next, 32));
      expect(f.status).toBe(201);
      const cancelled = await http().post(`/v1/memberships/${membership.id}/cancel`).set('Authorization', `Bearer ${student.token}`).send({});
      expect(cancelled.body.cancelAt).toBe(midnight(next).toISOString());
      expect((await endFreeze(s, f.body.id)).status).toBe(201);
      const after = await su.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(after.cancelAt?.toISOString()).toBe(midnight(next).toISOString());
      expect(after.expiryDate?.toISOString()).toBe(midnight(next).toISOString());
    });

    it('item 3 (M-3): a desk refund that ends the membership ends its monthly series', async () => {
      const { student, membership, transactionId } = await member(s, monthly.id, 'refunded');
      const refund = await http()
        .post(`/v1/transactions/${transactionId}/refund`)
        .set('Authorization', `Bearer ${s.ownerToken}`)
        .send({ amount: 15000, notes: 'devolvido', endMembership: true });
      expect(refund.status).toBe(201);
      expect(refund.body.membershipEnded).toBe(true);
      expect((await su.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe('EXPIRED');
      const series = await seriesOf(membership.id);
      expect(series).toMatchObject({ nextDate: null, endDate: midnight(addDays(today(), -1) < dayOf(series.firstDate) ? dayOf(series.firstDate) : addDays(today(), -1)) });
      expect(await recurringRow(s, student.user.id, series.id)).toMatchObject({ status: 'ENDED', nextDate: null });
    });

    it('item 3 (M-3): Delete my account ends the monthly series on the cancel day', async () => {
      const { student, membership, next } = await member(s, monthly.id, 'deleting');
      const self = jwt.sign({ sub: student.user.id, email: student.user.email, grants: [] });
      const stepUp = await http().post('/v1/auth/step-up/verify').set('Authorization', `Bearer ${self}`).send({ passcode: PASSCODE });
      expect(stepUp.status).toBe(201);
      const res = await http().post('/v1/users/me/deletion').set('Authorization', `Bearer ${self}`).set('x-step-up-token', stepUp.body.stepUpToken);
      expect(res.status).toBe(200);
      expect((await su.membership.findUniqueOrThrow({ where: { id: membership.id } })).cancelAt?.toISOString()).toBe(midnight(next).toISOString());
      const series = await seriesOf(membership.id);
      expect(series).toMatchObject({ nextDate: null, endDate: midnight(addDays(next, -1)) });
      expect(await recurringRow(s, student.user.id, series.id)).toMatchObject({ nextDate: null });
    });

    it('item 3: any other end (here, ended outside the app paths) is caught by the charge-recurring job', async () => {
      const { student, membership } = await member(s, monthly.id, 'ended-elsewhere');
      await su.membership.update({ where: { id: membership.id }, data: { status: 'EXPIRED' } });
      expect(await recurringRow(s, student.user.id, (await seriesOf(membership.id)).id)).toMatchObject({ status: 'ACTIVE' });
      await job.run(new Date());
      const series = await seriesOf(membership.id);
      expect(series.nextDate).toBeNull();
      expect(await recurringRow(s, student.user.id, series.id)).toMatchObject({ status: 'ENDED', nextDate: null });
      // A running membership's series is left alone.
      const running = await member(s, monthly.id, 'still-running');
      await job.run(new Date());
      expect(dayOf((await seriesOf(running.membership.id)).nextDate!)).toBe(running.next);
    });
  });

  describe('item 4: revenue counts what was kept', () => {
    const revenueOf = async (s: School, currency: string) => {
      const summary = await http().get(`/v1/schools/${s.school.id}/transactions/summary`).set('Authorization', `Bearer ${s.ownerToken}`);
      expect(summary.status).toBe(200);
      const overview = await http().get(`/v1/schools/${s.school.id}/charge-reports/overview`).set('Authorization', `Bearer ${s.ownerToken}`);
      expect(overview.status).toBe(200);
      return {
        summary: (summary.body.revenue as Array<{ currency: string; amount: number }>).find((r) => r.currency === currency)?.amount ?? 0,
        overview: (overview.body.currencies as Array<{ currency: string; memberships: number }>).find((c) => c.currency === currency)?.memberships ?? 0,
      };
    };

    it('M-4: a desk refund that leaves the non-refundable joining fee: the fee stays in both figures', async () => {
      const s = await mkSchool('Taxa');
      const plan = await su.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.school.id, type: 'SUBSCRIPTION', title: 'Mensal taxa', price: 18990, currency: 'BRL', joiningFee: 5000, joiningFeeRefundable: false },
      });
      const { transactionId } = await member(s, plan.id, 'fee-kept');
      expect(await su.transaction.findUniqueOrThrow({ where: { id: transactionId } })).toMatchObject({ amount: 23990, joiningFeeAmount: 5000 });
      expect(await revenueOf(s, 'BRL')).toEqual({ summary: 23990, overview: 23990 });

      const refund = await http()
        .post(`/v1/transactions/${transactionId}/refund`)
        .set('Authorization', `Bearer ${s.ownerToken}`)
        .send({ amount: 18990, notes: 'devolvido', endMembership: true });
      expect(refund.status).toBe(201);
      expect(refund.body.status).toBe('REFUNDED');
      expect(await revenueOf(s, 'BRL')).toEqual({ summary: 5000, overview: 5000 });
    });

    it('M-5: a part refund counts its amount less the refund on Transactions as on the overview; a whole refund (surcharge too) counts nothing', async () => {
      const s = await mkSchool('Card');
      const student = await mkStudent('card', s.school.id);
      const plan = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, type: 'CLASS_PACK', title: 'Pack', price: 8000, classesIncluded: 10, currency: 'GBP' } });
      const row = (amount: number, status: 'SUCCESSFUL' | 'REFUNDED', refundedAmount: number | null, surchargeAmount = 0) => ({
        id: randomUUID(), schoolId: s.school.id, studentId: student.user.id, paymentAccountId: s.account.id, membershipPlanId: plan.id,
        kind: 'MEMBERSHIP' as const, amount, surchargeAmount, currency: 'GBP', status, refundedAmount, paymentMethod: 'STRIPE' as const,
      });
      await su.transaction.createMany({
        data: [
          row(8000, 'SUCCESSFUL', 3000, 160), // £80 pack, £30 refunded in Stripe: £50 kept
          row(4000, 'REFUNDED', 4080, 80), // refunded in full with its surcharge: nothing kept
          row(2000, 'SUCCESSFUL', null), // not refunded
        ],
      });
      expect(await revenueOf(s, 'GBP')).toEqual({ summary: 7000, overview: 7000 });
    });
  });
});
