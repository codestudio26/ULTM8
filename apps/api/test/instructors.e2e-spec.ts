/**
 * HTTP-level cross-tenant isolation gate for InstructorsModule (Phase 6), same ground
 * rule as classes.e2e-spec.ts/timetable.e2e-spec.ts: prove over real HTTP that an
 * authenticated request from one tenant actually gets rejected/empty when targeting
 * another tenant's Instructor profile.
 *
 * This suite specifically exercises the pieces of Phase 6's design flagged as novel/
 * inferred and needing verification (see the Phase 6 kickoff prompt):
 *  1. instructor_tenant_isolation's three-way branch OR — same shape as
 *     class_tenant_isolation/timetable_slot_tenant_isolation.
 *  2. InstructorsService.create() only allows a profile for a userId that already
 *     holds an active INSTRUCTOR RoleGrant matching the profile's own scope — this
 *     module does not grant the RoleGrant itself.
 *  3. A branchId-only PATCH re-validates the profile against the new Branch, same
 *     regression class Phase 4's code review caught for ClassesService.update().
 *  4. Duplicate (schoolId, userId) profile creation is rejected with 409, not a
 *     silent second row.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
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
    '[instructors.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('InstructorsModule — HTTP-level cross-tenant isolation', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let branchA1: { id: string };
  let branchA2: { id: string };
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let grantedSchoolWide: { id: string; email: string };
  let grantedSchoolWide2: { id: string };
  let grantedSchoolWide3: { id: string };
  let grantedBranchA2: { id: string };
  let ungranted: { id: string };
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenBranchStaffA1: string;

  const instructorIds: string[] = [];

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

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Instructors HTTP School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Instructors HTTP School B' } });
    branchA1 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Instructors Branch A1' } });
    branchA2 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Instructors Branch A2' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `instructors-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    ownerA = await mkUser('owner-a');
    ownerB = await mkUser('owner-b');
    grantedSchoolWide = await mkUser('granted-school-wide');
    grantedSchoolWide2 = await mkUser('granted-school-wide-2');
    grantedSchoolWide3 = await mkUser('granted-school-wide-3');
    grantedBranchA2 = await mkUser('granted-branch-a2');
    ungranted = await mkUser('ungranted');

    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id },
    });
    const branchStaffA1User = await mkUser('branch-staff-a1');
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaffA1User.id, schoolId: schoolA.id, branchId: branchA1.id },
    });
    // School-scoped INSTRUCTOR grant — branchId null, "floats" across every Branch.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: grantedSchoolWide.id, schoolId: schoolA.id },
    });
    // A second, distinct School-scoped INSTRUCTOR grant — kept separate from
    // grantedSchoolWide precisely so the "CAN back a Branch-specific profile" test
    // below doesn't collide with the (schoolId, userId) uniqueness the "CANNOT create
    // a second profile" test is deliberately exercising against grantedSchoolWide.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: grantedSchoolWide2.id, schoolId: schoolA.id },
    });
    // A third, still-unused-until-the-null-specializations-regression-test grant —
    // every other School-scoped fixture user above ends the suite with a profile
    // already created for it by an earlier test, which would turn a fresh create()
    // call into an unintended (schoolId, userId) duplicate instead of exercising what
    // that later test is actually about.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: grantedSchoolWide3.id, schoolId: schoolA.id },
    });
    // Branch-scoped INSTRUCTOR grant — tied to branchA2 only.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: grantedBranchA2.id, schoolId: schoolA.id, branchId: branchA2.id },
    });
    // `ungranted` deliberately gets NO RoleGrant at all — used to prove profile
    // creation is rejected without one.

    tokenOwnerA = signAccessToken(ownerA, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null },
    ]);
    tokenOwnerB = signAccessToken(ownerB, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolB.id, branchId: null },
    ]);
    tokenBranchStaffA1 = signAccessToken(branchStaffA1User, [
      { role: 'BRANCH_STAFF', franchiseId: null, schoolId: schoolA.id, branchId: branchA1.id },
    ]);
  });

  afterAll(async () => {
    await superuser.instructor.deleteMany({ where: { id: { in: instructorIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA1.id, branchA2.id] } } });
    await superuser.user.deleteMany({
      where: { email: { contains: 'instructors-http-' } },
    });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  function profileBody(userId: string, overrides: Record<string, unknown> = {}) {
    return {
      userId,
      bio: 'Fixture instructor profile',
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // Negative: School A's owner reaching for School B's Instructor profiles over HTTP
  // ---------------------------------------------------------------------------

  it('cannot create an Instructor profile under another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(grantedSchoolWide.id));
    expect(res.status).toBe(404);
  });

  it('cannot list another tenant\'s Instructor profiles via the School-scoped list route', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolB.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
  });

  it('cannot GET or PATCH another tenant\'s Instructor profile', async () => {
    const schoolBInstructorUser = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-school-b-instructor-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'SchoolB',
        surname: 'Instructor',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: schoolBInstructorUser.id, schoolId: schoolB.id },
    });
    const created = await superuser.instructor.create({
      data: { id: randomUUID(), schoolId: schoolB.id, userId: schoolBInstructorUser.id, bio: 'School B profile' },
    });
    instructorIds.push(created.id);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/instructors/${created.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/instructors/${created.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ bio: 'HACKED' });
    expect([403, 404]).toContain(patchRes.status);
    const unchanged = await superuser.instructor.findUniqueOrThrow({ where: { id: created.id } });
    expect(unchanged.bio).toBe('School B profile');
  });

  // ---------------------------------------------------------------------------
  // Positive control — proves the negatives above are real isolation, not every
  // request failing regardless of tenant.
  // ---------------------------------------------------------------------------

  it('CAN create, read, and update an Instructor profile within its own School', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(grantedSchoolWide.id, { bio: 'Owned profile' }));
    expect(createRes.status).toBe(201);
    instructorIds.push(createRes.body.id);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/instructors/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/instructors/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ bio: 'Updated by owner A' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.bio).toBe('Updated by owner A');
  });

  // ---------------------------------------------------------------------------
  // The RoleGrant-gate piece, novel to this module: a profile can only be created
  // for a userId that already holds an active INSTRUCTOR RoleGrant matching scope.
  // ---------------------------------------------------------------------------

  it('CANNOT create an Instructor profile for a user with no INSTRUCTOR RoleGrant at all', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(ungranted.id));
    expect(res.status).toBe(400);
  });

  it('a School-scoped INSTRUCTOR grant CAN back a Branch-specific profile', async () => {
    // Uses grantedSchoolWide2, NOT grantedSchoolWide — grantedSchoolWide already got a
    // profile in the "CAN create, read, update" test above, and the (schoolId, userId)
    // uniqueness constraint (exercised separately below) would otherwise turn this
    // into an unintended duplicate-creation attempt rather than a test of the
    // branch-matching rule this case is actually about.
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(grantedSchoolWide2.id, { branchId: branchA1.id, bio: 'Floating instructor, branch profile' }));
    expect(res.status).toBe(201);
    instructorIds.push(res.body.id);
  });

  it('a Branch-scoped INSTRUCTOR grant CANNOT back a DIFFERENT Branch\'s profile', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(grantedBranchA2.id, { branchId: branchA1.id }));
    expect(res.status).toBe(400);
  });

  it('CANNOT create a second profile for the same (schoolId, userId) — 409, not a silent duplicate', async () => {
    // grantedSchoolWide already has a School-wide profile from an earlier test in this
    // suite — deliberately reusing that setup rather than creating a fresh user, since
    // the rule under test IS the per-(schoolId, userId) uniqueness.
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(grantedSchoolWide.id, { bio: 'Attempted duplicate' }));
    expect(res.status).toBe(409);
  });

  // ---------------------------------------------------------------------------
  // instructor_tenant_isolation's three-way branch OR.
  // ---------------------------------------------------------------------------

  it('a Branch-scoped grant sees its own Branch\'s profiles and School-wide profiles, never another Branch\'s', async () => {
    // Self-contained fixture data (inserted directly, bypassing the service layer —
    // same superuser-bypass convention classes.e2e-spec.ts uses for its own equivalent
    // test) rather than relying on profiles created by earlier tests in this suite,
    // so this test's own assertions hold regardless of what ran before it.
    const branchWideOwner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-branch-or-wide-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'BranchOr',
        surname: 'SchoolWide',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    const branchA1Owner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-branch-or-a1-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'BranchOr',
        surname: 'A1',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    const branchA2Owner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-branch-or-a2-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'BranchOr',
        surname: 'A2',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    const schoolWideProfile = await superuser.instructor.create({
      data: { id: randomUUID(), schoolId: schoolA.id, userId: branchWideOwner.id, branchId: null },
    });
    const branchA1Profile = await superuser.instructor.create({
      data: { id: randomUUID(), schoolId: schoolA.id, userId: branchA1Owner.id, branchId: branchA1.id },
    });
    const branchA2Profile = await superuser.instructor.create({
      data: { id: randomUUID(), schoolId: schoolA.id, userId: branchA2Owner.id, branchId: branchA2.id },
    });
    instructorIds.push(schoolWideProfile.id, branchA1Profile.id, branchA2Profile.id);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenBranchStaffA1}`);
    expect(listRes.status).toBe(200);
    const ids = listRes.body.items.map((row: { id: string }) => row.id);
    expect(ids).toContain(schoolWideProfile.id);
    expect(ids).toContain(branchA1Profile.id);
    expect(ids).not.toContain(branchA2Profile.id);
  });

  // ---------------------------------------------------------------------------
  // Regression coverage, same class of bug Phase 4's code review caught for
  // ClassesService.update() — applied here from the start, verified here from the
  // start too.
  // ---------------------------------------------------------------------------

  it('PATCHing branchId alone re-validates the profile\'s own userId against the new Branch', async () => {
    // Valid at creation: grantedBranchA2 is scoped to branchA2, and the profile starts
    // out scoped to branchA2 too.
    const created = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(grantedBranchA2.id, { branchId: branchA2.id, bio: 'Branch-only patch target' }));
    expect(created.status).toBe(201);
    instructorIds.push(created.body.id);

    // A branch-only PATCH must still re-check the profile's own userId against the
    // new Branch, not silently carry the old validity forward.
    const patched = await request(app.getHttpServer())
      .patch(`/v1/instructors/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ branchId: branchA1.id });
    expect(patched.status).toBe(400);

    const unchanged = await superuser.instructor.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(unchanged.branchId).toBe(branchA2.id); // update was rejected, not partially applied
  });

  it('PATCHing specializations to null is rejected with 400, not a 500 NOT NULL violation', async () => {
    // specializations is NOT NULL on the Instructor model — @IsOptional() alone
    // doesn't reject an explicit null, only an omitted field. This must be caught at
    // the service layer with a clean 400, not fall through to Postgres as a literal
    // null and surface as an unhandled 500.
    const created = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(grantedSchoolWide3.id, { specializations: ['BJJ'] }));
    expect(created.status).toBe(201);
    instructorIds.push(created.body.id);

    const patched = await request(app.getHttpServer())
      .patch(`/v1/instructors/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ specializations: null });
    expect(patched.status).toBe(400);

    const unchanged = await superuser.instructor.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(unchanged.specializations).toEqual(['BJJ']); // update was rejected, not partially applied
  });

  // ---------------------------------------------------------------------------
  // GET .../instructors/eligible-users (Decision 111) — the candidate pool for
  // InstructorFormModal's picker: Users holding an active INSTRUCTOR RoleGrant at
  // this School, i.e. exactly who assertValidInstructor would accept for create().
  // ---------------------------------------------------------------------------

  it('School Owner sees every active INSTRUCTOR RoleGrant holder at their School, and no one else', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/instructors/eligible-users`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((u: { id: string }) => u.id);
    // Every School-scoped or Branch-scoped INSTRUCTOR grant holder fixtured in
    // beforeAll — regardless of whether a profile was ever created for them.
    expect(ids).toContain(grantedSchoolWide.id);
    expect(ids).toContain(grantedSchoolWide2.id);
    expect(ids).toContain(grantedSchoolWide3.id);
    expect(ids).toContain(grantedBranchA2.id);
    // `ungranted` has no RoleGrant at all; the caller (a SCHOOL_OWNER_MANAGER, not an
    // INSTRUCTOR) shouldn't show up as their own candidate either.
    expect(ids).not.toContain(ungranted.id);
    expect(ids).not.toContain(ownerA.id);

    const match = res.body.items.find((u: { id: string }) => u.id === grantedSchoolWide.id);
    expect(match.firstName).toBe('granted-school-wide');
    expect(match.surname).toBe('Tenant');
    expect(match.email).toBe(grantedSchoolWide.email);
  });

  it('excludes a User whose INSTRUCTOR RoleGrant has been revoked', async () => {
    const revokedUser = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-revoked-instructor-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Revoked',
        surname: 'Instructor',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    await superuser.roleGrant.create({
      data: {
        id: randomUUID(),
        role: 'INSTRUCTOR',
        userId: revokedUser.id,
        schoolId: schoolA.id,
        revokedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/instructors/eligible-users`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(revokedUser.id);
    // The still-active grants from the previous test remain visible — proves this is
    // a real revokedAt filter, not an empty/broken query.
    expect(ids).toContain(grantedSchoolWide.id);
  });

  it('Branch Staff cannot list eligible Instructor candidates (School Owner only, narrower than the roster read)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/instructors/eligible-users`)
      .set('Authorization', `Bearer ${tokenBranchStaffA1}`);
    expect(res.status).toBe(403);
  });

  it('cannot list another tenant\'s eligible Instructor candidates', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/instructors/eligible-users`)
      .set('Authorization', `Bearer ${tokenOwnerB}`);
    expect(res.status).toBe(404);
  });
});
