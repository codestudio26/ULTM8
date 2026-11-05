import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Income categories (Decision 316 item 10): the School names its own list; a
 * membership plan, a staff-created charge and a recurring charge (and each of
 * its occurrences) can carry one; the Transactions list (and so its CSV
 * export) shows it. Who manages and reads the list, that a category of
 * another School is never accepted (API and database), that one in use can't
 * be deleted, and that members never see it. Against a real Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[income-categories.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describeIfDb('Income categories (Decision 316 item 10)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let branch: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const schoolIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token}`),
  });
  const sign = (user: { id: string; email: string }, role: string, schoolId: string, branchId: string | null = null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId }] });
  const listUrl = (schoolId: string) => `/v1/schools/${schoolId}/income-categories`;

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `income-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Income',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    users[label] = user;
    return user;
  }

  async function grant(label: string, role: string, schoolId: string, branchId: string | null = null, isMainOwner = false) {
    const user = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: role as never, userId: user.id, schoolId, branchId, isMainOwner } });
    tokens[label] = sign(user, role, schoolId, branchId);
    return user;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Income School', defaultCurrency: 'BRL' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Income School', defaultCurrency: 'BRL' } });
    schoolIds.push(school.id, otherSchool.id);
    branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
    await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });

    await grant('owner', 'SCHOOL_OWNER_MANAGER', school.id, null, true);
    await grant('otherOwner', 'SCHOOL_OWNER_MANAGER', otherSchool.id, null, true);
    await grant('staff', 'BRANCH_STAFF', school.id, branch.id);
    await grant('coach', 'INSTRUCTOR', school.id, branch.id);
    const student = await grant('student', 'STUDENT', school.id);
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, branchId: branch.id } });
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.chargeAllocation.deleteMany({ where });
    await superuser.balanceEntry.deleteMany({ where });
    await superuser.transaction.deleteMany({ where });
    await superuser.charge.deleteMany({ where });
    await superuser.recurringCharge.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.incomeCategory.deleteMany({ where });
    await superuser.staffActivity.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.studentHomeBranch.deleteMany({ where });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  const names = (res: request.Response) => (res.body.items as { name: string }[]).map((c) => c.name);

  it("the owner manages the School's list; names are unique ignoring case", async () => {
    const kids = await as(tokens.owner).post(listUrl(school.id), { name: '  Kids   programme ' });
    expect(kids.status).toBe(201);
    expect(kids.body).toMatchObject({ name: 'Kids programme', useCount: 0 });
    expect((await as(tokens.owner).post(listUrl(school.id), { name: 'Merchandise' })).status).toBe(201);
    expect((await as(tokens.owner).post(listUrl(school.id), { name: 'KIDS programme' })).status).toBe(409);
    expect((await as(tokens.owner).post(listUrl(school.id), { name: '   ' })).status).toBe(400);
    expect((await as(tokens.owner).post(listUrl(school.id), { name: 'x'.repeat(61) })).status).toBe(400);

    const renamed = await as(tokens.owner).patch(`${listUrl(school.id)}/${kids.body.id}`, { name: 'Kids classes' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Kids classes');
    expect((await as(tokens.owner).patch(`${listUrl(school.id)}/${kids.body.id}`, { name: 'merchandise' })).status).toBe(409);

    const temp = (await as(tokens.owner).post(listUrl(school.id), { name: 'Temp' })).body;
    expect((await as(tokens.owner).delete(`${listUrl(school.id)}/${temp.id}`)).status).toBe(204);
    expect((await as(tokens.owner).delete(`${listUrl(school.id)}/${temp.id}`)).status).toBe(404);

    expect(names(await as(tokens.owner).get(listUrl(school.id)))).toEqual(['Kids classes', 'Merchandise']);
  });

  it('staff read the list but cannot change it; members and other Schools reach nothing', async () => {
    const list = await as(tokens.staff).get(listUrl(school.id));
    expect(list.status).toBe(200);
    expect(names(list)).toEqual(['Kids classes', 'Merchandise']);
    expect((await as(tokens.coach).get(listUrl(school.id))).status).toBe(200);
    const id = list.body.items[0].id;

    expect((await as(tokens.staff).post(listUrl(school.id), { name: 'Staff made' })).status).toBe(403);
    expect((await as(tokens.staff).patch(`${listUrl(school.id)}/${id}`, { name: 'Staff renamed' })).status).toBe(403);
    expect((await as(tokens.staff).delete(`${listUrl(school.id)}/${id}`)).status).toBe(403);
    expect((await as(tokens.student).get(listUrl(school.id))).status).toBe(403);

    expect((await as(tokens.otherOwner).get(listUrl(school.id))).status).toBe(403);
    expect((await as(tokens.otherOwner).patch(`${listUrl(otherSchool.id)}/${id}`, { name: 'Taken over' })).status).toBe(404);
    expect((await as(tokens.otherOwner).delete(`${listUrl(otherSchool.id)}/${id}`)).status).toBe(404);

    // The app connection has no grant on the table at all.
    await expect(appDb.incomeCategory.findMany()).rejects.toThrow();
  });

  it('a plan carries one of its own School\'s categories, can change or clear it, and never takes another School\'s', async () => {
    const [kids, merch] = (await as(tokens.owner).get(listUrl(school.id))).body.items as { id: string; name: string }[];
    const foreign = (await as(tokens.otherOwner).post(listUrl(otherSchool.id), { name: 'Foreign' })).body;

    const base = { type: 'CLASS_PACK', title: 'Ten classes', price: 10000, classesIncluded: 10, expiryDurationDays: 90 };
    expect((await as(tokens.owner).post(`/v1/schools/${school.id}/membership-plans`, { ...base, incomeCategoryId: foreign.id })).status).toBe(400);
    const plan = await as(tokens.owner).post(`/v1/schools/${school.id}/membership-plans`, { ...base, incomeCategoryId: kids.id });
    expect(plan.status).toBe(201);
    expect(plan.body.incomeCategoryId).toBe(kids.id);

    expect((await as(tokens.owner).patch(`/v1/membership-plans/${plan.body.id}`, { incomeCategoryId: foreign.id })).status).toBe(400);
    expect((await as(tokens.owner).patch(`/v1/membership-plans/${plan.body.id}`, { incomeCategoryId: merch.id })).body.incomeCategoryId).toBe(merch.id);
    // Editing something else leaves it alone; null clears it.
    expect((await as(tokens.owner).patch(`/v1/membership-plans/${plan.body.id}`, { title: 'Ten classes pack' })).body.incomeCategoryId).toBe(merch.id);
    expect((await as(tokens.owner).patch(`/v1/membership-plans/${plan.body.id}`, { incomeCategoryId: null })).body.incomeCategoryId).toBeNull();
    await as(tokens.owner).patch(`/v1/membership-plans/${plan.body.id}`, { incomeCategoryId: kids.id });

    // The database refuses another School's category too, whatever writes it.
    await expect(superuser.membershipPlan.update({ where: { id: plan.body.id }, data: { incomeCategoryId: foreign.id } })).rejects.toThrow();
  });

  it('staff charges and recurring charges carry a category; staff see it, the member does not', async () => {
    const [kids, merch] = (await as(tokens.owner).get(listUrl(school.id))).body.items as { id: string; name: string }[];
    const foreign = (await as(tokens.otherOwner).get(listUrl(otherSchool.id))).body.items[0];
    const chargesUrl = `/v1/schools/${school.id}/students/${users.student.id}/charges`;

    expect((await as(tokens.staff).post(chargesUrl, { description: 'Rash guard', amount: 12000, dueDate: day(7), incomeCategoryId: foreign.id })).status).toBe(400);
    const charge = await as(tokens.staff).post(chargesUrl, { description: 'Rash guard', amount: 12000, dueDate: day(7), incomeCategoryId: merch.id });
    expect(charge.status).toBe(201);
    expect(charge.body.incomeCategoryName).toBe('Merchandise');
    const plain = await as(tokens.owner).post(chargesUrl, { description: 'Gloves', amount: 5000, dueDate: day(7) });
    expect(plain.body.incomeCategoryName).toBeNull();

    const recurringUrl = `/v1/schools/${school.id}/students/${users.student.id}/recurring-charges`;
    expect((await as(tokens.owner).post(recurringUrl, { description: 'Private lesson', amount: 8000, frequency: 'WEEKLY', firstDate: day(0), incomeCategoryId: foreign.id })).status).toBe(400);
    const series = await as(tokens.owner).post(recurringUrl, { description: 'Private lesson', amount: 8000, frequency: 'WEEKLY', firstDate: day(0), incomeCategoryId: kids.id });
    expect(series.status).toBe(201);
    expect(series.body.incomeCategoryName).toBe('Kids classes');
    // A first date of today makes its first charge straight away, with the series' category.
    const occurrence = await superuser.charge.findFirst({ where: { recurringChargeId: series.body.id } });
    expect(occurrence?.incomeCategoryId).toBe(kids.id);

    const staffView = await as(tokens.owner).get(chargesUrl);
    const byDescription = (items: { description: string; incomeCategoryName: string | null }[], d: string) => items.find((c) => c.description === d)?.incomeCategoryName;
    expect(byDescription(staffView.body.charges, 'Rash guard')).toBe('Merchandise');
    expect(byDescription(staffView.body.charges, 'Private lesson')).toBe('Kids classes');

    const memberView = await as(tokens.student).get(`/v1/students/${users.student.id}/charges`);
    expect(memberView.status).toBe(200);
    const memberCharges = (memberView.body.schools as { charges: { incomeCategoryName: string | null }[] }[]).flatMap((s) => s.charges);
    expect(memberCharges.length).toBeGreaterThan(0);
    expect(memberCharges.every((c) => c.incomeCategoryName === null)).toBe(true);
    const memberSeries = await as(tokens.student).get(`/v1/students/${users.student.id}/recurring-charges`);
    expect(JSON.stringify(memberSeries.body)).not.toContain('Kids classes');
  });

  it('a category in use cannot be deleted, only renamed; the list counts its uses', async () => {
    const list = (await as(tokens.owner).get(listUrl(school.id))).body.items as { id: string; name: string; useCount: number }[];
    const kids = list.find((c) => c.name === 'Kids classes')!;
    // The plan, the recurring charge and its first occurrence.
    expect(kids.useCount).toBe(3);
    const refused = await as(tokens.owner).delete(`${listUrl(school.id)}/${kids.id}`);
    expect(refused.status).toBe(409);
    await expect(superuser.incomeCategory.delete({ where: { id: kids.id } })).rejects.toThrow();
    expect((await as(tokens.owner).patch(`${listUrl(school.id)}/${kids.id}`, { name: 'Kids' })).status).toBe(200);
  });

  it('the Transactions list (and its CSV) shows the category of the plan or charge each payment is for', async () => {
    const chargesUrl = `/v1/schools/${school.id}/students/${users.student.id}/charges`;
    const rash = (await as(tokens.owner).get(chargesUrl)).body.charges.find((c: { description: string }) => c.description === 'Rash guard');
    const paid = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${users.student.id}/charge-payments`, { paymentMethod: 'CASH', amount: rash.grossAmount, chargeId: rash.id });
    expect(paid.status).toBe(201);

    const plan = await superuser.membershipPlan.findFirstOrThrow({ where: { schoolId: school.id, title: 'Ten classes pack' } });
    const bought = await as(tokens.student).post(`/v1/membership-plans/${plan.id}/purchase`, {});
    expect(bought.status).toBe(201);
    expect(bought.body.outcome).toBe('pending_confirmation');

    const ledger = await as(tokens.owner).get(`/v1/schools/${school.id}/transactions`);
    expect(ledger.status).toBe(200);
    const rows = ledger.body.items as { kind: string; incomeCategoryName: string | null; membershipPlanTitle: string | null }[];
    expect(rows.find((r) => r.kind === 'CHARGE_PAYMENT')?.incomeCategoryName).toBe('Merchandise');
    expect(rows.find((r) => r.kind === 'MEMBERSHIP' && r.membershipPlanTitle === 'Ten classes pack')?.incomeCategoryName).toBe('Kids');

    const mine = await as(tokens.student).get('/v1/transactions/me');
    expect(mine.status).toBe(200);
    expect((mine.body.items as { incomeCategoryName: string | null }[]).every((r) => r.incomeCategoryName === null)).toBe(true);
  });
});
