/**
 * HTTP-level gate for Phase 14 (AcademiesModule) — mobile-facing discovery.
 * The entire point of this phase is proving a Student with ZERO RoleGrant at a
 * School can still browse it via /academies — this needs its own explicit test,
 * not just inferred from the code (Phase 14 kickoff prompt §5). Also proves:
 * - the curated-fields contract on all three nested resources (mobileNumber/
 *   instructorId/cancellationCharge/etc. never leak — the exact gap an earlier
 *   draft's code review caught, see AcademiesService's own header comment),
 * - the visible-plans-only and upcoming-classes-only filtering on the detail
 *   endpoint, and the ON-only filtering on the timetable endpoint,
 * - AND, critically, that this module's own cross-tenant discovery reads have
 *   ZERO effect on every OTHER module's tenant isolation — the exact regression
 *   an earlier draft's RLS design (scoped `TO ultm8_app`) would have caused.
 *   Proven directly here, not just inferred from the migration's own design,
 *   the same "needs its own explicit test" standard as the discovery premise.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, School } from '@prisma/client';
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
    '[academies.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('AcademiesModule — HTTP-level cross-School discovery', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let homeSchool: School;
  let otherSchool: School;
  let student: { id: string; email: string };
  let token: string;

  const schoolIds: string[] = [];
  const userIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    homeSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Home Dojo' } });
    schoolIds.push(homeSchool.id);
    otherSchool = await superuser.school.create({
      data: {
        id: randomUUID(),
        name: 'Discoverable Dojo',
        mobileNumber: '+15559998888',
        activities: ['Judo'],
        description: 'A school the caller has never joined.',
      },
    });
    schoolIds.push(otherSchool.id);

    student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `academies-http-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Discovery',
        surname: 'Student',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(student.id);

    // Only ever granted a role at homeSchool — deliberately NO RoleGrant at
    // otherSchool. This is the entire premise the test suite below proves.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: homeSchool.id },
    });
    token = signAccessToken(student, [{ role: 'STUDENT', franchiseId: null, schoolId: homeSchool.id, branchId: null }]);
  });

  afterAll(async () => {
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('GET /academies lists a School the caller holds NO RoleGrant at, and never leaks mobileNumber', async () => {
    const res = await request(app.getHttpServer()).get('/v1/academies').set('Authorization', `Bearer ${token}`).query({ limit: 100 });
    expect(res.status).toBe(200);
    const listed = res.body.items.find((item: { id: string }) => item.id === otherSchool.id);
    expect(listed).toBeDefined();
    expect(listed.name).toBe('Discoverable Dojo');
    expect(listed.mobileNumber).toBeUndefined();
  });

  it('GET /academies/:id returns the curated profile for a School the caller has never joined — visible plans and upcoming Classes only, curated fields only', async () => {
    const visiblePlan = await superuser.membershipPlan.create({
      data: {
        id: randomUUID(),
        schoolId: otherSchool.id,
        type: 'TRIAL_MEMBERSHIP',
        title: 'Trial Week',
        price: 0,
        visible: true,
        cancellationCharge: 500,
      },
    });
    const hiddenPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: otherSchool.id, type: 'SUBSCRIPTION', title: 'Internal Draft Plan', price: 5000, visible: false },
    });
    const future = new Date(Date.now() + 3_600_000);
    const past = new Date(Date.now() - 3_600_000);
    const upcomingClass = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: otherSchool.id,
        title: 'Upcoming Judo',
        startDate: future,
        endDate: new Date(future.getTime() + 3_600_000),
        instructorId: student.id, // any valid User id — only used to prove it doesn't leak
        cancellationCharge: 1000,
      },
    });
    const pastClass = await superuser.class.create({
      data: { id: randomUUID(), schoolId: otherSchool.id, title: 'Already Happened', startDate: past, endDate: new Date(past.getTime() + 3_600_000) },
    });

    const res = await request(app.getHttpServer()).get(`/v1/academies/${otherSchool.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.mobileNumber).toBeUndefined();

    const planIds = res.body.membershipPlans.map((p: { id: string }) => p.id);
    expect(planIds).toContain(visiblePlan.id);
    expect(planIds).not.toContain(hiddenPlan.id);
    const returnedVisiblePlan = res.body.membershipPlans.find((p: { id: string }) => p.id === visiblePlan.id);
    expect(returnedVisiblePlan.cancellationCharge).toBeUndefined();

    const classIds = res.body.upcomingClasses.map((c: { id: string }) => c.id);
    expect(classIds).toContain(upcomingClass.id);
    expect(classIds).not.toContain(pastClass.id);
    const returnedUpcomingClass = res.body.upcomingClasses.find((c: { id: string }) => c.id === upcomingClass.id);
    expect(returnedUpcomingClass.instructorId).toBeUndefined();
    expect(returnedUpcomingClass.cancellationCharge).toBeUndefined();
  });

  it('GET /academies/:id/timetable returns only ON slots for a School the caller has never joined, with curated fields only', async () => {
    const onSlot = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: otherSchool.id,
        weekday: 'MONDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        status: 'ON',
        title: 'Evening Judo',
        instructorId: student.id, // any valid User id — only used to prove it doesn't leak
        cancellationCharge: 750,
      },
    });
    const offSlot = await superuser.timetableSlot.create({
      data: { id: randomUUID(), schoolId: otherSchool.id, weekday: 'TUESDAY', startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)), endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)), status: 'OFF', title: 'Paused Slot' },
    });

    const res = await request(app.getHttpServer()).get(`/v1/academies/${otherSchool.id}/timetable`).set('Authorization', `Bearer ${token}`).query({ limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(onSlot.id);
    expect(ids).not.toContain(offSlot.id);
    const returnedOnSlot = res.body.items.find((item: { id: string }) => item.id === onSlot.id);
    expect(returnedOnSlot.startTime).toBe('18:00');
    expect(returnedOnSlot.instructorId).toBeUndefined();
    expect(returnedOnSlot.cancellationCharge).toBeUndefined();
  });

  it('GET /academies/:id 404s for a School that genuinely does not exist', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/academies/${randomUUID()}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("REGRESSION GUARD — AcademiesModule's own discovery reads have zero effect on every other module's tenant isolation for the same caller/School pair", async () => {
    // Same caller (zero RoleGrant at otherSchool), same School, but hitting the
    // pre-existing, non-discovery endpoints. An earlier draft's RLS design
    // (a policy scoped TO ultm8_app instead of a dedicated role) would have
    // made every one of these return 200 with otherSchool's data instead of
    // 404 — caught on this PR's own code review before it ever shipped. This
    // test exists specifically so that regression can never ship silently.
    const schoolRes = await request(app.getHttpServer()).get(`/v1/schools/${otherSchool.id}`).set('Authorization', `Bearer ${token}`);
    expect(schoolRes.status).toBe(404);

    const classesRes = await request(app.getHttpServer()).get(`/v1/schools/${otherSchool.id}/classes`).set('Authorization', `Bearer ${token}`);
    expect(classesRes.status).toBe(404);

    const timetableRes = await request(app.getHttpServer()).get(`/v1/schools/${otherSchool.id}/timetable`).set('Authorization', `Bearer ${token}`);
    expect(timetableRes.status).toBe(404);
  });
});
