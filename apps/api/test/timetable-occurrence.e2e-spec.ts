/**
 * HTTP-level gate for `GET /timetable/:id/occurrences/:date` — the v1.2
 * backend backlog's Timetable "Book" action gap (Decision 235). Seeds a
 * `Class` row directly, matching the exact (timetableSlotId, occurrenceDate)
 * shape `ClassOccurrenceGenerationProcessor` itself writes (that job's own
 * generation logic is covered separately in
 * class-occurrence-generation.e2e-spec.ts — this suite's only job is
 * proving the lookup resolves what the job already materialized).
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
    '[timetable-occurrence.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('GET /timetable/:id/occurrences/:date — resolve a TimetableSlot occurrence to its Class', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let owner: { id: string; email: string };
  let student: { id: string; email: string };
  let outsiderOwner: { id: string; email: string };
  let slot: { id: string };
  let materializedClass: { id: string };
  let tokenOwner: string;
  let tokenStudent: string;
  let tokenOutsiderOwner: string;

  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const slotIds: string[] = [];
  const classIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function mkUser(label: string) {
    return superuser.user.create({
      data: {
        id: randomUUID(),
        email: `timetable-occurrence-http-${label}-${randomUUID()}@example.test`,
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

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Timetable Occurrence HTTP School' } });
    schoolIds.push(school.id);
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Timetable Occurrence HTTP Other School' } });
    schoolIds.push(otherSchool.id);

    owner = await mkUser('owner');
    userIds.push(owner.id);
    student = await mkUser('student');
    userIds.push(student.id);
    outsiderOwner = await mkUser('outsider-owner');
    userIds.push(outsiderOwner.id);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: outsiderOwner.id, schoolId: otherSchool.id },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudent = signAccessToken(student, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOutsiderOwner = signAccessToken(outsiderOwner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: otherSchool.id, branchId: null }]);

    slot = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        weekday: 'MONDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        status: 'ON',
        title: 'Evening Judo',
      },
    });
    slotIds.push(slot.id);

    // Matches ClassOccurrenceGenerationProcessor's own output shape exactly —
    // a UTC-midnight occurrenceDate, startDate/endDate on that same calendar day.
    materializedClass = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        timetableSlotId: slot.id,
        occurrenceDate: new Date(Date.UTC(2027, 10, 22)),
        title: 'Evening Judo',
        startDate: new Date(Date.UTC(2027, 10, 22, 18, 0)),
        endDate: new Date(Date.UTC(2027, 10, 22, 19, 0)),
      },
    });
    classIds.push(materializedClass.id);
  });

  afterAll(async () => {
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.timetableSlot.deleteMany({ where: { id: { in: slotIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('resolves to the already-materialized Class for a School Owner', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slot.id}/occurrences/2027-11-22`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(200);
    expect(res.body.classId).toBe(materializedClass.id);
    expect(res.body.title).toBe('Evening Judo');
  });

  it('also resolves for a Student — no Staff-only gate, same RLS shape as the slot/Class rows themselves', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slot.id}/occurrences/2027-11-22`)
      .set('Authorization', `Bearer ${tokenStudent}`);
    expect(res.status).toBe(200);
    expect(res.body.classId).toBe(materializedClass.id);
  });

  it('404s for a date nothing has been materialized for yet (not a silent on-demand create)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slot.id}/occurrences/2027-11-29`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(404);
  });

  it("a different School's Owner cannot resolve this School's slot — 404, not leaked", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slot.id}/occurrences/2027-11-22`)
      .set('Authorization', `Bearer ${tokenOutsiderOwner}`);
    expect(res.status).toBe(404);
  });

  it('404s for a nonexistent TimetableSlot id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${randomUUID()}/occurrences/2027-11-22`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed date with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/timetable/${slot.id}/occurrences/not-a-date`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(res.status).toBe(400);
  });
});
