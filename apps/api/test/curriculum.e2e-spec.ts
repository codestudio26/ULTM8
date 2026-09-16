/**
 * HTTP-level gate for CurriculumModule (Phase 44, Decision 104) — the
 * assertStaffAtSchool write gate on createLesson/updateLesson, the skillIds ->
 * Skill-must-belong-to-School validation, the two Spec 55 §7-confirmed read
 * routes (GET /skills/:id/lessons, GET /lessons/:id), and Lesson's own RLS shape
 * (lesson_tenant_isolation — ANY active RoleGrant holder at the School, Student
 * included, per Decision 58's own "surfacing automatically... a student's
 * profile"; zero rows for a caller with no RoleGrant at all).
 *
 * Deliberately NOT covered here: the actual video-upload/captioning pipeline
 * (Decision 101 picked vendors, did not build the integration — no credentials
 * exist in this working environment) and Category (Decision 104's own "flag to
 * the Architect" item, not a real entity).
 *
 * Same ground rule as every other e2e spec in this repo: prove over real HTTP,
 * not just by reading the code. Requires DATABASE_URL, DATABASE_URL_APP,
 * JWT_ACCESS_SECRET.
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
    '[curriculum.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('CurriculumModule — HTTP-level Lesson CRUD, skillIds validation, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let ownerA: { id: string; email: string };
  let instructorA: { id: string; email: string };
  let studentA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let tokenOwnerA: string;
  let tokenInstructorA: string;
  let tokenStudentA: string;

  const schoolIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  let disciplineA: { id: string };
  let skillA: { id: string };
  let skillFromSchoolB: { id: string };
  let lessonId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Curriculum HTTP School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Curriculum HTTP School B' } });
    schoolIds.push(schoolA.id, schoolB.id);

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `curriculum-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    ownerA = await mkUser('owner-a');
    instructorA = await mkUser('instructor-a');
    studentA = await mkUser('student-a');
    ownerB = await mkUser('owner-b');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: instructorA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id },
      ],
    });

    tokenOwnerA = signAccessToken(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenInstructorA = signAccessToken(instructorA, [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: schoolA.id, branchId: null }]);

    disciplineA = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Curriculum HTTP Discipline' } });
    skillA = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: disciplineA.id, schoolId: schoolA.id, name: 'Armbar' } });

    const disciplineB = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolB.id, name: 'Curriculum HTTP Discipline B' } });
    skillFromSchoolB = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: disciplineB.id, schoolId: schoolB.id, name: 'Other School Skill' } });
  });

  afterAll(async () => {
    await superuser.lessonSkill.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
    await superuser.lesson.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.skill.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { email: { contains: 'curriculum-http-' } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Write gate — assertStaffAtSchool (Owner/Manager, Branch Staff, Instructor)
  // ---------------------------------------------------------------------------

  it('a Student cannot create a Lesson; an Instructor can (write gate)', async () => {
    const forbidden = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/curriculum/lessons`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ title: 'Denied', format: 'PRERECORDED', skillIds: [skillA.id] });
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/curriculum/lessons`)
      .set('Authorization', `Bearer ${tokenInstructorA}`)
      .send({
        title: 'Armbar From Guard',
        category: 'Fundamentals',
        durationSeconds: 300,
        description: 'Basic armbar setup.',
        format: 'PRERECORDED',
        instructorId: instructorA.id,
        skillIds: [skillA.id],
      });
    expect(res.status).toBe(201);
    lessonId = res.body.id;
    expect(res.body.schoolId).toBe(schoolA.id);
    expect(res.body.instructorId).toBe(instructorA.id);
    expect(res.body.skillIds).toEqual([skillA.id]);
    expect(res.body.captionStatus).toBe('PENDING');
    expect(res.body.videoRef).toBeNull();
    expect(res.body.captionTrackRef).toBeNull();
    expect(res.body.skills).toBeUndefined(); // the raw LessonSkill join rows must not leak onto the wire
  });

  it('a Student cannot update a Lesson; the School Owner can (write gate applies to updateLesson too)', async () => {
    const forbidden = await request(app.getHttpServer())
      .patch(`/v1/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ title: 'Denied' });
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer())
      .patch(`/v1/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ title: 'Armbar From Closed Guard' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Armbar From Closed Guard');
    expect(res.body.skillIds).toEqual([skillA.id]); // omitted skillIds leaves the existing set unchanged
  });

  // ---------------------------------------------------------------------------
  // skillIds validation — must all belong to the target School
  // ---------------------------------------------------------------------------

  it('skillIds referencing a Skill from a different School are rejected — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/curriculum/lessons`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ title: 'Cross-School Skill', format: 'PRERECORDED', skillIds: [skillFromSchoolB.id] });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Spec 55 §7-confirmed read routes
  // ---------------------------------------------------------------------------

  it('GET /skills/:id/lessons returns Lessons linked to that Skill', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/skills/${skillA.id}/lessons`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(res.status).toBe(200);
    const found = res.body.items.find((l: { id: string }) => l.id === lessonId);
    expect(found).toBeDefined();
    expect(found.skillIds).toEqual([skillA.id]);
  });

  it('GET /lessons/:id returns the full Lesson shape', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(lessonId);
    expect(res.body.skillIds).toEqual([skillA.id]);
    expect(res.body.format).toBe('PRERECORDED');
  });

  // ---------------------------------------------------------------------------
  // RLS — lesson_tenant_isolation: ANY active RoleGrant holder at the School
  // (Student included), zero rows for a caller with none. Direct Prisma, not
  // HTTP — same reasoning ranks.e2e-spec.ts documents for StudentRank/
  // PromotionEvent's own direct-Prisma RLS checks.
  // ---------------------------------------------------------------------------

  it('RLS: a Student (or any other active RoleGrant holder) at the School can broadly read Lesson rows', async () => {
    const asStudentA = await withUser(studentA.id, (tx) => tx.lesson.findMany({ where: { id: lessonId } }));
    expect(asStudentA).toHaveLength(1);

    const asInstructorA = await withUser(instructorA.id, (tx) => tx.lesson.findMany({ where: { id: lessonId } }));
    expect(asInstructorA).toHaveLength(1);
  });

  it('RLS: a caller with no RoleGrant at this School gets zero Lesson rows, even for an existing id', async () => {
    const asOwnerB = await withUser(ownerB.id, (tx) => tx.lesson.findMany({ where: { id: lessonId } }));
    expect(asOwnerB).toHaveLength(0);
  });

  it('RLS: LessonSkill delegates to Lesson/Skill visibility — a caller with no RoleGrant at the School sees zero LessonSkill rows for it', async () => {
    const asOwnerB = await withUser(ownerB.id, (tx) => tx.lessonSkill.findMany({ where: { lessonId } }));
    expect(asOwnerB).toHaveLength(0);

    const asStudentA = await withUser(studentA.id, (tx) => tx.lessonSkill.findMany({ where: { lessonId } }));
    expect(asStudentA).toHaveLength(1);
  });
});
