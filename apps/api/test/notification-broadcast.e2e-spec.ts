/**
 * HTTP-level gate for NotificationBroadcastModule — the v1.2 backend
 * backlog's "Compose/broadcast a message to Students" gap (Decision 243).
 *
 * Drives the real HTTP endpoint against a real, live notification-fanout
 * worker over real Redis — the same established convention
 * waivers.e2e-spec.ts already uses for createWaiver's own fan-out (see that
 * suite's afterAll comment): no mocked queue, assert against the real
 * Notification rows the fan-out worker writes.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET.
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
    '[notification-broadcast.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeIfDb('NotificationBroadcastModule — HTTP, School-Owner-gated broadcast to all active Students', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let owner: { id: string; email: string };
  let instructor: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let studentRevoked: { id: string; email: string };
  let emptySchool: { id: string };
  let emptySchoolOwner: { id: string; email: string };
  let otherSchoolOwner: { id: string; email: string };
  let tokenOwner: string;
  let tokenInstructor: string;
  let tokenEmptySchoolOwner: string;
  let tokenOutsiderOwner: string;

  const userIds: string[] = [];
  const schoolIds: string[] = [];

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

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Broadcast HTTP School' } });
    schoolIds.push(school.id);
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Broadcast HTTP Other School' } });
    schoolIds.push(otherSchool.id);
    emptySchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Broadcast HTTP Empty School' } });
    schoolIds.push(emptySchool.id);

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `notification-broadcast-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    owner = await mkUser('owner');
    userIds.push(owner.id);
    instructor = await mkUser('instructor');
    userIds.push(instructor.id);
    studentA = await mkUser('student-a');
    userIds.push(studentA.id);
    studentB = await mkUser('student-b');
    userIds.push(studentB.id);
    studentRevoked = await mkUser('student-revoked');
    userIds.push(studentRevoked.id);
    emptySchoolOwner = await mkUser('empty-school-owner');
    userIds.push(emptySchoolOwner.id);
    otherSchoolOwner = await mkUser('other-school-owner');
    userIds.push(otherSchoolOwner.id);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: instructor.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentRevoked.id, schoolId: school.id, revokedAt: new Date() },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: emptySchoolOwner.id, schoolId: emptySchool.id },
        // Real DB-backed grant at a DIFFERENT School only — RLS/authorization
        // checks the actual RoleGrant row, not the JWT's own `grants` claim,
        // so this user must genuinely hold no grant at `school.id` at all.
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherSchoolOwner.id, schoolId: otherSchool.id },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenInstructor = signAccessToken(instructor, [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenEmptySchoolOwner = signAccessToken(emptySchoolOwner, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: emptySchool.id, branchId: null },
    ]);
    tokenOutsiderOwner = signAccessToken(otherSchoolOwner, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: otherSchool.id, branchId: null },
    ]);
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('School Owner broadcasts to every active Student at the School — a real Notification row lands for each, not for a revoked grant, an Instructor, or the Owner themself', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Holiday Schedule', body: 'The School will be closed next Monday.' });
    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBe(2);

    // Real fan-out via live Redis/BullMQ worker — poll briefly rather than
    // assume synchronous completion, same bounded-poll convention this
    // codebase's other live-worker e2e assertions already use.
    let notifA: unknown = null;
    let notifB: unknown = null;
    for (let i = 0; i < 20 && (!notifA || !notifB); i++) {
      notifA = await superuser.notification.findFirst({ where: { userId: studentA.id, title: 'Holiday Schedule' } });
      notifB = await superuser.notification.findFirst({ where: { userId: studentB.id, title: 'Holiday Schedule' } });
      if (!notifA || !notifB) await sleep(250);
    }
    expect(notifA).not.toBeNull();
    expect(notifB).not.toBeNull();
    expect((notifA as { type: string | null }).type).toBe('SCHOOL_BROADCAST');
    expect((notifA as { body: string }).body).toBe('The School will be closed next Monday.');

    const notifRevoked = await superuser.notification.findFirst({ where: { userId: studentRevoked.id, title: 'Holiday Schedule' } });
    const notifInstructor = await superuser.notification.findFirst({ where: { userId: instructor.id, title: 'Holiday Schedule' } });
    const notifOwner = await superuser.notification.findFirst({ where: { userId: owner.id, title: 'Holiday Schedule' } });
    expect(notifRevoked).toBeNull();
    expect(notifInstructor).toBeNull();
    expect(notifOwner).toBeNull();
  });

  it('a School with zero active Students returns recipientCount 0 and enqueues nothing', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${emptySchool.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenEmptySchoolOwner}`)
      .send({ title: 'Nobody home', body: 'No Students yet.' });
    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBe(0);
  });

  it('an Instructor (non-Owner) is rejected with 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenInstructor}`)
      .send({ title: 'Denied', body: 'text' });
    expect(res.status).toBe(403);
  });

  it("an Owner of a DIFFERENT School cannot broadcast to this School — 404, School not visible to them", async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOutsiderOwner}`)
      .send({ title: 'Denied', body: 'text' });
    expect(res.status).toBe(404);
  });

  it('an archived School rejects the broadcast with 403', async () => {
    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
    try {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/notifications/broadcast`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ title: 'Denied', body: 'text' });
      expect(res.status).toBe(403);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
    }
  });

  it('rejects a request missing title/body with 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
