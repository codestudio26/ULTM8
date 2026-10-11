/**
 * HTTP-level gate for `GET /schools/:schoolId/bookings?from=&to=` — the v1.2
 * backend backlog's Dashboard "Bookings This Week" drill-down gap. Proves
 * the date-range filter (through the related Class's own `startDate`, not
 * a column on Booking itself), the Class title/date/activities join, and
 * that this new call site correctly rides the Phase 11 migration's existing
 * `booking_staff_read` RLS policy (a School-level grant sees every Branch's
 * Bookings; a Branch-scoped grant sees its own Branch's plus School-wide
 * ones) — not a re-test of that policy's own correctness (already proven in
 * bookings.e2e-spec.ts), but proof this NEW endpoint actually rides it.
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
    '[school-bookings.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('GET /schools/:schoolId/bookings — date-range Bookings aggregation', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  let owner: { id: string; email: string };
  let branchStaffA: { id: string; email: string };
  let student: { id: string; email: string };
  let outsiderOwner: { id: string; email: string };
  let planId: string;
  let membershipId: string;
  let tokenOwner: string;
  let tokenBranchStaffA: string;
  let tokenStudent: string;
  let tokenOutsiderOwner: string;

  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const classIds: string[] = [];
  const membershipIds: string[] = [];
  const bookingIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function mkUser(label: string) {
    return superuser.user.create({
      data: {
        id: randomUUID(),
        email: `school-bookings-http-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  }

  async function mkClass(title: string, activities: string[], startDate: Date, branchId?: string) {
    const cls = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branchId ?? null,
        title,
        activities,
        startDate,
        endDate: new Date(startDate.getTime() + 3_600_000),
      },
    });
    classIds.push(cls.id);
    return cls;
  }

  async function mkBooking(studentId: string, classId: string, membershipId: string, schoolId: string, branchId?: string | null) {
    const booking = await superuser.booking.create({
      data: { id: randomUUID(), studentId, classId, schoolId, branchId: branchId ?? null, sourceMembershipId: membershipId, status: 'UPCOMING' },
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

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'School Bookings HTTP School' } });
    schoolIds.push(school.id);
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'School Bookings HTTP Other School' } });
    schoolIds.push(otherSchool.id);
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch A' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch B' } });

    owner = await mkUser('owner');
    userIds.push(owner.id);
    branchStaffA = await mkUser('branch-staff-a');
    userIds.push(branchStaffA.id);
    student = await mkUser('student');
    userIds.push(student.id);
    outsiderOwner = await mkUser('outsider-owner');
    userIds.push(outsiderOwner.id);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaffA.id, schoolId: school.id, branchId: branchA.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: outsiderOwner.id, schoolId: otherSchool.id },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenBranchStaffA = signAccessToken(branchStaffA, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchA.id }]);
    tokenStudent = signAccessToken(student, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOutsiderOwner = signAccessToken(outsiderOwner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: otherSchool.id, branchId: null }]);

    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    planId = plan.id;

    // One shared ACTIVE Membership for `student`, reused by every test's
    // Bookings — Membership enforces "one active general-access Membership
    // per Student per School" (Membership_one_active_general_access_per_school),
    // so each test creating its own would collide.
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
    membershipIds.push(membership.id);
    membershipId = membership.id;
  });

  afterAll(async () => {
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('returns Bookings within the date range, joined with the Class title/date/activities, newest-day-first excluded (ordered ascending)', async () => {
    const inRangeEarly = await mkClass('Judo Fundamentals', ['Judo'], new Date('2027-03-02T10:00:00Z'), branchA.id);
    const inRangeLate = await mkClass('Karate Sparring', ['Karate'], new Date('2027-03-05T10:00:00Z'), branchA.id);
    const beforeRange = await mkClass('Before Range', ['Judo'], new Date('2027-02-28T10:00:00Z'), branchA.id);
    const afterRange = await mkClass('After Range', ['Judo'], new Date('2027-03-10T10:00:00Z'), branchA.id);
    await mkBooking(student.id, inRangeEarly.id, membershipId, school.id, branchA.id);
    await mkBooking(student.id, inRangeLate.id, membershipId, school.id, branchA.id);
    await mkBooking(student.id, beforeRange.id, membershipId, school.id, branchA.id);
    await mkBooking(student.id, afterRange.id, membershipId, school.id, branchA.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: '2027-03-01', to: '2027-03-07' })
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(200);
    const classTitles = res.body.items.map((b: { classTitle: string }) => b.classTitle);
    expect(classTitles).toContain('Judo Fundamentals');
    expect(classTitles).toContain('Karate Sparring');
    expect(classTitles).not.toContain('Before Range');
    expect(classTitles).not.toContain('After Range');

    const early = res.body.items.find((b: { classTitle: string }) => b.classTitle === 'Judo Fundamentals');
    expect(early.activities).toEqual(['Judo']);
    expect(early.status).toBe('UPCOMING');
    expect(early.studentFirstName).toBe('student');

    // Ascending by the Class's own startDate — the earlier-dated session
    // appears before the later one, ready for client-side day-grouping.
    const earlyIndex = classTitles.indexOf('Judo Fundamentals');
    const lateIndex = classTitles.indexOf('Karate Sparring');
    expect(earlyIndex).toBeLessThan(lateIndex);
  });

  it('`to` is inclusive of the whole day, not just midnight', async () => {
    const onToDay = await mkClass('Late on the to-day', ['Judo'], new Date('2027-04-07T23:00:00Z'));
    await mkBooking(student.id, onToDay.id, membershipId, school.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: '2027-04-01', to: '2027-04-07' })
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: { classTitle: string }) => b.classTitle)).toContain('Late on the to-day');
  });

  it('a Branch-scoped Staff member sees only their own Branch\'s Bookings plus School-wide ones, not a different Branch\'s', async () => {
    const branchACls = await mkClass('Branch A Only', ['Judo'], new Date('2027-05-02T10:00:00Z'), branchA.id);
    const branchBCls = await mkClass('Branch B Only', ['Judo'], new Date('2027-05-02T10:00:00Z'), branchB.id);
    const schoolWideCls = await mkClass('School Wide', ['Judo'], new Date('2027-05-02T10:00:00Z'));
    await mkBooking(student.id, branchACls.id, membershipId, school.id, branchA.id);
    await mkBooking(student.id, branchBCls.id, membershipId, school.id, branchB.id);
    await mkBooking(student.id, schoolWideCls.id, membershipId, school.id, null);

    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: '2027-05-01', to: '2027-05-03' })
      .set('Authorization', `Bearer ${tokenBranchStaffA}`);
    expect(res.status).toBe(200);
    const titles = res.body.items.map((b: { classTitle: string }) => b.classTitle);
    expect(titles).toContain('Branch A Only');
    expect(titles).toContain('School Wide');
    expect(titles).not.toContain('Branch B Only');
  });

  it('a Student (non-Staff) is rejected with 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: '2027-03-01', to: '2027-03-07' })
      .set('Authorization', `Bearer ${tokenStudent}`);
    expect(res.status).toBe(403);
  });

  it("a different School's Owner cannot read this School's bookings — 404", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: '2027-03-01', to: '2027-03-07' })
      .set('Authorization', `Bearer ${tokenOutsiderOwner}`);
    expect(res.status).toBe(404);
  });

  it('rejects `from` after `to` with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: '2027-03-10', to: '2027-03-01' })
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(400);
  });

  it('rejects a range longer than 92 days with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: '2027-01-01', to: '2027-12-31' })
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(400);
  });

  it('rejects a missing/malformed date with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/bookings`)
      .query({ from: 'not-a-date', to: '2027-03-07' })
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(400);
  });
});
