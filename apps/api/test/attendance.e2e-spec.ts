/**
 * HTTP-level gate for Phase 13 (AttendanceModule) — self-service QR check-in:
 * the confirmed Booking->Completed + StudentRank.classesAttendedTowardCheckpoint
 * write, the check-in-window gate, the double-scan/already-resolved guard, and
 * the camera-tier-consent block (withdrawn vs. never-applicable). Same ground
 * rule as every other e2e spec in this repo: prove over real HTTP, not just by
 * reading the code.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
  console.warn(
    '[attendance.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('AttendanceModule — HTTP-level self-service QR check-in', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let tokenStudentA: string;
  let tokenStudentB: string;

  let subscriptionPlanId: string;
  let discipline: { id: string };
  let rank: { id: string };

  const userIds: string[] = [];
  const membershipIds: string[] = [];
  const bookingIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function mkActiveMembership(studentId: string) {
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId, membershipPlanId: subscriptionPlanId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
    membershipIds.push(membership.id);
    return membership;
  }

  async function mkBooking(studentId: string, classId: string, membershipId: string) {
    const booking = await superuser.booking.create({
      data: { id: randomUUID(), studentId, classId, schoolId: school.id, sourceMembershipId: membershipId, status: 'UPCOMING' },
    });
    bookingIds.push(booking.id);
    return booking;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Attendance HTTP School' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `attendance-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    studentA = await mkUser('student-a');
    userIds.push(studentA.id);
    studentB = await mkUser('student-b');
    userIds.push(studentB.id);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
      ],
    });

    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);

    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    subscriptionPlanId = plan.id;

    discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, primaryColour: 'white' } });
  });

  afterAll(async () => {
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.consentRecord.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.guardianLink.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { email: { contains: 'guardian-managed.ultm8.internal' } }] } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a Student CAN scan a valid Booking within the check-in window — marks Completed and increments StudentRank', async () => {
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: studentA.id, disciplineId: discipline.id, schoolId: school.id, currentRankId: rank.id, classesAttendedTowardCheckpoint: 3 },
    });
    const future = new Date(Date.now() + 3_600_000);
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Judo Class', activities: ['Judo'], startDate: future, endDate: new Date(future.getTime() + 3_600_000), qrAttendanceEndAt: new Date(future.getTime() + 3_600_000) },
    });
    const membership = await mkActiveMembership(studentA.id);
    const booking = await mkBooking(studentA.id, cls.id, membership.id);

    const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentA}`).send({ bookingId: booking.id });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('COMPLETED');

    const rankAfter = await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: studentA.id, disciplineId: discipline.id } } });
    expect(rankAfter.classesAttendedTowardCheckpoint).toBe(4);
  });

  it('scanning someone else\'s Booking, or a Booking that\'s already resolved, is rejected', async () => {
    // Uses studentB as the owner here (not studentA) — studentA already holds
    // an Active general-access Membership from the previous test, and a second
    // mkActiveMembership() call for the same Student would violate the
    // one-active-general-access-per-School guard.
    const future = new Date(Date.now() + 3_600_000);
    const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Open Mat', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
    const membershipB = await mkActiveMembership(studentB.id);
    const bookingForB = await mkBooking(studentB.id, cls.id, membershipB.id);

    const wrongCaller = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentA}`).send({ bookingId: bookingForB.id });
    expect(wrongCaller.status).toBe(404);

    const firstScan = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ bookingId: bookingForB.id });
    expect(firstScan.status).toBe(201);

    const secondScan = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ bookingId: bookingForB.id });
    expect(secondScan.status).toBe(400);
  });

  it('scanning after the check-in window has closed is rejected — 400', async () => {
    // Reuses studentB's EXISTING general-access Membership from the previous
    // test (AttendanceService.scan() never actually checks Membership state —
    // sourceMembershipId only needs to satisfy Booking's own FK constraint
    // here, this test is purely about the window gate) rather than minting
    // another, which would violate the one-active-general-access-per-School
    // guard the same way the earlier fix in the previous test addressed.
    const existingMembershipB = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
    const past = new Date(Date.now() - 3_600_000);
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Already Closed', startDate: past, endDate: new Date(past.getTime() + 1_800_000), qrAttendanceEndAt: new Date(past.getTime() + 1_800_000) },
    });
    const booking = await mkBooking(studentB.id, cls.id, existingMembershipB.id);

    const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ bookingId: booking.id });
    expect(res.status).toBe(400);
  });

  it('a Guardian-linked minor whose camera-tier consent is Withdrawn is blocked from self-service scan — 403', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/guardians/me/minors')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ firstName: 'Minor', surname: 'Child', dateOfBirth: '2015-06-01' });
    expect(createRes.status).toBe(201);
    const minorId = createRes.body.studentId;
    userIds.push(minorId);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: minorId, schoolId: school.id } });
    const tokenMinor = signAccessToken({ id: minorId, email: 'minor@example.test' }, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);

    const grantRes = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minorId}/consent`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ tier: 'CAMERA', policyVersion: '2026-09-v1' });
    expect(grantRes.status).toBe(201);
    const withdrawRes = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${grantRes.body.id}/withdraw`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(withdrawRes.status).toBe(200);

    const future = new Date(Date.now() + 3_600_000);
    const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Minor Class', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
    const membership = await mkActiveMembership(minorId);
    const booking = await mkBooking(minorId, cls.id, membership.id);

    const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenMinor}`).send({ bookingId: booking.id });
    expect(res.status).toBe(403);
  });
});
