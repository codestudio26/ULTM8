/**
 * GET /timetable/:id/occurrence?date= — Timetable page redesign (click-to-book).
 * See TimetableService.findOccurrence's own header comment for the full rationale
 * (SKILL.md §9, `[CONFIRMED]`, resolved 24 Aug 2026 — a bookable Class is either
 * materialized ahead of time by class-occurrence-generation.processor.ts or
 * created as an independent one-off, never on demand). This spec proves, over
 * real HTTP, the four outcomes the backlog write-up calls out: a materialized
 * Class is found, a not-yet-materialized date 404s cleanly (never a 500, never
 * created on the fly), cross-tenant isolation holds, and a non-Staff caller is
 * rejected.
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
    '[timetable-occurrence.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('TimetableController.findOccurrence — GET /timetable/:id/occurrence', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenStudentA: string;
  let slotA: { id: string; schoolId: string; title: string };

  const slotIds: string[] = [];
  const classIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  function mkUser(label: string) {
    return superuser.user.create({
      data: {
        id: randomUUID(),
        email: `timetable-occurrence-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Occurrence HTTP School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Occurrence HTTP School B' } });

    ownerA = await mkUser('owner-a');
    ownerB = await mkUser('owner-b');
    const studentA = await mkUser('student-a');

    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: schoolA.id } });

    tokenOwnerA = signAccessToken(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenOwnerB = signAccessToken(ownerB, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolB.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: schoolA.id, branchId: null }]);

    slotA = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: schoolA.id,
        weekday: 'MONDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        title: 'Occurrence Fixture Slot',
        activities: ['BJJ'],
        status: 'ON',
      },
    });
    slotIds.push(slotA.id);
  });

  afterAll(async () => {
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.timetableSlot.deleteMany({ where: { id: { in: slotIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await superuser.user.deleteMany({ where: { email: { contains: 'timetable-occurrence-' } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('finds the materialized Class for a date the slot was already generated for', async () => {
    const cls = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: schoolA.id,
        timetableSlotId: slotA.id,
        occurrenceDate: new Date('2026-11-02T00:00:00.000Z'), // a Monday
        title: slotA.title,
        activities: ['BJJ'],
        startDate: new Date('2026-11-02T18:00:00.000Z'),
        endDate: new Date('2026-11-02T19:00:00.000Z'),
      },
    });
    classIds.push(cls.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slotA.id}/occurrence`)
      .query({ date: '2026-11-02' })
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(cls.id);
    expect(res.body.timetableSlotId).toBe(slotA.id);
  });

  it('404s cleanly — not an unhandled 500 — for a date nothing has been materialized for yet', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slotA.id}/occurrence`)
      .query({ date: '2026-12-28' }) // beyond the 4-week generation horizon, nothing seeded
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/not been generated|generation horizon/i);
  });

  it('cross-School isolation — School B\'s owner gets 404, never School A\'s slot/Class', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slotA.id}/occurrence`)
      .query({ date: '2026-11-02' })
      .set('Authorization', `Bearer ${tokenOwnerB}`);
    expect(res.status).toBe(404);
  });

  it('rejects a non-Staff caller (a Student at the SAME School) even though the slot is RLS-visible to them', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slotA.id}/occurrence`)
      .query({ date: '2026-11-02' })
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed date', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slotA.id}/occurrence`)
      .query({ date: 'not-a-date' })
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(400);
  });
});
