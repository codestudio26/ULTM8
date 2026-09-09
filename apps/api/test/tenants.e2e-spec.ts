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
  let verifiedInvitee: { id: string; email: string };
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
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
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

    const revokeRes = await request(app.getHttpServer())
      .delete(`/v1/users/${verifiedInvitee.id}/role-grants/${grantRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(revokeRes.status).toBe(200);

    const revoked = await superuser.roleGrant.findUniqueOrThrow({ where: { id: grantRes.body.id } });
    expect(revoked.revokedAt).not.toBeNull();
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
});
