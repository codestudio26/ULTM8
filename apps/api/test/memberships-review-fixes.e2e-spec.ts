import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Decision 334 — the Memberships section review of 26 Oct 2026 (bugs M1-M20,
 * Q2 hidden plans). One test per fix, against a real Postgres. Stripe paths
 * need live credentials and are covered by unit tests instead; every purchase
 * here goes through a Bank Transfer School or the £0 path.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[memberships-review-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;

describeIfDb('Memberships review fixes (Decision 334)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let tokenOwner: string;
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  function sign(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `memberships-fixes-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Fixes',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  /** A new Student of `schoolId`, with a token. */
  async function mkStudent(label: string, schoolId = school.id) {
    const user = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    return { user, token: sign(user, [{ role: 'STUDENT', franchiseId: null, schoolId, branchId: null }]) };
  }

  async function mkSchool(name: string, data: Record<string, unknown> = {}) {
    const created = await superuser.school.create({ data: { id: randomUUID(), name, ...data } });
    schoolIds.push(created.id);
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: created.id, provider: 'BANK_TRANSFER', accountTitle: 'Fixture', country: 'GB' },
    });
    return created;
  }

  const createPlan = (body: Record<string, unknown>, schoolId = school.id, token = tokenOwner) =>
    request(app.getHttpServer()).post(`/v1/schools/${schoolId}/membership-plans`).set('Authorization', `Bearer ${token}`).send(body);
  const patchPlan = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).patch(`/v1/membership-plans/${id}`).set('Authorization', `Bearer ${tokenOwner}`).send(body);
  const purchase = (planId: string, token: string) =>
    request(app.getHttpServer()).post(`/v1/membership-plans/${planId}/purchase`).set('Authorization', `Bearer ${token}`).send({});
  const confirm = (transactionId: string, token = tokenOwner) =>
    request(app.getHttpServer()).patch(`/v1/transactions/${transactionId}/confirm`).set('Authorization', `Bearer ${token}`).send({});

  async function mkPlan(body: Record<string, unknown>) {
    const res = await createPlan({ currency: 'gbp', ...body });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await mkSchool('Memberships Fixes School');
    owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    tokenOwner = sign(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.transaction.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.waiverSignature.deleteMany({ where });
    await superuser.waiver.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    // Cash orders and confirmations notify the owner and the Student (Decision 339, T11).
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('M1: a Weekly Pass that ran out by date no longer blocks buying another', async () => {
    const plan = await mkPlan({ type: 'WEEKLY_PASS', title: 'Free week', price: 0, expiryDurationDays: 7 });
    const { user, token } = await mkStudent('m1');
    // Stored status stays ACTIVE after expiry (Decision 26).
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: user.id, membershipPlanId: plan.id, schoolId: school.id, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() - DAY) },
    });

    const res = await purchase(plan.id, token);
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('active');

    // A live one still blocks a second.
    expect((await purchase(plan.id, token)).status).toBe(409);
  });

  it('M20: a live Trial does not block buying a Weekly Pass', async () => {
    const trial = await mkPlan({ type: 'TRIAL_MEMBERSHIP', title: 'M20 trial', price: 0, expiryDurationDays: 7 });
    const week = await mkPlan({ type: 'WEEKLY_PASS', title: 'M20 week', price: 0, expiryDurationDays: 7 });
    const { token } = await mkStudent('m20');
    expect((await purchase(trial.id, token)).status).toBe(201);
    expect((await purchase(week.id, token)).status).toBe(201);
  });

  it('M1/M20: confirming a cash payment is refused while a live Weekly Pass exists, and the payment stays Pending', async () => {
    const paid = await mkPlan({ type: 'WEEKLY_PASS', title: 'Paid week', price: 2000, expiryDurationDays: 7 });
    const free = await mkPlan({ type: 'WEEKLY_PASS', title: 'Free week 2', price: 0, expiryDurationDays: 7 });
    const { token } = await mkStudent('m1-confirm');
    const pending = await purchase(paid.id, token);
    expect(pending.body.outcome).toBe('pending_confirmation');
    expect((await purchase(free.id, token)).status).toBe(201);

    const res = await confirm(pending.body.transactionId);
    expect(res.status).toBe(409);
    const tx = await superuser.transaction.findUniqueOrThrow({ where: { id: pending.body.transactionId } });
    expect(tx.status).toBe('PENDING');
  });

  it('M3: a Trial must last 1-30 days', async () => {
    expect((await createPlan({ type: 'TRIAL_MEMBERSHIP', title: 'No expiry', price: 0 })).status).toBe(400);
    expect((await createPlan({ type: 'TRIAL_MEMBERSHIP', title: 'Too long', price: 0, expiryDurationDays: 31 })).status).toBe(400);
    const plan = await mkPlan({ type: 'TRIAL_MEMBERSHIP', title: 'Thirty', price: 0, expiryDurationDays: 30 });
    expect((await patchPlan(plan.id, { expiryDurationDays: 60 })).status).toBe(400);
    expect((await patchPlan(plan.id, { expiryDurationDays: null })).status).toBe(400);
  });

  it('M3: at most 30 trial days per Student per School in 12 months, and the refusal says when the next can start', async () => {
    const twenty = await mkPlan({ type: 'TRIAL_MEMBERSHIP', title: '20-day trial', price: 0, expiryDurationDays: 20 });
    const ten = await mkPlan({ type: 'TRIAL_MEMBERSHIP', title: '10-day trial', price: 0, expiryDurationDays: 10 });
    const { token } = await mkStudent('m3');
    expect((await purchase(twenty.id, token)).status).toBe(201);

    const refused = await purchase(twenty.id, token);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/Another trial can start on \d{4}-\d{2}-\d{2}/);

    expect((await purchase(ten.id, token)).status).toBe(201);
    expect((await purchase(ten.id, token)).status).toBe(409);
  });

  it('M2: changing type clears what the new type does not use; sending it is refused', async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Pack to sub', price: 5000, classesIncluded: 10, expiryDurationDays: 90 });
    const res = await patchPlan(plan.id, { type: 'SUBSCRIPTION' });
    expect(res.status).toBe(200);
    expect(res.body.classesIncluded).toBeNull();
    expect(res.body.expiryDurationDays).toBeNull();

    expect((await createPlan({ type: 'WEEKLY_PASS', title: 'Week with credits', price: 100, expiryDurationDays: 7, classesIncluded: 3 })).status).toBe(400);
    expect((await createPlan({ type: 'SUBSCRIPTION', title: 'Sub with expiry', price: 100, expiryDurationDays: 30 })).status).toBe(400);
  });

  it('M14: the type is locked while the plan has live members', async () => {
    const plan = await mkPlan({ type: 'WEEKLY_PASS', title: 'Locked week', price: 0, expiryDurationDays: 7 });
    const { token } = await mkStudent('m14');
    expect((await purchase(plan.id, token)).status).toBe(201);

    const res = await patchPlan(plan.id, { type: 'CLASS_PACK', classesIncluded: 5 });
    expect(res.status).toBe(409);
    // Other edits still work.
    expect((await patchPlan(plan.id, { title: 'Renamed week' })).status).toBe(200);
  });

  it('M4: Class Pack needs a class count and Weekly Pass an expiry; a legacy plan can still be edited otherwise', async () => {
    expect((await createPlan({ type: 'CLASS_PACK', title: 'Unlimited pack', price: 100 })).status).toBe(400);
    expect((await createPlan({ type: 'WEEKLY_PASS', title: 'Endless week', price: 100 })).status).toBe(400);

    const legacy = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'WEEKLY_PASS', title: 'Legacy week', price: 100 },
    });
    expect((await patchPlan(legacy.id, { visible: false })).status).toBe(200);
    expect((await patchPlan(legacy.id, { expiryDurationDays: null })).status).toBe(400);
  });

  it('M6: no plan or School currency is refused; the School default is used when the plan has none', async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'No currency', price: 1000, classesIncluded: 1, currency: undefined });
    const { token } = await mkStudent('m6');
    const refused = await purchase(plan.id, token);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain('no currency');

    const euroSchool = await mkSchool('Memberships Fixes Euro School', { defaultCurrency: 'EUR' });
    const euroPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: euroSchool.id, type: 'CLASS_PACK', title: 'Euro pack', price: 1000, classesIncluded: 1 },
    });
    const euroStudent = await mkStudent('m6-eur', euroSchool.id);
    const res = await purchase(euroPlan.id, euroStudent.token);
    expect(res.status).toBe(201);
    const tx = await superuser.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
    expect(tx.currency).toBe('EUR');
  });

  it("M7: a plan that requires a waiver can't be bought until one is signed", async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Waiver pack', price: 1000, classesIncluded: 1, termsWaiverRequired: true });
    const { user, token } = await mkStudent('m7');
    expect((await purchase(plan.id, token)).status).toBe(400);

    const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Risks acknowledged.' } });
    await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: waiver.id, studentId: user.id, signedById: user.id, schoolId: school.id, status: 'SIGNED', signedDate: new Date() },
    });
    expect((await purchase(plan.id, token)).status).toBe(201);
  });

  it('M8: a price too large for the database is a 400, not a 500', async () => {
    expect((await createPlan({ type: 'CLASS_PACK', title: 'Huge', price: 3_000_000_000, classesIncluded: 1 })).status).toBe(400);
  });

  it('M9/M18: active-count leaves out removed Students and reports subscribers separately', async () => {
    const plan = await mkPlan({ type: 'WEEKLY_PASS', title: 'Counted week', price: 0, expiryDurationDays: 7 });
    const kept = await mkStudent('m18-kept');
    const removed = await mkStudent('m18-removed');
    expect((await purchase(plan.id, kept.token)).status).toBe(201);
    expect((await purchase(plan.id, removed.token)).status).toBe(201);
    await superuser.roleGrant.updateMany({ where: { userId: removed.user.id, schoolId: school.id }, data: { revokedAt: new Date() } });

    const res = await request(app.getHttpServer()).get(`/v1/membership-plans/${plan.id}/active-count`).set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activeCount: 1, subscriberCount: 0 });
  });

  it("M18: a removed Student's Pending cash payment can't be confirmed", async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Removed pack', price: 1000, classesIncluded: 1 });
    const { user, token } = await mkStudent('m18-confirm');
    const pending = await purchase(plan.id, token);
    await superuser.roleGrant.updateMany({ where: { userId: user.id, schoolId: school.id }, data: { revokedAt: new Date() } });

    expect((await confirm(pending.body.transactionId)).status).toBe(409);
    expect(await superuser.membership.count({ where: { studentId: user.id } })).toBe(0);
  });

  it('M11: blank titles and unknown currencies are refused; currencies are stored upper-case', async () => {
    expect((await createPlan({ type: 'CLASS_PACK', title: '   ', price: 100, classesIncluded: 1 })).status).toBe(400);
    expect((await createPlan({ type: 'CLASS_PACK', title: 'Bad currency', price: 100, classesIncluded: 1, currency: 'xyz' })).status).toBe(400);
    const res = await createPlan({ type: 'CLASS_PACK', title: '  Trimmed  ', price: 100, classesIncluded: 1, currency: 'eur' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Trimmed');
    expect(res.body.currency).toBe('EUR');
  });

  it('M12: with no subscribers, a price or currency change drops the saved Stripe price; with subscribers, currency is locked', async () => {
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000, currency: 'GBP', stripePriceId: 'price_old' },
    });
    const res = await patchPlan(plan.id, { price: 6000 });
    expect(res.status).toBe(200);
    expect(res.body.stripePriceId ?? null).toBeNull();
    expect((await superuser.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } })).stripePriceId).toBeNull();

    const { user } = await mkStudent('m12');
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: user.id, membershipPlanId: plan.id, schoolId: school.id, frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}` },
    });
    expect((await patchPlan(plan.id, { currency: 'eur' })).status).toBe(400);
  });

  it('M13: a closed School takes no purchases and no confirmations', async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Closing pack', price: 1000, classesIncluded: 1 });
    const { token } = await mkStudent('m13');
    const pending = await purchase(plan.id, token);
    expect(pending.status).toBe(201);

    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
    try {
      expect((await purchase(plan.id, token)).status).toBe(403);
      expect((await confirm(pending.body.transactionId)).status).toBe(403);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
    }
  });

  it('M15: a plan for a class that has started or been archived cannot be made or sold', async () => {
    const mkClass = (start: number, archived = false) =>
      superuser.class.create({
        data: {
          id: randomUUID(),
          schoolId: school.id,
          title: 'Seminar',
          activities: ['Judo'],
          startDate: new Date(Date.now() + start),
          endDate: new Date(Date.now() + start + 3600_000),
          archivedAt: archived ? new Date() : null,
        },
      });
    const past = await mkClass(-DAY);
    const archived = await mkClass(DAY, true);
    const future = await mkClass(DAY);
    expect((await createPlan({ type: 'CLASS_PACK', title: 'Past seminar', price: 1000, scopedClassId: past.id })).status).toBe(400);
    expect((await createPlan({ type: 'CLASS_PACK', title: 'Archived seminar', price: 1000, scopedClassId: archived.id })).status).toBe(400);

    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Future seminar', price: 1000, scopedClassId: future.id });
    await superuser.class.update({ where: { id: future.id }, data: { startDate: new Date(Date.now() - 60_000) } });
    const { token } = await mkStudent('m15');
    expect((await purchase(plan.id, token)).status).toBe(400);
  });

  it('M16: asking to pay cash twice returns the same Pending payment', async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Once pack', price: 1000, classesIncluded: 1 });
    const { token } = await mkStudent('m16');
    const first = await purchase(plan.id, token);
    const second = await purchase(plan.id, token);
    expect(second.status).toBe(201);
    expect(second.body.transactionId).toBe(first.body.transactionId);
  });

  it('M17: someone who is not a Student of the School cannot buy its plans', async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Staff pack', price: 1000, classesIncluded: 1 });
    const staff = await mkUser('m17-staff');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id } });
    const token = sign(staff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
    expect((await purchase(plan.id, token)).status).toBe(403);
  });

  it('Q2: a hidden plan cannot be bought by its link', async () => {
    const plan = await mkPlan({ type: 'CLASS_PACK', title: 'Hidden pack', price: 1000, classesIncluded: 1, visible: false });
    const { token } = await mkStudent('q2');
    expect((await purchase(plan.id, token)).status).toBe(400);
  });
});
