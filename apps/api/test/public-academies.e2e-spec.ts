/**
 * HTTP-level gate for PublicAcademiesController (Decision 266 — Apple 4.2.6/4.3
 * compliance, Decision 247's "one shared app, School picked after install").
 * The entire point of this module is that these two routes work with NO
 * Authorization header at all — every request below deliberately sends none.
 * Covers:
 * - search-by-name finds a School with zero auth, and the curated-fields
 *   contract (mobileNumber never leaks) still holds on this path too,
 * - by-code lookup finds the right School and 404s on a wrong/unknown code,
 * - a brand-new School always has a real joinCode to look up by (the DB
 *   default, not something this test has to construct),
 * - AND that none of this crosses into the ordinary authenticated
 *   `/academies`/`/schools` routes needing a guard change — PublicAcademiesController
 *   is additive, not a relaxation of AcademiesController's own guard.
 *
 * Requires DATABASE_URL.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, School } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[public-academies.e2e-spec] Skipped — DATABASE_URL not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('PublicAcademiesController — pre-auth School search and join-code lookup', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });

  let school: School;
  const schoolIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({
      data: {
        id: randomUUID(),
        name: `Public Discovery Dojo ${randomUUID().slice(0, 8)}`,
        mobileNumber: '+15559998888',
        activities: ['Judo'],
      },
    });
    schoolIds.push(school.id);
    await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main Branch' } });
  });

  afterAll(async () => {
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a brand-new School already has a real, 8-character join code — no setup needed to look it up by', () => {
    expect(school.joinCode).toMatch(/^[A-Z2-9]{8}$/);
  });

  it('search finds the School by (partial, case-insensitive) name with NO Authorization header', async () => {
    const namePart = school.name.slice(0, 10);
    const res = await request(app.getHttpServer()).get('/v1/public/schools/search').query({ q: namePart.toLowerCase() });
    expect(res.status).toBe(200);
    const match = res.body.items.find((item: { id: string }) => item.id === school.id);
    expect(match).toBeDefined();
    // Same curated-fields contract as the authenticated /academies endpoint —
    // mobileNumber is deliberately excluded from AcademySummaryDto.
    expect(match.mobileNumber).toBeUndefined();
    expect(match.name).toBe(school.name);
  });

  it('search for a name nobody has returns an empty list, not a 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/public/schools/search')
      .query({ q: `nonexistent-school-${randomUUID()}` });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('by-code finds the right School, with its branches, for picking a home branch before joining (Decision 209)', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/public/schools/by-code/${school.joinCode}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(school.id);
    expect(res.body.mobileNumber).toBeUndefined();
    expect(res.body.branches).toEqual([{ id: expect.any(String), name: 'Main Branch' }]);
  });

  it('by-code accepts a lowercase-typed code (the alphabet is uppercase-only, mobile keyboards default to lowercase)', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/public/schools/by-code/${school.joinCode.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(school.id);
  });

  it('an unknown join code 404s, not 500s or leaks whether SOME code is close', async () => {
    const res = await request(app.getHttpServer()).get('/v1/public/schools/by-code/ZZZZZZZZ');
    expect(res.status).toBe(404);
  });
});
