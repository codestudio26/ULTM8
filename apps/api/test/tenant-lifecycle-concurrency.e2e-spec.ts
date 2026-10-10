/**
 * V1 Stress Test Round 3 (docs/V1-STRESS-TEST-REPORT-ROUND3.md) — a genuine
 * concurrency bug in TenantLifecycleService found under real concurrent HTTP
 * load against a real Postgres: `closeSchool()`/`closeFranchise()`/
 * `reactivateSchool()`/`reactivateFranchise()` each did a plain `findUnique()`,
 * a conditional throw, then a SEPARATE, unconditional `update()` — a TOCTOU
 * window with nothing narrowing it (no external network call needs to happen
 * in between the way `SubscriptionPlansService.subscribe()`'s own analogous
 * race needed a real Stripe round trip to open a window at all). Driving real
 * concurrent HTTP traffic at this round's live server reproduced it directly:
 * firing 4 concurrent `close()` calls (from 4 different FULL_ADMIN callers) at
 * the SAME School, with NO artificial delay needed, landed all 4 as 201
 * successes for 15 of 30 Schools tried, and all 10 of 10 Franchises tried —
 * each creating its OWN duplicate CLOSE_*_ACCOUNT audit row. That's a real
 * integrity problem for the one thing Decision 110/ultm8-tenant-isolation §6
 * most need right — "who closed this tenant, and when" — not a cosmetic
 * glitch: an audit trail with 4 rows for 1 real action can't answer that
 * question at all.
 *
 * Fixed the same way `SubscriptionPlansService.subscribe()`'s own race was
 * fixed this round — see TenantLifecycleService's own header comment for the
 * full account. This file proves the fix with LOW concurrency (2 concurrent
 * calls, matching this repo's own existing e2e style — jest, not a raw load
 * script) specifically because the bug needed NO artificial delay to
 * reproduce at all; the live, higher-concurrency run that actually found it is
 * documented in the Round 3 report, not repeated here.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET, JWT_ACCESS_SECRET — skips with a warning if any
 * are unset, same convention as tenant-lifecycle.e2e-spec.ts.
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
    '[tenant-lifecycle-concurrency.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'DATABASE_URL_PLATFORM_ADMIN / PLATFORM_ADMIN_JWT_SECRET / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('TenantLifecycleService — concurrent close/reactivate race (Round 3)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });

  const adminIds: string[] = [];
  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function seedAdmin() {
    const admin = await superuser.adminUser.create({
      data: { id: randomUUID(), email: `tenant-lifecycle-race-${randomUUID()}@example.test`, name: 'Race Admin', subRole: 'FULL_ADMIN', ssoSubject: `cognito-sub-${randomUUID()}` },
    });
    adminIds.push(admin.id);
    return platformAdminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  it('two concurrent close() calls for the same School never both win — exactly one 201, one 409, and exactly ONE audit row', async () => {
    const [tokenA, tokenB] = await Promise.all([seedAdmin(), seedAdmin()]);
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Race Close School ${randomUUID()}` } });
    schoolIds.push(school.id);

    const fire = (token: string) =>
      request(app.getHttpServer()).post(`/v1/platform-admin/schools/${school.id}/close`).set('Authorization', `Bearer ${token}`).send({ confirmName: school.name });

    const [resA, resB] = await Promise.all([fire(tokenA), fire(tokenB)]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const auditCount = await superuser.auditLogEntry.count({ where: { targetId: school.id, action: 'CLOSE_SCHOOL_ACCOUNT' } });
    expect(auditCount).toBe(1);

    const persisted = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(persisted.archivedAt).toBeTruthy();
  });

  it('two concurrent close() calls for the same Franchise never both win — exactly one 201, one 409, and exactly ONE audit row', async () => {
    const [tokenA, tokenB] = await Promise.all([seedAdmin(), seedAdmin()]);
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: `Race Close Franchise ${randomUUID()}` } });
    franchiseIds.push(franchise.id);

    const fire = (token: string) =>
      request(app.getHttpServer()).post(`/v1/platform-admin/franchises/${franchise.id}/close`).set('Authorization', `Bearer ${token}`).send({ confirmName: franchise.name });

    const [resA, resB] = await Promise.all([fire(tokenA), fire(tokenB)]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const auditCount = await superuser.auditLogEntry.count({ where: { targetId: franchise.id, action: 'CLOSE_FRANCHISE_ACCOUNT' } });
    expect(auditCount).toBe(1);
  });

  it('two concurrent reactivate() calls for the same already-closed School never both win — exactly one 201, one 409, and exactly ONE audit row', async () => {
    const [tokenA, tokenB] = await Promise.all([seedAdmin(), seedAdmin()]);
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Race Reactivate School ${randomUUID()}`, archivedAt: new Date(), purgeAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } });
    schoolIds.push(school.id);

    const fire = (token: string) =>
      request(app.getHttpServer()).post(`/v1/platform-admin/schools/${school.id}/reactivate`).set('Authorization', `Bearer ${token}`);

    const [resA, resB] = await Promise.all([fire(tokenA), fire(tokenB)]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const auditCount = await superuser.auditLogEntry.count({ where: { targetId: school.id, action: 'REACTIVATE_SCHOOL_ACCOUNT' } });
    expect(auditCount).toBe(1);

    const persisted = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(persisted.archivedAt).toBeNull();
  });

  it('two concurrent reactivate() calls for the same already-closed Franchise never both win — exactly one 201, one 409, and exactly ONE audit row', async () => {
    const [tokenA, tokenB] = await Promise.all([seedAdmin(), seedAdmin()]);
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: `Race Reactivate Franchise ${randomUUID()}`, archivedAt: new Date(), purgeAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) } });
    franchiseIds.push(franchise.id);

    const fire = (token: string) =>
      request(app.getHttpServer()).post(`/v1/platform-admin/franchises/${franchise.id}/reactivate`).set('Authorization', `Bearer ${token}`);

    const [resA, resB] = await Promise.all([fire(tokenA), fire(tokenB)]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const auditCount = await superuser.auditLogEntry.count({ where: { targetId: franchise.id, action: 'REACTIVATE_FRANCHISE_ACCOUNT' } });
    expect(auditCount).toBe(1);
  });
});
