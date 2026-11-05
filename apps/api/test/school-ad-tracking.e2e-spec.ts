/**
 * Decision 318 item 10 — the School's ad tracking, ready-made connections
 * only: the owner saves a Meta Pixel ID and/or a Google Analytics ID on the
 * School (PATCH /schools/:id). Real HTTP against a real Postgres: only the
 * strict formats are accepted (so no script or markup can be stored), null
 * clears, only the owner can set them, and the database's own CHECK
 * constraints refuse anything else even on a direct write.
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

describeIfDb('School ad tracking IDs (Decision 318 item 10)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const patch = (who: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).patch(`/v1/schools/${schoolId}`).set('Authorization', `Bearer ${tokens[who]}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolId, name: 'Ad Tracking School' } });
    for (const [label, role] of [
      ['owner', 'SCHOOL_OWNER_MANAGER'],
      ['staff', 'BRANCH_STAFF'],
      ['coach', 'INSTRUCTOR'],
    ] as const) {
      const u = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `ad-tracking-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tracking',
          passcodeHash: 'x',
          phoneVerifiedAt: new Date(),
        },
      });
      users[label] = u;
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: u.id, schoolId } });
      tokens[label] = jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
    }
  });

  afterAll(async () => {
    await superuser.roleGrant.deleteMany({ where: { schoolId } });
    await superuser.school.deleteMany({ where: { id: schoolId } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('starts with neither ID', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/schools/${schoolId}`).set('Authorization', `Bearer ${tokens.owner}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ metaPixelId: null, googleAnalyticsId: null });
  });

  it('saves a Meta Pixel ID and a Google Analytics ID', async () => {
    const res = await patch('owner', { metaPixelId: '123456789012345', googleAnalyticsId: 'G-AB12CD34EF' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ metaPixelId: '123456789012345', googleAnalyticsId: 'G-AB12CD34EF' });
  });

  it('refuses anything that is not exactly an ID', async () => {
    for (const metaPixelId of [
      '123',
      '12345678901234567890123',
      '1234567890abc',
      ' 123456789012345',
      '123456789012345<script>',
      '"><script>alert(1)</script>',
      "123456789012345'); fetch('//x.test')//",
      '１２３４５６７８９０１２３', // full-width digits
    ]) {
      expect([metaPixelId, (await patch('owner', { metaPixelId })).status]).toEqual([metaPixelId, 400]);
    }
    for (const googleAnalyticsId of [
      'UA-12345678-1',
      'g-ab12cd34ef',
      'G-',
      'G-AB1',
      'G-AB12CD34EF<script>',
      "G-AB12'});alert(1)//",
      'GTM-ABCDEF',
      'G-ABCDEFGHIJKLMNOPQ',
      'AW-123456789',
      '<img src=x onerror=alert(1)>',
    ]) {
      expect([googleAnalyticsId, (await patch('owner', { googleAnalyticsId })).status]).toEqual([googleAnalyticsId, 400]);
    }
    // Nothing refused was saved.
    const school = await superuser.school.findUniqueOrThrow({ where: { id: schoolId } });
    expect(school).toMatchObject({ metaPixelId: '123456789012345', googleAnalyticsId: 'G-AB12CD34EF' });
    expect((await patch('owner', { metaPixelId: 123456789012345 })).status).toBe(400);
  });

  it('clears an ID with null', async () => {
    const res = await patch('owner', { metaPixelId: null, googleAnalyticsId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ metaPixelId: null, googleAnalyticsId: null });
  });

  it('is set by the School owner only', async () => {
    for (const who of ['staff', 'coach']) {
      expect([who, (await patch(who, { metaPixelId: '123456789012345' })).status]).toEqual([who, 403]);
    }
    const school = await superuser.school.findUniqueOrThrow({ where: { id: schoolId } });
    expect(school.metaPixelId).toBeNull();
  });

  it('is refused by the database itself outside the formats', async () => {
    await expect(superuser.school.update({ where: { id: schoolId }, data: { metaPixelId: '<script>' } })).rejects.toThrow();
    await expect(superuser.school.update({ where: { id: schoolId }, data: { googleAnalyticsId: 'G-1"><script>' } })).rejects.toThrow();
    await expect(superuser.school.update({ where: { id: schoolId }, data: { metaPixelId: '1234567890', googleAnalyticsId: 'G-ABCD' } })).resolves.toBeTruthy();
  });
});
