import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Decision 414 item 6 — currency first. Until the School has set its currency
 * on the School page, no price can be saved anywhere: each path that saves an
 * amount is refused with SCHOOL_CURRENCY_REQUIRED, works once the currency is
 * set, and takes a price of 0 (free) either way. Records priced before the
 * rule keep their amounts, and their other fields can still be edited.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[currency-first.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const CODE = 'SCHOOL_CURRENCY_REQUIRED';
const day = (offset: number) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describeIfDb('Currency first (Decision 414 item 6)', () => {
  let app: INestApplication;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  let seq = 0;

  let school: { id: string };
  let branchId: string;
  let disciplineId: string;
  let owner: { id: string; email: string };
  let student: { id: string; email: string };
  let token: string;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${t}`).send(body),
    patch: (url: string, body: Record<string, unknown>) => http().patch(url).set('Authorization', `Bearer ${t}`).send(body),
    put: (url: string, body: Record<string, unknown>) => http().put(url).set('Authorization', `Bearer ${t}`).send(body),
  });
  const owned = () => as(token);
  const setCurrency = (defaultCurrency: string | null) => su.school.update({ where: { id: school.id }, data: { defaultCurrency } });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `currency-first-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'CurrencyFirst',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  /** The status, with the error alongside so a failure says why. */
  function expectStatus(res: request.Response, status: number) {
    expect({ status: res.status, error: res.body?.error }).toEqual({ status, error: status < 400 ? undefined : expect.anything() });
  }

  /** Refused with the code while the School has no currency. */
  async function expectRefused(res: request.Response) {
    expect({ status: res.status, code: res.body?.error?.code, message: res.body?.error?.message }).toEqual({ status: 400, code: CODE, message: "Set your School's currency on the School page before setting prices." });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await su.school.create({
      data: { id: randomUUID(), name: 'Currency First School', ranksToggle: true, promotionFeeEnabled: true, timezone: 'UTC' },
    });
    schoolIds.push(school.id);
    branchId = (await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } })).id;
    disciplineId = (await su.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } })).id;
    owner = await mkUser('owner');
    student = await mkUser('student');
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
      ],
    });
    token = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  beforeEach(async () => {
    await setCurrency(null);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.recurringCharge.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.rankStripeTier.deleteMany({ where });
    await su.rank.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.timetableSlot.deleteMany({ where });
    await su.discipline.deleteMany({ where });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.branch.deleteMany({ where });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('membership plans', () => {
    const create = (body: Record<string, unknown>) =>
      owned().post(`/v1/schools/${school.id}/membership-plans`, { type: 'CLASS_PACK', title: `Pack ${++seq}`, classesIncluded: 5, ...body });

    it('a priced plan is refused until the School has a currency, even with its own currency; a free one is not', async () => {
      await expectRefused(await create({ price: 5000 }));
      await expectRefused(await create({ price: 5000, currency: 'gbp' }));
      await expectRefused(await create({ price: 0, cancellationCharge: 500 }));
      expectStatus(await create({ price: 0 }), 201);

      await setCurrency('GBP');
      const res = await create({ price: 5000, cancellationCharge: 500 });
      expect(res.status).toBe(201);
      expect(res.body.price).toBe(5000);
    });

    it('a plan priced before the rule keeps its price, and everything else on it can still be edited', async () => {
      const legacy = await su.membershipPlan.create({
        data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Legacy pack', price: 4000, classesIncluded: 4, cancellationCharge: 300 },
      });
      const url = `/v1/membership-plans/${legacy.id}`;
      const renamed = await owned().patch(url, { title: 'Legacy pack, renamed' });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ title: 'Legacy pack, renamed', price: 4000 });
      // The portal sends the whole form: the same price and charge are not new prices.
      expectStatus(await owned().patch(url, { title: 'Legacy pack', price: 4000, cancellationCharge: 300 }), 200);
      await expectRefused(await owned().patch(url, { price: 4500 }));
      await expectRefused(await owned().patch(url, { cancellationCharge: 400 }));
      // Made free, or its charge cleared: allowed.
      expectStatus(await owned().patch(url, { cancellationCharge: null }), 200);
      expectStatus(await owned().patch(url, { price: 0 }), 200);

      await setCurrency('GBP');
      expectStatus(await owned().patch(url, { price: 4500 }), 200);
    });
  });

  describe('belt prices (promotion fees)', () => {
    const tier = (extra: Record<string, unknown> = {}) => ({ order: 0, count: 0, colour: '#000000', classesRequired: 3, ...extra });
    const create = (promotionFeeMinor: number | null) =>
      owned().post(`/v1/styles/${disciplineId}/ranks`, { order: 0, primaryColour: '#FFFFFF', stripeTiers: [tier({ promotionFeeMinor })] });

    it('a belt price is refused until the School has a currency; a free belt is not; a kept price is not a new one', async () => {
      await expectRefused(await create(1500));
      const free = await create(null);
      expect(free.status).toBe(201);
      const rankId = free.body.id as string;
      const tierId = free.body.stripeTiers[0].id as string;
      await expectRefused(await owned().patch(`/v1/ranks/${rankId}`, { stripeTiers: [tier({ id: tierId, promotionFeeMinor: 1500 })] }));

      await setCurrency('GBP');
      const priced = await owned().patch(`/v1/ranks/${rankId}`, { stripeTiers: [tier({ id: tierId, promotionFeeMinor: 1500 })] });
      expect(priced.status).toBe(200);
      expect(priced.body.stripeTiers[0].promotionFeeMinor).toBe(1500);

      // Without a currency again (as for a School priced before the rule):
      // re-saving the belt with the price it has, or making it free, works.
      await setCurrency(null);
      expectStatus(await owned().patch(`/v1/ranks/${rankId}`, { name: 'White', stripeTiers: [tier({ id: tierId, promotionFeeMinor: 1500 })] }), 200);
      await expectRefused(await owned().patch(`/v1/ranks/${rankId}`, { stripeTiers: [tier({ id: tierId, promotionFeeMinor: 2000 })] }));
      expectStatus(await owned().patch(`/v1/ranks/${rankId}`, { stripeTiers: [tier({ id: tierId, promotionFeeMinor: null })] }), 200);
    });
  });

  describe('charges', () => {
    const base = () => `/v1/schools/${school.id}/students/${student.id}`;

    it('a one-off charge, a recurring charge and credit are refused until the School has a currency', async () => {
      await expectRefused(await owned().post(`${base()}/charges`, { description: 'Rash guard', amount: 5000, dueDate: day(7) }));
      await expectRefused(await owned().post(`${base()}/recurring-charges`, { description: 'Lesson', amount: 2000, frequency: 'WEEKLY', firstDate: day(1) }));
      await expectRefused(await owned().post(`${base()}/credits`, { amount: 500, note: 'Goodwill' }));

      await setCurrency('GBP');
      expectStatus(await owned().post(`${base()}/charges`, { description: 'Rash guard', amount: 5000, dueDate: day(7) }), 201);
      expectStatus(await owned().post(`${base()}/recurring-charges`, { description: 'Lesson', amount: 2000, frequency: 'WEEKLY', firstDate: day(1) }), 201);
      expectStatus(await owned().post(`${base()}/credits`, { amount: 500, note: 'Goodwill' }), 201);
    });
  });

  describe("the School's own fees", () => {
    const lateFees = (body: Record<string, unknown>) =>
      owned().put(`/v1/schools/${school.id}/late-fees`, { enabled: false, type: 'FIXED', graceDays: 3, legalConfirmed: true, ...body });

    it('a fixed late fee is refused until the School has a currency, even while late fees are off; a percentage is not', async () => {
      await expectRefused(await lateFees({ fixedAmount: 500 }));
      await expectRefused(await lateFees({ enabled: true, fixedAmount: 500 }));
      expectStatus(await lateFees({ enabled: true, type: 'PERCENT', percentBps: 500 }), 200);
      expectStatus(await lateFees({ fixedAmount: null }), 200);

      await setCurrency('GBP');
      expectStatus(await lateFees({ enabled: true, fixedAmount: 500 }), 200);
    });

    it('the no-show fee and the freeze fee are refused until the School has a currency, unless set in the same save', async () => {
      const url = `/v1/schools/${school.id}`;
      await expectRefused(await owned().patch(url, { noShowFee: 500 }));
      await expectRefused(await owned().patch(url, { freezeFeeAmount: 1500 }));
      expectStatus(await owned().patch(url, { noShowFee: null, freezeFeeAmount: null, name: 'Currency First School' }), 200);

      const same = await owned().patch(url, { defaultCurrency: 'GBP', confirmCurrencyChange: true, noShowFee: 500, freezeFeeAmount: 1500 });
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({ defaultCurrency: 'GBP', noShowFee: 500, freezeFeeAmount: 1500 });

      // Saved before the rule (currency cleared since): unchanged amounts are kept.
      await setCurrency(null);
      expectStatus(await owned().patch(url, { noShowFee: 500, freezeFeeAmount: 1500, name: 'Currency First School' }), 200);
      await expectRefused(await owned().patch(url, { noShowFee: 600 }));
      await su.school.update({ where: { id: school.id }, data: { noShowFee: null, freezeFeeAmount: null } });
    });

    it("a Branch's no-show fee is refused until the School has a currency", async () => {
      const url = `/v1/branches/${branchId}`;
      await expectRefused(await owned().patch(url, { noShowFee: 500 }));
      expectStatus(await owned().patch(url, { name: 'Main' }), 200);
      await setCurrency('GBP');
      expectStatus(await owned().patch(url, { noShowFee: 500 }), 200);
    });
  });

  describe('late-cancellation charges on Classes and timetable slots', () => {
    const classBody = (extra: Record<string, unknown> = {}) => ({
      title: `Class ${++seq}`,
      styles: [{ disciplineId }],
      startDate: '2036-10-01T10:00:00.000Z',
      endDate: '2036-10-01T11:00:00.000Z',
      ...extra,
    });
    const slotBody = (extra: Record<string, unknown> = {}) => ({
      weekday: 'MONDAY',
      startTime: '18:00',
      endTime: '19:00',
      title: `Slot ${++seq}`,
      styles: [{ disciplineId }],
      ...extra,
    });

    it("a Class's cancellation charge is refused until the School has a currency; 0 is not", async () => {
      await expectRefused(await owned().post(`/v1/schools/${school.id}/classes`, classBody({ cancellationCharge: 500 })));
      expectStatus(await owned().post(`/v1/schools/${school.id}/classes`, classBody({ cancellationCharge: 0 })), 201);
      const created = await owned().post(`/v1/schools/${school.id}/classes`, classBody());
      expect(created.status).toBe(201);
      await expectRefused(await owned().patch(`/v1/classes/${created.body.id}`, { cancellationCharge: 500 }));
      expectStatus(await owned().patch(`/v1/classes/${created.body.id}`, { title: 'Renamed class' }), 200);

      await setCurrency('GBP');
      expectStatus(await owned().patch(`/v1/classes/${created.body.id}`, { cancellationCharge: 500 }), 200);
      expectStatus(await owned().post(`/v1/schools/${school.id}/classes`, classBody({ cancellationCharge: 500 })), 201);
    });

    it("a timetable slot's cancellation charge is refused until the School has a currency; 0 is not", async () => {
      await expectRefused(await owned().post(`/v1/schools/${school.id}/timetable`, slotBody({ cancellationCharge: 500 })));
      expectStatus(await owned().post(`/v1/schools/${school.id}/timetable`, slotBody({ cancellationCharge: 0 })), 201);
      const created = await owned().post(`/v1/schools/${school.id}/timetable`, slotBody());
      expect(created.status).toBe(201);
      await expectRefused(await owned().patch(`/v1/timetable/${created.body.id}`, { cancellationCharge: 500 }));

      await setCurrency('GBP');
      expectStatus(await owned().patch(`/v1/timetable/${created.body.id}`, { cancellationCharge: 500 }), 200);
    });
  });
});
