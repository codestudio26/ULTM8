/**
 * HTTP-level gate for Phase 12 (GuardianModule) — minor creation + linking, the
 * two-tier ConsentRecord grant/withdraw flow, the withdrawal-asymmetry rule
 * (baseline cascades RoleGrant revocation; camera-only just clears the stored
 * profile photo), and RLS isolation. Same ground rule as every other e2e spec in
 * this repo: prove over real HTTP, not just by reading the code.
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
    '[guardians.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('GuardianModule — HTTP-level linking, consent, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let guardianA: { id: string; email: string };
  let guardianB: { id: string; email: string };
  let tokenGuardianA: string;
  let tokenGuardianB: string;

  let school: { id: string };

  const userIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `guardians-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('1985-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    guardianA = await mkUser('guardian-a');
    userIds.push(guardianA.id);
    guardianB = await mkUser('guardian-b');
    userIds.push(guardianB.id);

    tokenGuardianA = signAccessToken(guardianA, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);
    tokenGuardianB = signAccessToken(guardianB, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Guardians HTTP School' } });
  });

  afterAll(async () => {
    await superuser.consentRecord.deleteMany({ where: { guardianId: { in: [guardianA.id, guardianB.id] } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: [guardianA.id, guardianB.id] } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { email: { contains: 'guardian-managed.ultm8.internal' } }] } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  let minorId: string;
  let baselineConsentId: string;
  let cameraConsentId: string;

  it('a Guardian CAN create + link a new minor', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/guardians/me/minors')
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ firstName: 'Minor', surname: 'Child', dateOfBirth: '2015-06-01', gender: 'other' });
    expect(res.status).toBe(201);
    expect(res.body.studentId).toBeDefined();
    minorId = res.body.studentId;
    userIds.push(minorId);

    const listRes = await request(app.getHttpServer()).get('/v1/guardians/me/minors').set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.some((m: { studentId: string }) => m.studentId === minorId)).toBe(true);
  });

  it('the minor gets a synthetic, unique, E.164-shaped (digits-only) phone/email, and login stays blocked (phoneVerifiedAt null)', async () => {
    const minor = await superuser.user.findUniqueOrThrow({ where: { id: minorId } });
    expect(minor.email).toContain('guardian-managed.ultm8.internal');
    expect(minor.phone).toMatch(/^\+\d+$/); // digits only after '+' — a hex-slice bug once produced letters here
    expect(minor.phoneVerifiedAt).toBeNull();
  });

  it('granting consent for a minor the caller has no link to is rejected — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minorId}/consent`)
      .set('Authorization', `Bearer ${tokenGuardianB}`)
      .send({ tier: 'BASELINE', policyVersion: '2026-09-v1' });
    expect(res.status).toBe(400);
  });

  it('a Guardian CAN grant both tiers of consent for their own linked minor', async () => {
    const baselineRes = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minorId}/consent`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ tier: 'BASELINE', policyVersion: '2026-09-v1' });
    expect(baselineRes.status).toBe(201);
    expect(baselineRes.body.status).toBe('ACTIVE');
    baselineConsentId = baselineRes.body.id;

    const cameraRes = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minorId}/consent`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ tier: 'CAMERA', policyVersion: '2026-09-v1' });
    expect(cameraRes.status).toBe(201);
    cameraConsentId = cameraRes.body.id;

    const listRes = await request(app.getHttpServer()).get('/v1/guardians/me/consent').set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(2);
  });

  it('withdrawing CAMERA-tier consent clears the stored profile photo but does NOT touch RoleGrant or account status', async () => {
    await superuser.user.update({ where: { id: minorId }, data: { profilePhotoUrl: 'https://example.test/photo.jpg' } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: minorId, schoolId: school.id } });

    const res = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${cameraConsentId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');

    const minorAfter = await superuser.user.findUniqueOrThrow({ where: { id: minorId } });
    expect(minorAfter.profilePhotoUrl).toBeNull();

    const grantAfter = await superuser.roleGrant.findFirst({ where: { userId: minorId, schoolId: school.id } });
    expect(grantAfter!.revokedAt).toBeNull(); // camera-only withdrawal never touches RoleGrant

    const doubleWithdraw = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${cameraConsentId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(doubleWithdraw.status).toBe(409);
  });

  it('withdrawing BASELINE consent cascades — revokes every active RoleGrant the minor holds', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${baselineConsentId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');

    const grantAfter = await superuser.roleGrant.findFirst({ where: { userId: minorId, schoolId: school.id } });
    expect(grantAfter!.revokedAt).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // RLS — GuardianLink/ConsentRecord are narrow, self-only, no shared-visibility
  // branch at all (Decision 92). Direct Prisma, not HTTP — no HTTP endpoint
  // exposes another Guardian's raw rows to probe this via supertest alone, same
  // reasoning every prior phase's own RLS test documents.
  // ---------------------------------------------------------------------------

  it('RLS: Guardian B cannot read Guardian A\'s GuardianLink or ConsentRecord rows', async () => {
    const linksAsB = await withUser(guardianB.id, (tx) => tx.guardianLink.findMany({ where: { guardianId: guardianA.id } }));
    expect(linksAsB).toHaveLength(0);

    const consentAsB = await withUser(guardianB.id, (tx) => tx.consentRecord.findMany({ where: { guardianId: guardianA.id } }));
    expect(consentAsB).toHaveLength(0);

    const linksAsA = await withUser(guardianA.id, (tx) => tx.guardianLink.findMany({ where: { guardianId: guardianA.id } }));
    expect(linksAsA.length).toBeGreaterThan(0);
  });

  it('RLS: the minor themselves cannot read their own GuardianLink/ConsentRecord rows (Guardian-exclusive per Decision 92)', async () => {
    const linksAsMinor = await withUser(minorId, (tx) => tx.guardianLink.findMany({ where: { studentId: minorId } }));
    expect(linksAsMinor).toHaveLength(0);
  });
});
