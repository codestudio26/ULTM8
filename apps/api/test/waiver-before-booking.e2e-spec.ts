/**
 * Decision 441 item 5: "Waiver must be signed before booking or check-in", a
 * School setting, on by default (School.checkInRequireWaiver, the check-in
 * rule of Decision 394, which now also covers booking):
 * - on, a member (or a child, through their parent) without a signed waiver
 *   for the School can't book a class, join its waiting list, claim an offered
 *   place or check in, whoever books (the member, a parent, staff);
 * - a School with no waiver in use (none, or only archived ones) stops nobody;
 * - off, a Class's own "needs a waiver" still works as before;
 * - buying a plan isn't blocked.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Waiver before booking or check-in (Decision 441 item 5)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const MIN = 60_000;
  let school: { id: string };
  let planId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const book = (who: string, cls: { id: string }, body: object = {}) => as(who).post(`/v1/classes/${cls.id}/book`).send(body);
  const scan = (cls: { id: string }, who: string) => as('coach').post(`/v1/classes/${cls.id}/attendance-scan`).send({ studentId: users[who].id });
  const setRule = (on: boolean) => superuser.school.update({ where: { id: school.id }, data: { checkInRequireWaiver: on } });

  async function classAt(startMin: number, extra: { capacity?: number; termsWaiverRequired?: boolean } = {}) {
    return superuser.class.create({
      data: {
        id: randomUUID(), schoolId: school.id, title: `Class ${startMin}`, membershipInclusion: true,
        startDate: new Date(Date.now() + startMin * MIN), endDate: new Date(Date.now() + (startMin + 60) * MIN), ...extra,
      },
    });
  }
  async function member(who: string) {
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: users[who].id, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
  }
  async function sign(waiverId: string, who: string, signedBy = who) {
    await superuser.waiverSignature.create({
      data: {
        id: randomUUID(), waiverId, studentId: users[who].id, signedById: users[signedBy].id, schoolId: school.id, status: 'SIGNED',
        signerFullName: `${signedBy} Waiver`, signatureText: `${signedBy} Waiver`, signedDate: new Date(),
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // Created with the column's default: on.
    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Waiver Before Booking School', defaultCurrency: 'brl' } });
    for (const label of ['owner', 'coach', 'ana', 'ben', 'cara', 'dan', 'parent', 'kid']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `waiver-before-booking-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Waiver',
          passcodeHash: 'x',
          dateOfBirth: new Date(label === 'kid' ? '2015-01-01' : '2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    const grants: Array<[string, 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT']> = [
      ['owner', 'SCHOOL_OWNER_MANAGER'],
      ['coach', 'INSTRUCTOR'],
      ['ana', 'STUDENT'],
      ['ben', 'STUDENT'],
      ['cara', 'STUDENT'],
      ['dan', 'STUDENT'],
      ['kid', 'STUDENT'],
    ];
    await superuser.roleGrant.createMany({
      data: grants.map(([who, role]) => ({ id: randomUUID(), role, userId: users[who].id, schoolId: school.id, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' })),
    });
    for (const [who, role] of grants) {
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
    }
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id } });
    await superuser.consentRecord.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id, tier: 'BASELINE', policyVersion: '2026-09-v1' } });
    tokens.parent = jwt.sign({ sub: users.parent.id, email: users.parent.email, grants: [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }] });
    planId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    for (const who of ['ana', 'ben', 'cara', 'dan', 'kid']) await member(who);
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    await superuser.waiverSignature.deleteMany({ where });
    // Decision 426: WaiverSignature.waiverId is ON DELETE RESTRICT, so the signatures go first.
    await superuser.waiverSignature.deleteMany({ where: { waiver: where } });
    await superuser.waiver.deleteMany({ where });
    await superuser.trainingLog.deleteMany({ where });
    await superuser.waitlistEntry.deleteMany({ where });
    await superuser.booking.deleteMany({ where });
    await superuser.balanceEntry.deleteMany({ where });
    await superuser.transaction.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.notification.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.consentRecord.deleteMany({ where: { guardianId: users.parent.id } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: users.parent.id } });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('is on for a new School, and a School with no waiver in use stops nobody', async () => {
    const rules = await as('owner').get(`/v1/schools/${school.id}/check-in-rules`);
    expect(rules.status).toBe(200);
    expect(rules.body.requireWaiver).toBe(true);

    // No waiver at all, then only an archived one: still nobody is stopped.
    expect((await book('ana', await classAt(60))).status).toBe(201);
    await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Old terms', body: 'Text', archivedAt: new Date() } });
    expect((await book('ana', await classAt(61))).status).toBe(201);
    const now = await classAt(-5);
    expect((await book('ana', now)).status).toBe(201);
    expect((await scan(now, 'ana')).status).toBe(201);
  });

  it('stops booking for a member, a parent and staff until the waiver is signed', async () => {
    const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Text' } });
    const cls = await classAt(120);

    for (const [who, body] of [['ben', {}], ['owner', { studentId: users.ben.id, overrideReason: 'Walk-in' }], ['parent', { studentId: users.kid.id }]] as const) {
      const refused = await book(who, cls, body);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatchObject({ code: 'WAIVER_REQUIRED', message: 'This School needs a signed waiver before booking a class or checking in.' });
    }
    expect(await superuser.booking.count({ where: { classId: cls.id } })).toBe(0);

    await sign(waiver.id, 'ben');
    expect((await book('ben', cls)).status).toBe(201);
    // The parent signs for their child (the signature is the child's).
    await sign(waiver.id, 'kid', 'parent');
    const kidBooking = await book('parent', cls, { studentId: users.kid.id });
    expect(kidBooking.status).toBe(201);
    expect(kidBooking.body.studentId).toBe(users.kid.id);
  });

  it('stops joining a waiting list and claiming an offered place', async () => {
    const full = await classAt(180, { capacity: 1 });
    expect((await book('ben', full)).status).toBe(201);
    const join = await as('cara').post(`/v1/classes/${full.id}/waitlist`).send({});
    expect(join.status).toBe(403);
    expect(join.body.error.code).toBe('WAIVER_REQUIRED');

    // An offer made before the rule applied to them (e.g. they joined while it
    // was off) still can't be claimed without a signature.
    const entry = await superuser.waitlistEntry.create({
      data: {
        id: randomUUID(), classId: full.id, studentId: users.cara.id, schoolId: school.id, position: 1,
        status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: new Date(Date.now() + 60 * MIN),
      },
    });
    const benBooking = await superuser.booking.findFirstOrThrow({ where: { classId: full.id, studentId: users.ben.id } });
    expect((await http().patch(`/v1/bookings/${benBooking.id}/cancel`).set('Authorization', `Bearer ${tokens.ben}`).send({})).status).toBe(200);
    const claim = await as('cara').post(`/v1/waitlist/${entry.id}/claim`).send({});
    expect(claim.status).toBe(403);
    expect(claim.body.error.code).toBe('WAIVER_REQUIRED');
  });

  it('stops checking in until the waiver is signed (every way in ends in the same check-in rules)', async () => {
    const now = await classAt(-5);
    const booking = await superuser.booking.create({ data: { id: randomUUID(), studentId: users.dan.id, classId: now.id, schoolId: school.id } });
    const refused = await scan(now, 'dan');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CHECK_IN_WAIVER_REQUIRED');
    expect((await superuser.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('UPCOMING');

    const waiver = await superuser.waiver.findFirstOrThrow({ where: { schoolId: school.id, archivedAt: null } });
    await sign(waiver.id, 'dan');
    expect((await scan(now, 'dan')).status).toBe(201);
  });

  it('off: only a Class that needs a waiver asks for one, at booking', async () => {
    await setRule(false);
    try {
      // Dan has signed; Cara hasn't.
      expect((await book('cara', await classAt(240))).status).toBe(201);
      const marked = await book('cara', await classAt(241, { termsWaiverRequired: true }));
      expect(marked.status).toBe(400);
      expect(marked.body.error.message).toBe('This Student must hold a Signed Waiver for this School before booking a Class that requires one.');
      const now = await classAt(-5);
      await superuser.booking.create({ data: { id: randomUUID(), studentId: users.cara.id, classId: now.id, schoolId: school.id } });
      expect((await scan(now, 'cara')).status).toBe(201);
    } finally {
      await setRule(true);
    }
  });

  it("a signature on an archived waiver counts unless the School turned that off (Decision 354), at booking (stress test round 6, R-2)", async () => {
    const old = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Retired terms', body: 'Text', archivedAt: new Date() } });
    const ella = await superuser.user.create({
      data: {
        id: randomUUID(), email: `waiver-before-booking-ella-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'ella', surname: 'Waiver', passcodeHash: 'x', dateOfBirth: new Date('2000-01-01'), phoneVerifiedAt: new Date(),
      },
    });
    users.ella = ella;
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: ella.id, schoolId: school.id } });
    tokens.ella = jwt.sign({ sub: ella.id, email: ella.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
    await member('ella');
    // Ella signed only the waiver that was since archived; the School has another in use.
    await sign(old.id, 'ella');
    expect((await book('ella', await classAt(300))).status).toBe(201);
    await superuser.school.update({ where: { id: school.id }, data: { waiverArchivedSignaturesCount: false } });
    try {
      const refused = await book('ella', await classAt(301));
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('WAIVER_REQUIRED');
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { waiverArchivedSignaturesCount: true } });
    }
  });

  it("doesn't stop buying a plan", async () => {
    await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });
    const pack = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Ten classes', price: 10000, classesIncluded: 10, expiryDurationDays: 90 },
    });
    const bought = await as('cara').post(`/v1/membership-plans/${pack.id}/purchase`).send({});
    expect(bought.status).toBe(201);
    expect(bought.body.outcome).toBe('pending_confirmation');
  });
});
