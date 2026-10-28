/**
 * Decision 379 — a parent books a class for their child in the app and can
 * bring guests, paid for with the child's own Friend Passes. The child's
 * Schools and upcoming bookings, the child's Friend Passes, the guests' links
 * on the child's booking, and no guests in Kid Mode.
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

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[minor-guests.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
const PORTAL = 'https://portal.example.test';

describeIfDb('A parent books a class with guests for their child (Decision 379)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const school = { id: randomUUID() };
  const otherSchool = { id: randomUUID() };
  type U = { id: string; token: string };
  let parent: U;
  let stranger: U;
  let child: { id: string };
  let friendPassPlanId: string;
  const previousPortal = process.env.PORTAL_BASE_URL;

  const http = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const at = (ms: number) => new Date(Date.now() + ms);
  const mkClass = (title = 'Kids BJJ') =>
    superuser.class.create({
      data: { membershipInclusion: true, termsWaiverRequired: true, id: randomUUID(), schoolId: school.id, title, startDate: at(2 * HOUR), endDate: at(3 * HOUR) },
    });
  const mkPass = (data: Record<string, unknown> = {}) =>
    superuser.membership.create({
      data: { id: randomUUID(), studentId: child.id, schoolId: school.id, membershipPlanId: friendPassPlanId, frequency: 'ONE_TIME', classesRemaining: 1, ...data },
    });

  async function mkUser(label: string, dob: string) {
    return superuser.user.create({
      data: {
        id: randomUUID(),
        email: `minor-guests-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Family',
        passcodeHash: 'x',
        dateOfBirth: new Date(dob),
        phoneVerifiedAt: new Date(),
      },
    });
  }
  const guardianToken = (id: string) => jwt.sign({ sub: id, grants: [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }] });

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = PORTAL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: 'Zebra Dojo', timezone: 'UTC' } });
    await superuser.school.create({ data: { id: otherSchool.id, name: 'Alpha Gym', timezone: 'UTC' } });
    const p = await mkUser('parent', '1985-01-01');
    const s = await mkUser('stranger', '1985-01-01');
    parent = { id: p.id, token: guardianToken(p.id) };
    stranger = { id: s.id, token: guardianToken(s.id) };
    child = await mkUser('child', '2015-06-01');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: child.id, schoolId: school.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: child.id, schoolId: otherSchool.id } });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: child.id } });

    const subscription = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Kids Unlimited', price: 5000 } });
    friendPassPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Bring a friend', price: 0, classesIncluded: 1 } })).id;
    await superuser.membership.create({ data: { id: randomUUID(), studentId: child.id, schoolId: school.id, membershipPlanId: subscription.id, frequency: 'RECURRING' } });
    const w = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Terms' } });
    await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: w.id, studentId: child.id, schoolId: school.id, signerFullName: 'Parent Family', signatureText: 'Parent Family', status: 'SIGNED' },
    });
  });

  afterAll(async () => {
    if (previousPortal === undefined) delete process.env.PORTAL_BASE_URL;
    else process.env.PORTAL_BASE_URL = previousPortal;
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'minor-guests-' } }, select: { id: true } })).map((u) => u.id);
    for (const id of [school.id, otherSchool.id]) {
      await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
      await superuser.waiverSignature.deleteMany({ where: { schoolId: id } });
      await superuser.waiver.deleteMany({ where: { schoolId: id } });
      await superuser.bookingAttendee.deleteMany({ where: { schoolId: id } });
      await superuser.booking.deleteMany({ where: { schoolId: id } });
      await superuser.membership.deleteMany({ where: { schoolId: id } });
      await superuser.membershipPlan.deleteMany({ where: { schoolId: id } });
      await superuser.class.deleteMany({ where: { schoolId: id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: id } });
    }
    await superuser.bookingDelegation.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: [school.id, otherSchool.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it("lists the child's Schools by name, only for their parent", async () => {
    const res = await http().get(`/v1/guardians/me/minors/${child.id}/schools`).set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { schoolId: otherSchool.id, name: 'Alpha Gym' },
      { schoolId: school.id, name: 'Zebra Dojo' },
    ]);
    expect((await http().get(`/v1/guardians/me/minors/${child.id}/schools`).set(auth(stranger))).status).toBe(403);
  });

  it("lists the child's Friend Passes, only for their parent", async () => {
    const pass = await mkPass();
    const res = await http().get(`/v1/guardians/me/minors/${child.id}/friend-passes`).query({ schoolId: school.id }).set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { membershipId: string }) => p.membershipId)).toContain(pass.id);
    expect((await http().get(`/v1/guardians/me/minors/${child.id}/friend-passes`).query({ schoolId: school.id }).set(auth(stranger))).status).toBe(403);
  });

  it("books the child with a guest on the child's Friend Pass, then lists the booking and the guest's link", async () => {
    const cls = await mkClass('Kids No-Gi');
    const pass = await mkPass({ scopedClassId: cls.id });
    const booked = await http().post(`/v1/classes/${cls.id}/book`).set(auth(parent)).send({ studentId: child.id, attendeeMembershipIds: [pass.id] });
    expect(booked.status).toBe(201);
    expect(booked.body.studentId).toBe(child.id);

    const list = await http().get(`/v1/guardians/me/minors/${child.id}/bookings`).set(auth(parent));
    expect(list.status).toBe(200);
    const row = list.body.items.find((b: { id: string }) => b.id === booked.body.id);
    expect(row).toMatchObject({ classId: cls.id, classTitle: 'Kids No-Gi', schoolId: school.id, guestCount: 1 });

    const guests = await http().get(`/v1/guardians/me/minors/${child.id}/bookings/${booked.body.id}/guests`).set(auth(parent));
    expect(guests.status).toBe(200);
    expect(guests.body.waiverRequired).toBe(true);
    expect(guests.body.guests).toHaveLength(1);
    expect(guests.body.guests[0].link).toMatch(new RegExp(`^${PORTAL}/guest-waiver/`));
    expect(guests.body.guests[0].waiverStatus).toBe('UNSIGNED');

    // Not someone else's child, and not a booking that isn't the child's.
    expect((await http().get(`/v1/guardians/me/minors/${child.id}/bookings`).set(auth(stranger))).status).toBe(403);
    expect((await http().get(`/v1/guardians/me/minors/${child.id}/bookings/${booked.body.id}/guests`).set(auth(stranger))).status).toBe(403);
    expect((await http().get(`/v1/guardians/me/minors/${child.id}/bookings/${randomUUID()}/guests`).set(auth(parent))).status).toBe(404);

    // Cancelled bookings drop off the list.
    const cancelled = await http().patch(`/v1/bookings/${booked.body.id}/cancel`).set(auth(parent)).send({ studentId: child.id });
    expect(cancelled.status).toBe(200);
    const after = await http().get(`/v1/guardians/me/minors/${child.id}/bookings`).set(auth(parent));
    expect(after.body.items.some((b: { id: string }) => b.id === booked.body.id)).toBe(false);
  });

  it('refuses guests in Kid Mode, while Kid Mode still books the child', async () => {
    await superuser.bookingDelegation.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: child.id } });
    const minted = await http().post(`/v1/guardians/me/minors/${child.id}/kid-mode-token`).set(auth(parent)).send({});
    expect(minted.status).toBe(201);
    const kid = { Authorization: `Bearer ${minted.body.accessToken}` };
    const cls = await mkClass('Kids Fundamentals');
    const pass = await mkPass();

    const withGuest = await http().post(`/v1/classes/${cls.id}/book`).set(kid).send({ studentId: child.id, attendeeMembershipIds: [pass.id] });
    expect(withGuest.status).toBe(403);
    expect(withGuest.body.error.code).toBe('NO_GUESTS_IN_KID_MODE');

    const alone = await http().post(`/v1/classes/${cls.id}/book`).set(kid).send({ studentId: child.id });
    expect(alone.status).toBe(201);
  });
});
