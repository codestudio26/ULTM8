import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Decision 319 item 4 — staff see their classes in Google Calendar (a private
 * calendar link each) and a schedule embed for the School's own website.
 * Both public links read through token-keyed SECURITY DEFINER functions:
 * these tests check a link reads only its own School (and, for a calendar
 * link, only its holder's classes), only while switched on, and only public
 * schedule fields.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[schedule-sharing.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describeIfDb('Staff calendar links and the schedule embed (Decision 319 item 4)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `sched-share-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Share',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkSchool(name: string) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name, timezone: 'Europe/London' } });
    schoolIds.push(school.id);
    const owner = await mkUser(`${name}-owner`);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    const coach = await mkUser(`${name}-coach`);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id } });
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `${name} Main` } });
    return {
      school,
      branch,
      owner,
      coach,
      ownerToken: jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] }),
      coachToken: jwt.sign({ sub: coach.id, email: coach.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] }),
    };
  }

  async function mkClass(schoolId: string, title: string, opts: { instructorId?: string; branchId?: string; inDays?: number; cancelled?: boolean } = {}) {
    const start = new Date(Date.now() + (opts.inDays ?? 2) * DAY);
    return superuser.class.create({
      data: {
        id: randomUUID(), schoolId, title, branchId: opts.branchId, instructorId: opts.instructorId,
        startDate: start, endDate: new Date(start.getTime() + HOUR), description: 'Private notes? No: the class description.',
        cancelledAt: opts.cancelled ? new Date() : null,
      },
    });
  }

  let a: Awaited<ReturnType<typeof mkSchool>>;
  let b: Awaited<ReturnType<typeof mkSchool>>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    a = await mkSchool('Alpha');
    b = await mkSchool('Bravo');
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.staffCalendarFeed.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('the School settings', () => {
    it('are off by default, and only the owner sees or changes them', async () => {
      const res = await http().get(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ staffCalendarFeedsEnabled: false, scheduleEmbedKey: null });
      expect((await http().get(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.coachToken))).status).toBe(403);
      expect([403, 404]).toContain((await http().put(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(b.ownerToken)).send({ scheduleEmbedEnabled: true })).status);
    });
  });

  describe('a staff calendar link', () => {
    it("can't be made until the School switches it on", async () => {
      const mine = await http().get(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(a.coachToken));
      expect(mine.body).toEqual({ enabled: false, feed: null });
      expect((await http().post(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(a.coachToken))).status).toBe(404);
    });

    it("shows the holder's own classes at that School only, marks a cancelled class cancelled, and stops when turned off", async () => {
      await http().put(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken)).send({ staffCalendarFeedsEnabled: true });
      await http().put(`/v1/schools/${b.school.id}/schedule-sharing`).set(auth(b.ownerToken)).send({ staffCalendarFeedsEnabled: true });
      await mkClass(a.school.id, 'Alpha Fundamentals', { instructorId: a.coach.id, branchId: a.branch.id });
      await mkClass(a.school.id, 'Alpha Cancelled', { instructorId: a.coach.id, cancelled: true });
      await mkClass(a.school.id, 'Alpha Someone Else', { instructorId: a.owner.id });
      await mkClass(b.school.id, 'Bravo Secret', { instructorId: b.coach.id });

      const made = await http().post(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(a.coachToken));
      expect(made.status).toBe(200);
      const token = made.body.feed.token as string;
      // The same link is shown again.
      expect((await http().get(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(a.coachToken))).body.feed.token).toBe(token);
      // Only the hash is stored.
      const row = await superuser.staffCalendarFeed.findFirstOrThrow({ where: { userId: a.coach.id } });
      expect(row.tokenHash).not.toContain(token);

      const ics = await http().get(`/v1/calendar-feeds/${token}.ics`);
      expect(ics.status).toBe(200);
      expect(ics.headers['content-type']).toMatch(/^text\/calendar/);
      expect(ics.text).toContain('SUMMARY:Alpha Fundamentals');
      expect(ics.text).toContain('LOCATION:Alpha Main');
      expect(ics.text).toMatch(/SUMMARY:Alpha Cancelled[\s\S]*?STATUS:CANCELLED/);
      expect(ics.text).not.toContain('Alpha Someone Else');
      expect(ics.text).not.toContain('Bravo');

      // A coach at another School can't make a link here.
      expect((await http().post(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(b.coachToken))).status).toBe(403);

      await http().put(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken)).send({ staffCalendarFeedsEnabled: false });
      expect((await http().get(`/v1/calendar-feeds/${token}.ics`)).status).toBe(404);
      await http().put(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken)).send({ staffCalendarFeedsEnabled: true });
      expect((await http().get(`/v1/calendar-feeds/${token}.ics`)).status).toBe(200);
    });

    it('a new link turns the old one off; removing it, or losing the staff role, turns it off', async () => {
      const first = (await http().post(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(a.coachToken))).body.feed.token as string;
      const second = (await http().post(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(a.coachToken))).body.feed.token as string;
      expect(second).not.toBe(first);
      expect((await http().get(`/v1/calendar-feeds/${first}`)).status).toBe(404);
      expect((await http().get(`/v1/calendar-feeds/${second}`)).status).toBe(200);

      await superuser.roleGrant.updateMany({ where: { userId: a.coach.id, schoolId: a.school.id }, data: { revokedAt: new Date() } });
      expect((await http().get(`/v1/calendar-feeds/${second}`)).status).toBe(404);
      await superuser.roleGrant.updateMany({ where: { userId: a.coach.id, schoolId: a.school.id }, data: { revokedAt: null } });

      expect((await http().delete(`/v1/schools/${a.school.id}/calendar-feed/me`).set(auth(a.coachToken))).status).toBe(200);
      expect((await http().get(`/v1/calendar-feeds/${second}`)).status).toBe(404);
    });

    it('a made-up or malformed token reads nothing', async () => {
      expect((await http().get('/v1/calendar-feeds/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
      expect((await http().get(`/v1/calendar-feeds/${encodeURIComponent("x' OR '1'='1")}`)).status).toBe(404);
    });
  });

  describe('the schedule embed', () => {
    it("shows only this School's public schedule (no coach, no ids), as JSON and as a frameable page", async () => {
      const on = await http().put(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken)).send({ scheduleEmbedEnabled: true });
      const key = on.body.scheduleEmbedKey as string;
      expect(key).toEqual(expect.any(String));
      await mkClass(a.school.id, 'Alpha Kids <b>', { instructorId: a.coach.id, branchId: a.branch.id, inDays: 3 });
      await mkClass(a.school.id, 'Alpha Far Future', { inDays: 40 });

      const json = await http().get(`/v1/schedule-embeds/${key}`);
      expect(json.status).toBe(200);
      expect(json.body.schoolName).toBe('Alpha');
      const titles = json.body.classes.map((c: { title: string }) => c.title);
      expect(titles).toContain('Alpha Kids <b>');
      expect(titles).not.toContain('Alpha Far Future');
      expect(titles.some((t: string) => t.startsWith('Bravo'))).toBe(false);
      for (const c of json.body.classes) expect(Object.keys(c).sort()).toEqual(['branchName', 'branchTimezone', 'cancelled', 'endDate', 'startDate', 'title']);
      expect(JSON.stringify(json.body)).not.toContain(a.coach.id);
      expect(JSON.stringify(json.body)).not.toContain(a.coach.firstName);

      const page = await http().get(`/v1/schedule-embeds/${key}/page?lang=de`);
      expect(page.status).toBe(200);
      expect(page.headers['content-type']).toMatch(/^text\/html/);
      expect(page.headers['content-security-policy']).toContain('frame-ancestors *');
      expect(page.headers['x-frame-options']).toBeUndefined();
      expect(page.text).toContain('Kursplan');
      expect(page.text).toContain('Alpha Kids &lt;b&gt;');
    });

    it('a new link turns the old one off; off turns it off', async () => {
      const old = (await http().get(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken))).body.scheduleEmbedKey as string;
      const fresh = (await http().put(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken)).send({ newEmbedKey: true })).body.scheduleEmbedKey as string;
      expect(fresh).not.toBe(old);
      expect((await http().get(`/v1/schedule-embeds/${old}`)).status).toBe(404);
      expect((await http().get(`/v1/schedule-embeds/${old}/page`)).status).toBe(404);
      await http().put(`/v1/schools/${a.school.id}/schedule-sharing`).set(auth(a.ownerToken)).send({ scheduleEmbedEnabled: false });
      expect((await http().get(`/v1/schedule-embeds/${fresh}`)).status).toBe(404);
    });

    it("the app's own connection can't read the feed table of other people", async () => {
      const app2 = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
      try {
        const rows = await app2.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${b.coach.id}, true)`;
          return tx.staffCalendarFeed.findMany({ where: { schoolId: a.school.id } });
        });
        expect(rows).toEqual([]);
      } finally {
        await app2.$disconnect();
      }
    });
  });
});
