/**
 * HTTP-level gate for PlatformAdminModule Slice 2 (Phase 26) — the first real
 * cross-tenant admin business-logic endpoint, GET /platform-admin/schools/:id, plus
 * the AuditLogEntry write it's required to make (ultm8-tenant-isolation SKILL.md §6:
 * "viewing... another tenant's records" is one of the confirmed audit-logged action
 * categories, not just the write ones).
 *
 * No real Cognito User Pool is reachable here (same as platform-admin-auth.e2e-spec.ts)
 * — this file signs Platform Admin JWTs directly instead of going through the
 * /platform-admin/auth/exchange flow, matching how bookings.e2e-spec.ts and others
 * sign tenant JWTs directly rather than re-exercising the login endpoint in every
 * downstream test file.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET, JWT_ACCESS_SECRET (the last one for the cross-realm
 * rejection test below) — skips with a warning if any are unset, same convention
 * as every other HTTP-level gate in this repo.
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
const DATABASE_URL_PLATFORM_ADMIN = process.env.DATABASE_URL_PLATFORM_ADMIN;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(
  DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_PLATFORM_ADMIN && PLATFORM_ADMIN_JWT_SECRET && JWT_ACCESS_SECRET,
);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[platform-admin-schools.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'DATABASE_URL_PLATFORM_ADMIN / PLATFORM_ADMIN_JWT_SECRET / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('PlatformAdminModule — GET /platform-admin/schools/:id (Slice 2)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  // Authenticated as ultm8_platform_admin itself, NOT the app's own connection —
  // used only to prove the DB-level column GRANT actually enforces the curation
  // contract (see the test below), independent of whatever the application code's
  // own `select` object happens to ask for.
  const platformAdminRoleClient = new PrismaClient({ datasourceUrl: DATABASE_URL_PLATFORM_ADMIN });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  const tenantJwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const adminIds: string[] = [];
  let school: { id: string; franchiseId: string | null };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // A School the seeded AdminUsers below hold NO RoleGrant at all — proves the
    // read is genuinely cross-tenant, not accidentally working because of some
    // incidental RLS visibility.
    school = await superuser.school.create({
      data: { id: randomUUID(), name: 'Platform-Admin HTTP Gate School' },
    });
  });

  afterAll(async () => {
    await superuser.auditLogEntry.deleteMany({ where: { targetId: school.id } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await platformAdminRoleClient.$disconnect();
    await app.close();
  });

  async function seedAdmin(overrides: Partial<{ subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN'; revokedAt: Date | null }> = {}) {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `platform-admin-schools-http-${randomUUID()}@example.test`,
        name: 'HTTP Gate Admin',
        subRole: overrides.subRole ?? 'SUPPORT',
        ssoSubject: `cognito-sub-${randomUUID()}`,
        revokedAt: overrides.revokedAt ?? null,
      },
    });
    adminIds.push(admin.id);
    return admin;
  }

  function tokenFor(admin: { id: string; email: string; subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN' }) {
    return platformAdminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  it('a SUPPORT-tier admin with no RoleGrant anywhere near this School can read it — 200, and it is recorded in the audit log', async () => {
    const admin = await seedAdmin({ subRole: 'SUPPORT' });
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: school.id, name: 'Platform-Admin HTTP Gate School' });
    // This only proves the app-layer PLATFORM_ADMIN_SCHOOL_SELECT never asked for
    // the column — see the DEDICATED test below for the actual DB-level GRANT
    // enforcement, which is a genuinely different, stronger property (FOUND ON
    // REVIEW: an earlier version of this comment conflated the two).
    expect(res.body.stripeFranchiseFeeSubscriptionId).toBeUndefined();

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: admin.id, targetId: school.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'VIEW_SCHOOL', targetType: 'School', schoolId: school.id, franchiseId: null });
  });

  it('a second view of the same School by the same admin creates a SECOND audit row — not deduplicated or merged', async () => {
    // Proves AuditLogService.record() is a plain, repeatable insert, not an
    // upsert keyed on adminUserId+targetId — an audit trail that silently merged
    // repeat views would lose exactly the information ("how many times, when
    // each") it exists to keep (ultm8-tenant-isolation SKILL.md §6).
    const admin = await seedAdmin();
    const first = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(first.status).toBe(200);
    const second = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(second.status).toBe(200);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: admin.id, targetId: school.id } });
    expect(entries).toHaveLength(2);
  });

  it('viewing a Franchise-affiliated School records the audit row\'s own franchiseId, not just schoolId', async () => {
    // The only other School fixture in this file has no franchiseId at all (always
    // null) — this is the sole test exercising the "on which tenant" franchiseId
    // branch of the write, the more common real-world case per the domain model.
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Platform-Admin HTTP Gate Franchise' } });
    const affiliatedSchool = await superuser.school.create({
      data: { id: randomUUID(), name: 'Platform-Admin HTTP Gate Affiliated School', franchiseId: franchise.id },
    });
    const admin = await seedAdmin();

    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${affiliatedSchool.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: admin.id, targetId: affiliatedSchool.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ schoolId: affiliatedSchool.id, franchiseId: franchise.id });

    await superuser.auditLogEntry.deleteMany({ where: { targetId: affiliatedSchool.id } });
    await superuser.school.delete({ where: { id: affiliatedSchool.id } });
    await superuser.franchise.delete({ where: { id: franchise.id } });
  });

  it('the DATABASE column GRANT itself rejects stripeFranchiseFeeSubscriptionId for ultm8_platform_admin — not just the application-layer select', async () => {
    // The genuinely distinct property from the success-path test above: even a
    // query that DELIBERATELY asks for the excluded column, authenticated as
    // ultm8_platform_admin directly (bypassing PLATFORM_ADMIN_SCHOOL_SELECT
    // entirely), must fail at the database layer — proving "the database enforces
    // the curation contract, not just code review" (this design's own stated
    // principle, mirrored from academies_discovery_module) is real, not aspirational.
    await expect(
      platformAdminRoleClient.$queryRaw`SELECT "stripeFranchiseFeeSubscriptionId" FROM "School" WHERE id = ${school.id}`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('no NON-OWNER Postgres role holds UPDATE or DELETE on AuditLogEntry — the immutability guarantee is real, not just claimed in a comment', async () => {
    // Referenced directly by the Phase 26 migration's own corrected comment on its
    // REVOKE statements: PostgreSQL REVOKE isn't "sticky" against a future
    // accidental re-GRANT, so this is the actual, durable check that would catch
    // one — not a hardcoded role list (queries information_schema directly, so it
    // automatically covers any future role too, including the break-glass
    // credential once it exists).
    //
    // FOUND ON CI, on this test's own first real run (fixed here, not silently
    // patched over) — an assumption this test's first draft got wrong:
    // information_schema.role_table_grants DOES list the table OWNER's own full
    // privileges as explicit grant rows (CI's actual failure: `postgres`, the
    // migration-running role and this table's owner, showed up holding both
    // UPDATE and DELETE) — ownership isn't a separate, invisible-to-this-view
    // mechanism the way a first draft assumed. That's expected and correct
    // Postgres behavior, not a gap: the spec's own break-glass design (§4)
    // already establishes that immutability is a NON-owner concern — "the
    // break-glass credential is deliberately provisioned as a non-superuser,
    // non-table-owner Postgres role" specifically so even emergency access can't
    // bypass this table's restrictions, which only makes sense if the owner
    // itself was never expected to be bound by them (a table's owner always has
    // full DDL/DML power in Postgres; that's not a privilege that can be
    // meaningfully revoked without transferring ownership entirely, which is a
    // different, much bigger change this migration doesn't make). Fixed by
    // excluding the actual owner, looked up dynamically via pg_tables rather
    // than hardcoding "postgres" — CI and a real environment may not share that
    // exact role name.
    const grants = await superuser.$queryRaw<Array<{ grantee: string; privilege_type: string }>>`
      SELECT g.grantee, g.privilege_type FROM information_schema.role_table_grants g
      WHERE g.table_name = 'AuditLogEntry'
        AND g.privilege_type IN ('UPDATE', 'DELETE')
        AND g.grantee <> (SELECT tableowner FROM pg_tables WHERE tablename = 'AuditLogEntry')
    `;
    expect(grants).toEqual([]);
  });

  it('a BILLING_PAYMENTS_OPS-tier admin can also read it — no subRole restriction on this read', async () => {
    const admin = await seedAdmin({ subRole: 'BILLING_PAYMENTS_OPS' });
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
  });

  it('a nonexistent School id is a clean 404, not a Prisma error leaking through', async () => {
    const admin = await seedAdmin();
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(404);
  });

  it('a revoked AdminUser is rejected even with a signature/expiry-valid token — 401 (proves the guard\'s own per-request revokedAt check, not just TTL)', async () => {
    const admin = await seedAdmin({ revokedAt: new Date() });
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(401);
  });

  it('a token for an AdminUser id that does not exist at all is rejected — 401', async () => {
    const token = platformAdminJwt.sign({ sub: randomUUID(), email: 'nobody@example.test', subRole: 'SUPPORT' });
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('no token at all is rejected — 401', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/platform-admin/schools/${school.id}`);
    expect(res.status).toBe(401);
  });

  it('a TENANT access token (customer realm) does not work here either — 401', async () => {
    const tenantToken = tenantJwt.sign({ sub: randomUUID(), email: 'tenant-user@example.test', grants: [] });
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}`)
      .set('Authorization', `Bearer ${tenantToken}`);
    expect(res.status).toBe(401);
  });
});
