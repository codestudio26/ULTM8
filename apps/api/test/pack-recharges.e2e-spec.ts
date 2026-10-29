import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Decision 393 (Decision 316 item 7, handover F8): a Class Pack with no
 * classes left at check-in. The desk (or the tablet, with a scan) offers the
 * same pack; the member or their Guardian sees it in the app; once a new pack
 * exists, the desk finishes the check-in. Payment itself is the existing
 * purchase flow, so here the new Membership is made as the webhook would.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[pack-recharges.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const MIN = 60_000;

describeIfDb('Pack used up: buy the same pack (Decision 393)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let school: { id: string };
  let branch: { id: string };
  let plan: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const base = () => `/v1/schools/${school.id}/front-desk`;

  async function classNow(title = 'Fundamentals') {
    return superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, branchId: branch.id, title, startDate: new Date(Date.now() - 5 * MIN), endDate: new Date(Date.now() + 55 * MIN), membershipInclusion: true },
    });
  }

  async function usedUpPack(studentId: string) {
    return superuser.membership.create({
      data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: school.id, frequency: 'ONE_TIME', classesRemaining: 0, createdAt: new Date(Date.now() - 60 * MIN) },
    });
  }

  /** The new pack, as the payment webhook makes it. */
  async function buyPack(studentId: string) {
    return superuser.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: school.id, frequency: 'ONE_TIME', classesRemaining: 5 } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Recharge School' } });
    branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Centro' } });
    plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Five classes', price: 4000, currency: 'GBP', classesIncluded: 5 } });
    const people: Array<[string, Role | null, string | null, string]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', null, '1990-01-01'],
      ['coach', 'INSTRUCTOR', null, '1990-01-01'],
      ['ana', 'STUDENT', null, '1995-01-01'],
      ['bo', 'STUDENT', null, '1995-01-01'],
      ['kid', 'STUDENT', null, '2016-01-01'],
      ['mum', null, null, '1985-01-01'],
    ];
    for (const [who, role, branchId, dob] of people) {
      const user = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `recharge-${who}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: who[0].toUpperCase() + who.slice(1),
          surname: 'Desk',
          passcodeHash: 'x',
          dateOfBirth: new Date(dob),
          phoneVerifiedAt: new Date(),
        },
      });
      users[who] = user;
      if (role) await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId } });
      tokens[who] = jwt.sign({ sub: user.id, email: user.email, grants: role ? [{ role, franchiseId: null, schoolId: school.id, branchId }] : [] });
    }
    for (const who of ['ana', 'bo', 'kid']) {
      await superuser.studentHomeBranch.create({ data: { schoolId: school.id, studentId: users[who].id, branchId: branch.id } });
    }
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.mum.id, studentId: users.kid.id } });
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    await superuser.packRecharge.deleteMany({ where });
    await superuser.trainingLog.deleteMany({ where });
    await superuser.booking.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.frontDeskSession.deleteMany({ where });
    await superuser.staffKioskCode.deleteMany({ where });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.studentHomeBranch.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a used-up pack is its own refusal; the desk offers it, the member pays in the app, the desk finishes the check-in', async () => {
    const cls = await classNow();
    await usedUpPack(users.ana.id);
    const refused = await http().post(`${base()}/check-ins`).set(as('owner')).send({ studentId: users.ana.id, classIds: [cls.id] });
    expect(refused.body.done).toBe(false);
    expect(refused.body.classes[0]).toMatchObject({ ok: false, code: 'PACK_USED_UP' });

    const offer = await http().post(`${base()}/pack-recharges`).set(as('owner')).send({ studentId: users.ana.id, classIds: [cls.id] });
    expect(offer.status).toBe(201);
    expect(offer.body).toMatchObject({ membershipPlanId: plan.id, planTitle: 'Five classes', price: 4000, currency: 'GBP' });

    const mine = await http().get('/v1/pack-recharges/me').set(as('ana'));
    expect(mine.body.items).toEqual([expect.objectContaining({ id: offer.body.id, schoolName: 'Recharge School', childFirstName: null, plan: expect.objectContaining({ id: plan.id, title: 'Five classes' }) })]);
    // Nobody else sees it.
    expect((await http().get('/v1/pack-recharges/me').set(as('bo'))).body.items).toEqual([]);

    const status = () => http().get(`${base()}/pack-recharges/${offer.body.id}`).set(as('owner'));
    expect((await status()).body).toEqual({ paid: false, expired: false, completed: false });
    const early = await http().post(`${base()}/pack-recharges/${offer.body.id}/complete`).set(as('owner')).send();
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('RECHARGE_NOT_PAID');

    await buyPack(users.ana.id);
    expect((await status()).body.paid).toBe(true);
    // Paid: no longer offered in the app.
    expect((await http().get('/v1/pack-recharges/me').set(as('ana'))).body.items).toEqual([]);

    const done = await http().post(`${base()}/pack-recharges/${offer.body.id}/complete`).set(as('owner')).send();
    expect(done.status).toBe(200);
    expect(done.body.done).toBe(true);
    const booking = await superuser.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: users.ana.id } });
    expect(booking).toMatchObject({ status: 'COMPLETED', checkInMethod: 'INSTRUCTOR_MANUAL' });
    expect((await status()).body.completed).toBe(true);
  });

  it('asking again for the same pack updates the open offer instead of adding one', async () => {
    const a = await classNow('Morning');
    const b = await classNow('Noon');
    await usedUpPack(users.bo.id);
    const first = await http().post(`${base()}/pack-recharges`).set(as('owner')).send({ studentId: users.bo.id, classIds: [a.id] });
    const second = await http().post(`${base()}/pack-recharges`).set(as('owner')).send({ studentId: users.bo.id, classIds: [a.id, b.id] });
    expect(second.body.id).toBe(first.body.id);
    expect((await superuser.packRecharge.findUniqueOrThrow({ where: { id: first.body.id } })).classIds).toEqual([a.id, b.id]);
  });

  it('a Guardian sees their child\'s pack to buy', async () => {
    const cls = await classNow('Kids');
    await usedUpPack(users.kid.id);
    const offer = await http().post(`${base()}/pack-recharges`).set(as('owner')).send({ studentId: users.kid.id, classIds: [cls.id] });
    expect(offer.status).toBe(201);
    const mine = await http().get('/v1/pack-recharges/me').set(as('mum'));
    expect(mine.body.items).toEqual([expect.objectContaining({ id: offer.body.id, studentId: users.kid.id, childFirstName: 'Kid' })]);
  });

  it('refuses without a used-up pack, and for a pack no longer sold', async () => {
    const cls = await classNow('Refusals');
    const someone = await superuser.user.create({
      data: { id: randomUUID(), email: `recharge-none-${randomUUID()}@example.test`, firstName: 'None', surname: 'Pack', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') },
    });
    users.none = someone;
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: someone.id, schoolId: school.id } });
    const none = await http().post(`${base()}/pack-recharges`).set(as('owner')).send({ studentId: someone.id, classIds: [cls.id] });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('NO_PACK_TO_RECHARGE');

    const oldPlan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Old pack', price: 100, classesIncluded: 1, archivedAt: new Date() } });
    await superuser.membership.create({ data: { id: randomUUID(), studentId: someone.id, membershipPlanId: oldPlan.id, schoolId: school.id, frequency: 'ONE_TIME', classesRemaining: 0 } });
    const archived = await http().post(`${base()}/pack-recharges`).set(as('owner')).send({ studentId: someone.id, classIds: [cls.id] });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('PACK_NOT_FOR_SALE');
  });

  it('on the tablet it needs a scan, and the finishing check-in records the scan', async () => {
    const cls = await classNow('Tablet');
    const someone = await superuser.user.create({
      data: { id: randomUUID(), email: `recharge-cy-${randomUUID()}@example.test`, firstName: 'Cy', surname: 'Desk', passcodeHash: 'x', dateOfBirth: new Date('1995-01-01') },
    });
    users.cy = someone;
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: someone.id, schoolId: school.id } });
    await superuser.studentHomeBranch.create({ data: { schoolId: school.id, studentId: someone.id, branchId: branch.id } });
    tokens.cy = jwt.sign({ sub: someone.id, email: someone.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
    await usedUpPack(someone.id);

    const session = await http().post(`${base()}/sessions`).set(as('owner')).send({ branchId: branch.id });
    const tablet = { Authorization: `Bearer ${session.body.sessionToken}` };
    const byName = await http().post('/v1/front-desk/kiosk/pack-recharges').set(tablet).send({ studentId: someone.id, classIds: [cls.id] });
    expect(byName.status).toBe(400);
    expect(byName.body.error.code).toBe('KIOSK_BOOK_FIRST');

    const qr = (await http().get('/v1/attendance/my-qr-token').set(as('cy'))).body.token;
    const lookup = await http().post('/v1/front-desk/kiosk/qr-lookups').set(tablet).send({ studentToken: qr });
    const offer = await http().post('/v1/front-desk/kiosk/pack-recharges').set(tablet).send({ studentId: someone.id, classIds: [cls.id], lookupToken: lookup.body.lookupToken });
    expect(offer.status).toBe(201);
    // Another tablet, or the desk, can't finish this tablet's recharge from the tablet route.
    const other = await http().post(`${base()}/sessions`).set(as('owner')).send({ branchId: branch.id });
    expect((await http().get(`/v1/front-desk/kiosk/pack-recharges/${offer.body.id}`).set({ Authorization: `Bearer ${other.body.sessionToken}` })).status).toBe(404);

    await buyPack(someone.id);
    // Well after the 5-minute scan has gone, the paid recharge still finishes on its own tablet.
    const done = await http().post(`/v1/front-desk/kiosk/pack-recharges/${offer.body.id}/complete`).set(tablet).send();
    expect(done.status).toBe(200);
    expect(done.body.done).toBe(true);
    const booking = await superuser.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: someone.id } });
    expect(booking).toMatchObject({ status: 'COMPLETED', checkInMethod: 'INSTRUCTOR_SCAN' });
  });
});
