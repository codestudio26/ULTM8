/**
 * Front-desk check-in review (27–28 Oct 2026):
 * - CI1: a checked-in (Completed) booking still holds its seat, so nobody can
 *   book past the class limit once people check in.
 * - Q2: POST /schools/{schoolId}/front-desk/qr-lookups checks a scanned app QR
 *   once and gives the desk a lookup token to check that Student in with.
 * - Q4: GET /students/{id}/waiver-status for the welcome card.
 * - Decision 377: each guest on a booking is checked in on their own.
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
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Front desk: seats after check-in, QR lookup, waiver status', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let planId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const MIN = 60_000;

  async function member(studentId: string) {
    return superuser.membership.create({
      data: { id: randomUUID(), studentId, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
  }

  async function classNow(capacity: number | null = null) {
    return superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Fundamentals', capacity, startDate: new Date(Date.now() - 5 * MIN), endDate: new Date(Date.now() + 55 * MIN) },
    });
  }

  async function myQr(who: string): Promise<string> {
    const res = await http().get('/v1/attendance/my-qr-token').set('Authorization', `Bearer ${tokens[who]}`);
    expect(res.status).toBe(200);
    return res.body.token;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Front Desk School' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Front Desk Other School' } });
    for (const label of ['ana', 'ben', 'coach', 'coach2', 'outsider']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `front-desk-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label === 'ana' ? 'Ana' : label,
          surname: 'Desk',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    const grants: Array<[string, 'STUDENT' | 'INSTRUCTOR', string]> = [
      ['ana', 'STUDENT', school.id],
      ['ben', 'STUDENT', school.id],
      ['coach', 'INSTRUCTOR', school.id],
      ['coach2', 'INSTRUCTOR', school.id],
      ['outsider', 'STUDENT', otherSchool.id],
    ];
    await superuser.roleGrant.createMany({ data: grants.map(([who, role, schoolId]) => ({ id: randomUUID(), role, userId: users[who].id, schoolId })) });
    for (const [who, role, schoolId] of grants) {
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
    }
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    planId = plan.id;
  });

  afterAll(async () => {
    const schoolIds = [school.id, otherSchool.id];
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiver.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('CI1: a checked-in student still holds their seat', async () => {
    const cls = await classNow(1);
    const m = await member(users.ana.id);
    await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ana.id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });
    const checkIn = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentId: users.ana.id });
    expect(checkIn.status).toBe(201);
    expect(checkIn.body.status).toBe('COMPLETED');

    await member(users.ben.id);
    const book = await http().post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentId: users.ben.id });
    expect(book.status).toBe(409);
    expect(book.body.error.code).toBe('CLASS_FULL');
  });

  it('Q2: a scanned QR is checked once, then the lookup checks the student in as a scan', async () => {
    const cls = await classNow();
    const m = await member(users.ana.id);
    await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ana.id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });

    const lookup = await http().post(`/v1/schools/${school.id}/front-desk/qr-lookups`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentToken: await myQr('ana') });
    expect(lookup.status).toBe(201);
    expect(lookup.body).toMatchObject({ studentId: users.ana.id, firstName: 'Ana', surname: 'Desk' });
    expect(new Date(lookup.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * MIN);

    // Another staff member can't use it.
    const stolen = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${tokens.coach2}`).send({ studentId: users.ana.id, lookupToken: lookup.body.lookupToken });
    expect(stolen.status).toBe(400);
    // Nor for someone else.
    const wrongStudent = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentId: users.ben.id, lookupToken: lookup.body.lookupToken });
    expect(wrongStudent.status).toBe(400);
    // A lookup token is not a student QR.
    const asQr = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentId: users.ana.id, studentToken: lookup.body.lookupToken });
    expect(asQr.status).toBe(400);

    const res = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentId: users.ana.id, lookupToken: lookup.body.lookupToken });
    expect(res.status).toBe(201);
    expect(res.body.checkInMethod).toBe('INSTRUCTOR_SCAN');
    expect(res.body.checkedInById).toBe(users.coach.id);
  });

  it('Q2/CI6: the QR of someone who is not a student here is refused; students and junk are refused too', async () => {
    const outsider = await http().post(`/v1/schools/${school.id}/front-desk/qr-lookups`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentToken: await myQr('outsider') });
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe('NOT_A_STUDENT_HERE');

    const junk = await http().post(`/v1/schools/${school.id}/front-desk/qr-lookups`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentToken: 'not-a-token' });
    expect(junk.status).toBe(400);

    const byStudent = await http().post(`/v1/schools/${school.id}/front-desk/qr-lookups`).set('Authorization', `Bearer ${tokens.ben}`).send({ studentToken: await myQr('ana') });
    expect(byStudent.status).toBe(403);
  });

  it('Q4: waiver status lists the current waivers still to sign', async () => {
    const current = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Text' } });
    const second = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Photos', body: 'Text' } });
    await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Old one', body: 'Text', archivedAt: new Date() } });
    await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: current.id, studentId: users.ana.id, schoolId: school.id, status: 'SIGNED', signerFullName: 'Ana Desk', signatureText: 'Ana Desk', signedDate: new Date() },
    });

    const ana = await http().get(`/v1/students/${users.ana.id}/waiver-status`).query({ schoolId: school.id }).set('Authorization', `Bearer ${tokens.coach}`);
    expect(ana.status).toBe(200);
    expect(ana.body).toEqual({ signed: true, toSign: [{ waiverId: second.id, title: 'Photos' }] });

    const ben = await http().get(`/v1/students/${users.ben.id}/waiver-status`).query({ schoolId: school.id }).set('Authorization', `Bearer ${tokens.coach}`);
    expect(ben.status).toBe(200);
    expect(ben.body.signed).toBe(false);
    expect(ben.body.toSign.map((w: { title: string }) => w.title)).toEqual(['Liability', 'Photos']);

    const outsider = await http().get(`/v1/students/${users.outsider.id}/waiver-status`).query({ schoolId: school.id }).set('Authorization', `Bearer ${tokens.coach}`);
    expect(outsider.status).toBe(404);

    const byStudent = await http().get(`/v1/students/${users.ana.id}/waiver-status`).query({ schoolId: school.id }).set('Authorization', `Bearer ${tokens.ben}`);
    expect(byStudent.status).toBe(403);
  });

  it('Decision 377: a guest is checked in on their own, once, only by staff, and not by the member\'s check-in', async () => {
    const cls = await classNow(10);
    const m = await member(users.ana.id);
    const booking = await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ana.id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });
    // A is older, so the guest list (by createdAt) is A then B.
    const guestA = await superuser.bookingAttendee.create({ data: { id: randomUUID(), bookingId: booking.id, schoolId: school.id, membershipId: m.id, createdAt: new Date(Date.now() - 1000) } });
    const guestB = await superuser.bookingAttendee.create({ data: { id: randomUUID(), bookingId: booking.id, schoolId: school.id, membershipId: m.id } });

    const host = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${tokens.coach}`).send({ studentId: users.ana.id });
    expect(host.status).toBe(201);
    expect(host.body.attendees.every((a: { checkedInAt: string | null }) => a.checkedInAt === null)).toBe(true);

    const byStudent = await http().post(`/v1/bookings/${booking.id}/guests/${guestA.id}/check-in`).set('Authorization', `Bearer ${tokens.ana}`);
    expect(byStudent.status).toBe(403);

    const res = await http().post(`/v1/bookings/${booking.id}/guests/${guestA.id}/check-in`).set('Authorization', `Bearer ${tokens.coach}`);
    expect(res.status).toBe(201);
    expect(res.body.attendeeId).toBe(guestA.id);
    const again = await http().post(`/v1/bookings/${booking.id}/guests/${guestA.id}/check-in`).set('Authorization', `Bearer ${tokens.coach}`);
    expect(again.status).toBe(409);

    const rows = await superuser.bookingAttendee.findMany({ where: { bookingId: booking.id } });
    expect(rows.find((r) => r.id === guestA.id)?.checkedInById).toBe(users.coach.id);
    expect(rows.find((r) => r.id === guestB.id)?.checkedInAt).toBeNull();

    const guests = await http().get(`/v1/bookings/${booking.id}/guests`).set('Authorization', `Bearer ${tokens.coach}`);
    expect(guests.status).toBe(200);
    expect(guests.body.guests.map((g: { checkedInAt: string | null }) => g.checkedInAt !== null)).toEqual([true, false]);

    const notOnBooking = await http().post(`/v1/bookings/${booking.id}/guests/${randomUUID()}/check-in`).set('Authorization', `Bearer ${tokens.coach}`);
    expect(notOnBooking.status).toBe(404);
  });

  it('Decision 377: a guest can\'t be checked in before check-in opens or on a cancelled booking', async () => {
    const later = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Evening', startDate: new Date(Date.now() + 180 * MIN), endDate: new Date(Date.now() + 240 * MIN) },
    });
    const m = await member(users.ben.id);
    const booking = await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ben.id, classId: later.id, schoolId: school.id, sourceMembershipId: m.id } });
    const guest = await superuser.bookingAttendee.create({ data: { id: randomUUID(), bookingId: booking.id, schoolId: school.id, membershipId: m.id } });
    const early = await http().post(`/v1/bookings/${booking.id}/guests/${guest.id}/check-in`).set('Authorization', `Bearer ${tokens.coach}`);
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('CHECK_IN_NOT_OPEN');

    const now = await classNow();
    const cancelled = await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ben.id, classId: now.id, schoolId: school.id, sourceMembershipId: m.id, status: 'CANCELLED' } });
    const cancelledGuest = await superuser.bookingAttendee.create({ data: { id: randomUUID(), bookingId: cancelled.id, schoolId: school.id, membershipId: m.id } });
    const res = await http().post(`/v1/bookings/${cancelled.id}/guests/${cancelledGuest.id}/check-in`).set('Authorization', `Bearer ${tokens.coach}`);
    expect(res.status).toBe(409);
  });
});
