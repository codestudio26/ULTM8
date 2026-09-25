/**
 * HTTP-level gate for Phase 11 (ClassesModule: booking + waitlist) — booking
 * creation gates (Active Membership + spend-order, Signed Waiver, rank-eligibility +
 * Staff override, capacity->Full), cancellation (refund vs withhold, credit
 * restoration), the one-active-Booking-per-Student-per-Class guard, the override
 * amendment endpoint, and the full waitlist join/withdraw/claim flow. Same ground
 * rule as every other e2e spec in this repo: prove over real HTTP, not just by
 * reading the code.
 *
 * Also includes direct-Prisma RLS tests (not HTTP) for this phase's own asymmetric
 * narrow-plus-broad Booking/WaitlistEntry policy (Decision 89/migration's own
 * comment) — no HTTP endpoint exposes another Student's raw Booking row, and the
 * broad Staff-read policy specifically needs proving against real Postgres, the same
 * reasoning every prior phase's own RLS test documents.
 *
 * A real BullMQ/Redis worker is NOT exercised here (booking-no-show-processing,
 * waitlist-cascade-processing) — the waitlist-claim test instead directly flips a
 * WaitlistEntry to NOTIFIED via the superuser client to simulate what the cascade
 * job would have done, matching this codebase's established "e2e proves the HTTP
 * surface and RLS, not the BullMQ worker infrastructure itself" boundary (no prior
 * phase's e2e spec spins up a real queue worker either).
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
    '[bookings.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('ClassesModule: booking + waitlist — HTTP-level gates, cancellation, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let branchStaff: { id: string; email: string };
  let outsider: { id: string; email: string };
  let guardian: { id: string; email: string };
  let minor: { id: string; email: string };
  let tokenOwner: string;
  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenBranchStaff: string;
  let tokenOutsider: string;
  let tokenGuardian: string;

  let subscriptionPlanId: string;
  let classPackPlanId: string;
  let waiver: { id: string };
  let discipline: { id: string };
  let rank: { id: string };
  let stripeTier: { id: string };

  let classBasic: { id: string };
  let classWaiverGated: { id: string };
  let classRankGated: { id: string };
  let classFull: { id: string };
  let classPastCutoff: { id: string };

  const bookingIds: string[] = [];
  const waitlistEntryIds: string[] = [];
  const membershipIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  async function mkActiveMembership(studentId: string, planId: string, classesRemaining: number | null) {
    const membership = await superuser.membership.create({
      data: {
        id: randomUUID(),
        studentId,
        membershipPlanId: planId,
        schoolId: school.id,
        status: 'ACTIVE',
        frequency: classesRemaining === null ? 'RECURRING' : 'ONE_TIME',
        classesRemaining,
      },
    });
    membershipIds.push(membership.id);
    return membership;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Bookings HTTP School', waitlistClaimWindowMinutes: 120 } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `bookings-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    owner = await mkUser('owner');
    studentA = await mkUser('student-a');
    studentB = await mkUser('student-b');
    branchStaff = await mkUser('branch-staff');
    outsider = await mkUser('outsider');
    guardian = await mkUser('guardian');
    minor = await mkUser('minor');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaff.id, schoolId: school.id },
        // Stands in for Phase 38's own Guardian-on-behalf-of enrollment —
        // exercised end-to-end in that phase's own test suite, not re-proven
        // here.
        { id: randomUUID(), role: 'STUDENT', userId: minor.id, schoolId: school.id },
      ],
    });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: minor.id } });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenBranchStaff = signAccessToken(branchStaff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOutsider = signAccessToken(outsider, []);
    tokenGuardian = signAccessToken(guardian, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);

    const subscriptionPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
    });
    subscriptionPlanId = subscriptionPlan.id;
    const classPackPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5 },
    });
    classPackPlanId = classPackPlan.id;

    waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Risks acknowledged.' } });

    discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, primaryColour: 'white' },
    });
    stripeTier = await superuser.rankStripeTier.create({
      data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: 0, count: 1, colour: 'white', eligibleClassTypes: ['Judo'] },
    });

    const future = new Date(Date.now() + 24 * 3_600_000);
    const past = new Date(Date.now() - 24 * 3_600_000);

    classBasic = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Open Mat', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classWaiverGated = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Sparring', startDate: future, endDate: new Date(future.getTime() + 3_600_000), termsWaiverRequired: true },
    });
    classRankGated = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Judo Fundamentals', activities: ['Judo'], startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classFull = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Small Group', capacity: 1, startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classPastCutoff = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Already Cutoff', startDate: future, endDate: new Date(future.getTime() + 3_600_000), refundFeeDate: past },
    });
  });

  afterAll(async () => {
    // Phase 15 — creating a Waiver above for real enqueues waiver-signature-
    // requests, which (unlike its old log-only-stub self) now fans out a real
    // Notification row per Student at this School via a live worker consuming
    // real CI Redis, asynchronously, outside this test's own control. Found
    // when this exact cleanup step started failing on Notification's own
    // ON DELETE RESTRICT foreign key. Queried by the same email pattern the
    // final `user.deleteMany` below already trusts (not a hand-maintained
    // list of the two named Students) — this file also creates at least one
    // additional Student dynamically further down, which a hardcoded
    // [studentA.id, studentB.id] list would have missed.
    const createdUserIds = (
      await superuser.user.findMany({ where: { email: { contains: 'bookings-http-' } }, select: { id: true } })
    ).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { id: { in: waitlistEntryIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiver.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: guardian.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'bookings-http-' } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Creation gates
  // ---------------------------------------------------------------------------

  it('a Student with NO Active Membership cannot book — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('a Student with an Active general-access Membership CAN book — no credit spent', async () => {
    const membership = await mkActiveMembership(studentA.id, subscriptionPlanId, null);

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('UPCOMING');
    expect(res.body.sourceMembershipId).toBe(membership.id);
    bookingIds.push(res.body.id);

    const meRes = await request(app.getHttpServer()).get('/v1/bookings/me').set('Authorization', `Bearer ${tokenStudentA}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.items.some((b: { id: string }) => b.id === res.body.id)).toBe(true);
  });

  it('GET /classes/:id/bookings — School Owner and Branch Staff can see the roster; a Student or outsider cannot', async () => {
    const ownerRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classBasic.id}/bookings`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.items.some((b: { studentId: string }) => b.studentId === studentA.id)).toBe(true);
    const bookingA = ownerRes.body.items.find((b: { studentId: string }) => b.studentId === studentA.id);
    expect(bookingA.studentFirstName).toBe('student-a');
    expect(bookingA.studentSurname).toBe('Tenant');

    const staffRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classBasic.id}/bookings`)
      .set('Authorization', `Bearer ${tokenBranchStaff}`);
    expect(staffRes.status).toBe(200);

    const studentRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classBasic.id}/bookings`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(studentRes.status).toBe(403);

    // The outsider holds no RoleGrant anywhere at this School, so Class's own
    // `class_tenant_isolation` RLS policy already filters the row out before
    // assertStaffAtSchool ever runs — a 404, not a 403, matching this
    // codebase's own established "RLS-blocked and genuinely-missing are
    // indistinguishable by design" convention (ultm8-tenant-isolation §2).
    const outsiderRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classBasic.id}/bookings`)
      .set('Authorization', `Bearer ${tokenOutsider}`);
    expect(outsiderRes.status).toBe(404);
  });

  it('GET /classes/:id/bookings resolves the Student name even after their only RoleGrant at this School is revoked (Decision 117 regression)', async () => {
    // Simulates the real trigger: GuardiansService.withdrawConsent's BASELINE
    // cascade revokes every active RoleGrant a Student holds, everywhere,
    // synchronously — a fresh, throwaway Student here so revoking it can't affect
    // any other test in this suite. Before Decision 117's fix, the name join was a
    // Prisma `include` on Booking.student, which relied on user_self_or_shared_school
    // RLS — invisible once this grant is revoked, even though the caller remains
    // fully authorized to see the Booking row itself (booking_staff_read doesn't
    // depend on the target Student's own RoleGrant status at all).
    const revokedStudent = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `bookings-http-revoked-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'revoked-student',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    const grant = await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: revokedStudent.id, schoolId: school.id },
    });
    const membership = await mkActiveMembership(revokedStudent.id, subscriptionPlanId, null);
    const booking = await superuser.booking.create({
      data: {
        id: randomUUID(),
        studentId: revokedStudent.id,
        classId: classBasic.id,
        schoolId: school.id,
        sourceMembershipId: membership.id,
        status: 'UPCOMING',
      },
    });
    bookingIds.push(booking.id);

    await superuser.roleGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });

    const res = await request(app.getHttpServer())
      .get(`/v1/classes/${classBasic.id}/bookings`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((b: { studentId: string }) => b.studentId === revokedStudent.id);
    expect(row).toBeDefined();
    expect(row.studentFirstName).toBe('revoked-student');
    expect(row.studentSurname).toBe('Tenant');
  });

  it('GET /classes/:id/bookings — a single-grant Branch-scoped Staff member outside this Class\'s own Branch gets 404 (RLS hides the Class row itself, same as any cross-tenant read — ultm8-tenant-isolation §2); a genuinely empty Class returns 200 + []', async () => {
    // Self-contained fixture — mirrors the established branch-scoping pattern
    // already used in classes.e2e-spec.ts/instructors.e2e-spec.ts/
    // timetable.e2e-spec.ts for the identical three-way RLS structure, not
    // reused from this file's own beforeAll (which never set up a second
    // Branch).
    const branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Bookings Branch A' } });
    const branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Bookings Branch B' } });
    const staffB = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `bookings-http-branch-b-staff-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'branch-b-staff',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staffB.id, schoolId: school.id, branchId: branchB.id },
    });
    const tokenStaffB = signAccessToken(staffB, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchB.id }]);
    const classBranchA = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branchA.id,
        title: 'Branch A Only Class',
        activities: ['Jiu Jitsu'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });

    // Wrong Branch, single grant — traced directly against class_tenant_isolation
    // (20260907000000_classes_module/migration.sql): staffB's only RoleGrant
    // (BRANCH_STAFF at branchB) does not satisfy that policy's own three-way
    // EXISTS clause for a Class scoped to branchA, so `findAllForClass`'s own
    // `tx.class.findUnique` already returns null under RLS, before
    // assertStaffAtSchool's branch check is ever reached — a 404, exactly
    // like ClassesService.findOne()'s own documented "RLS-blocked and
    // genuinely-missing are indistinguishable by design" convention. This is
    // NOT the scenario assertStaffAtSchool's targetBranchId param defends —
    // see the dual-grant test directly below for the case where it does real
    // work (RLS lets the Class row through via a non-matching-branch grant,
    // but no Staff grant of the caller's own covers this Branch).
    const wrongBranchRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classBranchA.id}/bookings`)
      .set('Authorization', `Bearer ${tokenStaffB}`);
    expect(wrongBranchRes.status).toBe(404);

    // A genuinely empty (but authorized) Class still returns 200 + [], not an
    // error — School Owner has no Branch restriction, so this exercises the
    // "authorized but nothing to show" path distinctly from the 404 above.
    const emptyRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classBranchA.id}/bookings`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body.items).toEqual([]);

    await superuser.class.delete({ where: { id: classBranchA.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: staffB.id } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
  });

  it('GET /classes/:id/bookings — a Staff member holding a SECOND, non-matching-branch RoleGrant that lets the Class pass RLS still gets a real 403 from assertStaffAtSchool, not a false-positive 200', async () => {
    // This is the scenario assertStaffAtSchool's targetBranchId param actually
    // defends against (see this file's single-grant test directly above for
    // why the simple case is a 404, not a 403, via RLS alone). Here, staffC
    // holds TWO RoleGrants at the same School: a STUDENT grant scoped to
    // branchA (satisfying class_tenant_isolation's EXISTS clause, since RLS
    // admits ANY active RoleGrant holder, not just Staff roles — that
    // policy's own migration comment), and a BRANCH_STAFF grant scoped to
    // branchB (the mismatched one). The Class row is therefore visible via
    // RLS, so findAllForClass proceeds past its NotFoundException check —
    // proving assertStaffAtSchool's own branch check is what blocks this,
    // not RLS silently doing the job for it.
    const branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Bookings Dual-Grant Branch A' } });
    const branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Bookings Dual-Grant Branch B' } });
    const staffC = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `bookings-http-dual-grant-staff-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'dual-grant-staff',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: staffC.id, schoolId: school.id, branchId: branchA.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: staffC.id, schoolId: school.id, branchId: branchB.id },
      ],
    });
    const tokenStaffC = signAccessToken(staffC, [
      { role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: branchA.id },
      { role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchB.id },
    ]);
    const classBranchA = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branchA.id,
        title: 'Dual-Grant Branch A Only Class',
        activities: ['Jiu Jitsu'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/v1/classes/${classBranchA.id}/bookings`)
      .set('Authorization', `Bearer ${tokenStaffC}`);
    expect(res.status).toBe(403);

    await superuser.class.delete({ where: { id: classBranchA.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: staffC.id } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
  });

  it('a duplicate active Booking for the same Student/Class is rejected — 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(409);
  });

  it('spend order: a Class Pack credit is spent when it is the ONLY eligible Membership, and classesRemaining decrements', async () => {
    const classPack = await mkActiveMembership(studentB.id, classPackPlanId, 2);

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.sourceMembershipId).toBe(classPack.id);
    bookingIds.push(res.body.id);

    const after = await superuser.membership.findUniqueOrThrow({ where: { id: classPack.id } });
    expect(after.classesRemaining).toBe(1);
  });

  it('a waiver-required Class blocks an unsigned Student — 400 — and admits them once Signed', async () => {
    const blocked = await request(app.getHttpServer())
      .post(`/v1/classes/${classWaiverGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(blocked.status).toBe(400);

    const signRes = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiver.id}/sign`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ signerFullName: 'Student A', signatureText: 'Student A' });
    expect(signRes.status).toBe(201);

    const allowed = await request(app.getHttpServer())
      .post(`/v1/classes/${classWaiverGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(allowed.status).toBe(201);
    bookingIds.push(allowed.body.id);
  });

  it('a rank-gated Class blocks a Student with no matching StudentRank — 403 — and a Staff override bypasses it', async () => {
    const blocked = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    expect(blocked.status).toBe(403);

    // Staff self-override is rejected — a Student may never self-override.
    const selfOverride = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({ overrideReason: 'Trying to self-override' });
    expect(selfOverride.status).toBe(403);

    const staffOverride = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ studentId: studentB.id, overrideReason: 'Trial class, cleared verbally by coach' });
    expect(staffOverride.status).toBe(201);
    expect(staffOverride.body.overriddenById).toBe(owner.id);
    expect(staffOverride.body.overrideReason).toBe('Trial class, cleared verbally by coach');
    bookingIds.push(staffOverride.body.id);
  });

  it('a Student WITH a matching StudentRank whose stripe tier covers the activity CAN book without an override', async () => {
    await superuser.studentRank.create({
      data: {
        id: randomUUID(),
        studentId: studentA.id,
        disciplineId: discipline.id,
        schoolId: school.id,
        currentRankId: rank.id,
        currentStripeId: stripeTier.id,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.overriddenById).toBeNull();
    bookingIds.push(res.body.id);
  });

  it('PATCH /bookings/{id}/override lets Staff amend an existing override\'s justification, but not a non-overridden Booking', async () => {
    // studentB's own Class Pack from the earlier "spend order"/rank-gated-override
    // tests is already fully exhausted (0 remaining) — fund this attempt with a
    // fresh one so it actually reaches the one-active-Booking guard (via the
    // create()-time P2002 check) rather than failing earlier on insufficient funds.
    await mkActiveMembership(studentB.id, classPackPlanId, 1);

    // studentB already holds an UPCOMING, Staff-overridden Booking on
    // classRankGated from the previous test — a second create attempt for the same
    // Student/Class correctly hits the one-active-Booking guard (409) regardless of
    // the override fields, proving the amend path (not a second create) is the only
    // way to touch that override's justification text.
    const secondCreateAttempt = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ studentId: studentB.id, overrideReason: 'initial reason' });
    expect(secondCreateAttempt.status).toBe(409);

    const overriddenBookings = await withUser(owner.id, (tx) => tx.booking.findMany({ where: { classId: classRankGated.id, overriddenById: owner.id } }));
    expect(overriddenBookings.length).toBeGreaterThan(0);
    const targetId = overriddenBookings[0].id;

    const amendRes = await request(app.getHttpServer())
      .patch(`/v1/bookings/${targetId}/override`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ overrideReason: 'Amended: cleared in writing after all' });
    expect(amendRes.status).toBe(200);
    expect(amendRes.body.overrideReason).toBe('Amended: cleared in writing after all');

    const nonOverriddenId = bookingIds[0];
    const rejectAmend = await request(app.getHttpServer())
      .patch(`/v1/bookings/${nonOverriddenId}/override`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ overrideReason: 'Should be rejected' });
    expect(rejectAmend.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Capacity -> Full -> Waitlist
  // ---------------------------------------------------------------------------

  it('CONCURRENCY: two simultaneous bookClass calls for a capacity=1 Class never both succeed (the FOR UPDATE lock fix)', async () => {
    const classConcurrency = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Concurrency Check', capacity: 1, startDate: new Date(Date.now() + 24 * 3_600_000), endDate: new Date(Date.now() + 25 * 3_600_000) },
    });
    const mkRacer = async (label: string) => {
      const user = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `bookings-http-race-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Racer',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
      await mkActiveMembership(user.id, subscriptionPlanId, null);
      const token = signAccessToken(user, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
      return { user, token };
    };

    const racer1 = await mkRacer('one');
    const racer2 = await mkRacer('two');

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer()).post(`/v1/classes/${classConcurrency.id}/book`).set('Authorization', `Bearer ${racer1.token}`).send({}),
      request(app.getHttpServer()).post(`/v1/classes/${classConcurrency.id}/book`).set('Authorization', `Bearer ${racer2.token}`).send({}),
    ]);
    const statuses = [res1.status, res2.status].sort();
    // Exactly one succeeds (201); the other is rejected as Full (409) — never both
    // 201, which is exactly what the pre-fix race allowed.
    expect(statuses).toEqual([201, 409]);
    const winner = res1.status === 201 ? res1 : res2;
    bookingIds.push(winner.body.id);

    const finalCount = await superuser.booking.count({ where: { classId: classConcurrency.id, status: 'UPCOMING' } });
    expect(finalCount).toBe(1);
  });

  it('a full Class rejects a new Booking (409) and directs the caller to the waitlist; joining the waitlist then succeeds', async () => {
    // studentA already holds an Active general-access Membership from the earlier
    // "CAN book — no credit spent" test (general-access is never consumed, so it's
    // still valid here) — creating a second one would violate the one-active-
    // general-access-per-School guard, so this reuses the existing one rather than
    // minting another.
    const firstRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(firstRes.status).toBe(201);
    bookingIds.push(firstRes.body.id);

    const secondRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    expect(secondRes.status).toBe(409);

    const waitlistRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(waitlistRes.status).toBe(201);
    expect(waitlistRes.body.status).toBe('WAITING');
    expect(waitlistRes.body.position).toBe(1);
    waitlistEntryIds.push(waitlistRes.body.id);

    const duplicateJoin = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(duplicateJoin.status).toBe(409);
  });

  it('GET /classes/:id/waitlist — School Owner and Branch Staff can see the queue; a Student or outsider cannot', async () => {
    const ownerRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.items.some((e: { studentId: string; status: string }) => e.studentId === studentB.id && e.status === 'WAITING')).toBe(
      true,
    );
    const entryB = ownerRes.body.items.find((e: { studentId: string }) => e.studentId === studentB.id);
    expect(entryB.studentFirstName).toBe('student-b');
    expect(entryB.studentSurname).toBe('Tenant');

    const staffRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenBranchStaff}`);
    expect(staffRes.status).toBe(200);

    const studentRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(studentRes.status).toBe(403);

    // Same RLS-vs-404 reasoning as the bookings admin-read test above.
    const outsiderRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenOutsider}`);
    expect(outsiderRes.status).toBe(404);
  });

  it('GET /classes/:id/waitlist resolves the Student name even after their only RoleGrant at this School is revoked (Decision 117 regression)', async () => {
    // Same regression as the Bookings version above — see that test's own comment.
    const revokedStudent = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `bookings-http-revoked-waitlist-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'revoked-waitlist-student',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    const grant = await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: revokedStudent.id, schoolId: school.id },
    });
    const entry = await superuser.waitlistEntry.create({
      data: {
        id: randomUUID(),
        studentId: revokedStudent.id,
        classId: classFull.id,
        schoolId: school.id,
        position: 999,
        status: 'WAITING',
      },
    });
    waitlistEntryIds.push(entry.id);

    await superuser.roleGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });

    const res = await request(app.getHttpServer())
      .get(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((e: { studentId: string }) => e.studentId === revokedStudent.id);
    expect(row).toBeDefined();
    expect(row.studentFirstName).toBe('revoked-waitlist-student');
    expect(row.studentSurname).toBe('Tenant');
  });

  it('GET /classes/:id/waitlist — a single-grant Branch-scoped Staff member outside this Class\'s own Branch gets 404, same RLS-driven reasoning as the Bookings version of this test above', async () => {
    // Same class_tenant_isolation-traced reasoning as the Bookings single-
    // grant test above: staffB's only RoleGrant is BRANCH_STAFF at branchB,
    // which does not satisfy class_tenant_isolation's EXISTS clause for a
    // branchA-scoped Class, so the Class row itself is invisible under RLS —
    // findAllForClass's own NotFoundException fires before
    // assertStaffAtSchool's branch check is ever reached. 404, not 403.
    const branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Waitlist Branch A' } });
    const branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Waitlist Branch B' } });
    const staffB = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `bookings-http-waitlist-branch-b-staff-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'waitlist-branch-b-staff',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staffB.id, schoolId: school.id, branchId: branchB.id },
    });
    const tokenStaffB = signAccessToken(staffB, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchB.id }]);
    const classBranchA = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branchA.id,
        title: 'Waitlist Branch A Only Class',
        activities: ['Jiu Jitsu'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });

    const wrongBranchRes = await request(app.getHttpServer())
      .get(`/v1/classes/${classBranchA.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStaffB}`);
    expect(wrongBranchRes.status).toBe(404);

    await superuser.class.delete({ where: { id: classBranchA.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: staffB.id } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
  });

  it('GET /classes/:id/waitlist — a Staff member holding a SECOND, non-matching-branch RoleGrant that lets the Class pass RLS still gets a real 403 from assertStaffAtSchool', async () => {
    // Same dual-grant reasoning as the Bookings version of this test above —
    // proves assertStaffAtSchool's own branch check is the thing blocking
    // this, since RLS itself lets the Class row through via staffC's
    // school_tenant_isolation-satisfying STUDENT grant at branchA.
    const branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Waitlist Dual-Grant Branch A' } });
    const branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Waitlist Dual-Grant Branch B' } });
    const staffC = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `bookings-http-waitlist-dual-grant-staff-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'waitlist-dual-grant-staff',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: staffC.id, schoolId: school.id, branchId: branchA.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: staffC.id, schoolId: school.id, branchId: branchB.id },
      ],
    });
    const tokenStaffC = signAccessToken(staffC, [
      { role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: branchA.id },
      { role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchB.id },
    ]);
    const classBranchA = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branchA.id,
        title: 'Waitlist Dual-Grant Branch A Only Class',
        activities: ['Jiu Jitsu'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/v1/classes/${classBranchA.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStaffC}`);
    expect(res.status).toBe(403);

    await superuser.class.delete({ where: { id: classBranchA.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: staffC.id } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
  });

  it('withdrawing frees the Student to rejoin the same Class\'s waitlist', async () => {
    const entryId = waitlistEntryIds[0];
    const withdrawRes = await request(app.getHttpServer()).delete(`/v1/waitlist/${entryId}`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(withdrawRes.status).toBe(204);

    const rejoinRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(rejoinRes.status).toBe(201);
    waitlistEntryIds.push(rejoinRes.body.id);
  });

  it('claiming a Notified entry creates a real Booking and spends a credit; claiming a non-Notified entry is rejected', async () => {
    // studentB's own Class Pack from the earlier "spend order"/rank-gated-override
    // tests is already fully exhausted (0 remaining) by this point in the suite —
    // fund this claim with a FRESH Class Pack, not a general-access Membership: a
    // general-access one would also get picked (and never touched) by the LATER
    // "cancelling BEFORE cutoff" test's own spend-order preference, silently
    // breaking that test's own classesRemaining assertions.
    await mkActiveMembership(studentB.id, classPackPlanId, 1);

    const entryId = waitlistEntryIds[waitlistEntryIds.length - 1];

    const tooEarly = await request(app.getHttpServer()).post(`/v1/waitlist/${entryId}/claim`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(tooEarly.status).toBe(400);

    // Simulate what waitlist-cascade-processing would have done on a freed seat —
    // no real BullMQ worker runs in this suite (see the file's own header comment).
    await superuser.waitlistEntry.update({
      where: { id: entryId },
      data: { status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: new Date(Date.now() + 3_600_000) },
    });

    // Free up the one seat classFull had — cancel Student A's Booking there first.
    const studentABookingOnFull = await withUser(studentA.id, (tx) => tx.booking.findFirst({ where: { classId: classFull.id, studentId: studentA.id } }));
    await request(app.getHttpServer()).patch(`/v1/bookings/${studentABookingOnFull!.id}/cancel`).set('Authorization', `Bearer ${tokenStudentA}`);

    const claimRes = await request(app.getHttpServer()).post(`/v1/waitlist/${entryId}/claim`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(claimRes.status).toBe(201);
    expect(claimRes.body.studentId).toBe(studentB.id);
    bookingIds.push(claimRes.body.id);

    const claimedEntry = await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(claimedEntry.status).toBe('CLAIMED');
    expect(claimedEntry.claimedBookingId).toBe(claimRes.body.id);
  });

  // ---------------------------------------------------------------------------
  // Cancellation — refund vs withhold
  // ---------------------------------------------------------------------------

  it('cancelling BEFORE the refund cutoff restores the spent credit (REFUNDED)', async () => {
    // studentB has accumulated several Class Pack Memberships from earlier tests in
    // this suite, some still holding a positive balance — since spend-order only
    // guarantees "prefer general-access first," among MULTIPLE simultaneously-active
    // Class Packs the selection order is otherwise unspecified. Expiring all of
    // studentB's prior ones first makes the fresh Membership created below the only
    // eligible candidate, so this test's own classesRemaining assertions are
    // deterministic rather than depending on exactly which earlier test left which
    // balance behind.
    await superuser.membership.updateMany({ where: { studentId: studentB.id, classesRemaining: { not: null } }, data: { status: 'EXPIRED' } });

    const membership = await mkActiveMembership(studentB.id, classPackPlanId, 3);
    const bookRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classWaiverGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    // studentB has no Signed waiver yet for this School's Waiver in this test's own
    // isolated flow — sign first.
    if (bookRes.status === 400) {
      await request(app.getHttpServer())
        .post(`/v1/waivers/${waiver.id}/sign`)
        .set('Authorization', `Bearer ${tokenStudentB}`)
        .send({ signerFullName: 'Student B', signatureText: 'Student B' });
    }
    const res = bookRes.status === 400
      ? await request(app.getHttpServer()).post(`/v1/classes/${classWaiverGated.id}/book`).set('Authorization', `Bearer ${tokenStudentB}`).send({})
      : bookRes;
    expect(res.status).toBe(201);
    bookingIds.push(res.body.id);

    const afterBook = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(afterBook.classesRemaining).toBe(2);

    const cancelRes = await request(app.getHttpServer()).patch(`/v1/bookings/${res.body.id}/cancel`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    expect(cancelRes.body.refundResolution).toBe('REFUNDED');

    const afterCancel = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(afterCancel.classesRemaining).toBe(3);

    const doubleCancel = await request(app.getHttpServer()).patch(`/v1/bookings/${res.body.id}/cancel`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(doubleCancel.status).toBe(409);
  });

  it('cancelling AFTER the refund cutoff withholds the credit (WITHHELD)', async () => {
    // studentA's own general-access Membership (from the very first booking test)
    // is still Active and would otherwise always be preferred over a fresh Class
    // Pack per the spend-order rule (general-access first) — meaning the Class Pack
    // created below would never actually be selected/decremented, and this test
    // would silently stop testing credit-withholding at all. Expiring it here is
    // safe: nothing later in this suite depends on studentA still holding it.
    await superuser.membership.updateMany({ where: { studentId: studentA.id, classesRemaining: null }, data: { status: 'EXPIRED' } });

    const membership = await mkActiveMembership(studentA.id, classPackPlanId, 3);
    const bookRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classPastCutoff.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(bookRes.status).toBe(201);
    bookingIds.push(bookRes.body.id);

    const cancelRes = await request(app.getHttpServer()).patch(`/v1/bookings/${bookRes.body.id}/cancel`).set('Authorization', `Bearer ${tokenStudentA}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.refundResolution).toBe('WITHHELD');

    const after = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.classesRemaining).toBe(2); // still decremented, never restored
  });

  it('cancelling a Booking whose Membership was funded by a DISPUTED Transaction does NOT restore the credit (Decision 111 freeze) — the cancellation itself still succeeds', async () => {
    // classWaiverGated, not classBasic — studentB already holds an active Booking
    // on classBasic from the earlier "spend order" test above (never cancelled),
    // and the one-active-Booking-per-Student-per-Class guard would 409 a second
    // attempt there. studentB already signed classWaiverGated's own Waiver in the
    // "cancelling BEFORE the refund cutoff" test above, and that test's own
    // Booking on it was CANCELLED — so it's free to book again here, no
    // WITHHELD-vs-REFUNDED cutoff configured on it (matches classBasic's own
    // shape for this test's purposes).
    await superuser.membership.updateMany({ where: { studentId: studentB.id, classesRemaining: { not: null } }, data: { status: 'EXPIRED' } });

    const membership = await mkActiveMembership(studentB.id, classPackPlanId, 3);
    // A minimal PaymentAccount + DISPUTED Transaction funding this Membership —
    // BookingsService.restoreCredit()'s own freeze guard checks for exactly this
    // shape (a Transaction row with this membershipId and status DISPUTED).
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Freeze Guard Fixture', country: 'GB' },
    });
    const transaction = await superuser.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        studentId: studentB.id,
        paymentAccountId: paymentAccount.id,
        membershipPlanId: classPackPlanId,
        membershipId: membership.id,
        amount: 3000,
        status: 'DISPUTED',
        paymentMethod: 'STRIPE',
        disputedAmount: 3000,
      },
    });

    const bookRes = await request(app.getHttpServer()).post(`/v1/classes/${classWaiverGated.id}/book`).set('Authorization', `Bearer ${tokenStudentB}`).send({});
    expect(bookRes.status).toBe(201);
    bookingIds.push(bookRes.body.id);

    const afterBook = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(afterBook.classesRemaining).toBe(2);

    const cancelRes = await request(app.getHttpServer()).patch(`/v1/bookings/${bookRes.body.id}/cancel`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    // Still REFUNDED — the freeze only withholds the credit-restore ACTION
    // (restoreCredit's own comment explains why refundResolution itself isn't
    // repurposed to reflect this), not the cutoff-driven resolution field.
    expect(cancelRes.body.refundResolution).toBe('REFUNDED');

    const afterCancel = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(afterCancel.classesRemaining).toBe(2); // NOT restored — frozen while disputed

    await superuser.transaction.delete({ where: { id: transaction.id } });
    await superuser.paymentAccount.delete({ where: { id: paymentAccount.id } });
  });

  // ---------------------------------------------------------------------------
  // Guardian-on-behalf-of booking (Phase 40).
  // ---------------------------------------------------------------------------

  it('a Guardian CAN book a Class for a linked minor — the Booking belongs to the MINOR, not the Guardian', async () => {
    await mkActiveMembership(minor.id, subscriptionPlanId, null);

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('UPCOMING');
    expect(res.body.studentId).toBe(minor.id);
    bookingIds.push(res.body.id);

    // Direct Prisma, under the minor's own tenant context — confirms the row
    // is genuinely readable as the minor's own (Booking RLS's "self" branch),
    // the same style of check Phase 39's own Membership test already used.
    const asMinor = await withUser(minor.id, (tx) => tx.booking.findMany({ where: { id: res.body.id } }));
    expect(asMinor).toHaveLength(1);
  });

  it('a Guardian may NOT supply overrideReason — 403, only Instructor/Staff may override', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id, overrideReason: 'Guardian trying to override' });
    expect(res.status).toBe(403);
  });

  it('a caller with NO active GuardianLink to the named Student is rejected — 403, not a silent no-op', async () => {
    // studentA stands in for "some other real Student" — outsider holds no
    // GuardianLink to them (or anyone) at all.
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenOutsider}`)
      .send({ studentId: studentA.id });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Guardian-on-behalf-of booking cancellation (Phase 41).
  // ---------------------------------------------------------------------------

  it('a Guardian CAN cancel a linked minor\'s own Booking', async () => {
    // Not individually deleted at the end of this test — the resulting
    // Booking still holds a live FK to it even once CANCELLED (a cancelled
    // Booking is a status flip, not a delete), so cleanup relies on the
    // suite's own bulk afterAll (bookingAttendee -> booking -> ... -> class,
    // by schoolId), same precedent the "CONCURRENCY" test's own
    // classConcurrency fixture above already established.
    const classForCancel = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Guardian Cancel Fixture', startDate: new Date(Date.now() + 24 * 3_600_000), endDate: new Date(Date.now() + 25 * 3_600_000) },
    });

    const bookRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classForCancel.id}/book`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(bookRes.status).toBe(201);
    bookingIds.push(bookRes.body.id);

    const cancelRes = await request(app.getHttpServer())
      .patch(`/v1/bookings/${bookRes.body.id}/cancel`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    // resolvedById is the GUARDIAN (the actual caller who cancelled it), same
    // "record the real actor" convention Phase 37's own signedById established.
    expect(cancelRes.body.resolvedById).toBe(guardian.id);
  });

  it('a caller with NO active GuardianLink to the Booking\'s real Student cannot cancel it, even naming that Student explicitly — 403', async () => {
    // studentA already holds at least one Booking from earlier tests in this
    // suite — outsider names studentA's real id, but holds no GuardianLink to
    // them at all.
    const studentABooking = await withUser(studentA.id, (tx) => tx.booking.findFirst({ where: { studentId: studentA.id, status: 'UPCOMING' } }));
    expect(studentABooking).not.toBeNull();

    const res = await request(app.getHttpServer())
      .patch(`/v1/bookings/${studentABooking!.id}/cancel`)
      .set('Authorization', `Bearer ${tokenOutsider}`)
      .send({ studentId: studentA.id });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Guardian/Staff-on-behalf-of Waitlist join/withdraw/claim (Phase 42, Decision
  // 103). Deliberately placed after the Phase 40/41 Guardian booking sections
  // above, not earlier in the file — the claim test below relies on minor
  // already holding the Active general-access Membership the Phase 40 booking
  // test creates (FOUND ON REVIEW, before this ever merged: an earlier draft
  // placed this section immediately after the ORIGINAL "claiming a Notified
  // entry..." test instead, well before Phase 40/41 run in file order — Jest
  // runs `it` blocks in file order, so minor had no Membership yet at that
  // point and the claim test failed on CI with a genuine 400, not a build
  // error. Moved here rather than making the test mint its own membership,
  // since minting a second general-access one for minor would then collide
  // with Phase 40's own creation via `Membership_one_active_general_access_
  // per_school` once IT ran later in file order instead).
  // ---------------------------------------------------------------------------

  it('a Guardian CAN join a Class\'s waitlist for a linked minor — the entry belongs to the MINOR, not the Guardian', async () => {
    // Not individually deleted — both WaitlistEntry rows created below stay
    // WAITING and still hold a live FK to this Class, same reasoning the
    // Phase 41 cancellation fixture's own comment already documents; cleanup
    // relies on the suite's own bulk afterAll.
    const classForGuardianWaitlist = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Guardian Waitlist Fixture', startDate: new Date(Date.now() + 24 * 3_600_000), endDate: new Date(Date.now() + 25 * 3_600_000) },
    });

    const joinRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classForGuardianWaitlist.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(joinRes.status).toBe(201);
    expect(joinRes.body.studentId).toBe(minor.id);
    waitlistEntryIds.push(joinRes.body.id);

    const asMinor = await withUser(minor.id, (tx) => tx.waitlistEntry.findMany({ where: { id: joinRes.body.id } }));
    expect(asMinor).toHaveLength(1);

    // Staff-on-behalf-of also works, same shape, for a different Student —
    // Decision 103 extended join to BOTH, not just Guardian.
    const staffJoinRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classForGuardianWaitlist.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ studentId: studentA.id });
    expect(staffJoinRes.status).toBe(201);
    expect(staffJoinRes.body.studentId).toBe(studentA.id);
    waitlistEntryIds.push(staffJoinRes.body.id);
  });

  it('a caller with NO active GuardianLink to the named Student cannot join a waitlist on their behalf — 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenOutsider}`)
      .send({ studentId: studentA.id });
    expect(res.status).toBe(403);
  });

  it('a Guardian CAN claim a Notified entry on behalf of a linked minor — creates a real Booking for the MINOR', async () => {
    const classForGuardianClaim = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Guardian Claim Fixture', capacity: 1, startDate: new Date(Date.now() + 24 * 3_600_000), endDate: new Date(Date.now() + 25 * 3_600_000) },
    });

    const joinRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classForGuardianClaim.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(joinRes.status).toBe(201);
    waitlistEntryIds.push(joinRes.body.id);

    await superuser.waitlistEntry.update({
      where: { id: joinRes.body.id },
      data: { status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: new Date(Date.now() + 3_600_000) },
    });

    // minor already holds an Active general-access Membership from the earlier
    // Phase 40 booking test — general-access is never consumed, so it's still
    // valid here and funds this claim without minting a second one.
    const claimRes = await request(app.getHttpServer())
      .post(`/v1/waitlist/${joinRes.body.id}/claim`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(claimRes.status).toBe(201);
    expect(claimRes.body.studentId).toBe(minor.id);
    bookingIds.push(claimRes.body.id);

    const claimedEntry = await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: joinRes.body.id } });
    expect(claimedEntry.status).toBe('CLAIMED');
  });

  it('a Guardian CAN withdraw a linked minor\'s own Waitlist entry via the studentId query hint', async () => {
    // Not individually deleted — a withdrawn (CANCELLED) entry is a status
    // flip, not a row delete, so it still holds a live FK to this Class; same
    // reasoning as every other throwaway-Class fixture in this section.
    const classForGuardianWithdraw = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Guardian Withdraw Fixture', startDate: new Date(Date.now() + 24 * 3_600_000), endDate: new Date(Date.now() + 25 * 3_600_000) },
    });

    const joinRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classForGuardianWithdraw.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(joinRes.status).toBe(201);
    waitlistEntryIds.push(joinRes.body.id);

    const withdrawRes = await request(app.getHttpServer())
      .delete(`/v1/waitlist/${joinRes.body.id}`)
      .query({ studentId: minor.id })
      .set('Authorization', `Bearer ${tokenGuardian}`);
    expect(withdrawRes.status).toBe(204);

    const afterWithdraw = await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: joinRes.body.id } });
    expect(afterWithdraw.status).toBe('CANCELLED');
  });

  it('a caller with NO active GuardianLink to the entry\'s real Student cannot withdraw it, even naming that Student explicitly — 403', async () => {
    const studentAWaitlistEntry = await withUser(studentA.id, (tx) =>
      tx.waitlistEntry.findFirst({ where: { studentId: studentA.id, status: { in: ['WAITING', 'NOTIFIED'] } } }),
    );
    expect(studentAWaitlistEntry).not.toBeNull();

    const res = await request(app.getHttpServer())
      .delete(`/v1/waitlist/${studentAWaitlistEntry!.id}`)
      .query({ studentId: studentA.id })
      .set('Authorization', `Bearer ${tokenOutsider}`);
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // RLS — Booking/WaitlistEntry's asymmetric narrow-plus-broad shape (Decision 89)
  // ---------------------------------------------------------------------------

  it('RLS: Student B cannot read Student A\'s Booking rows directly, even sharing a School', async () => {
    const asStudentB = await withUser(studentB.id, (tx) => tx.booking.findMany({ where: { studentId: studentA.id } }));
    expect(asStudentB).toHaveLength(0);

    const asOwner = await withUser(owner.id, (tx) => tx.booking.findMany({ where: { studentId: studentA.id } }));
    expect(asOwner.length).toBeGreaterThan(0);
  });

  it('RLS: Branch Staff CAN read every Student\'s Booking rows at the School (the new broad Staff-read policy) but cannot write one directly', async () => {
    const asBranchStaffRead = await withUser(branchStaff.id, (tx) => tx.booking.findMany({ where: { schoolId: school.id } }));
    expect(asBranchStaffRead.length).toBeGreaterThan(0);

    const someBookingId = asBranchStaffRead[0].id;
    await expect(
      withUser(branchStaff.id, (tx) => tx.booking.update({ where: { id: someBookingId }, data: { overrideReason: 'direct write attempt' } })),
    ).rejects.toThrow();
  });

  it('RLS: an outsider with no RoleGrant at this School sees nothing', async () => {
    const asOutsider = await withUser(outsider.id, (tx) => tx.booking.findMany({ where: { schoolId: school.id } }));
    expect(asOutsider).toHaveLength(0);
  });
});
