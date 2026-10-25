/**
 * Decision 278 — the School Portal header's Global Search. Proves over real HTTP that
 * the new optional `search` param on the four list endpoints it reuses
 * (Students, Instructors, Branches, Franchises; Classes' own `search` is covered by
 * classes.e2e-spec.ts) only ever narrows what the caller could already list:
 *  - case-insensitive substring on names (first name, surname, full name for people),
 *  - archived rows stay excluded, as the endpoints' own default (Franchises: with
 *    the opt-in `excludeArchived=true` the search box sends),
 *  - `%` and `_` match themselves, not any text (Branches, Franchises, Classes),
 *  - and, per endpoint, a search never returns another School's (or another
 *    Franchise owner's) rows even when the names match.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a warning
 * if any are unset, same convention as tenants.e2e-spec.ts.
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
    '[global-search.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Global Search (Decision 278) — `search` on the list endpoints, tenant-isolated', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);
  // A made-up word every fixture name below shares, so a match can only come from
  // this suite's own rows, whatever else the database holds.
  const WORD = `Qzv${tag}`;

  let schoolA: { id: string };
  let schoolB: { id: string };
  let branchA1: { id: string };
  let branchA2: { id: string };
  let branchA3Archived: { id: string };
  let branchB1: { id: string };
  let branchA4Percent: { id: string };
  let classA1: { id: string };
  let classA2Percent: { id: string };
  let franchiseAArchived: { id: string };
  let franchiseA: { id: string };
  let franchiseB: { id: string };
  let studentA: { id: string };
  let studentA2: { id: string };
  let studentB: { id: string };
  let studentAInactive: { id: string };
  let instructorProfileA: { id: string };
  let instructorProfileAArchived: { id: string };
  let instructorProfileB: { id: string };
  let tokenOwnerA: string;
  let tokenBranchStaffA1: string;
  let tokenFranchiseOwnerA: string;

  function sign(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  const mkUser = (label: string, firstName: string, surname: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `global-search-${tag}-${label}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname,
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: `Search School A ${tag}` } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: `Search School B ${tag}` } });
    branchA1 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: `${WORD} North Dojo` } });
    branchA2 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: `${WORD} South Dojo` } });
    branchA3Archived = await superuser.branch.create({
      data: { id: randomUUID(), schoolId: schoolA.id, name: `${WORD} Old Dojo`, archivedAt: new Date(), purgeAt: new Date(Date.now() + 86_400_000) },
    });
    branchB1 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolB.id, name: `${WORD} North Dojo` } });
    branchA4Percent = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: `${WORD} 100% Club` } });
    classA1 = await superuser.class.create({
      data: { id: randomUUID(), schoolId: schoolA.id, title: `${WORD} North Kata`, startDate: new Date(), endDate: new Date() },
    });
    classA2Percent = await superuser.class.create({
      data: { id: randomUUID(), schoolId: schoolA.id, title: `${WORD} 100% Kata`, startDate: new Date(), endDate: new Date() },
    });

    const ownerA = await mkUser('owner-a', 'Owner', 'Alpha');
    const ownerB = await mkUser('owner-b', 'Owner', 'Bravo');
    const branchStaffA1 = await mkUser('staff-a1', 'Staff', 'Alpha');
    const franchiseOwnerA = await mkUser('fo-a', 'Franchisor', 'Alpha');
    const franchiseOwnerB = await mkUser('fo-b', 'Franchisor', 'Bravo');
    studentA = await mkUser('student-a', `${WORD}Jonathan`, 'Smithers');
    studentA2 = await mkUser('student-a2', 'Mary', 'Other');
    studentB = await mkUser('student-b', `${WORD}Jonathan`, 'Smithers');
    studentAInactive = await mkUser('student-a-old', `${WORD}Jonathan`, 'Leftschool');
    const coachA = await mkUser('coach-a', `${WORD}Coach`, 'Kowalski');
    const coachAArchived = await mkUser('coach-a-old', `${WORD}Coach`, 'Retired');
    const coachB = await mkUser('coach-b', `${WORD}Coach`, 'Kowalski');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaffA1.id, schoolId: schoolA.id, branchId: branchA1.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA2.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: schoolB.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentAInactive.id, schoolId: schoolA.id, revokedAt: new Date() },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coachA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coachAArchived.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coachB.id, schoolId: schoolB.id },
      ],
    });

    instructorProfileA = await superuser.instructor.create({ data: { id: randomUUID(), userId: coachA.id, schoolId: schoolA.id } });
    instructorProfileAArchived = await superuser.instructor.create({
      data: { id: randomUUID(), userId: coachAArchived.id, schoolId: schoolA.id, archivedAt: new Date(), purgeAt: new Date(Date.now() + 86_400_000) },
    });
    instructorProfileB = await superuser.instructor.create({ data: { id: randomUUID(), userId: coachB.id, schoolId: schoolB.id } });

    franchiseA = await superuser.franchise.create({ data: { id: randomUUID(), name: `${WORD} Martial Arts Group` } });
    franchiseB = await superuser.franchise.create({ data: { id: randomUUID(), name: `${WORD} Martial Arts Group` } });
    franchiseAArchived = await superuser.franchise.create({
      data: { id: randomUUID(), name: `${WORD} Martial Arts Closed`, archivedAt: new Date(), purgeAt: new Date(Date.now() + 86_400_000) },
    });
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwnerA.id, franchiseId: franchiseA.id },
        { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwnerA.id, franchiseId: franchiseAArchived.id },
        { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwnerB.id, franchiseId: franchiseB.id },
      ],
    });

    tokenOwnerA = sign(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenBranchStaffA1 = sign(branchStaffA1, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: schoolA.id, branchId: branchA1.id }]);
    tokenFranchiseOwnerA = sign(franchiseOwnerA, [
      { role: 'FRANCHISE_OWNER', franchiseId: franchiseA.id, schoolId: null, branchId: null },
      { role: 'FRANCHISE_OWNER', franchiseId: franchiseAArchived.id, schoolId: null, branchId: null },
    ]);
  });

  afterAll(async () => {
    // Guarded: if setup failed partway, some of these were never created — clean up
    // whatever exists rather than throwing on an undefined fixture.
    const schoolIds = [schoolA?.id, schoolB?.id].filter((id): id is string => !!id);
    const franchiseIds = [franchiseA?.id, franchiseB?.id, franchiseAArchived?.id].filter((id): id is string => !!id);
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.instructor.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({
      where: { OR: [{ schoolId: { in: schoolIds } }, { franchiseId: { in: franchiseIds } }] },
    });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.user.deleteMany({ where: { email: { contains: `global-search-${tag}-` } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app?.close();
  });

  const ids = (res: request.Response) => (res.body.items as Array<{ id: string }>).map((i) => i.id);
  const get = (path: string, token: string, query: Record<string, string>) =>
    request(app.getHttpServer()).get(path).query(query).set('Authorization', `Bearer ${token}`);

  // ---------------------------------------------------------------------------
  // Students — GET /schools/:id/students?search=
  // ---------------------------------------------------------------------------

  it('Students: case-insensitive substring on first name, surname and full name; only the caller\'s School', async () => {
    for (const q of [WORD.toLowerCase().slice(0, 6), 'SMITH', `${WORD.toLowerCase()}jonathan smi`]) {
      const res = await get(`/v1/schools/${schoolA.id}/students`, tokenOwnerA, { search: q });
      expect(res.status).toBe(200);
      expect(ids(res)).toContain(studentA.id);
      expect(ids(res)).not.toContain(studentA2.id);
      // School B's student has the very same name — never returned.
      expect(ids(res)).not.toContain(studentB.id);
    }
  });

  it('Students: no search, or a blank one, behaves exactly as before', async () => {
    for (const query of [{}, { search: '   ' }] as Array<Record<string, string>>) {
      const res = await get(`/v1/schools/${schoolA.id}/students`, tokenOwnerA, query);
      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(expect.arrayContaining([studentA.id, studentA2.id]));
    }
  });

  it('Students: an inactive (revoked) Student is left out, as on the roster\'s default Active view', async () => {
    const res = await get(`/v1/schools/${schoolA.id}/students`, tokenOwnerA, { search: 'leftschool' });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([]);
    // Still findable when the caller asks for inactive Students explicitly.
    const inactive = await get(`/v1/schools/${schoolA.id}/students`, tokenOwnerA, { search: 'leftschool', status: 'INACTIVE' });
    expect(inactive.status).toBe(200);
    expect(ids(inactive)).toEqual([studentAInactive.id]);
  });

  it('Students: names only — an email fragment matches nothing', async () => {
    const res = await get(`/v1/schools/${schoolA.id}/students`, tokenOwnerA, { search: `global-search-${tag}` });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([]);
  });

  it('Students: searching another School\'s roster is still refused', async () => {
    const res = await get(`/v1/schools/${schoolB.id}/students`, tokenOwnerA, { search: WORD });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Instructors — GET /schools/:schoolId/instructors?search=
  // ---------------------------------------------------------------------------

  it('Instructors: matches by name, excludes archived profiles and other Schools', async () => {
    for (const q of [`${WORD.toLowerCase()}coach`, 'kowal', `${WORD}Coach Kow`]) {
      const res = await get(`/v1/schools/${schoolA.id}/instructors`, tokenOwnerA, { search: q, limit: '5' });
      expect(res.status).toBe(200);
      expect(ids(res)).toEqual([instructorProfileA.id]);
    }
    const all = await get(`/v1/schools/${schoolA.id}/instructors`, tokenOwnerA, { search: WORD });
    expect(ids(all)).toContain(instructorProfileA.id);
    expect(ids(all)).not.toContain(instructorProfileAArchived.id);
    expect(ids(all)).not.toContain(instructorProfileB.id);
  });

  it('Instructors: a name that matches nobody gives an empty page', async () => {
    const res = await get(`/v1/schools/${schoolA.id}/instructors`, tokenOwnerA, { search: `${WORD}nobody` });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('Instructors: searching another School is still refused', async () => {
    const res = await get(`/v1/schools/${schoolB.id}/instructors`, tokenOwnerA, { search: WORD });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Branches — GET /schools/:schoolId/branches?search=
  // ---------------------------------------------------------------------------

  it('Branches: matches by name, excludes archived Branches and other Schools', async () => {
    const res = await get(`/v1/schools/${schoolA.id}/branches`, tokenOwnerA, { search: `${WORD.toLowerCase()} north` });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([branchA1.id]);

    const all = await get(`/v1/schools/${schoolA.id}/branches`, tokenOwnerA, { search: 'dojo' });
    expect(ids(all)).toEqual(expect.arrayContaining([branchA1.id, branchA2.id]));
    expect(ids(all)).not.toContain(branchA3Archived.id);
    expect(ids(all)).not.toContain(branchB1.id);
  });

  it('Branches: a Branch Staff search stays inside their own Branch (RLS unchanged)', async () => {
    const res = await get(`/v1/schools/${schoolA.id}/branches`, tokenBranchStaffA1, { search: WORD });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([branchA1.id]);
  });

  it('Branches: searching another School is still refused', async () => {
    const res = await get(`/v1/schools/${schoolB.id}/branches`, tokenOwnerA, { search: WORD });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Franchises — GET /franchises?search=
  // ---------------------------------------------------------------------------

  it('Franchises: matches by name, only Franchises the caller owns', async () => {
    const res = await get('/v1/franchises', tokenFranchiseOwnerA, { search: `${WORD.toLowerCase()} martial arts g` });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([franchiseA.id]);
    expect(ids(res)).not.toContain(franchiseB.id);
  });

  it('Franchises: excludeArchived=true leaves a matching archived Franchise out; without it, it is still listed', async () => {
    const q = `${WORD.toLowerCase()} martial`;
    const excluded = await get('/v1/franchises', tokenFranchiseOwnerA, { search: q, excludeArchived: 'true' });
    expect(excluded.status).toBe(200);
    expect(ids(excluded)).toEqual([franchiseA.id]);

    // Today's default is unchanged: the Franchises page still lists closed Franchises.
    for (const query of [{ search: q }, { search: q, excludeArchived: 'false' }] as Array<Record<string, string>>) {
      const res = await get('/v1/franchises', tokenFranchiseOwnerA, query);
      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(expect.arrayContaining([franchiseA.id, franchiseAArchived.id]));
      expect(ids(res)).not.toContain(franchiseB.id);
    }

    const bad = await get('/v1/franchises', tokenFranchiseOwnerA, { excludeArchived: 'yes' });
    expect(bad.status).toBe(400);
  });

  it('Franchises: a School Owner with no Franchise grant finds none, even by an exact name', async () => {
    const res = await get('/v1/franchises', tokenOwnerA, { search: `${WORD} Martial Arts Group` });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Validation — same length limit as ClassesQueryDto.search
  // ---------------------------------------------------------------------------

  it('rejects a search longer than 200 characters on every endpoint', async () => {
    const tooLong = 'a'.repeat(201);
    for (const path of [
      `/v1/schools/${schoolA.id}/students`,
      `/v1/schools/${schoolA.id}/instructors`,
      `/v1/schools/${schoolA.id}/branches`,
      '/v1/franchises',
    ]) {
      const res = await get(path, tokenOwnerA, { search: tooLong });
      expect(res.status).toBe(400);
    }
  });

  it('trims surrounding spaces before matching', async () => {
    const res = await get(`/v1/schools/${schoolA.id}/branches`, tokenOwnerA, { search: `   ${WORD} south   ` });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([branchA2.id]);
  });

  it('Classes: trims surrounding spaces too, and a search of only spaces means no filter', async () => {
    const res = await get(`/v1/schools/${schoolA.id}/classes`, tokenOwnerA, { search: `   ${WORD} north   ` });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([classA1.id]);

    const blank = await get(`/v1/schools/${schoolA.id}/classes`, tokenOwnerA, { search: '   ' });
    expect(blank.status).toBe(200);
    expect(ids(blank)).toEqual(expect.arrayContaining([classA1.id, classA2Percent.id]));
  });

  // ---------------------------------------------------------------------------
  // LIKE wildcards — `%` and `_` are matched literally
  // ---------------------------------------------------------------------------

  it('`%` matches a literal percent sign, not any text (Branches, Classes, Franchises)', async () => {
    const branches = await get(`/v1/schools/${schoolA.id}/branches`, tokenOwnerA, { search: '100%' });
    expect(ids(branches)).toEqual([branchA4Percent.id]);
    const branchesWild = await get(`/v1/schools/${schoolA.id}/branches`, tokenOwnerA, { search: `${WORD}%Dojo` });
    expect(ids(branchesWild)).toEqual([]);

    const classes = await get(`/v1/schools/${schoolA.id}/classes`, tokenOwnerA, { search: '100%' });
    expect(ids(classes)).toEqual([classA2Percent.id]);
    const classesWild = await get(`/v1/schools/${schoolA.id}/classes`, tokenOwnerA, { search: `${WORD}%Kata` });
    expect(ids(classesWild)).toEqual([]);

    const franchises = await get('/v1/franchises', tokenFranchiseOwnerA, { search: `${WORD}%Group` });
    expect(franchises.status).toBe(200);
    expect(ids(franchises)).toEqual([]);
  });

  it('`_` matches a literal underscore, not any one character (Branches, Classes, Franchises)', async () => {
    const branches = await get(`/v1/schools/${schoolA.id}/branches`, tokenOwnerA, { search: `${WORD} N_rth` });
    expect(branches.status).toBe(200);
    expect(ids(branches)).toEqual([]);

    const classes = await get(`/v1/schools/${schoolA.id}/classes`, tokenOwnerA, { search: `${WORD} N_rth` });
    expect(classes.status).toBe(200);
    expect(ids(classes)).toEqual([]);

    const franchises = await get('/v1/franchises', tokenFranchiseOwnerA, { search: `${WORD} M_rtial` });
    expect(franchises.status).toBe(200);
    expect(ids(franchises)).toEqual([]);

    // Control: the same searches without the wildcard do match.
    const control = await get(`/v1/schools/${schoolA.id}/branches`, tokenOwnerA, { search: `${WORD} North` });
    expect(ids(control)).toEqual([branchA1.id]);
  });
});
