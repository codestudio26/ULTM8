/**
 * HTTP-level gate for AttendanceModule. Phase 13 covered self-service QR
 * check-in against a bare bookingId; Phase 51 (Decision 107) rewrote it around
 * the actual rotating-QR-token mechanism and added the Instructor roll-call
 * scan (Decision 71) — this file now proves both token-mint endpoints, the
 * token-gated self-service flow, and both roll-call modes (scanned and
 * manual) over real HTTP, not just by reading the code. Same ground rule as
 * every other e2e spec in this repo.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET,
 * QR_CLASS_TOKEN_SECRET, QR_STUDENT_TOKEN_SECRET (all already required by
 * AppModule's own boot — the app fails to serve any request without them
 * present, same as every other required secret in this suite).
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
const QR_CLASS_TOKEN_SECRET = process.env.QR_CLASS_TOKEN_SECRET;
const QR_STUDENT_TOKEN_SECRET = process.env.QR_STUDENT_TOKEN_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && QR_CLASS_TOKEN_SECRET && QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[attendance.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / ' +
      'QR_CLASS_TOKEN_SECRET / QR_STUDENT_TOKEN_SECRET not set. This gate MUST run against a ' +
      'real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('AttendanceModule — HTTP-level QR check-in + Instructor roll-call scan', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  // Raw instances of the SAME two secrets QrTokenService signs/verifies with —
  // used only to mint a deliberately-already-expired token for the expiry
  // test below (the real endpoint has no way to mint one on demand).
  const classQrJwt = new JwtService({ secret: QR_CLASS_TOKEN_SECRET });
  const studentQrJwt = new JwtService({ secret: QR_STUDENT_TOKEN_SECRET });

  let school: { id: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let instructor: { id: string; email: string };
  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenInstructor: string;

  let subscriptionPlanId: string;
  let discipline: { id: string };
  let rank: { id: string };
  // Set by the self-service describe block's own consent-withdrawal test,
  // reused by the roll-call describe block's "manual mode works around
  // withdrawn consent" case — both blocks share this outer closure.
  let minorWithWithdrawnConsent: { id: string } | undefined;

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

  async function fetchClassToken(callerToken: string, classId: string): Promise<string> {
    const res = await request(app.getHttpServer()).get(`/v1/classes/${classId}/qr-token`).set('Authorization', `Bearer ${callerToken}`);
    expect(res.status).toBe(200);
    return res.body.token;
  }

  async function fetchMyToken(callerToken: string): Promise<string> {
    const res = await request(app.getHttpServer()).get('/v1/attendance/my-qr-token').set('Authorization', `Bearer ${callerToken}`);
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
    instructor = await mkUser('instructor');
    userIds.push(instructor.id);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: instructor.id, schoolId: school.id },
      ],
    });

    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenInstructor = signAccessToken(instructor, [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }]);

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

  describe('self-service scan (GET /classes/{id}/qr-token, POST /attendance/scan)', () => {
    it('a Student CAN scan a valid, freshly-minted Class token within the check-in window — marks Completed, records SELF_SERVICE, increments StudentRank', async () => {
      await superuser.studentRank.create({
        data: { id: randomUUID(), studentId: studentA.id, disciplineId: discipline.id, schoolId: school.id, currentRankId: rank.id, classesAttendedTowardCheckpoint: 3 },
      });
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Judo Class', activities: ['Judo'], startDate: future, endDate: new Date(future.getTime() + 3_600_000), qrAttendanceEndAt: new Date(future.getTime() + 3_600_000) },
      });
      const membership = await mkActiveMembership(studentA.id);
      await mkBooking(studentA.id, cls.id, membership.id);

      const qrToken = await fetchClassToken(tokenInstructor, cls.id);
      const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentA}`).send({ classId: cls.id, qrToken });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.checkInMethod).toBe('SELF_SERVICE');
      expect(res.body.checkedInById).toBeNull();

      const rankAfter = await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: studentA.id, disciplineId: discipline.id } } });
      expect(rankAfter.classesAttendedTowardCheckpoint).toBe(4);
    });

    it('a Student with no Upcoming Booking on the Class is rejected — 404', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'No Booking Here', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });

      const qrToken = await fetchClassToken(tokenInstructor, cls.id);
      const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentA}`).send({ classId: cls.id, qrToken });
      expect(res.status).toBe(404);
    });

    it('scanning a Booking that is already Completed is rejected — 404 (no Upcoming Booking left to find)', async () => {
      // Unlike Phase 13's own bookingId-keyed lookup (which could distinguish
      // "not found" from "found but not Upcoming"), the classId-keyed lookup
      // this phase introduces only ever matches an UPCOMING row — once the
      // first scan completes it, a second scan against the same Class finds
      // nothing to match at all. Documented, deliberate collapse — see
      // AttendanceService.scan()'s own comment.
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Open Mat', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      const membershipB = await mkActiveMembership(studentB.id);
      await mkBooking(studentB.id, cls.id, membershipB.id);

      const qrToken = await fetchClassToken(tokenInstructor, cls.id);
      const firstScan = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ classId: cls.id, qrToken });
      expect(firstScan.status).toBe(201);

      const secondQrToken = await fetchClassToken(tokenInstructor, cls.id);
      const secondScan = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ classId: cls.id, qrToken: secondQrToken });
      expect(secondScan.status).toBe(404);
    });

    it('scanning after the check-in window has closed is rejected — 400', async () => {
      // Reuses studentB's EXISTING general-access Membership from the previous
      // test rather than minting another, which would violate the
      // one-active-general-access-per-School guard.
      const existingMembershipB = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
      const past = new Date(Date.now() - 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Already Closed', startDate: past, endDate: new Date(past.getTime() + 1_800_000), qrAttendanceEndAt: new Date(past.getTime() + 1_800_000) },
      });
      await mkBooking(studentB.id, cls.id, existingMembershipB.id);

      const qrToken = await fetchClassToken(tokenInstructor, cls.id);
      const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ classId: cls.id, qrToken });
      expect(res.status).toBe(400);
    });

    it('a QR token minted for a different Class is rejected — 400', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const [clsA, clsB] = await Promise.all([
        superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Class A', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } }),
        superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Class B', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } }),
      ]);
      const membershipB = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
      await mkBooking(studentB.id, clsA.id, membershipB.id);

      const tokenForClassB = await fetchClassToken(tokenInstructor, clsB.id);
      const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ classId: clsA.id, qrToken: tokenForClassB });
      expect(res.status).toBe(400);
    });

    it('an expired QR token is rejected — 400', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Expired Token Class', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      const membershipB = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
      await mkBooking(studentB.id, cls.id, membershipB.id);

      const expiredToken = classQrJwt.sign({ classId: cls.id }, { expiresIn: -1 });
      const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenStudentB}`).send({ classId: cls.id, qrToken: expiredToken });
      expect(res.status).toBe(400);
    });

    it('a non-Staff caller cannot mint a Class QR token — 403', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Staff Only Mint', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      const res = await request(app.getHttpServer()).get(`/v1/classes/${cls.id}/qr-token`).set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(403);
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
      await mkBooking(minorId, cls.id, membership.id);

      const qrToken = await fetchClassToken(tokenInstructor, cls.id);
      const res = await request(app.getHttpServer()).post('/v1/attendance/scan').set('Authorization', `Bearer ${tokenMinor}`).send({ classId: cls.id, qrToken });
      expect(res.status).toBe(403);

      // The consent-withdrawn minor from this test is reused below as the
      // "roll-call manual mode works around withdrawn consent" fixture.
      minorWithWithdrawnConsent = { id: minorId };
    });
  });

  describe('Instructor roll-call scan (GET /attendance/my-qr-token, POST /classes/{id}/attendance-scan)', () => {
    it('an Instructor CAN scan a Student\'s own personal token — marks Completed, records INSTRUCTOR_SCAN + checkedInById', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Roll Call Class', activities: ['Judo'], startDate: future, endDate: new Date(future.getTime() + 3_600_000), qrAttendanceEndAt: new Date(future.getTime() + 3_600_000) },
      });
      const membership = await superuser.membership.findFirstOrThrow({ where: { studentId: studentA.id } });
      await mkBooking(studentA.id, cls.id, membership.id);

      const studentToken = await fetchMyToken(tokenStudentA);
      const res = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenInstructor}`)
        .send({ studentId: studentA.id, studentToken });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.checkInMethod).toBe('INSTRUCTOR_SCAN');
      expect(res.body.checkedInById).toBe(instructor.id);
    });

    it('an Instructor CAN confirm a Student manually, with no token at all — records INSTRUCTOR_MANUAL', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Manual Roll Call', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      const membership = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
      await mkBooking(studentB.id, cls.id, membership.id);

      const res = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenInstructor}`)
        .send({ studentId: studentB.id });
      expect(res.status).toBe(201);
      expect(res.body.checkInMethod).toBe('INSTRUCTOR_MANUAL');
      expect(res.body.checkedInById).toBe(instructor.id);
    });

    it('manual mode works around a Student\'s withdrawn camera-tier consent, but scan mode is still blocked by it', async () => {
      expect(minorWithWithdrawnConsent).toBeDefined();
      const minorId = minorWithWithdrawnConsent!.id;

      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Consent Fallback Class', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      // Reuses the minor's EXISTING general-access Membership (minted by the
      // self-service consent-withdrawal test that created this fixture) rather
      // than minting another, which would violate the one-active-general-
      // access-per-School guard — same reasoning as every other test in this
      // file that reuses studentB's own Membership.
      const membership = await superuser.membership.findFirstOrThrow({ where: { studentId: minorId } });
      await mkBooking(minorId, cls.id, membership.id);

      const tokenMinor = signAccessToken({ id: minorId, email: 'minor@example.test' }, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
      const minorToken = await fetchMyToken(tokenMinor);

      // Scan mode still respects the withdrawn consent — same conservative
      // reading scan() itself applies (Decision 107's own flagged ambiguity).
      const scanAttempt = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenInstructor}`)
        .send({ studentId: minorId, studentToken: minorToken });
      expect(scanAttempt.status).toBe(403);

      // Manual mode is the deliberate camera-free fallback — works regardless.
      const manualAttempt = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenInstructor}`)
        .send({ studentId: minorId });
      expect(manualAttempt.status).toBe(201);
      expect(manualAttempt.body.checkInMethod).toBe('INSTRUCTOR_MANUAL');
    });

    it('a mismatched Student token (belongs to a different Student) is rejected — 400', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Mismatched Token Class', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      const membershipB = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
      await mkBooking(studentB.id, cls.id, membershipB.id);

      // A real token, but minted for studentA, submitted against studentB.
      const wrongStudentToken = await fetchMyToken(tokenStudentA);
      const res = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenInstructor}`)
        .send({ studentId: studentB.id, studentToken: wrongStudentToken });
      expect(res.status).toBe(400);
    });

    it('an expired Student token is rejected — 400', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Expired Student Token', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      const membershipB = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
      await mkBooking(studentB.id, cls.id, membershipB.id);

      const expiredToken = studentQrJwt.sign({ studentId: studentB.id }, { expiresIn: -1 });
      const res = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenInstructor}`)
        .send({ studentId: studentB.id, studentToken: expiredToken });
      expect(res.status).toBe(400);
    });

    it('a non-Staff caller (a Student) cannot use the roll-call scan endpoint — 403', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Student Cannot Roll Call', startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
      const res = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ studentId: studentB.id });
      expect(res.status).toBe(403);
    });

    it('roll-call scan after the check-in window has closed is rejected — 400, same as self-service', async () => {
      const past = new Date(Date.now() - 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Roll Call Window Closed', startDate: past, endDate: new Date(past.getTime() + 1_800_000), qrAttendanceEndAt: new Date(past.getTime() + 1_800_000) },
      });
      const membershipB = await superuser.membership.findFirstOrThrow({ where: { studentId: studentB.id } });
      await mkBooking(studentB.id, cls.id, membershipB.id);

      const res = await request(app.getHttpServer())
        .post(`/v1/classes/${cls.id}/attendance-scan`)
        .set('Authorization', `Bearer ${tokenInstructor}`)
        .send({ studentId: studentB.id });
      expect(res.status).toBe(400);
    });
  });
});
