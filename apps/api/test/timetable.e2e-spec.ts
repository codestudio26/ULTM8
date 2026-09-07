/**
 * HTTP-level cross-tenant isolation gate for TimetableModule (Phase 5), same ground
 * rule as classes.e2e-spec.ts: prove over real HTTP that an authenticated request from
 * one tenant actually gets rejected/empty when targeting another tenant's
 * TimetableSlot, and that the shared TenantAuthorizationService validators (moved out
 * of ClassesService this phase) still behave correctly for a second consumer.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
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
    '[timetable.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('TimetableModule — HTTP-level cross-tenant isolation', () => {
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
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenBranchStaffA1: string;

  const slotIds: string[] = [];

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

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Timetable HTTP School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Timetable HTTP School B' } });
    branchA1 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Timetable Branch A1' } });
    branchA2 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Timetable Branch A2' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `timetable-http-${label}-${randomUUID()}@example.test`,
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
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: instructorSchoolWide.id, schoolId: schoolA.id },
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
    await superuser.class.deleteMany({ where: { timetableSlotId: { in: slotIds } } });
    await superuser.timetableSlot.deleteMany({ where: { id: { in: slotIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA1.id, branchA2.id] } } });
    await superuser.user.deleteMany({ where: { email: { contains: 'timetable-http-' } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  function slotBody(overrides: Record<string, unknown> = {}) {
    return {
      weekday: 'MONDAY',
      startTime: '18:00',
      endTime: '19:00',
      title: 'Fixture Slot',
      activities: ['BJJ'],
      ...overrides,
    };
  }

  it('cannot create a TimetableSlot under another tenant\'s School', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/timetable`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(slotBody());
    expect(res.status).toBe(404);
  });

  it('cannot list another tenant\'s TimetableSlots', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolB.id}/timetable`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
  });

  it('cannot GET or PATCH another tenant\'s TimetableSlot', async () => {
    const created = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: schoolB.id,
        weekday: 'TUESDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 17, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        title: 'School B Slot',
        activities: ['Yoga'],
      },
    });
    slotIds.push(created.id);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/timetable/${created.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/timetable/${created.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ title: 'HACKED' });
    expect([403, 404]).toContain(patchRes.status);
    const unchanged = await superuser.timetableSlot.findUniqueOrThrow({ where: { id: created.id } });
    expect(unchanged.title).toBe('School B Slot');
  });

  it('CAN create, read, and update a TimetableSlot within its own School', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/timetable`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(slotBody({ title: 'Owned Slot', instructorId: instructorSchoolWide.id }));
    expect(createRes.status).toBe(201);
    expect(createRes.body.startTime).toBe('18:00'); // HH:mm round-trip, not a full ISO timestamp
    slotIds.push(createRes.body.id);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/timetable/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/timetable/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ description: 'Updated by owner A' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.description).toBe('Updated by owner A');
  });

  it('a Branch-scoped grant sees its own Branch\'s slots and School-wide slots, never another Branch\'s', async () => {
    const schoolWide = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/timetable`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(slotBody({ title: 'School-wide Slot' }));
    expect(schoolWide.status).toBe(201);
    slotIds.push(schoolWide.body.id);

    const inBranchA1 = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/timetable`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(slotBody({ title: 'Branch A1 Slot', branchId: branchA1.id }));
    expect(inBranchA1.status).toBe(201);
    slotIds.push(inBranchA1.body.id);

    const inBranchA2 = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/timetable`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(slotBody({ title: 'Branch A2 Slot', branchId: branchA2.id }));
    expect(inBranchA2.status).toBe(201);
    slotIds.push(inBranchA2.body.id);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/timetable`)
      .set('Authorization', `Bearer ${tokenBranchStaffA1}`);
    expect(listRes.status).toBe(200);
    const ids = listRes.body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(schoolWide.body.id);
    expect(ids).toContain(inBranchA1.body.id);
    expect(ids).not.toContain(inBranchA2.body.id);
  });

  it('rejects a branch-only PATCH that would leave an incompatible instructor in place (shared validator reused correctly)', async () => {
    const branchInstructor = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `timetable-http-instructor-a2-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Instructor',
        surname: 'A2',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'INSTRUCTOR', userId: branchInstructor.id, schoolId: schoolA.id, branchId: branchA2.id },
    });

    const created = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/timetable`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(slotBody({ title: 'Branch-only patch target', branchId: branchA2.id, instructorId: branchInstructor.id }));
    expect(created.status).toBe(201);
    slotIds.push(created.body.id);

    const patched = await request(app.getHttpServer())
      .patch(`/v1/timetable/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ branchId: branchA1.id });
    expect(patched.status).toBe(400);

    await superuser.user.delete({ where: { id: branchInstructor.id } }).catch(() => undefined);
  });
});
