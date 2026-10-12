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
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

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
  // Decision 1/230 — captured emails for "Add Manually"'s temp-passcode send,
  // same overrideProvider(NotificationDeliveryService) pattern
  // coach-invites.e2e-spec.ts already established.
  const sentEmails: Array<{ to: string; subject: string; body: string }> = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({
        sendEmail: async (to: string, subject: string, body: string) => {
          if (!subject.startsWith('Your ULTM8 instructor account is ready')) return;
          sentEmails.push({ to, subject, body });
        },
      })
      .compile();
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
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
    // PATCH's response is InstructorResponseDto too — firstName/surname/email/status
    // must be resolved onto it the same way GET already is, not just silently absent.
    expect(patchRes.body.firstName).toBeTruthy();
    expect(patchRes.body.surname).toBeTruthy();
    expect(patchRes.body.email).toBeTruthy();
    expect(patchRes.body.status).toBe('ACTIVE');
  });

  // ---------------------------------------------------------------------------
  // GET .../instructors (the roster list) resolves a real name per profile — and
  // keeps resolving it even after the profiled User's own RoleGrant is revoked,
  // proving this uses PrismaAuthService (Decision 117's pattern), not a plain
  // RLS-scoped `include` that user_self_or_shared_school could silently break.
  // ---------------------------------------------------------------------------

  it('roster list resolves a real name per profile, and keeps resolving it after the RoleGrant is revoked', async () => {
    const nameUser = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-name-resolution-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'NameResolution',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    const nameGrant = await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: nameUser.id, schoolId: schoolA.id },
    });

    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(nameUser.id));
    expect(createRes.status).toBe(201);
    instructorIds.push(createRes.body.id);

    async function fetchProfile() {
      const res = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/instructors`)
        .set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(res.status).toBe(200);
      return res.body.items.find((i: { id: string }) => i.id === createRes.body.id);
    }

    const before = await fetchProfile();
    expect(before.firstName).toBe('NameResolution');
    expect(before.surname).toBe('Tenant');
    expect(before.email).toBe(nameUser.email);
    // v1.2 backlog: the Active/Revoked pill — resolved from this same RoleGrant,
    // revokedAt: null means ACTIVE.
    expect(before.status).toBe('ACTIVE');

    await superuser.roleGrant.update({ where: { id: nameGrant.id }, data: { revokedAt: new Date() } });

    const after = await fetchProfile();
    expect(after.firstName).toBe('NameResolution');
    expect(after.surname).toBe('Tenant');
    expect(after.email).toBe(nameUser.email);
    // Name/email keep resolving after revocation (PrismaAuthService, not RLS) but the
    // status pill must flip — that's the whole point of showing it.
    expect(after.status).toBe('REVOKED');
  });

  it('GET /instructors/:id resolves firstName/surname/email/status the same way the roster list does', async () => {
    // findOne() previously returned the raw Instructor row with none of these resolved
    // at all, despite InstructorResponseDto declaring firstName/surname required —
    // Instructor Detail was silently relying on the list fetch's own cache for names.
    const detailUser = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-detail-resolution-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'DetailResolution',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: detailUser.id, schoolId: schoolA.id },
    });

    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(profileBody(detailUser.id));
    expect(createRes.status).toBe(201);
    instructorIds.push(createRes.body.id);

    const detailRes = await request(app.getHttpServer())
      .get(`/v1/instructors/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.firstName).toBe('DetailResolution');
    expect(detailRes.body.surname).toBe('Tenant');
    expect(detailRes.body.email).toBe(detailUser.email);
    expect(detailRes.body.status).toBe('ACTIVE');
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
  // GET .../instructors/eligible-users (Decision 115) — the candidate pool for
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
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
  it('specialisations are picked from the School\'s styles when it has any; free text otherwise (Decision 152)', async () => {
    const schoolS = await superuser.school.create({ data: { id: randomUUID(), name: 'Instructors HTTP Styles School' } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolS.id } });
    const tokenOwnerS = signAccessToken(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolS.id, branchId: null }]);
    const bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolS.id, name: 'BJJ' } });
    const judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolS.id, name: 'Judo' } });
    const foreign = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolB.id, name: 'Other BJJ' } });
    const coachUser = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `instructors-http-styles-coach-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Styles',
        surname: 'Coach',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coachUser.id, schoolId: schoolS.id } });
    try {
      const create = (body: Record<string, unknown>) =>
        request(app.getHttpServer()).post(`/v1/schools/${schoolS.id}/instructors`).set('Authorization', `Bearer ${tokenOwnerS}`).send(profileBody(coachUser.id, body));

      expect((await create({ specializations: ['BJJ'] })).status).toBe(400); // free text in a School with styles
      expect((await create({ specializationStyleIds: [foreign.id] })).status).toBe(400); // another School's style
      expect((await create({ specializationStyleIds: [bjj.id, bjj.id] })).status).toBe(400); // listed twice
      expect(await superuser.instructor.count({ where: { schoolId: schoolS.id } })).toBe(0);

      const created = await create({ specializationStyleIds: [bjj.id, judo.id] });
      expect(created.status).toBe(201);
      expect(created.body.specializationStyleIds).toEqual([bjj.id, judo.id]);
      expect(created.body.specializations).toEqual(['BJJ', 'Judo']); // names, for display

      const patch = (body: Record<string, unknown>) =>
        request(app.getHttpServer()).patch(`/v1/instructors/${created.body.id}`).set('Authorization', `Bearer ${tokenOwnerS}`).send(body);
      const kept = await patch({ bio: 'Updated' });
      expect(kept.status).toBe(200);
      expect(kept.body.specializationStyleIds).toEqual([bjj.id, judo.id]);
      expect((await patch({ specializationStyleIds: null })).status).toBe(400);
      const narrowed = await patch({ specializationStyleIds: [judo.id] });
      expect(narrowed.status).toBe(200);
      expect([narrowed.body.specializationStyleIds, narrowed.body.specializations]).toEqual([[judo.id], ['Judo']]);
      const cleared = await patch({ specializationStyleIds: [] });
      expect([cleared.body.specializationStyleIds, cleared.body.specializations]).toEqual([[], []]);

      // School A has no styles: free text as before, style ids refused.
      const noStyles = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/instructors`)
        .set('Authorization', `Bearer ${tokenOwnerA}`)
        .send(profileBody(coachUser.id, { specializationStyleIds: [bjj.id] }));
      expect(noStyles.status).toBe(400);
    } finally {
      await superuser.instructor.deleteMany({ where: { schoolId: schoolS.id } });
      await superuser.discipline.deleteMany({ where: { id: { in: [bjj.id, judo.id, foreign.id] } } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: schoolS.id } });
      await superuser.school.delete({ where: { id: schoolS.id } });
    }
  });

  // ---------------------------------------------------------------------------
  // Decision 1/230/237 — Instructor "Add Manually": a real User + RoleGrant +
  // Instructor created immediately from just name+email, a temp passcode
  // emailed, forced change on first login.
  // ---------------------------------------------------------------------------

  function extractTempPasscode(body: string): string {
    const match = body.match(/Temporary passcode: (\d{6})/);
    if (!match) throw new Error(`No temp passcode found in email body: ${body}`);
    return match[1];
  }

  it('creates a real User + RoleGrant + Instructor immediately from just name+email, and emails a temp passcode', async () => {
    const schoolN = await superuser.school.create({ data: { id: randomUUID(), name: 'Instructors HTTP No-Branch School' } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolN.id } });
    const tokenOwnerN = signAccessToken(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolN.id, branchId: null }]);
    const email = `instructors-http-am-${randomUUID()}@example.test`;

    try {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolN.id}/instructors/add-manually`)
        .set('Authorization', `Bearer ${tokenOwnerN}`)
        .send({ firstName: 'Added', surname: 'Manually', email });
      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(true);
      expect(res.body.firstName).toBe('Added');
      expect(res.body.email).toBe(email);
      instructorIds.push(res.body.id);

      const createdUser = await superuser.user.findUniqueOrThrow({ where: { email } });
      expect(createdUser.phone).toBeNull();
      expect(createdUser.dateOfBirth).toBeNull();
      expect(createdUser.mustChangePasscode).toBe(true);

      const grant = await superuser.roleGrant.findFirst({ where: { userId: createdUser.id, schoolId: schoolN.id, role: 'INSTRUCTOR' } });
      expect(grant).not.toBeNull();
      expect(grant!.revokedAt).toBeNull();

      const sentEmail = sentEmails.find((e) => e.to === email);
      expect(sentEmail).toBeDefined();
      expect(() => extractTempPasscode(sentEmail!.body)).not.toThrow();
    } finally {
      await superuser.roleGrant.deleteMany({ where: { schoolId: schoolN.id } });
      await superuser.school.delete({ where: { id: schoolN.id } });
    }
  });

  it('rejects a duplicate email — 409, points at "Invite to Instructor Role" instead', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'Dup', surname: 'Email', email: ownerA.email, branchId: branchA1.id });
    expect(res.status).toBe(409);
  });

  it('non-owner (Branch Staff) cannot use Add Manually — 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors/add-manually`)
      .set('Authorization', `Bearer ${tokenBranchStaffA1}`)
      .send({ firstName: 'No', surname: 'Permission', email: `instructors-http-no-perm-${randomUUID()}@example.test` });
    expect(res.status).toBe(403);
  });

  it('School has branches: add-manually without branchId is rejected — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'No', surname: 'Branch', email: `instructors-http-no-branch-${randomUUID()}@example.test` });
    expect(res.status).toBe(400);
  });

  it('full smoke path: add-manually -> login (must change passcode) -> first-login change -> real session; the old temp passcode then fails', async () => {
    const email = `instructors-http-smoke-${randomUUID()}@example.test`;
    const created = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'Smoke', surname: 'Path', email, branchId: branchA1.id });
    expect(created.status).toBe(201);
    instructorIds.push(created.body.id);

    const sentEmail = sentEmails.find((e) => e.to === email);
    const tempPasscode = extractTempPasscode(sentEmail!.body);

    const firstLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, passcode: tempPasscode });
    expect(firstLogin.status).toBe(201);
    expect(firstLogin.body.mustChangePasscode).toBe(true);
    expect(typeof firstLogin.body.passcodeChangeToken).toBe('string');
    expect(firstLogin.body.accessToken).toBeUndefined();

    // The passcode-change token cannot be used anywhere else.
    const misuse = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/instructors`)
      .set('Authorization', `Bearer ${firstLogin.body.passcodeChangeToken}`);
    expect(misuse.status).toBe(403);

    const change = await request(app.getHttpServer())
      .post('/v1/auth/passcode-change/first-login')
      .set('Authorization', `Bearer ${firstLogin.body.passcodeChangeToken}`)
      .send({ newPasscode: '424242' });
    expect(change.status).toBe(201);
    expect(typeof change.body.accessToken).toBe('string');
    expect(typeof change.body.refreshToken).toBe('string');

    // The old temp passcode no longer works.
    const oldPasscodeLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, passcode: tempPasscode });
    expect(oldPasscodeLogin.status).toBe(401);

    // The new passcode logs in normally — no more mustChangePasscode.
    const secondLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, passcode: '424242' });
    expect(secondLogin.status).toBe(201);
    expect(typeof secondLogin.body.accessToken).toBe('string');
    expect(secondLogin.body.mustChangePasscode).toBeUndefined();
  });

  it('PATCH /instructors/me/profile completes the four deferred fields across every Instructor row the caller holds', async () => {
    const email = `instructors-http-complete-${randomUUID()}@example.test`;
    const created = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/instructors/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'Complete', surname: 'Profile', email, branchId: branchA1.id });
    expect(created.status).toBe(201);
    instructorIds.push(created.body.id);

    const sentEmail = sentEmails.find((e) => e.to === email);
    const tempPasscode = extractTempPasscode(sentEmail!.body);
    const firstLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, passcode: tempPasscode });
    const change = await request(app.getHttpServer())
      .post('/v1/auth/passcode-change/first-login')
      .set('Authorization', `Bearer ${firstLogin.body.passcodeChangeToken}`)
      .send({ newPasscode: '424242' });
    const tokenNewInstructor = change.body.accessToken as string;

    const res = await request(app.getHttpServer())
      .patch('/v1/instructors/me/profile')
      .set('Authorization', `Bearer ${tokenNewInstructor}`)
      .send({ address: '123 Mat Street', activities: ['BJJ', 'Judo'], certificationConsent: true });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].address).toBe('123 Mat Street');
    expect(res.body.items[0].activities).toEqual(['BJJ', 'Judo']);
    expect(typeof res.body.items[0].certificationConsentedAt).toBe('string');
  });

  // ---------------------------------------------------------------------------
  // GET /instructors/:id/classes (v1.2 backend backlog) — the real replacement
  // for the School Portal's client-side filter-the-School's-Classes workaround,
  // with a server-computed enrolled count.
  // ---------------------------------------------------------------------------

  describe('GET /instructors/:id/classes', () => {
    it('returns only this Instructor\'s own Classes, each with a server-computed enrolledCount', async () => {
      const coachUser = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `instructors-http-classes-coach-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: 'ClassesCoach',
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('1990-01-01'),
        },
      });
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coachUser.id, schoolId: schoolA.id } });
      const profile = await superuser.instructor.create({ data: { id: randomUUID(), schoolId: schoolA.id, userId: coachUser.id } });
      instructorIds.push(profile.id);

      const future = new Date(Date.now() + 24 * 3_600_000);
      // instructorId on Class is a User.id FK, matching coachUser.id — not this
      // profile's own `id` (see findClassesForInstructor's own header comment).
      const ownClass = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, instructorId: coachUser.id, title: 'Owned by coach', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });
      // A second Class taught by someone else at the same School — must not show up.
      const otherClass = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, title: 'Someone else\'s class', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });

      // Fixture Bookings for the enrolled-count: two UPCOMING (should count), one
      // CANCELLED (should not), on ownClass; one UPCOMING booking on otherClass
      // (proves the count is per-Class, not School-wide).
      const studentOne = await superuser.user.create({
        data: { id: randomUUID(), email: `instructors-http-classes-s1-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`, firstName: 'S1', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('2000-01-01') },
      });
      const studentTwo = await superuser.user.create({
        data: { id: randomUUID(), email: `instructors-http-classes-s2-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`, firstName: 'S2', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('2000-01-01') },
      });
      const studentThree = await superuser.user.create({
        data: { id: randomUUID(), email: `instructors-http-classes-s3-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`, firstName: 'S3', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('2000-01-01') },
      });
      const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: schoolA.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
      const mkMembership = (studentId: string) =>
        superuser.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: schoolA.id, status: 'ACTIVE', frequency: 'RECURRING' } });
      const m1 = await mkMembership(studentOne.id);
      const m2 = await mkMembership(studentTwo.id);
      const m3 = await mkMembership(studentThree.id);
      await superuser.booking.create({ data: { id: randomUUID(), studentId: studentOne.id, classId: ownClass.id, schoolId: schoolA.id, sourceMembershipId: m1.id, status: 'UPCOMING' } });
      await superuser.booking.create({ data: { id: randomUUID(), studentId: studentTwo.id, classId: ownClass.id, schoolId: schoolA.id, sourceMembershipId: m2.id, status: 'UPCOMING' } });
      await superuser.booking.create({ data: { id: randomUUID(), studentId: studentThree.id, classId: ownClass.id, schoolId: schoolA.id, sourceMembershipId: m3.id, status: 'CANCELLED' } });
      await superuser.booking.create({ data: { id: randomUUID(), studentId: studentThree.id, classId: otherClass.id, schoolId: schoolA.id, sourceMembershipId: m3.id, status: 'UPCOMING' } });

      try {
        const res = await request(app.getHttpServer())
          .get(`/v1/instructors/${profile.id}/classes`)
          .set('Authorization', `Bearer ${tokenOwnerA}`);
        expect(res.status).toBe(200);
        const ids = res.body.items.map((c: { id: string }) => c.id);
        expect(ids).toContain(ownClass.id);
        expect(ids).not.toContain(otherClass.id);
        const row = res.body.items.find((c: { id: string }) => c.id === ownClass.id);
        expect(row.title).toBe('Owned by coach');
        // 2 UPCOMING, the CANCELLED one excluded — same "Full" definition
        // domain-rules §9 confirms.
        expect(row.enrolledCount).toBe(2);
      } finally {
        await superuser.booking.deleteMany({ where: { schoolId: schoolA.id, classId: { in: [ownClass.id, otherClass.id] } } });
        await superuser.membership.deleteMany({ where: { id: { in: [m1.id, m2.id, m3.id] } } });
        await superuser.membershipPlan.delete({ where: { id: plan.id } });
        await superuser.class.deleteMany({ where: { id: { in: [ownClass.id, otherClass.id] } } });
        await superuser.user.deleteMany({ where: { id: { in: [studentOne.id, studentTwo.id, studentThree.id] } } });
      }
    });

    it('cannot read another tenant\'s Instructor Classes', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/instructors/${randomUUID()}/classes`)
        .set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });
  });
});
