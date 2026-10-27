/**
 * Instructors: the answers to the open product questions (Decision 331), over
 * real HTTP and a real Postgres: the owner resends a temporary passcode,
 * instructors edit their own bio/photo/phone, an Instructor role can't be
 * revoked while it leaves classes without an instructor, and address and
 * certification are for the owner (and the instructor) only.
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
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[instructors-decisions-331.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Instructors: Decision 331', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolA = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const previousBaseUrl = process.env.PORTAL_BASE_URL;
  const sent: Array<{ to: string; subject: string; body: string }> = [];
  let owner: { id: string; email: string };
  let token: string;

  const mkUser = (label: string, mustChangePasscode = false) =>
    superuser.user.create({
      data: { id: randomUUID(), email: `instr-331-${label}-${randomUUID()}@example.test`, firstName: label, surname: 'D331', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), mustChangePasscode },
    });
  const grant = (userId: string, branchId: string | null = null) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId, schoolId: schoolA, branchId } });
  const profile = (userId: string, data: Record<string, unknown> = {}) =>
    superuser.instructor.create({ data: { id: randomUUID(), userId, schoolId: schoolA, ...data } });
  const coachToken = (u: { id: string; email: string }, branchId: string | null = null) =>
    jwt.sign({ sub: u.id, email: u.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: schoolA, branchId }] });
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
  const mkClass = (instructorId: string, offsetDays: number, branchId: string | null = null) =>
    superuser.class.create({
      data: { id: randomUUID(), schoolId: schoolA, branchId, instructorId, title: '331 class', startDate: inDays(offsetDays), endDate: new Date(inDays(offsetDays).getTime() + 3_600_000) },
    });
  const mkSlot = (instructorId: string, branchId: string | null = null) =>
    superuser.timetableSlot.create({
      data: { id: randomUUID(), schoolId: schoolA, branchId, instructorId, weekday: 'MONDAY', startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)), endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)), status: 'ON', title: '331 slot' },
    });
  const http = () => app.getHttpServer();
  const asOwner = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const revoke = (userId: string, grantId: string) => asOwner(request(http()).delete(`/v1/users/${userId}/role-grants/${grantId}`));

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test/';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({
        sendEmail: async (to: string, subject: string, body: string) => {
          sent.push({ to, subject, body });
        },
        sendPush: async () => undefined,
      })
      .overrideProvider(R2ClientService)
      .useValue({
        getPublicPhotoUploadUrl: async (key: string) => `https://upload.example.test/${key}`,
        getPublicPhotoUrl: (key: string) => `https://photos.example.test/${key}`,
        objectExists: async () => true,
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolA, name: 'Instructor decisions 331' } });
    await superuser.branch.create({ data: { id: branchA1, schoolId: schoolA, name: '331 A1' } });
    await superuser.branch.create({ data: { id: branchA2, schoolId: schoolA, name: '331 A2' } });
    owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: schoolA } });
    token = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA, branchId: null }] });
  });

  afterAll(async () => {
    process.env.PORTAL_BASE_URL = previousBaseUrl;
    await superuser.class.deleteMany({ where: { schoolId: schoolA } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: schoolA } });
    await superuser.instructor.deleteMany({ where: { schoolId: schoolA } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: schoolA } });
    await superuser.branch.deleteMany({ where: { schoolId: schoolA } });
    await superuser.user.deleteMany({ where: { email: { startsWith: 'instr-331-' } } });
    await superuser.school.deleteMany({ where: { id: schoolA } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('resend temporary passcode', () => {
    it('sets a new temporary passcode and emails it, for someone who has not signed in yet', async () => {
      const fresh = await mkUser('fresh', true);
      await grant(fresh.id);
      const p = await profile(fresh.id);
      sent.length = 0;

      const res = await asOwner(request(http()).post(`/v1/instructors/${p.id}/resend-passcode`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ emailSent: true });

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(fresh.email);
      const passcode = /Temporary passcode: (\d{6})/.exec(sent[0].body)?.[1];
      expect(passcode).toBeDefined();
      const user = await superuser.user.findUniqueOrThrow({ where: { id: fresh.id } });
      expect(await bcrypt.compare(passcode!, user.passcodeHash)).toBe(true);
      expect(user.mustChangePasscode).toBe(true);
    });

    it('refuses once they have chosen their own passcode, or lost the role', async () => {
      const seasoned = await mkUser('seasoned');
      await grant(seasoned.id);
      const p1 = await profile(seasoned.id);
      const signedIn = await asOwner(request(http()).post(`/v1/instructors/${p1.id}/resend-passcode`));
      expect(signedIn.status).toBe(409);
      expect(signedIn.body.error.message).toMatch(/already signed in/);
      expect((await superuser.user.findUniqueOrThrow({ where: { id: seasoned.id } })).passcodeHash).toBe('x');

      const gone = await mkUser('gone', true);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: gone.id, schoolId: schoolA, revokedAt: new Date() } });
      const p2 = await profile(gone.id);
      const revoked = await asOwner(request(http()).post(`/v1/instructors/${p2.id}/resend-passcode`));
      expect(revoked.status).toBe(409);
      expect(revoked.body.error.message).toMatch(/no longer an instructor/);
    });

    it('is for the School Owner/Manager only', async () => {
      const fresh = await mkUser('fresh2', true);
      await grant(fresh.id);
      const p = await profile(fresh.id);
      const colleague = await mkUser('colleague');
      await grant(colleague.id);
      const res = await request(http()).post(`/v1/instructors/${p.id}/resend-passcode`).set('Authorization', `Bearer ${coachToken(colleague)}`);
      expect(res.status).toBe(403);
      expect((await superuser.user.findUniqueOrThrow({ where: { id: fresh.id } })).passcodeHash).toBe('x');
    });
  });

  describe('instructors edit their own bio, photo and phone', () => {
    it('saves them on their profile, without touching their login phone', async () => {
      const coach = await mkUser('selfedit');
      await grant(coach.id);
      await profile(coach.id);
      const res = await request(http())
        .patch('/v1/instructors/me/profile')
        .set('Authorization', `Bearer ${coachToken(coach)}`)
        .send({ bio: 'Black belt, ten years teaching.', photoUrl: 'https://photos.example.test/me.png', phone: '+447911123456' });
      expect(res.status).toBe(200);
      expect(res.body.items[0]).toMatchObject({ bio: 'Black belt, ten years teaching.', photoUrl: 'https://photos.example.test/me.png', phone: '+447911123456' });
      expect((await superuser.user.findUniqueOrThrow({ where: { id: coach.id } })).phone).toBeNull();

      const cleared = await request(http()).patch('/v1/instructors/me/profile').set('Authorization', `Bearer ${coachToken(coach)}`).send({ bio: null, phone: null });
      expect(cleared.body.items[0]).toMatchObject({ bio: null, phone: null, photoUrl: 'https://photos.example.test/me.png' });
    });

    it('rejects a phone that is not E.164', async () => {
      const coach = await mkUser('badphone');
      await grant(coach.id);
      await profile(coach.id);
      const res = await request(http()).patch('/v1/instructors/me/profile').set('Authorization', `Bearer ${coachToken(coach)}`).send({ phone: '12345' });
      expect(res.status).toBe(400);
    });

    it('lets an instructor get a photo upload link for their own profile only', async () => {
      const coach = await mkUser('photo');
      await grant(coach.id);
      const own = await profile(coach.id);
      const other = await mkUser('otherphoto');
      await grant(other.id);
      const theirs = await profile(other.id);
      const ask = (entityId: string) =>
        request(http())
          .post('/v1/uploads/public-photo-url')
          .set('Authorization', `Bearer ${coachToken(coach)}`)
          .send({ entityType: 'INSTRUCTOR', schoolId: schoolA, entityId, contentType: 'image/png' });
      const mine = await ask(own.id);
      expect(mine.status).toBe(201);
      expect(mine.body.publicUrl).toContain(`/instructor/${schoolA}/${own.id}/`);
      expect((await ask(theirs.id)).status).toBe(403);
    });
  });

  describe('revoking an Instructor role while they still teach', () => {
    it('is refused while it leaves an upcoming class or an active weekly slot, and allowed after hand over', async () => {
      const leaving = await mkUser('leaving');
      const g = await grant(leaving.id);
      const p = await profile(leaving.id);
      const takeover = await mkUser('takeover');
      await grant(takeover.id);
      await profile(takeover.id);
      await mkClass(leaving.id, 3);
      await mkSlot(leaving.id);

      const blocked = await revoke(leaving.id, g.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.message).toMatch(/Hand over classes/);
      expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: g.id } })).revokedAt).toBeNull();

      const moved = await asOwner(request(http()).post(`/v1/instructors/${p.id}/reassign`).send({ toUserId: takeover.id }));
      expect(moved.status).toBe(200);
      const ok = await revoke(leaving.id, g.id);
      expect(ok.status).toBe(200);
      expect(ok.body.revokedAt).not.toBeNull();
    });

    it('ignores past classes and slots that are off or archived', async () => {
      const coach = await mkUser('pastonly');
      const g = await grant(coach.id);
      await profile(coach.id);
      await mkClass(coach.id, -3);
      const off = await mkSlot(coach.id);
      await superuser.timetableSlot.update({ where: { id: off.id }, data: { status: 'OFF' } });
      const archived = await mkSlot(coach.id);
      await superuser.timetableSlot.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
      expect((await revoke(coach.id, g.id)).status).toBe(200);
    });

    it('allows removing one branch when their other Instructor role still covers the classes there', async () => {
      const coach = await mkUser('twobranches');
      const g1 = await grant(coach.id, branchA1);
      const g2 = await grant(coach.id, branchA2);
      await profile(coach.id, { branchId: branchA1 });
      await mkClass(coach.id, 3, branchA1);

      // Losing A2 leaves nothing uncovered; losing A1 would.
      expect((await revoke(coach.id, g2.id)).status).toBe(200);
      expect((await revoke(coach.id, g1.id)).status).toBe(409);
    });

    it('does not block revoking other roles', async () => {
      const staff = await mkUser('staffer');
      const g = await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: schoolA, branchId: branchA1 } });
      await mkClass(staff.id, 3, branchA1);
      expect((await revoke(staff.id, g.id)).status).toBe(200);
    });
  });

  describe('address and certification are for the owner and the instructor', () => {
    it('hides them from a colleague, on the list and the detail, and shows them to the owner and to the instructor', async () => {
      const coach = await mkUser('private');
      await grant(coach.id);
      const p = await profile(coach.id, {
        address: '1 Main St, Lisbon',
        addressLine1: '1 Main St',
        addressCity: 'Lisbon',
        addressCountry: 'PT',
        certificationKey: `instructor-certifications/${schoolA}/x/cert.pdf`,
        certificationConsentedAt: new Date(),
        bio: 'Public bio',
      });
      const colleague = await mkUser('peer');
      await grant(colleague.id);
      await profile(colleague.id);

      const asColleague = (r: request.Test) => r.set('Authorization', `Bearer ${coachToken(colleague)}`);
      const colleagueDetail = await asColleague(request(http()).get(`/v1/instructors/${p.id}`));
      expect(colleagueDetail.status).toBe(200);
      expect(colleagueDetail.body).toMatchObject({
        bio: 'Public bio',
        address: null,
        addressLine1: null,
        addressCity: null,
        addressCountry: null,
        certificationKey: null,
        certificationConsentedAt: null,
      });
      const colleagueList = await asColleague(request(http()).get(`/v1/schools/${schoolA}/instructors`).query({ limit: 100 }));
      const row = colleagueList.body.items.find((i: { id: string }) => i.id === p.id);
      expect(row).toMatchObject({ address: null, certificationKey: null });
      // Their own row stays whole.
      expect(colleagueList.body.items.find((i: { userId: string }) => i.userId === colleague.id)).toBeDefined();

      const ownerDetail = await asOwner(request(http()).get(`/v1/instructors/${p.id}`));
      expect(ownerDetail.body).toMatchObject({ address: '1 Main St, Lisbon', addressCity: 'Lisbon', certificationKey: `instructor-certifications/${schoolA}/x/cert.pdf` });
      const ownerList = await asOwner(request(http()).get(`/v1/schools/${schoolA}/instructors`).query({ limit: 100 }));
      expect(ownerList.body.items.find((i: { id: string }) => i.id === p.id)).toMatchObject({ address: '1 Main St, Lisbon' });

      const selfDetail = await request(http()).get(`/v1/instructors/${p.id}`).set('Authorization', `Bearer ${coachToken(coach)}`);
      expect(selfDetail.body).toMatchObject({ address: '1 Main St, Lisbon', certificationKey: `instructor-certifications/${schoolA}/x/cert.pdf` });
    });
  });
});
