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

  // ---------------------------------------------------------------------------
  // Decision 276 — structured, country-aware address. The API validates it
  // against the country's own rules, stores the six columns, and rebuilds the
  // one-line `address` every existing reader still uses.
  // ---------------------------------------------------------------------------

  it('stores a structured postalAddress, rebuilds `address`, and enforces the country rules', async () => {
    const created = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        name: 'Structured Address Branch',
        postalAddress: { line1: '100 Queen St W', city: 'Toronto', region: 'Ontario', postalCode: 'm5h 2n2', country: 'CA' },
      });
    expect(created.status).toBe(201);
    branchIds.push(created.body.id);
    expect(created.body).toMatchObject({
      address: '100 Queen St W, Toronto ON M5H 2N2, Canada',
      addressLine1: '100 Queen St W',
      addressCity: 'Toronto',
      addressRegion: 'ON',
      addressPostalCode: 'M5H 2N2',
      addressCountry: 'CA',
    });

    // A US ZIP isn't a Canadian postal code — rejected, nothing changes.
    const bad = await request(app.getHttpServer())
      .patch(`/v1/branches/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ postalAddress: { line1: '100 Queen St W', city: 'Toronto', region: 'ON', postalCode: '90210', country: 'CA' } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('postalAddress.postalCode');

    // `null` clears every address column at once.
    const cleared = await request(app.getHttpServer())
      .patch(`/v1/branches/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ postalAddress: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ address: null, addressLine1: null, addressCountry: null });
  });

  // ---------------------------------------------------------------------------
  // GET /schools/:schoolId/branches?city= — v1.2 backend backlog, "Branches page".
  // These two Branches only have the free-text `address` (no structured
  // `addressCity`), so since Decision 294 they go through the legacy fallback:
  // the address text containing the city.
  // ---------------------------------------------------------------------------

  it('filters GET /schools/:schoolId/branches by city, case-insensitively, against a legacy address', async () => {
    const toronto = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'City Filter Branch Toronto', address: '123 Main St, Toronto, ON' });
    const vaughan = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'City Filter Branch Vaughan', address: '456 King St, Vaughan, ON' });
    expect(toronto.status).toBe(201);
    expect(vaughan.status).toBe(201);
    branchIds.push(toronto.body.id, vaughan.body.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/branches`)
      .query({ city: 'toronto' }) // lowercase — proves case-insensitivity
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(toronto.body.id);
    expect(ids).not.toContain(vaughan.body.id);

    // Omitted entirely — both still present, exactly as before this filter existed.
    const unfiltered = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(unfiltered.status).toBe(200);
    const unfilteredIds = unfiltered.body.items.map((b: { id: string }) => b.id);
    expect(unfilteredIds).toContain(toronto.body.id);
    expect(unfilteredIds).toContain(vaughan.body.id);
  });

  // ---------------------------------------------------------------------------
  // Decision 294 — City matches the city field only (case and accents
  // ignored), one search box over name/city/postcode, a country filter, A to Z
  // order with name+id paging, `%`/`_` as plain text, and per-Branch Student
  // and upcoming-class counts. Its own School, so the lists are exact.
  // ---------------------------------------------------------------------------

  describe('Decision 294 — list filters, order and counts', () => {
    let filterSchool: { id: string };
    let tokenFilterOwner: string;
    const ids: Record<string, string> = {};
    const studentIds: string[] = [];

    const list = (query: Record<string, string | number | boolean> = {}) =>
      request(app.getHttpServer())
        .get(`/v1/schools/${filterSchool.id}/branches`)
        .query(query)
        .set('Authorization', `Bearer ${tokenFilterOwner}`);
    const names = (res: request.Response) => res.body.items.map((b: { name: string }) => b.name);

    beforeAll(async () => {
      filterSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Branch Filter HTTP School' } });
      await superuser.roleGrant.create({
        data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: filterSchool.id },
      });
      tokenFilterOwner = jwt.sign({
        sub: owner.id,
        email: owner.email,
        grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: filterSchool.id, branchId: null }],
      });
      const rows = [
        { key: 'london', name: 'Westminster', addressCity: 'London', addressPostalCode: 'SW1A 1AA', addressCountry: 'GB', address: '1 Parliament St, London SW1A 1AA, United Kingdom' },
        { key: 'manchester', name: 'Northern Quarter', addressCity: 'Manchester', addressPostalCode: 'M1 1AA', addressCountry: 'GB', address: '22 London Road, Manchester M1 1AA, United Kingdom' },
        { key: 'saoPaulo', name: 'Paulista', addressCity: 'São Paulo', addressPostalCode: '01310-100', addressCountry: 'BR', address: 'Av. Paulista 1000, São Paulo - SP, 01310-100, Brazil' },
        { key: 'percent', name: '100% Fight Club', addressCity: 'Leeds', addressPostalCode: 'LS1 1AA', addressCountry: 'GB', address: '5 Briggate, Leeds LS1 1AA, United Kingdom' },
        { key: 'accented', name: 'École du Nord', addressCity: 'Lyon', addressPostalCode: '69001', addressCountry: 'FR', address: '3 Rue de la République, 69001 Lyon, France' },
      ];
      for (const { key, ...data } of rows) {
        const b = await superuser.branch.create({ data: { id: randomUUID(), schoolId: filterSchool.id, ...data } });
        ids[key] = b.id;
      }

      // Two Students at London, one at Manchester.
      for (const branchId of [ids.london, ids.london, ids.manchester]) {
        const student = await superuser.user.create({
          data: {
            id: randomUUID(),
            email: `branch-filter-student-${randomUUID()}@example.test`,
            phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
            firstName: 'Student',
            surname: 'BranchFilter',
            passcodeHash: 'x',
            dateOfBirth: new Date('2000-01-01'),
            phoneVerifiedAt: new Date(),
          },
        });
        studentIds.push(student.id);
        await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: filterSchool.id, studentId: student.id, branchId } });
      }

      // London: one upcoming class counts; a past one and an archived future one don't.
      const hour = 3_600_000;
      const future = new Date(Date.now() + 7 * 24 * hour);
      const past = new Date(Date.now() - 7 * 24 * hour);
      await superuser.class.createMany({
        data: [
          { id: randomUUID(), schoolId: filterSchool.id, branchId: ids.london, title: 'Upcoming', startDate: future, endDate: new Date(future.getTime() + hour) },
          { id: randomUUID(), schoolId: filterSchool.id, branchId: ids.london, title: 'Past', startDate: past, endDate: new Date(past.getTime() + hour) },
          { id: randomUUID(), schoolId: filterSchool.id, branchId: ids.london, title: 'Archived', startDate: future, endDate: new Date(future.getTime() + hour), archivedAt: new Date() },
        ],
      });
    });

    afterAll(async () => {
      await superuser.class.deleteMany({ where: { schoolId: filterSchool.id } });
      await superuser.studentHomeBranch.deleteMany({ where: { schoolId: filterSchool.id } });
      await superuser.branch.deleteMany({ where: { schoolId: filterSchool.id } });
      await superuser.user.deleteMany({ where: { id: { in: studentIds } } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: filterSchool.id } });
      await superuser.school.deleteMany({ where: { id: filterSchool.id } });
    });

    it('lists every Branch A to Z, ignoring case and accents', async () => {
      const res = await list();
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['100% Fight Club', 'École du Nord', 'Northern Quarter', 'Paulista', 'Westminster']);
      expect(res.body.nextCursor).toBeNull();
    });

    it('matches City against the city field only, not the street', async () => {
      // "22 London Road, Manchester" used to match London.
      const res = await list({ city: 'london' });
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Westminster']);
    });

    it('ignores accents in City and search', async () => {
      expect(names(await list({ city: 'Sao Paulo' }))).toEqual(['Paulista']);
      expect(names(await list({ q: 'ecole' }))).toEqual(['École du Nord']);
    });

    it('searches name, city and postcode (postcode without spaces)', async () => {
      expect(names(await list({ q: 'westmin' }))).toEqual(['Westminster']);
      expect(names(await list({ q: 'MANCHESTER' }))).toEqual(['Northern Quarter']);
      expect(names(await list({ q: 'sw1a1aa' }))).toEqual(['Westminster']);
      expect(names(await list({ q: 'SW1A 1AA' }))).toEqual(['Westminster']);
      // A street name isn't searched — only name, city and postcode.
      expect(names(await list({ q: 'Briggate' }))).toEqual([]);
    });

    it('treats % and _ as plain text, not wildcards', async () => {
      expect(names(await list({ q: '%' }))).toEqual(['100% Fight Club']);
      expect(names(await list({ q: '_' }))).toEqual([]);
      expect(names(await list({ city: 'Lond_n' }))).toEqual([]);
    });

    it('filters by country and rejects a code that is not ISO 3166-1 alpha-2', async () => {
      expect(names(await list({ country: 'GB' }))).toEqual(['100% Fight Club', 'Northern Quarter', 'Westminster']);
      expect(names(await list({ country: 'BR', q: 'paulo' }))).toEqual(['Paulista']);
      expect((await list({ country: 'XX' })).status).toBe(400);
    });

    it('pages in name order with a name+id cursor and rejects a bad cursor', async () => {
      const first = await list({ limit: 2 });
      expect(names(first)).toEqual(['100% Fight Club', 'École du Nord']);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await list({ limit: 2, cursor: first.body.nextCursor });
      expect(names(second)).toEqual(['Northern Quarter', 'Paulista']);
      const third = await list({ limit: 2, cursor: second.body.nextCursor });
      expect(names(third)).toEqual(['Westminster']);
      expect(third.body.nextCursor).toBeNull();
      expect((await list({ cursor: 'not-a-cursor' })).status).toBe(400);
    });

    it('returns each Branch\'s Student count and upcoming (non-archived) class count', async () => {
      const res = await list();
      const byName = Object.fromEntries(res.body.items.map((b: { name: string; studentCount: number; upcomingClassCount: number }) => [b.name, b]));
      expect(byName.Westminster).toMatchObject({ studentCount: 2, upcomingClassCount: 1 });
      expect(byName['Northern Quarter']).toMatchObject({ studentCount: 1, upcomingClassCount: 0 });
      expect(byName.Paulista).toMatchObject({ studentCount: 0, upcomingClassCount: 0 });
    });
  });
});
