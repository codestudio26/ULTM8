/**
 * Decision 231 (POST-SPEC-55-DECISION-LOG.md) — Branch field-level settings
 * screen. This suite covers the new `type`/`activities`/`facilities`/
 * `defaultLanguage`/`description` columns' round-trip through
 * CreateBranchDto/UpdateBranchDto/BranchResponseDto: set on create, kept when
 * omitted on update, cleared with an explicit `null` (the same convention
 * UpdateBranchDto's own header comment documents for its pre-existing
 * nullable fields, and UpdateFranchiseDto already established for these
 * exact field names on Franchise).
 *
 * Cross-tenant isolation for BranchesController is already covered by
 * tenants.e2e-spec.ts — not duplicated here.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with
 * a warning if any are unset, same convention as every other e2e spec in
 * this repo.
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
    '[branches.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('BranchesModule — Decision 231 settings fields', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let tokenOwner: string;
  const branchIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Branch Settings HTTP School' } });
    owner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `branch-settings-http-owner-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Owner',
        surname: 'BranchSettings',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
    });
    tokenOwner = jwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }],
    });
  });

  afterAll(async () => {
    await superuser.branch.deleteMany({ where: { id: { in: branchIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: owner.id } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('persists type/activities/facilities/defaultLanguage/description on create', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        name: 'Settings Branch',
        type: 'Dojo',
        activities: ['BJJ', 'Judo'],
        facilities: ['Mats', 'Showers'],
        defaultLanguage: 'en-GB',
        description: 'A real Branch with real settings.',
      });

    expect(res.status).toBe(201);
    branchIds.push(res.body.id);
    expect(res.body.type).toBe('Dojo');
    expect(res.body.activities).toEqual(['BJJ', 'Judo']);
    expect(res.body.facilities).toEqual(['Mats', 'Showers']);
    expect(res.body.defaultLanguage).toBe('en-GB');
    expect(res.body.description).toBe('A real Branch with real settings.');
  });

  it('defaults activities/facilities to an empty array and the rest to null when omitted on create', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Bare Branch' });

    expect(res.status).toBe(201);
    branchIds.push(res.body.id);
    expect(res.body.type).toBeNull();
    expect(res.body.activities).toEqual([]);
    expect(res.body.facilities).toEqual([]);
    expect(res.body.defaultLanguage).toBeNull();
    expect(res.body.description).toBeNull();
  });

  it('keeps the fields unchanged when PATCH omits them, then clears the nullable ones with an explicit null', async () => {
    const create = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Update Branch', type: 'Academy', defaultLanguage: 'es', description: 'Before' });
    expect(create.status).toBe(201);
    const branchId = create.body.id;
    branchIds.push(branchId);

    // PATCH with an unrelated field only — these must survive untouched.
    const untouched = await request(app.getHttpServer())
      .patch(`/v1/branches/${branchId}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ contactPhone: '+15551234567' });
    expect(untouched.status).toBe(200);
    expect(untouched.body.type).toBe('Academy');
    expect(untouched.body.defaultLanguage).toBe('es');
    expect(untouched.body.description).toBe('Before');

    // Explicit null clears each nullable field; activities/facilities take a
    // real (possibly empty) array instead, same as Franchise's own fields.
    const cleared = await request(app.getHttpServer())
      .patch(`/v1/branches/${branchId}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: null, defaultLanguage: null, description: null, activities: ['Karate'], facilities: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.type).toBeNull();
    expect(cleared.body.defaultLanguage).toBeNull();
    expect(cleared.body.description).toBeNull();
    expect(cleared.body.activities).toEqual(['Karate']);
    expect(cleared.body.facilities).toEqual([]);
  });

  it('rejects more than 20 activities (ArrayMaxSize)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Overloaded Branch', activities: Array.from({ length: 21 }, (_, i) => `Activity ${i}`) });
    expect(res.status).toBe(400);
  });
});
