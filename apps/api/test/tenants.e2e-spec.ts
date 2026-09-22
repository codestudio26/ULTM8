/**
 * HTTP-level cross-tenant isolation gate for TenantsModule (Phase 2 ground rule: "add
 * HTTP-level integration tests too, not just rely on the existing DB-level RLS test —
 * prove that an authenticated request from School A's owner actually gets
 * rejected/empty when targeting School B's Branch via the API itself").
 *
 * Complements, does not replace, test/tenant-isolation.rls.spec.ts (which tests the RLS
 * policies directly). This suite boots the real Nest app (AppModule, with the same
 * global pipe/filter/prefix main.ts applies) and drives it over HTTP with supertest,
 * signing access tokens directly with JwtService rather than going through
 * POST /auth/register + OTP verification, since Twilio isn't configured in the CI job
 * that runs this gate — the token shape matches exactly what AuthService.login() would
 * issue (see JwtPayload/RoleGrantClaim).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a warning
 * if any are unset, same convention as tenant-isolation.rls.spec.ts.
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
    '[tenants.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI (see .github/workflows/ci.yml); a local skip is not a substitute.',
  );
}

describeIfDb('TenantsModule — HTTP-level cross-tenant isolation', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let verifiedInvitee: { id: string; email: string; phone: string };
  let tokenOwnerA: string;
  let tokenOwnerB: string;

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mirrors main.ts's bootstrap exactly, so this exercises the real request pipeline.
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'HTTP RLS School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'HTTP RLS School B' } });
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'HTTP Branch A1' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolB.id, name: 'HTTP Branch B1' } });

    const mkUser = (label: string, verified: boolean) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `tenants-http-${label}-${randomUUID()}@example.test`,
          // A "555" area code (the earlier format here) is a real, deterministic
          // rejection under class-validator's @IsPhoneNumber (libphonenumber-js
          // treats it as reserved/fictional, not just an arbitrary placeholder) —
          // fine for a fixture only ever written straight to Postgres, but this
          // suite's own invite-candidate lookup test sends a fixture phone through
          // that exact validated DTO field, so it needs a number that actually
          // validates. 650 is a real NANP area code; the exchange digit is forced
          // into 2-9 since NANP exchange codes can't start with 0/1 (verified:
          // 0 failures across 20,000 samples, vs. the naive random range's ~11%).
          phone: `+1650${2 + Math.floor(Math.random() * 8)}${Math.floor(10 + Math.random() * 90)}${Math.floor(1000 + Math.random() * 9000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: verified ? new Date() : null,
        },
      });

    ownerA = await mkUser('owner-a', true);
    ownerB = await mkUser('owner-b', true);
    verifiedInvitee = await mkUser('invitee', true);

    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id },
    });

    tokenOwnerA = signAccessToken(ownerA, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null },
    ]);
    tokenOwnerB = signAccessToken(ownerB, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolB.id, branchId: null },
    ]);
  });

  afterAll(async () => {
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
    await superuser.user.deleteMany({ where: { id: { in: [ownerA.id, ownerB.id, verifiedInvitee.id] } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Negative: School A's owner reaching for School B's resources over HTTP
  // ---------------------------------------------------------------------------

  it('cannot GET another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolB.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('cannot PATCH another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/schools/${schoolB.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'HACKED BY TENANT A' });
    expect([403, 404]).toContain(res.status);
    const unchanged = await superuser.school.findUniqueOrThrow({ where: { id: schoolB.id } });
    expect(unchanged.name).toBe('HTTP RLS School B');
  });

  it('School list only ever returns the caller\'s own Schools', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/schools')
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(schoolA.id);
    expect(ids).not.toContain(schoolB.id);
  });

  it('cannot GET another tenant\'s Branch', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/branches/${branchB.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
  });

  it('cannot list another tenant\'s Branches via the School-scoped list route', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolB.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
  });

  it('cannot create a Branch under another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Sneaky Branch' });
    expect(res.status).toBe(404);
    const stillOne = await superuser.branch.count({ where: { schoolId: schoolB.id } });
    expect(stillOne).toBe(1); // only the original fixture branch
  });

  it('cannot PATCH another tenant\'s Branch', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/branches/${branchB.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'HACKED BRANCH' });
    expect([403, 404]).toContain(res.status);
    const unchanged = await superuser.branch.findUniqueOrThrow({ where: { id: branchB.id } });
    expect(unchanged.name).toBe('HTTP Branch B1');
  });

  it('cannot grant a role scoped to another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/users/${verifiedInvitee.id}/role-grants`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ role: 'INSTRUCTOR', schoolId: schoolB.id });
    expect(res.status).toBe(403);
  });

  it('cannot see or revoke a RoleGrant scoped to another tenant\'s School', async () => {
    const grantRes = await request(app.getHttpServer())
      .post(`/v1/users/${verifiedInvitee.id}/role-grants`)
      .set('Authorization', `Bearer ${tokenOwnerB}`)
      .send({ role: 'INSTRUCTOR', schoolId: schoolB.id });
    expect(grantRes.status).toBe(201);
    const grantId = grantRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get(`/v1/users/${verifiedInvitee.id}/role-grants`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.map((g: { id: string }) => g.id)).not.toContain(grantId);

    const revokeRes = await request(app.getHttpServer())
      .delete(`/v1/users/${verifiedInvitee.id}/role-grants/${grantId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(revokeRes.status).toBe(404);

    const stillActive = await superuser.roleGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(stillActive.revokedAt).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Positive controls — proves the negatives above are real isolation, not every
  // request failing regardless of tenant (e.g. a broken route or a bug returning 404
  // unconditionally).
  // ---------------------------------------------------------------------------

  it('CAN read and update its own School', async () => {
    const getRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/schools/${schoolA.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ description: 'Updated by owner A' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.description).toBe('Updated by owner A');
  });

  it('CAN create, grant, and revoke within its own School', async () => {
    const branchRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Legit Branch A2' });
    expect(branchRes.status).toBe(201);

    const grantRes = await request(app.getHttpServer())
      .post(`/v1/users/${verifiedInvitee.id}/role-grants`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ role: 'BRANCH_STAFF', schoolId: schoolA.id, branchId: branchRes.body.id });
    expect(grantRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/users/${verifiedInvitee.id}/role-grants`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(listRes.status).toBe(200);
    const listedGrant = listRes.body.items.find((g: { id: string }) => g.id === grantRes.body.id);
    expect(listedGrant.userFirstName).toBe('invitee');
    expect(listedGrant.userSurname).toBe('Tenant');

    const revokeRes = await request(app.getHttpServer())
      .delete(`/v1/users/${verifiedInvitee.id}/role-grants/${grantRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(revokeRes.status).toBe(200);

    const revoked = await superuser.roleGrant.findUniqueOrThrow({ where: { id: grantRes.body.id } });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('findAllForUser resolves the target name even when every one of their RoleGrants at this School is revoked (Decision 113 regression)', async () => {
    // At this point verifiedInvitee holds no ACTIVE RoleGrant anywhere at schoolA —
    // the one created and revoked in the test above. Before Decision 113's fix, the
    // name join was a Prisma `include` on RoleGrant.user, which relied on
    // user_self_or_shared_school RLS: invisible once the target holds zero active
    // RoleGrants overlapping the caller's own School, even though the caller
    // (a real SCHOOL_OWNER_MANAGER at schoolA) remains fully authorized to see the
    // now-revoked RoleGrant row itself (rolegrant_school_manager_scope doesn't
    // depend on the target row's own revokedAt status at all).
    const listRes = await request(app.getHttpServer())
      .get(`/v1/users/${verifiedInvitee.id}/role-grants`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(listRes.status).toBe(200);
    const revokedRow = listRes.body.items.find((g: { schoolId: string | null }) => g.schoolId === schoolA.id);
    expect(revokedRow).toBeDefined();
    expect(revokedRow.revokedAt).not.toBeNull();
    expect(revokedRow.userFirstName).toBe('invitee');
    expect(revokedRow.userSurname).toBe('Tenant');
  });

  // ---------------------------------------------------------------------------
  // GET .../role-grants/invite-candidate (Decision 112) — exact email/phone match
  // only, ahead of the invite form actually firing create(). verifiedInvitee has no
  // RoleGrant at schoolA at this point in the suite (any it held were revoked above),
  // proving this lookup does NOT depend on an existing shared grant the way
  // fetchUserRoleGrants/findAllForUser does.
  // ---------------------------------------------------------------------------

  it('finds an invite candidate by exact email match', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/role-grants/invite-candidate`)
      .query({ email: verifiedInvitee.email })
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      found: true,
      id: verifiedInvitee.id,
      firstName: 'invitee',
      surname: 'Tenant',
    });
  });

  it('finds an invite candidate by exact phone match', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/role-grants/invite-candidate`)
      .query({ phone: verifiedInvitee.phone })
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.id).toBe(verifiedInvitee.id);
  });

  it('returns found:false for an email/phone with no matching account — never a 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/role-grants/invite-candidate`)
      .query({ email: `nobody-${randomUUID()}@example.test` })
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false, id: null, firstName: null, surname: null });
  });

  it('invite candidate lookup requires email or phone', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/role-grants/invite-candidate`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(400);
  });

  it('cannot look up an invite candidate at another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/role-grants/invite-candidate`)
      .query({ email: verifiedInvitee.email })
      .set('Authorization', `Bearer ${tokenOwnerB}`);
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // GET /schools/{id}/students — the Student roster (SchoolsService.
  // findAllStudentsForSchool). Staff-gated broadly, unlike the Owner-only
  // eligible-users endpoint Instructors has — any Staff member should be able
  // to see who's enrolled.
  // ---------------------------------------------------------------------------

  it('the Student roster lists everyone with an active STUDENT RoleGrant, and is Staff-only', async () => {
    const studentUser = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tenants-http-roster-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'roster-student',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    const studentToken = signAccessToken(studentUser, []);
    const joinRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/join`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send();
    expect(joinRes.status).toBe(201);

    const rosterRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/students`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(rosterRes.status).toBe(200);
    const row = rosterRes.body.items.find((s: { id: string }) => s.id === studentUser.id);
    expect(row).toBeDefined();
    expect(row.firstName).toBe('roster-student');
    expect(row.surname).toBe('Tenant');
    expect(row.email).toBe(studentUser.email);
    expect(row.enrolledAt).toBeDefined();

    // The Student themselves is not School Staff (Owner/Manager, Branch Staff,
    // or Instructor) — cannot read the roster.
    const asStudentRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/students`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(asStudentRes.status).toBe(403);
  });

  it('cannot read another tenant\'s Student roster', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/students`)
      .set('Authorization', `Bearer ${tokenOwnerB}`);
    expect(res.status).toBe(404);
  });

  it('self-service School creation grants the creator SCHOOL_OWNER_MANAGER atomically', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/schools')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Self-Service School' });
    expect(createRes.status).toBe(201);

    const grant = await superuser.roleGrant.findFirst({
      where: { userId: ownerA.id, schoolId: createRes.body.id, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
    });
    expect(grant).not.toBeNull();

    // SchoolsService.create() re-mints the caller's own access token and returns it
    // (ultm8-nestjs-module §7's narrow, approved exception — commit 6a5eb98) so the
    // frontend can swap it in immediately instead of forcing a log-out/back-in. Assert
    // it's actually present, and — the real proof the fix works, not just that a
    // string came back — decode it (jwt.decode(), no signature check needed here,
    // same JwtService instance already used to sign fixtures above) and confirm its
    // claims actually carry the new SCHOOL_OWNER_MANAGER grant for this School.
    expect(createRes.body.accessToken).toEqual(expect.any(String));
    const decoded = jwt.decode(createRes.body.accessToken) as { sub: string; grants: Array<Record<string, unknown>> };
    expect(decoded.sub).toBe(ownerA.id);
    expect(decoded.grants).toContainEqual(
      expect.objectContaining({ role: 'SCHOOL_OWNER_MANAGER', schoolId: createRes.body.id }),
    );

    await superuser.roleGrant.deleteMany({ where: { schoolId: createRes.body.id } });
    await superuser.school.delete({ where: { id: createRes.body.id } });
  });

  // ---------------------------------------------------------------------------
  // Self-service Student enrollment (Decision 96) — the fix for the gap Phase
  // 15's own review surfaced: no path anywhere previously let a real caller
  // become a Student at a School at all.
  // ---------------------------------------------------------------------------

  it('a caller with ZERO grant anywhere CAN self-service join a School as a Student, and gets a fresh access token reflecting it', async () => {
    // A genuinely fresh User, created here rather than reusing
    // verifiedInvitee — found on review that verifiedInvitee already holds an
    // active INSTRUCTOR grant at schoolB by this point in the suite (from the
    // earlier "cannot see or revoke a RoleGrant..." test above, which
    // deliberately never revokes it), so it would NOT actually exercise the
    // "caller with zero relationship to the School, whose own ultm8_app
    // context can't see it" path this test exists to prove — it would still
    // pass even if join()'s existence check were wrongly reverted to the
    // caller's own tenant context, since verifiedInvitee's own context CAN
    // already see schoolB via that pre-existing grant.
    const freshCaller = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tenants-http-fresh-joiner-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Fresh',
        surname: 'Joiner',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    const tokenFreshCaller = signAccessToken(freshCaller, []);

    const joinRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/join`)
      .set('Authorization', `Bearer ${tokenFreshCaller}`)
      .send();
    expect(joinRes.status).toBe(201);
    expect(joinRes.body.role).toBe('STUDENT');
    expect(joinRes.body.schoolId).toBe(schoolB.id);
    expect(joinRes.body.branchId).toBeNull();

    const grant = await superuser.roleGrant.findFirst({
      where: { userId: freshCaller.id, schoolId: schoolB.id, role: 'STUDENT', revokedAt: null },
    });
    expect(grant).not.toBeNull();

    // Same re-mint-and-return pattern as self-service School creation above —
    // decode the returned token and confirm it actually carries the new grant,
    // not just that a string came back.
    expect(joinRes.body.accessToken).toEqual(expect.any(String));
    const decoded = jwt.decode(joinRes.body.accessToken) as { sub: string; grants: Array<Record<string, unknown>> };
    expect(decoded.sub).toBe(freshCaller.id);
    expect(decoded.grants).toContainEqual(expect.objectContaining({ role: 'STUDENT', schoolId: schoolB.id }));

    // Joining a School the caller already holds an active Student grant at is
    // a conflict (enforced by the RoleGrant_one_active_student_per_school
    // partial unique index, not a separate check-then-insert query), not a
    // silent no-op or a second grant.
    const secondJoinRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/join`)
      .set('Authorization', `Bearer ${tokenFreshCaller}`)
      .send();
    expect(secondJoinRes.status).toBe(409);

    await superuser.roleGrant.deleteMany({ where: { userId: freshCaller.id } });
    await superuser.user.delete({ where: { id: freshCaller.id } });
  });

  it('joining a School that does not exist is a 404 — school_exists() can see every real School regardless of the caller\'s own grants', async () => {
    const tokenInvitee = signAccessToken(verifiedInvitee, []);
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${randomUUID()}/join`)
      .set('Authorization', `Bearer ${tokenInvitee}`)
      .send();
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Guardian-on-behalf-of enrollment (Phase 38) — closes the exact gap
  // Decision 96's own "What this does NOT resolve" section named.
  // ---------------------------------------------------------------------------

  it('a Guardian CAN enroll a linked minor at a School — no access token comes back, and the grant is issued by the Guardian', async () => {
    const guardian = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tenants-http-guardian-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Fresh',
        surname: 'Guardian',
        passcodeHash: 'x',
        dateOfBirth: new Date('1985-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    const minor = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tenants-http-minor-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Fresh',
        surname: 'Minor',
        passcodeHash: 'x',
        dateOfBirth: new Date('2015-01-01'),
        // Deliberately no phoneVerifiedAt — same permanently-blocked-login
        // state GuardiansService.createMinor() itself sets, since that's the
        // whole reason this endpoint's response has no accessToken to give.
      },
    });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: minor.id } });
    const tokenGuardian = signAccessToken(guardian, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);

    try {
      const joinRes = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolB.id}/join`)
        .set('Authorization', `Bearer ${tokenGuardian}`)
        .send({ studentId: minor.id });
      expect(joinRes.status).toBe(201);
      expect(joinRes.body.role).toBe('STUDENT');
      expect(joinRes.body.userId).toBe(minor.id);
      expect(joinRes.body.schoolId).toBe(schoolB.id);
      expect(joinRes.body.accessToken).toBeUndefined();

      const grant = await superuser.roleGrant.findFirst({
        where: { userId: minor.id, schoolId: schoolB.id, role: 'STUDENT', revokedAt: null },
      });
      expect(grant).not.toBeNull();
      expect(grant!.grantedById).toBe(guardian.id);

      // Same idempotency guarantee as the ordinary self-join path, against the
      // same partial unique index — proven independently for the Guardian
      // path, not assumed to carry over.
      const secondJoinRes = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolB.id}/join`)
        .set('Authorization', `Bearer ${tokenGuardian}`)
        .send({ studentId: minor.id });
      expect(secondJoinRes.status).toBe(409);
    } finally {
      await superuser.roleGrant.deleteMany({ where: { userId: minor.id } });
      await superuser.guardianLink.deleteMany({ where: { guardianId: guardian.id } });
      await superuser.user.deleteMany({ where: { id: { in: [guardian.id, minor.id] } } });
    }
  });

  it('a caller with NO active GuardianLink to the named Student is rejected — 403, not a silent no-op', async () => {
    const notAGuardian = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tenants-http-not-a-guardian-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Not',
        surname: 'AGuardian',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    const tokenNotAGuardian = signAccessToken(notAGuardian, []);

    try {
      // verifiedInvitee stands in for "some other real User" — notAGuardian
      // holds no GuardianLink to them at all.
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolB.id}/join`)
        .set('Authorization', `Bearer ${tokenNotAGuardian}`)
        .send({ studentId: verifiedInvitee.id });
      expect(res.status).toBe(403);
    } finally {
      await superuser.user.delete({ where: { id: notAGuardian.id } });
    }
  });

  // ---------------------------------------------------------------------------
  // FranchisesModule (Phase 16) — self-service creation mirrors School's own
  // Decision-79 pattern exactly; cross-tenant isolation mirrors School's own tests
  // above, against the same franchise_tenant_isolation RLS shape.
  // ---------------------------------------------------------------------------

  it('self-service Franchise creation grants the creator FRANCHISE_OWNER atomically', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Self-Service Franchise' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.feeModel).toBe('FLAT'); // schema default, never sent

    const grant = await superuser.roleGrant.findFirst({
      where: { userId: ownerA.id, franchiseId: createRes.body.id, role: 'FRANCHISE_OWNER', revokedAt: null },
    });
    expect(grant).not.toBeNull();

    // Same re-mint-and-return pattern as self-service School creation — decode the
    // returned token and confirm it actually carries the new grant.
    expect(createRes.body.accessToken).toEqual(expect.any(String));
    const decoded = jwt.decode(createRes.body.accessToken) as { sub: string; grants: Array<Record<string, unknown>> };
    expect(decoded.sub).toBe(ownerA.id);
    expect(decoded.grants).toContainEqual(
      expect.objectContaining({ role: 'FRANCHISE_OWNER', franchiseId: createRes.body.id }),
    );

    await superuser.roleGrant.deleteMany({ where: { franchiseId: createRes.body.id } });
    await superuser.franchise.delete({ where: { id: createRes.body.id } });
  });

  it('cannot GET or PATCH another tenant\'s Franchise, but CAN its own', async () => {
    const createFranchiseA = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Isolation Franchise A' });
    const createFranchiseB = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerB}`)
      .send({ name: 'Isolation Franchise B' });
    expect(createFranchiseA.status).toBe(201);
    expect(createFranchiseB.status).toBe(201);
    const franchiseAId = createFranchiseA.body.id;
    const franchiseBId = createFranchiseB.body.id;

    // Negative — owner A reaching for franchise B.
    const getRes = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchiseBId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseBId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'HACKED BY TENANT A' });
    expect([403, 404]).toContain(patchRes.status);
    const unchanged = await superuser.franchise.findUniqueOrThrow({ where: { id: franchiseBId } });
    expect(unchanged.name).toBe('Isolation Franchise B');

    const listRes = await request(app.getHttpServer())
      .get('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(listRes.status).toBe(200);
    const ids = listRes.body.items.map((f: { id: string }) => f.id);
    expect(ids).toContain(franchiseAId);
    expect(ids).not.toContain(franchiseBId);

    // Positive control — owner A on its own franchise A.
    const ownGetRes = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchiseAId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(ownGetRes.status).toBe(200);

    const ownPatchRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseAId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ description: 'Updated by owner A' });
    expect(ownPatchRes.status).toBe(200);
    expect(ownPatchRes.body.description).toBe('Updated by owner A');

    await superuser.roleGrant.deleteMany({ where: { franchiseId: { in: [franchiseAId, franchiseBId] } } });
    await superuser.franchise.deleteMany({ where: { id: { in: [franchiseAId, franchiseBId] } } });
  });

  it('PATCH /franchises/:id with explicit null clears an optional String field; omitting it leaves it unchanged (UpdateFranchiseDto, Phase 23)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Nullable-Field Franchise', mobileNumber: '+15551234567', description: 'Original description' });
    expect(createRes.status).toBe(201);
    const franchiseId = createRes.body.id;
    expect(createRes.body.mobileNumber).toBe('+15551234567');
    expect(createRes.body.description).toBe('Original description');

    // Omitting a field leaves it unchanged — proves this isn't accidentally
    // clearing everything not present in the body.
    const omitRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ description: 'Updated description, mobileNumber untouched' });
    expect(omitRes.status).toBe(200);
    expect(omitRes.body.mobileNumber).toBe('+15551234567');
    expect(omitRes.body.description).toBe('Updated description, mobileNumber untouched');

    // Explicit null clears — the specific gap UpdateFranchiseDto's own
    // NULLABLE_ON_UPDATE widening fixes (a bare PartialType(CreateFranchiseDto)
    // would 400 this at validation, or silently no-op it at the Prisma layer
    // if validation let it through untyped).
    const clearRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ mobileNumber: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.mobileNumber).toBeNull();
    expect(clearRes.body.description).toBe('Updated description, mobileNumber untouched');

    await superuser.roleGrant.deleteMany({ where: { franchiseId } });
    await superuser.franchise.delete({ where: { id: franchiseId } });
  });

  it('rejects an explicit flatFeeAmount/perHeadcountRate: null on PATCH /franchises/:id — 400, not a silent rate-clear (FOUND ON REVIEW, Phase 23)', async () => {
    // These two fields are deliberately NOT widened to nullable in
    // UpdateFranchiseDto (see that DTO's own header comment) — but
    // class-validator's @IsOptional() treats an explicit null exactly like an
    // omitted field, so nothing at the validation layer alone stopped a raw
    // client from sending null and silently clearing a configured rate.
    // FranchisesService.update() now rejects this explicitly — mirrors
    // MembershipsService.updatePlan()'s identical classesIncluded precedent
    // (see memberships.e2e-spec.ts's own 'rejects an explicit
    // classesIncluded: null' test).
    const createRes2 = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Reject-Null-Rate Franchise', flatFeeAmount: 5000 });
    expect(createRes2.status).toBe(201);
    const franchiseId2 = createRes2.body.id;

    const flatRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId2}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ flatFeeAmount: null });
    expect(flatRes.status).toBe(400);

    const perHeadcountRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId2}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ perHeadcountRate: null });
    expect(perHeadcountRes.status).toBe(400);

    const unchanged = await superuser.franchise.findUniqueOrThrow({ where: { id: franchiseId2 } });
    expect(unchanged.flatFeeAmount).toBe(5000);

    await superuser.roleGrant.deleteMany({ where: { franchiseId: franchiseId2 } });
    await superuser.franchise.delete({ where: { id: franchiseId2 } });
  });

  it('GET /franchises/:id/schools returns only that Franchise\'s own Schools, and is Owner-only', async () => {
    const createFranchise = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Roster Franchise' });
    expect(createFranchise.status).toBe(201);
    const franchiseId = createFranchise.body.id;

    // Directly seeded (superuser), same convention every other cross-boundary
    // fixture in this suite already uses — kept as a direct seed here rather than
    // switched to POST /schools/:id/join-franchise (Phase 16b-i, added later this
    // session) purely for test independence from that flow; see the dedicated
    // "School Owner can self-service-join..." tests below for that path exercised
    // directly.
    const memberSchool = await superuser.school.create({
      data: { id: randomUUID(), name: 'Franchise Member School', franchiseId },
    });

    const rosterRes = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchiseId}/schools`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(rosterRes.status).toBe(200);
    expect(rosterRes.body.items.map((s: { id: string }) => s.id)).toEqual([memberSchool.id]);
    expect(rosterRes.body.nextCursor).toBeNull();

    // Negative — a caller with no relationship to this Franchise at all
    // (school_tenant_isolation-style RLS blindness: schoolId-scoped RoleGrants
    // never grant visibility into a franchiseId-scoped row) gets the same 404
    // FranchisesService.findOne() already gives for any invisible Franchise.
    const rosterAsOwnerB = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchiseId}/schools`)
      .set('Authorization', `Bearer ${tokenOwnerB}`);
    expect(rosterAsOwnerB.status).toBe(404);

    await superuser.school.delete({ where: { id: memberSchool.id } });
    await superuser.roleGrant.deleteMany({ where: { franchiseId } });
    await superuser.franchise.delete({ where: { id: franchiseId } });
  });

  // ---------------------------------------------------------------------------
  // School -> Franchise linking (Phase 16b-i, Decision 98) — narrow, self-service,
  // ONE-WAY-ONLY join. Fixtures created fresh via HTTP self-service per test, not
  // coupled to the shared schoolA/schoolB fixtures other tests above depend on.
  // ---------------------------------------------------------------------------

  it('School Owner can self-service-join their School into a Franchise, one-way only', async () => {
    const createSchoolRes = await request(app.getHttpServer())
      .post('/v1/schools')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Join-Franchise Test School' });
    expect(createSchoolRes.status).toBe(201);
    const freshSchoolId = createSchoolRes.body.id;

    const createFranchiseRes = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Join-Franchise Test Franchise' });
    expect(createFranchiseRes.status).toBe(201);
    const franchiseId = createFranchiseRes.body.id;

    const joinRes = await request(app.getHttpServer())
      .post(`/v1/schools/${freshSchoolId}/join-franchise`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ franchiseId });
    expect(joinRes.status).toBe(201);
    expect(joinRes.body.franchiseId).toBe(franchiseId);

    // One-way only — a second join attempt (even naming the same Franchise again)
    // is a conflict, never a silent no-op or a re-link (Decision 98's entire point:
    // this never has to answer the Franchise-reaffiliation question Decision 97
    // deferred, because reaffiliation literally cannot happen through this route).
    const secondJoinRes = await request(app.getHttpServer())
      .post(`/v1/schools/${freshSchoolId}/join-franchise`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ franchiseId });
    expect(secondJoinRes.status).toBe(409);

    await superuser.school.delete({ where: { id: freshSchoolId } });
    await superuser.roleGrant.deleteMany({ where: { franchiseId } });
    await superuser.franchise.delete({ where: { id: franchiseId } });
  });

  it('joining a Franchise that does not exist is a 404 — franchise_exists() can see every real Franchise regardless of the caller\'s own grants', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/join-franchise`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ franchiseId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('only that School\'s own Owner/Manager may join it to a Franchise', async () => {
    const createFranchiseRes = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Unauthorized Join Test Franchise' });
    expect(createFranchiseRes.status).toBe(201);
    const franchiseId = createFranchiseRes.body.id;

    // ownerB holds no grant at all on schoolA.
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/join-franchise`)
      .set('Authorization', `Bearer ${tokenOwnerB}`)
      .send({ franchiseId });
    expect(res.status).toBe(403);
    const unchanged = await superuser.school.findUniqueOrThrow({ where: { id: schoolA.id } });
    expect(unchanged.franchiseId).toBeNull();

    await superuser.roleGrant.deleteMany({ where: { franchiseId } });
    await superuser.franchise.delete({ where: { id: franchiseId } });
  });

  // ---------------------------------------------------------------------------
  // Franchise fee-rate fields (Phase 16b-ii, Decision 99) — self-service,
  // Franchise-Owner-set, round-tripped through the existing create/update
  // endpoints (no dedicated endpoint — see create-franchise.dto.ts's own
  // comment).
  // ---------------------------------------------------------------------------

  it('Franchise fee-rate fields round-trip through create and update', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Fee-Rate Test Franchise', feeModel: 'PER_HEADCOUNT', perHeadcountRate: 500 });
    expect(createRes.status).toBe(201);
    expect(createRes.body.perHeadcountRate).toBe(500);
    expect(createRes.body.flatFeeAmount).toBeNull();
    const franchiseId = createRes.body.id;

    const updateRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ flatFeeAmount: 15000 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.flatFeeAmount).toBe(15000);
    // Independently settable regardless of feeModel — updating flatFeeAmount
    // doesn't clear perHeadcountRate or feeModel itself (see schema.prisma's
    // own comment on why both fields stay independently addressable).
    expect(updateRes.body.perHeadcountRate).toBe(500);
    expect(updateRes.body.feeModel).toBe('PER_HEADCOUNT');

    await superuser.roleGrant.deleteMany({ where: { franchiseId } });
    await superuser.franchise.delete({ where: { id: franchiseId } });
  });

  it('rejects a Franchise fee-rate value above the Postgres INTEGER ceiling — 400, not an unhandled DB error', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Overflow Test Franchise', flatFeeAmount: 2147483648 }); // 2^31, one past the signed 32-bit ceiling
    expect(res.status).toBe(400);
  });

  it('rejects changing a Franchise fee-rate once billing has started for a member School — 409, not silent Stripe/ledger divergence', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/franchises')
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ name: 'Rate-Lock Test Franchise', feeModel: 'FLAT', flatFeeAmount: 5000 });
    expect(createRes.status).toBe(201);
    const franchiseId = createRes.body.id;

    // Direct-seeded — no code path exists to actually create a standing Stripe
    // Subscription in this sandbox (no live Stripe credentials, same
    // established gap every other Stripe-calling test in this repo already
    // has); what's under test here is purely FranchisesService.update()'s own
    // guard logic, which only needs the correlator column set, not a real
    // Stripe object behind it.
    const billingSchool = await superuser.school.create({
      data: { id: randomUUID(), name: 'Rate-Lock Test School', franchiseId, stripeFranchiseFeeSubscriptionId: `sub_fixture_${randomUUID()}` },
    });

    const blockedRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ flatFeeAmount: 9999 });
    expect(blockedRes.status).toBe(409);
    const unchanged = await superuser.franchise.findUniqueOrThrow({ where: { id: franchiseId } });
    expect(unchanged.flatFeeAmount).toBe(5000);

    // Re-sending the SAME value (not an actual change) is not blocked — only a
    // genuine change to the currently-billing rate is.
    const noopRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ flatFeeAmount: 5000 });
    expect(noopRes.status).toBe(200);

    // Non-rate fields stay freely editable even once billing has started.
    const profileRes = await request(app.getHttpServer())
      .patch(`/v1/franchises/${franchiseId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ description: 'Updated after billing started' });
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.description).toBe('Updated after billing started');

    await superuser.school.delete({ where: { id: billingSchool.id } });
    await superuser.roleGrant.deleteMany({ where: { franchiseId } });
    await superuser.franchise.delete({ where: { id: franchiseId } });
  });
});
