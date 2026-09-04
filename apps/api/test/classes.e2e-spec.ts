/**
 * HTTP-level cross-tenant isolation gate for ClassesModule (Phase 4), same ground rule
 * as tenants.e2e-spec.ts: prove over real HTTP, not just by reading the RLS SQL, that an
 * authenticated request from one tenant actually gets rejected/empty when targeting
 * another tenant's Class.
 *
 * This suite specifically exercises the two pieces of Phase 4's design flagged as novel/
 * inferred and needing verification (see the Phase 4 kickoff prompt):
 *  1. class_tenant_isolation's three-way branch OR — a Branch-scoped grant sees its own
 *     Branch's Classes plus School-wide (branchId null) ones, never another Branch's.
 *  2. ClassesService's instructor-branch validation — a School-scoped Instructor
 *     (branchId null) may be assigned to a Branch-specific Class; a Branch-scoped
 *     Instructor may not be assigned to a DIFFERENT Branch's Class, but may be assigned
 *     to a School-wide one.
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
    '[classes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('ClassesModule — HTTP-level cross-tenant isolation', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let branchA1: { id: string };
  let branchA2: { id: string };
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let instructorSchoolWide: { id: string };
  let instructorBranchA2: { id: string };
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenBranchStaffA1: string;

  const classIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Classes HTTP School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Classes HTTP School B' } });
    branchA1 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Classes Branch A1' } });
    branchA2 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Classes Branch A2' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `classes-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    ownerA = await mkUser('owner-a');
    ownerB = await mkUser('owner-b');
    instructorSchoolWide = await mkUser('instructor-school-wide');
    instructorBranchA2 = await mkUser('instructor-branch-a2');

    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id },
    });
    const branchStaffA1User = await mkUser('branch-staff-a1');
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaffA1User.id, schoolId: schoolA.id, branchId: branchA1.id },
    });
    // School-scoped Instructor grant — branchId null, "floats" across every Branch.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: instructorSchoolWide.id, schoolId: schoolA.id },
    });
    // Branch-scoped Instructor grant — tied to branchA2 only.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: instructorBranchA2.id, schoolId: schoolA.id, branchId: branchA2.id },
    });

    tokenOwnerA = signAccessToken(ownerA, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null },
    ]);
    tokenOwnerB = signAccessToken(ownerB, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolB.id, branchId: null },
    ]);
    tokenBranchStaffA1 = signAccessToken(branchStaffA1User, [
      { role: 'BRANCH_STAFF', franchiseId: null, schoolId: schoolA.id, branchId: branchA1.id },
    ]);
  });

  afterAll(async () => {
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA1.id, branchA2.id] } } });
    await superuser.user.deleteMany({
      where: { email: { contains: 'classes-http-' } },
    });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  function classBody(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Fixture Class',
      activities: ['BJJ'],
      startDate: '2026-10-01T10:00:00.000Z',
      endDate: '2026-10-01T11:00:00.000Z',
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // Negative: School A's owner reaching for School B's Classes over HTTP
  // ---------------------------------------------------------------------------

  it('cannot create a Class under another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody());
    expect(res.status).toBe(404);
  });

  it('cannot list another tenant\'s Classes via the School-scoped list route', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolB.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
  });

  it('cannot GET or PATCH another tenant\'s Class', async () => {
    const created = await superuser.class.create({
      data: { id: randomUUID(), schoolId: schoolB.id, title: 'School B Class', activities: ['Yoga'], startDate: new Date(), endDate: new Date() },
    });
    classIds.push(created.id);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/classes/${created.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/classes/${created.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ title: 'HACKED' });
    expect([403, 404]).toContain(patchRes.status);
    const unchanged = await superuser.class.findUniqueOrThrow({ where: { id: created.id } });
    expect(unchanged.title).toBe('School B Class');
  });

  // ---------------------------------------------------------------------------
  // Positive control — proves the negatives above are real isolation, not every
  // request failing regardless of tenant.
  // ---------------------------------------------------------------------------

  it('CAN create, read, and update a Class within its own School', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody({ title: 'Owned Class' }));
    expect(createRes.status).toBe(201);
    classIds.push(createRes.body.id);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/classes/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/classes/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ description: 'Updated by owner A' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.description).toBe('Updated by owner A');
  });

  // ---------------------------------------------------------------------------
  // The novel piece: class_tenant_isolation's three-way branch OR.
  // ---------------------------------------------------------------------------

  it('a Branch-scoped grant sees its own Branch\'s Classes and School-wide Classes, never another Branch\'s', async () => {
    const schoolWide = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody({ title: 'School-wide Class' })); // no branchId
    expect(schoolWide.status).toBe(201);
    classIds.push(schoolWide.body.id);

    const inBranchA1 = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody({ title: 'Branch A1 Class', branchId: branchA1.id }));
    expect(inBranchA1.status).toBe(201);
    classIds.push(inBranchA1.body.id);

    const inBranchA2 = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody({ title: 'Branch A2 Class', branchId: branchA2.id }));
    expect(inBranchA2.status).toBe(201);
    classIds.push(inBranchA2.body.id);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenBranchStaffA1}`);
    expect(listRes.status).toBe(200);
    const ids = listRes.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(schoolWide.body.id);
    expect(ids).toContain(inBranchA1.body.id);
    expect(ids).not.toContain(inBranchA2.body.id);
  });

  // ---------------------------------------------------------------------------
  // The other novel piece: instructor branch-matching validation.
  // ---------------------------------------------------------------------------

  it('a School-scoped Instructor CAN be assigned to a Branch-specific Class', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody({ title: 'Taught by floating instructor', branchId: branchA1.id, instructorId: instructorSchoolWide.id }));
    expect(res.status).toBe(201);
    classIds.push(res.body.id);
  });

  it('a Branch-scoped Instructor CANNOT be assigned to a DIFFERENT Branch\'s Class', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody({ title: 'Mismatched instructor', branchId: branchA1.id, instructorId: instructorBranchA2.id }));
    expect(res.status).toBe(400);
  });

  it('a Branch-scoped Instructor CAN be assigned to a School-wide Class', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/classes`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(classBody({ title: 'School-wide, branch instructor', instructorId: instructorBranchA2.id })); // no branchId
    expect(res.status).toBe(201);
    classIds.push(res.body.id);
  });
});
