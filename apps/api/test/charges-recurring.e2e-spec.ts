import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { ChargeRecurringProcessor } from '../src/jobs/charge-recurring.processor';
import { ChargeAutoPayProcessor } from '../src/jobs/charge-auto-pay.processor';
import { addDays, occurrenceDay, schoolToday } from '../src/charges/recurring-schedule';

/**
 * Recurring charges, step 3 of 6 of staff-created charges (v1.3 backlog §3.6;
 * Decision 303 item 1, Decision 338 item 2, Decision 412). Over real HTTP
 * against a real Postgres, with the real notification worker and the real
 * charge-recurring and charge-auto-pay jobs (Stripe faked):
 * - weekly, monthly and yearly series; an end date and a number of payments;
 * - the daily job makes one charge per occurrence, on its day in the School's
 *   time zone, with an invoice number and the tax at that moment; a rerun, or
 *   two runs at once, never doubles; missed days are caught up one each;
 * - who may set up, stop and restart; a former student's series stops; a
 *   closed or degraded School makes nothing; credit pays a new occurrence and
 *   automatic payment picks it up; another School is refused.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[charges-recurring.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const at = (offset: number) => new Date(Date.now() + offset * DAY);

type Series = { id: string; status: string; nextDate: string | null; createdCount: number; frequency: string; estimate: { grossAmount: number } };

describeIfDb('Recurring charges (backlog 3.6 step 3, Decision 412)', () => {
  let app: INestApplication;
  let job: ChargeRecurringProcessor;
  let autoPay: ChargeAutoPayProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const acct = `acct_${randomUUID().slice(0, 8)}`;

  let school: { id: string };
  let otherSchool: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  let seq = 0;

  const intents: Array<{ amount: number; off_session?: boolean }> = [];
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      paymentIntents: {
        create: jest.fn(async (params: { amount: number; off_session?: boolean }) => {
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
    patch: (url: string, body: Record<string, unknown> = {}) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const sign = (user: { id: string; email: string }, role: string | null, schoolId: string | null, branchId: string | null = null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: role ? [{ role, franchiseId: null, schoolId, branchId }] : [] });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `recurring-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Recurring',
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

  const setUp = (studentId: string, body: Record<string, unknown>, token = tokens.owner, schoolId = school.id) =>
    as(token).post(`/v1/schools/${schoolId}/students/${studentId}/recurring-charges`, { description: `Lesson ${++seq}`, amount: 10000, frequency: 'WEEKLY', firstDate: day(0), ...body });
  const setUpOk = async (studentId: string, body: Record<string, unknown>) => {
    const res = await setUp(studentId, body);
    expect(res.status).toBe(201);
    return res.body as Series;
  };
  const stop = (id: string, token = tokens.owner, schoolId = school.id) => as(token).post(`/v1/schools/${schoolId}/recurring-charges/${id}/stop`);
  const restart = (id: string, token = tokens.owner, schoolId = school.id) => as(token).post(`/v1/schools/${schoolId}/recurring-charges/${id}/restart`);
  const list = (studentId: string, token = tokens.owner) => as(token).get(`/v1/schools/${school.id}/students/${studentId}/recurring-charges`);
  const occurrences = (seriesId: string) => su.charge.findMany({ where: { recurringChargeId: seriesId }, orderBy: { occurrenceDate: 'asc' }, include: { allocations: true } });
  const dueDays = async (seriesId: string) => (await occurrences(seriesId)).map((c) => c.dueDate.toISOString().slice(0, 10));
  const series = (id: string) => su.recurringCharge.findUniqueOrThrow({ where: { id } });

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
    job = app.get(ChargeRecurringProcessor);
    autoPay = app.get(ChargeAutoPayProcessor);

    school = await su.school.create({ data: { id: randomUUID(), name: 'Recurring School', defaultCurrency: 'BRL', timezone: 'UTC' } });
    otherSchool = await su.school.create({ data: { id: randomUUID(), name: 'Other Recurring School', defaultCurrency: 'BRL', timezone: 'UTC' } });
    schoolIds.push(school.id, otherSchool.id);
    branchA = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch A' } });
    branchB = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch B' } });
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'BR', stripeConnectedAccountId: acct } });

    const owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokens.owner = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    const otherOwner = await mkUser('otherOwner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: otherSchool.id, isMainOwner: true } });
    tokens.otherOwner = sign(otherOwner, 'SCHOOL_OWNER_MANAGER', otherSchool.id);
    await mkStaff('staffA', 'BRANCH_STAFF', branchA.id);
    await mkStaff('coachA', 'INSTRUCTOR', branchA.id);
  });

  afterEach(async () => {
    await su.school.update({
      where: { id: school.id },
      data: { taxCountry: null, taxRateBasisPoints: 0, taxInclusive: true, branchStaffCanRecordPayments: false, archivedAt: null, platformSubscriptionStatus: null, timezone: 'UTC' },
    });
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.recurringCharge.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.staffPermission.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.studentHomeBranch.deleteMany({ where });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.branch.deleteMany({ where });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('setting up (Decision 412)', () => {
    it('weekly from today: the first charge is made now, with an invoice number and the tax kept on it; notices sent', async () => {
      await as(tokens.owner).patch(`/v1/schools/${school.id}`, { taxCountry: 'BR', taxRateBasisPoints: 2000, taxInclusive: false });
      const student = await mkStudent('weekly');
      const s = await setUpOk(student.id, { frequency: 'WEEKLY' });
      expect(s).toMatchObject({ status: 'ACTIVE', frequency: 'WEEKLY', createdCount: 1, nextDate: day(7), estimate: { grossAmount: 12000 } });
      const [first] = await occurrences(s.id);
      expect(first).toMatchObject({ dueDate: new Date(`${day(0)}T00:00:00Z`), taxRateBasisPoints: 2000, taxInclusive: false, taxCountry: 'BR', netAmount: 10000, taxAmount: 2000, grossAmount: 12000, currency: 'BRL', createdById: null });
      expect(first.invoiceNumber).toBeGreaterThan(0);

      const rows = await notices(student.id, 2);
      expect(rows.map((n) => n.title)).toEqual(['Recurring charge set up', 'New invoice']);
      expect(rows[0].body).toBe(`A recurring charge was set up: Lesson ${seq}, 120.00 BRL every week, first on ${day(0)}.`);
    });

    it('a first date later than today makes nothing yet', async () => {
      const student = await mkStudent('later');
      const s = await setUpOk(student.id, { frequency: 'MONTHLY', firstDate: day(3) });
      expect(s).toMatchObject({ status: 'ACTIVE', createdCount: 0, nextDate: day(3) });
      expect(await occurrences(s.id)).toHaveLength(0);
      // The job does not make it ahead of its day either.
      await job.run(at(2));
      expect(await occurrences(s.id)).toHaveLength(0);
      await job.run(at(3));
      expect(await dueDays(s.id)).toEqual([day(3)]);
    });

    it('refuses a past first date, both ends, an end before the first date, a bad discount and a former student', async () => {
      const student = await mkStudent('invalid');
      expect((await setUp(student.id, { firstDate: day(-1) })).body.error.code).toBe('RECURRING_CHARGE_FIRST_DATE_PAST');
      expect((await setUp(student.id, { endDate: day(30), maxOccurrences: 3 })).body.error.code).toBe('RECURRING_CHARGE_END_BOTH');
      expect((await setUp(student.id, { firstDate: day(5), endDate: day(4) })).body.error.code).toBe('RECURRING_CHARGE_END_BEFORE_FIRST');
      expect((await setUp(student.id, { discountType: 'FIXED', discountValue: 10000 })).body.error.code).toBe('CHARGE_DISCOUNT_TOO_BIG');
      expect((await setUp(student.id, { frequency: 'DAILY' })).status).toBe(400);
      expect((await setUp(student.id, { maxOccurrences: 0 })).status).toBe(400);
      await su.roleGrant.updateMany({ where: { userId: student.id, role: 'STUDENT' }, data: { revokedAt: new Date() } });
      expect((await setUp(student.id, {})).body.error.code).toBe('CHARGE_NOT_A_STUDENT');
    });
  });

  describe('the daily job', () => {
    it('monthly and yearly: one charge per occurrence date, on its date', async () => {
      const student = await mkStudent('calendar');
      const monthly = await setUpOk(student.id, { frequency: 'MONTHLY' });
      const yearly = await setUpOk(student.id, { frequency: 'YEARLY' });
      await job.run(at(400));
      const expected = (freq: 'MONTHLY' | 'YEARLY') => {
        const out: string[] = [];
        for (let i = 0; occurrenceDay(day(0), freq, i) <= day(400); i++) out.push(occurrenceDay(day(0), freq, i));
        return out;
      };
      expect(await dueDays(monthly.id)).toEqual(expected('MONTHLY'));
      expect(await dueDays(yearly.id)).toEqual(expected('YEARLY'));
      expect((await dueDays(yearly.id)).length).toBe(2);
      // Each one is its own invoice.
      const numbers = (await occurrences(monthly.id)).map((c) => c.invoiceNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it('a rerun, or two runs at once, never doubles; days missed are caught up one each', async () => {
      const student = await mkStudent('catchUp');
      const s = await setUpOk(student.id, { frequency: 'WEEKLY' });
      await Promise.all([job.run(at(21)), job.run(at(21))]);
      expect(await dueDays(s.id)).toEqual([day(0), day(7), day(14), day(21)]);
      await job.run(at(21));
      await job.run(at(22));
      expect(await occurrences(s.id)).toHaveLength(4);
      expect(await series(s.id)).toMatchObject({ nextIndex: 4, createdCount: 4, nextDate: new Date(`${day(28)}T00:00:00Z`) });
      // Every occurrence got its "New invoice" notice, plus the set-up one.
      const rows = await notices(student.id, 5);
      expect(rows.filter((n) => n.title === 'New invoice')).toHaveLength(4);
    });

    it('uses the School tax at the moment each charge is made', async () => {
      await as(tokens.owner).patch(`/v1/schools/${school.id}`, { taxCountry: 'BR', taxRateBasisPoints: 2000, taxInclusive: false });
      const student = await mkStudent('taxChange');
      const s = await setUpOk(student.id, { frequency: 'WEEKLY', discountType: 'PERCENT', discountValue: 1000 });
      await as(tokens.owner).patch(`/v1/schools/${school.id}`, { taxRateBasisPoints: 1000 });
      await job.run(at(7));
      const [first, second] = await occurrences(s.id);
      expect(first).toMatchObject({ discountAmount: 1000, netAmount: 9000, taxRateBasisPoints: 2000, taxAmount: 1800, grossAmount: 10800 });
      expect(second).toMatchObject({ discountAmount: 1000, netAmount: 9000, taxRateBasisPoints: 1000, taxAmount: 900, grossAmount: 9900 });
    });

    it('ends after the number of payments, or after the end date', async () => {
      const student = await mkStudent('ends');
      const byCount = await setUpOk(student.id, { frequency: 'WEEKLY', maxOccurrences: 2 });
      const byDate = await setUpOk(student.id, { frequency: 'WEEKLY', endDate: day(10) });
      await job.run(at(60));
      expect(await dueDays(byCount.id)).toEqual([day(0), day(7)]);
      expect(await dueDays(byDate.id)).toEqual([day(0), day(7)]);
      const items: Series[] = (await list(student.id)).body.items;
      expect(items.find((i) => i.id === byCount.id)).toMatchObject({ status: 'ENDED', nextDate: null, createdCount: 2 });
      expect(items.find((i) => i.id === byDate.id)).toMatchObject({ status: 'ENDED', nextDate: null });
      expect((await stop(byCount.id)).body.error.code).toBe('RECURRING_CHARGE_ENDED');
    });

    it('works in the School time zone: made when the School day starts, not the UTC day', async () => {
      await su.school.update({ where: { id: school.id }, data: { timezone: 'Pacific/Auckland' } });
      const student = await mkStudent('zone');
      const localTomorrow = addDays(schoolToday(new Date(), 'Pacific/Auckland'), 1);
      const s = await setUpOk(student.id, { frequency: 'WEEKLY', firstDate: localTomorrow });
      const startOfDay = DateTime.fromISO(`${localTomorrow}T00:30`, { zone: 'Pacific/Auckland' }).toJSDate();
      await job.run(new Date(startOfDay.getTime() - 60 * 60 * 1000));
      expect(await occurrences(s.id)).toHaveLength(0);
      await job.run(startOfDay);
      // Still the day before in UTC, but already the School's day.
      expect(startOfDay.toISOString().slice(0, 10) < localTomorrow).toBe(true);
      expect(await dueDays(s.id)).toEqual([localTomorrow]);
    });

    it('a former student: the series stops and nothing is charged', async () => {
      const student = await mkStudent('leaver');
      const s = await setUpOk(student.id, { frequency: 'WEEKLY' });
      await su.roleGrant.updateMany({ where: { userId: student.id, role: 'STUDENT' }, data: { revokedAt: new Date() } });
      await job.run(at(14));
      expect(await occurrences(s.id)).toHaveLength(1);
      expect(await series(s.id)).toMatchObject({ stoppedReason: 'STUDENT_LEFT', stoppedById: null });
      expect((await restart(s.id)).body.error.code).toBe('CHARGE_NOT_A_STUDENT');
    });

    it('a closed or degraded School makes no occurrences; those days are passed over, not made later', async () => {
      const student = await mkStudent('closed');
      const s = await setUpOk(student.id, { frequency: 'WEEKLY' });
      await su.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
      await job.run(at(7));
      await su.school.update({ where: { id: school.id }, data: { archivedAt: null, platformSubscriptionStatus: 'CANCELED' } });
      await job.run(at(14));
      expect(await occurrences(s.id)).toHaveLength(1);
      await su.school.update({ where: { id: school.id }, data: { platformSubscriptionStatus: null } });
      await job.run(at(21));
      expect(await dueDays(s.id)).toEqual([day(0), day(21)]);
    });

    it('credit pays a new occurrence at once; automatic payment picks up the rest', async () => {
      const credited = await mkStudent('credit');
      await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: credited.id, schoolId: school.id, stripeCustomerId: `cus_${randomUUID()}`, autoPayCharges: true } });
      const desk = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${credited.id}/charge-payments`, { amount: 13000, paymentMethod: 'CASH', sendReceipt: false });
      expect(desk.status).toBe(201);
      const s = await setUpOk(credited.id, { frequency: 'WEEKLY', amount: 10000 });
      const [first] = await occurrences(s.id);
      expect(first.allocations.reduce((n, a) => n + a.amount, 0)).toBe(10000);

      await job.run(at(7));
      const before = intents.length;
      await autoPay.run(at(7));
      const second = (await occurrences(s.id))[1];
      // 3,000 of credit left, the card pays the other 7,000.
      expect(intents.slice(before)).toEqual([expect.objectContaining({ amount: 7000, off_session: true })]);
      expect(await su.transaction.findMany({ where: { chargeId: second.id, chargePaymentChannel: 'AUTOMATIC' } })).toEqual([expect.objectContaining({ amount: 7000, status: 'SUCCESSFUL' })]);
      expect((await su.charge.findUniqueOrThrow({ where: { id: second.id }, include: { allocations: true } })).allocations.reduce((n, a) => n + a.amount, 0)).toBe(10000);
    });
  });

  describe('stop and restart (Decision 412, Decision 338 item 2)', () => {
    it('stop: no more charges, the member is told; restart picks up from today, skipping the stopped weeks', async () => {
      const student = await mkStudent('stopRestart');
      const s = await setUpOk(student.id, { frequency: 'WEEKLY' });
      const stopped = await stop(s.id);
      expect(stopped.status).toBe(201);
      expect(stopped.body).toMatchObject({ status: 'STOPPED', stoppedReason: 'STAFF', nextDate: null });
      expect((await stop(s.id)).body.error.code).toBe('RECURRING_CHARGE_ALREADY_STOPPED');
      await job.run(at(14));
      expect(await occurrences(s.id)).toHaveLength(1);
      const rows = await notices(student.id, 3);
      expect(rows.map((n) => n.title)).toContain('Recurring charge stopped');

      // As if it had been stopped three weeks: started 21 days ago, one charge made.
      await su.recurringCharge.update({ where: { id: s.id }, data: { firstDate: new Date(`${day(-21)}T00:00:00Z`) } });
      await su.charge.updateMany({ where: { recurringChargeId: s.id }, data: { occurrenceDate: new Date(`${day(-21)}T00:00:00Z`) } });
      const back = await restart(s.id);
      expect(back.status).toBe(201);
      // Today's occurrence is made straight away; days -14 and -7 are not.
      expect(back.body).toMatchObject({ status: 'ACTIVE', nextDate: day(7), createdCount: 2 });
      expect((await occurrences(s.id)).map((c) => c.occurrenceDate!.toISOString().slice(0, 10))).toEqual([day(-21), day(0)]);
      expect((await restart(s.id)).body.error.code).toBe('RECURRING_CHARGE_NOT_STOPPED');
    });

    it('who: create/stop with "Can create charges"; restart only the owner and staff with access to payments', async () => {
      const mine = await mkStudent('perm', branchA.id);
      const theirs = await mkStudent('permOther', branchB.id);

      // Branch Staff (on by default) for their own branch's students only.
      const byStaff = await setUp(mine.id, {}, tokens.staffA);
      expect(byStaff.status).toBe(201);
      expect((await setUp(theirs.id, {}, tokens.staffA)).status).toBe(403);
      // Coaches are off by default.
      expect((await setUp(mine.id, {}, tokens.coachA)).status).toBe(403);
      expect((await stop(byStaff.body.id, tokens.coachA)).status).toBe(403);

      const staffList = await list(mine.id, tokens.staffA);
      expect(staffList.body.can).toEqual({ create: true, stop: true, restart: false });
      expect((await stop(byStaff.body.id, tokens.staffA)).status).toBe(201);
      const refused = await restart(byStaff.body.id, tokens.staffA);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('STAFF_ACCESS_OFF');

      // The School lets Branch Staff take payments (Decision 347): now they can restart.
      await su.school.update({ where: { id: school.id }, data: { branchStaffCanRecordPayments: true } });
      expect((await list(mine.id, tokens.staffA)).body.can.restart).toBe(true);
      expect((await restart(byStaff.body.id, tokens.staffA)).status).toBe(201);

      // Turning "Can create charges" off takes stopping away too.
      await su.staffPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: (await su.roleGrant.findFirstOrThrow({ where: { schoolId: school.id, role: 'BRANCH_STAFF' } })).userId, canCreateCharges: false } });
      expect((await stop(byStaff.body.id, tokens.staffA)).status).toBe(403);
      expect((await setUp(mine.id, {}, tokens.staffA)).status).toBe(403);
      await su.staffPermission.deleteMany({ where: { schoolId: school.id } });
    });

    it('another School is refused; the member and their Guardian see it read-only, a stranger does not', async () => {
      const student = await mkStudent('tenant');
      const s = await setUpOk(student.id, { frequency: 'MONTHLY', description: 'Private lesson' });
      expect((await list(student.id, tokens.otherOwner)).status).toBe(403);
      expect((await stop(s.id, tokens.otherOwner)).status).toBe(403);
      expect((await stop(s.id, tokens.otherOwner, otherSchool.id)).status).toBe(404);
      expect((await setUp(student.id, {}, tokens.otherOwner, otherSchool.id)).body.error.code).toBe('CHARGE_NOT_A_STUDENT');
      // A student can't use the staff routes.
      expect((await list(student.id, tokens.tenant)).status).toBe(403);

      const mine = await as(tokens.tenant).get(`/v1/students/${student.id}/recurring-charges`);
      expect(mine.status).toBe(200);
      expect(mine.body.items).toEqual([
        expect.objectContaining({ id: s.id, schoolName: 'Recurring School', description: 'Private lesson', frequency: 'MONTHLY', status: 'ACTIVE', createdByName: null }),
      ]);
      const parent = await mkUser('tenantParent');
      await su.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: student.id } });
      expect((await as(sign(parent, null, null)).get(`/v1/students/${student.id}/recurring-charges`)).body.items).toHaveLength(1);
      await mkStudent('stranger');
      expect((await as(tokens.stranger).get(`/v1/students/${student.id}/recurring-charges`)).status).toBe(403);
    });
  });
});
