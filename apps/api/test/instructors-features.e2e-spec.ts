/**
 * Instructors features (Decision 312) over real HTTP and a real Postgres: the
 * "hasn't signed in yet" flag, the instructor's own profile read, the
 * certification download link, and handing classes to another instructor.
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
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[instructors-features.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}


describeIfDb('Instructors features (Decision 312)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolA = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  let owner: { id: string; email: string };
  let token: string;

  const mkUser = (label: string, mustChangePasscode = false) =>
    superuser.user.create({
      data: { id: randomUUID(), email: `instr-feat-${label}-${randomUUID()}@example.test`, firstName: label, surname: 'Feat', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), mustChangePasscode },
    });
  const grant = (userId: string, branchId: string | null = null) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId, schoolId: schoolA, branchId } });
  const profile = (userId: string, data: Record<string, unknown> = {}) =>
    superuser.instructor.create({ data: { id: randomUUID(), userId, schoolId: schoolA, ...data } });
  const coachToken = (u: { id: string; email: string }, branchId: string | null = null) =>
    jwt.sign({ sub: u.id, email: u.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: schoolA, branchId }] });
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
  const mkClass = (instructorId: string, offsetDays: number, branchId: string | null = null, extra: Record<string, unknown> = {}) =>
    superuser.class.create({
      data: { id: randomUUID(), schoolId: schoolA, branchId, instructorId, title: 'Feat class', startDate: inDays(offsetDays), endDate: new Date(inDays(offsetDays).getTime() + 3_600_000), ...extra },
    });
  const mkSlot = (instructorId: string, status: 'ON' | 'OFF' = 'ON', branchId: string | null = null) =>
    superuser.timetableSlot.create({
      data: { id: randomUUID(), schoolId: schoolA, branchId, instructorId, weekday: 'MONDAY', startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)), endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)), status, title: 'Feat slot' },
    });
  const http = () => app.getHttpServer();
  const asOwner = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({ sendEmail: async () => undefined, sendPush: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolA, name: 'Instructor features A' } });
    await superuser.branch.create({ data: { id: branchA1, schoolId: schoolA, name: 'Feat A1' } });
    await superuser.branch.create({ data: { id: branchA2, schoolId: schoolA, name: 'Feat A2' } });
    owner = await mkUser('owner');
    // Granting a role needs a verified phone (the role-grant endpoint's own rule).
    await superuser.user.update({ where: { id: owner.id }, data: { phone: `+1555${Date.now().toString().slice(-7)}`, phoneVerifiedAt: new Date() } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: schoolA } });
    token = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA, branchId: null }] });
  });

  afterAll(async () => {
    await superuser.class.deleteMany({ where: { schoolId: schoolA } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: schoolA } });
    await superuser.instructor.deleteMany({ where: { schoolId: schoolA } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: schoolA } });
    await superuser.branch.deleteMany({ where: { schoolId: schoolA } });
    await superuser.user.deleteMany({ where: { email: { startsWith: 'instr-feat-' } } });
    await superuser.school.deleteMany({ where: { id: schoolA } });
    await superuser.$disconnect();
    await app.close();
  });

  it('shows who has not signed in yet, on the list and on the detail', async () => {
    const fresh = await mkUser('fresh', true);
    await grant(fresh.id);
    const freshProfile = await profile(fresh.id);
    const seasoned = await mkUser('seasoned');
    await grant(seasoned.id);
    await profile(seasoned.id);

    const list = await asOwner(request(http()).get(`/v1/schools/${schoolA}/instructors`).query({ limit: 100 }));
    expect(list.status).toBe(200);
    const byUser = new Map(list.body.items.map((i: { userId: string; awaitingFirstLogin: boolean }) => [i.userId, i.awaitingFirstLogin]));
    expect(byUser.get(fresh.id)).toBe(true);
    expect(byUser.get(seasoned.id)).toBe(false);

    const detail = await asOwner(request(http()).get(`/v1/instructors/${freshProfile.id}`));
    expect(detail.body.awaitingFirstLogin).toBe(true);
  });

  it('lets an instructor read their own profile, and returns an empty list for someone without one', async () => {
    const coach = await mkUser('self');
    await grant(coach.id);
    await profile(coach.id, { activities: ['Judo', 'Wrestling'], addressCity: 'Lisbon' });

    const mine = await request(http()).get('/v1/instructors/me/profile').set('Authorization', `Bearer ${coachToken(coach)}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ userId: coach.id, activities: ['Judo', 'Wrestling'], addressCity: 'Lisbon', firstName: 'self' });

    const none = await asOwner(request(http()).get('/v1/instructors/me/profile'));
    expect(none.status).toBe(200);
    expect(none.body.items).toEqual([]);
  });

  it('gives the owner a short-lived certification link, and nobody else', async () => {
    const coach = await mkUser('cert');
    await grant(coach.id);
    const withCert = await profile(coach.id, { certificationKey: `instructor-certifications/${schoolA}/x/cert.pdf`, certificationConsentedAt: new Date() });
    const other = await mkUser('nocert');
    await grant(other.id);
    const withoutCert = await profile(other.id);

    const ok = await asOwner(request(http()).get(`/v1/instructors/${withCert.id}/certification-url`));
    expect(ok.status).toBe(200);
    expect(ok.body.url).toContain('cert.pdf');

    const missing = await asOwner(request(http()).get(`/v1/instructors/${withoutCert.id}/certification-url`));
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe("This instructor hasn't uploaded a certification.");

    const asColleague = await request(http()).get(`/v1/instructors/${withCert.id}/certification-url`).set('Authorization', `Bearer ${coachToken(other)}`);
    expect(asColleague.status).toBe(403);
  });

  it('moves upcoming classes and active slots to another instructor, after which archiving works', async () => {
    const leaving = await mkUser('leaving');
    await grant(leaving.id);
    const leavingProfile = await profile(leaving.id);
    const takeover = await mkUser('takeover');
    await grant(takeover.id);
    await profile(takeover.id);

    const soon = await mkClass(leaving.id, 2, branchA1);
    const later = await mkClass(leaving.id, 9);
    const past = await mkClass(leaving.id, -5);
    const archivedClass = await mkClass(leaving.id, 4, null, { archivedAt: new Date() });
    const onSlot = await mkSlot(leaving.id, 'ON', branchA2);
    const offSlot = await mkSlot(leaving.id, 'OFF');

    const blocked = await asOwner(request(http()).post(`/v1/instructors/${leavingProfile.id}/archive`));
    expect(blocked.status).toBe(409);

    const res = await asOwner(request(http()).post(`/v1/instructors/${leavingProfile.id}/reassign`).send({ toUserId: takeover.id }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ classesMoved: 2, slotsMoved: 1 });

    const instructorOf = async (id: string) => (await superuser.class.findUniqueOrThrow({ where: { id } })).instructorId;
    expect(await instructorOf(soon.id)).toBe(takeover.id);
    expect(await instructorOf(later.id)).toBe(takeover.id);
    expect(await instructorOf(past.id)).toBe(leaving.id);
    expect(await instructorOf(archivedClass.id)).toBe(leaving.id);
    expect((await superuser.timetableSlot.findUniqueOrThrow({ where: { id: onSlot.id } })).instructorId).toBe(takeover.id);
    expect((await superuser.timetableSlot.findUniqueOrThrow({ where: { id: offSlot.id } })).instructorId).toBe(leaving.id);

    const archived = await asOwner(request(http()).post(`/v1/instructors/${leavingProfile.id}/archive`));
    expect(archived.status).toBe(201);
    expect(archived.body.archivedAt).not.toBeNull();
  });

  it('moves nothing when the new instructor cannot take every class', async () => {
    const leaving = await mkUser('leaving2');
    await grant(leaving.id);
    const leavingProfile = await profile(leaving.id);
    const branchOnly = await mkUser('branch-only');
    await grant(branchOnly.id, branchA2);
    const archivedCoach = await mkUser('archived-coach');
    await grant(archivedCoach.id);
    await profile(archivedCoach.id, { archivedAt: new Date() });

    const atA2 = await mkClass(leaving.id, 3, branchA2);
    const atA1 = await mkClass(leaving.id, 4, branchA1);

    const wrongBranch = await asOwner(request(http()).post(`/v1/instructors/${leavingProfile.id}/reassign`).send({ toUserId: branchOnly.id }));
    expect(wrongBranch.status).toBe(400);
    const archivedTarget = await asOwner(request(http()).post(`/v1/instructors/${leavingProfile.id}/reassign`).send({ toUserId: archivedCoach.id }));
    expect(archivedTarget.status).toBe(400);
    expect(archivedTarget.body.error.message).toBe('This instructor is archived. Unarchive them on the Instructors page, or pick another instructor.');
    const self = await asOwner(request(http()).post(`/v1/instructors/${leavingProfile.id}/reassign`).send({ toUserId: leaving.id }));
    expect(self.status).toBe(400);
    expect(self.body.error.message).toBe('Choose a different instructor to take over.');

    for (const c of [atA2, atA1]) {
      expect((await superuser.class.findUniqueOrThrow({ where: { id: c.id } })).instructorId).toBe(leaving.id);
    }
  });

  it('gives a revoked instructor their role back, at their profile branch, through the existing role-grant endpoint', async () => {
    const coach = await mkUser('regrant');
    const roleGrant = await grant(coach.id, branchA1);
    const coachProfile = await profile(coach.id, { branchId: branchA1 });
    await superuser.roleGrant.update({ where: { id: roleGrant.id }, data: { revokedAt: new Date() } });
    expect((await asOwner(request(http()).get(`/v1/instructors/${coachProfile.id}`))).body.status).toBe('REVOKED');

    const res = await asOwner(request(http()).post(`/v1/users/${coach.id}/role-grants`).send({ role: 'INSTRUCTOR', schoolId: schoolA, branchId: branchA1 }));
    expect(res.status).toBe(201);
    expect((await asOwner(request(http()).get(`/v1/instructors/${coachProfile.id}`))).body.status).toBe('ACTIVE');
  });

  it('only the owner can reassign', async () => {
    const leaving = await mkUser('leaving3');
    await grant(leaving.id);
    const leavingProfile = await profile(leaving.id);
    const colleague = await mkUser('colleague');
    await grant(colleague.id);
    await mkClass(leaving.id, 2);

    const res = await request(http())
      .post(`/v1/instructors/${leavingProfile.id}/reassign`)
      .set('Authorization', `Bearer ${coachToken(colleague)}`)
      .send({ toUserId: colleague.id });
    expect(res.status).toBe(403);
  });
});
