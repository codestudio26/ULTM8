/**
 * HTTP-level gate for PlatformAdminModule Slice 3 (Phase 27) — GET
 * /platform-admin/franchises/:id, mirroring platform-admin-schools.e2e-spec.ts
 * (Slice 2) exactly. Deliberately lighter than that file: the shared mechanics
 * (realm isolation, revokedAt re-check, DB-level column-grant enforcement,
 * AuditLogEntry immutability) are already proven there and don't need re-proving
 * per entity — this file focuses on what's actually NEW for this endpoint: does
 * the SAME ultm8_platform_admin role/pattern genuinely generalize to a second
 * table, and does the audit write correctly record `franchiseId` (not `schoolId`)
 * as the target.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET — skips with a warning if any are unset, same
 * convention as every other HTTP-level gate in this repo.
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
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_PLATFORM_ADMIN && PLATFORM_ADMIN_JWT_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[platform-admin-franchises.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'DATABASE_URL_PLATFORM_ADMIN / PLATFORM_ADMIN_JWT_SECRET not set. This gate MUST ' +
      'run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('PlatformAdminModule — GET /platform-admin/franchises/:id (Slice 3)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const platformAdminRoleClient = new PrismaClient({ datasourceUrl: DATABASE_URL_PLATFORM_ADMIN });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });

  const adminIds: string[] = [];
  let franchise: { id: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // No RoleGrant anywhere for the seeded AdminUsers below — proves the read is
    // genuinely cross-tenant, same reasoning as the School version of this test.
    franchise = await superuser.franchise.create({
      data: { id: randomUUID(), name: 'Platform-Admin HTTP Gate Franchise', flatFeeAmount: 5000 },
    });
  });

  afterAll(async () => {
    await superuser.auditLogEntry.deleteMany({ where: { targetId: franchise.id } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.franchise.delete({ where: { id: franchise.id } });
    await superuser.$disconnect();
    await platformAdminRoleClient.$disconnect();
    await app.close();
  });

  async function seedAdmin() {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `platform-admin-franchises-http-${randomUUID()}@example.test`,
        name: 'HTTP Gate Admin',
        subRole: 'SUPPORT',
        ssoSubject: `cognito-sub-${randomUUID()}`,
      },
    });
    adminIds.push(admin.id);
    return admin;
  }

  function tokenFor(admin: { id: string; email: string; subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN' }) {
    return platformAdminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  it('an admin with no RoleGrant anywhere near this Franchise can read it — 200, and the audit row records franchiseId (not schoolId)', async () => {
    const admin = await seedAdmin();
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/franchises/${franchise.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: franchise.id, name: 'Platform-Admin HTTP Gate Franchise', flatFeeAmount: 5000 });
    // stripeMeterId/stripeUsagePriceId are internal Stripe correlator ids
    // deliberately never granted to ultm8_platform_admin (same "not exposed"
    // treatment FRANCHISE_PUBLIC_SELECT's own comment already establishes for
    // the tenant-facing endpoint) — not re-tested for DB-level enforcement here
    // (platform-admin-schools.e2e-spec.ts already proves that mechanism works
    // for this exact role against a different table's excluded column).
    expect(res.body.stripeMeterId).toBeUndefined();
    expect(res.body.stripeUsagePriceId).toBeUndefined();

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: admin.id, targetId: franchise.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'VIEW_FRANCHISE', targetType: 'Franchise', franchiseId: franchise.id, schoolId: null });
  });

  it('a nonexistent Franchise id is a clean 404', async () => {
    const admin = await seedAdmin();
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/franchises/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(404);
  });

  it('no token at all is rejected — 401', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/platform-admin/franchises/${franchise.id}`);
    expect(res.status).toBe(401);
  });

  it('the DATABASE column GRANT itself rejects stripeMeterId for ultm8_platform_admin, proving the pattern genuinely extends to a second table, not just School', async () => {
    await expect(
      platformAdminRoleClient.$queryRaw`SELECT "stripeMeterId" FROM "Franchise" WHERE id = ${franchise.id}`,
    ).rejects.toThrow(/permission denied/i);
  });
});
