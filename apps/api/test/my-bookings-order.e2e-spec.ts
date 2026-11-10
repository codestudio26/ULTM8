/**
 * Decision 450 item 2 (demo finding): the member app's "My Bookings" was not in date
 * order, because GET /bookings/me paged by booking id. It now lists by the
 * class's date and time: classes not yet ended soonest first (one in
 * progress at the top), then ended ones newest first, then any whose class
 * the member can no longer read; pages keyed on (start time, id), so paging
 * never skips or repeats a booking. Still only the caller's own bookings.
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

describeIfDb('GET /bookings/me: in the class date order (Decision 450 item 2)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};
  /** Ana's bookings by label; `expected` is the order the list must have. */
  const bookingIds: Record<string, string> = {};
  let expected: string[] = [];
  let benBooking = '';
  const http = () => request(app.getHttpServer());
  const get = (who: string, path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const mkSchool = async (name: string) => {
      const s = await superuser.school.create({ data: { id: randomUUID(), name } });
      schoolIds.push(s.id);
      return s;
    };
    const school = await mkSchool('Order Dojo');
    // A School Ana trained at once: her grant there is gone, so its classes are hidden from her.
    const former = await mkSchool('Former Dojo');
    const mkUser = async (label: string, grants: Array<{ schoolId: string; revokedAt?: Date }>) => {
      const u = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `mbo-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Order',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      userIds.push(u.id);
      for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: g.schoolId, revokedAt: g.revokedAt ?? null } });
      tokens[label] = jwt.sign({ sub: u.id, email: u.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
      return u;
    };
    const ana = await mkUser('ana', [{ schoolId: school.id }, { schoolId: former.id, revokedAt: new Date(Date.now() - 86_400_000) }]);
    const ben = await mkUser('ben', [{ schoolId: school.id }]);

    const hour = 3_600_000;
    const day = 24 * hour;
    const now = Date.now();
    const mkClass = (schoolId: string, title: string, start: number, length = hour) =>
      superuser.class.create({ data: { membershipInclusion: true, id: randomUUID(), schoolId, title, startDate: new Date(start), endDate: new Date(start + length) } });
    const book = async (label: string, studentId: string, cls: { id: string; schoolId: string }, status: 'UPCOMING' | 'COMPLETED' | 'CANCELLED' = 'UPCOMING', id = randomUUID()) => {
      await superuser.booking.create({ data: { id, studentId, classId: cls.id, schoolId: cls.schoolId, status } });
      bookingIds[label] = id;
      return id;
    };

    // Created out of date order on purpose, and with ids that sort against the dates.
    const twinStart = now + 2 * day;
    const twinA = await mkClass(school.id, 'Twin A', twinStart);
    const twinB = await mkClass(school.id, 'Twin B', twinStart);
    const [lowId, highId] = [randomUUID(), randomUUID()].sort();
    await book('in5d', ana.id, await mkClass(school.id, 'In five days', now + 5 * day), 'UPCOMING', '00000000-0000-4000-8000-000000000001');
    await book('ended3d', ana.id, await mkClass(school.id, 'Three days ago', now - 3 * day), 'COMPLETED');
    await book('twinHigh', ana.id, twinB, 'UPCOMING', highId);
    await book('in1d', ana.id, await mkClass(school.id, 'Tomorrow', now + day), 'CANCELLED');
    await book('gone', ana.id, await mkClass(former.id, 'At the old School', now + 4 * day));
    await book('ended1d', ana.id, await mkClass(school.id, 'Yesterday', now - day), 'COMPLETED', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    await book('twinLow', ana.id, twinA, 'UPCOMING', lowId);
    await book('inProgress', ana.id, await mkClass(school.id, 'On the mat now', now - 30 * 60_000));
    await book('in3d', ana.id, await mkClass(school.id, 'In three days', now + 3 * day));
    await book('ended2d', ana.id, await mkClass(school.id, 'Two days ago', now - 2 * day), 'COMPLETED');
    expected = ['inProgress', 'in1d', 'twinLow', 'twinHigh', 'in3d', 'in5d', 'ended1d', 'ended2d', 'ended3d', 'gone'].map((k) => bookingIds[k]);
    benBooking = randomUUID();
    await superuser.booking.create({ data: { id: benBooking, studentId: ben.id, classId: twinA.id, schoolId: school.id, status: 'UPCOMING' } });
  });

  afterAll(async () => {
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('one page: not yet ended soonest first, then ended newest first, then a class no longer readable', async () => {
    const res = await get('ana', '/v1/bookings/me');
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: { id: string }) => b.id)).toEqual(expected);
    expect(res.body.nextCursor).toBeNull();
    // The hidden class still lists, without its name or time (Decision 427 SP4).
    expect(res.body.items[expected.length - 1]).toMatchObject({ classTitle: null, classStartsAt: null });
    // Same item shape as before: the class's start is not added as a "class" field.
    expect(res.body.items[0]).not.toHaveProperty('class');
    expect(res.body.items[0]).toMatchObject({ classTitle: 'On the mat now', attendees: [] });
  });

  it.each([1, 2, 3, 4, 9])('pages of %i: the same order, nothing skipped or repeated', async (limit) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const res = await get('ana', `/v1/bookings/me?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(limit);
      seen.push(...res.body.items.map((b: { id: string }) => b.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(expected);
  });

  it('a cursor that is not one of this list (an old id cursor, or garbage) is refused, never restarted', async () => {
    expect((await get('ana', `/v1/bookings/me?cursor=${expected[0]}`)).status).toBe(400);
    expect((await get('ana', '/v1/bookings/me?cursor=not-a-cursor')).status).toBe(400);
    const forged = Buffer.from(JSON.stringify({ p: 'sideways', at: new Date().toISOString(), s: null, id: 'x' })).toString('base64url');
    expect((await get('ana', `/v1/bookings/me?cursor=${forged}`)).status).toBe(400);
  });

  it("still only the caller's own bookings", async () => {
    const res = await get('ben', '/v1/bookings/me');
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: { id: string }) => b.id)).toEqual([benBooking]);
  });
});
