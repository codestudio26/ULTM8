/**
 * Regression gate for the Classes section review of 26 Oct 2026 (Decision 335).
 * Each block pins one finding, over real HTTP:
 *
 * - C3/C17: the date views (upcoming soonest first, past newest first) and the
 *   instructor filter the coach dashboard uses, paged across pages;
 * - C6: making a Class unlimited offers a seat to everyone still waiting;
 * - C7: a blank or spaces-only title is refused;
 * - C8: a QR window that closes before the start, or cut-offs after the end;
 * - C11: an archived Class can't be edited; cut-off dates can be cleared;
 * - C13: a guest needs a Friend Pass, one pass per guest;
 * - C16: no booking or waitlist entry at a closed School.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET (and REDIS_URL for the queues).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[classes-review-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describeIfDb('Classes review fixes (Decision 335)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let waitlistAdd: jest.SpyInstance;

  const school = { id: randomUUID() };
  type U = { id: string; email: string; token: string };
  let owner: U;
  let coach: U;
  const students: U[] = [];
  let subscriptionPlanId: string;
  let friendPassPlanId: string;

  const http = () => request(app.getHttpServer());
  const at = (ms: number) => new Date(Date.now() + ms);
  const mkClass = (data: Record<string, unknown> = {}) =>
    superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Fixture', startDate: at(2 * HOUR), endDate: at(3 * HOUR), ...data } });
  const patch = (classId: string, body: Record<string, unknown>) => http().patch(`/v1/classes/${classId}`).set('Authorization', `Bearer ${owner.token}`).send(body);
  const book = (classId: string, who: U, body: Record<string, unknown> = {}) => http().post(`/v1/classes/${classId}/book`).set('Authorization', `Bearer ${who.token}`).send(body);
  const list = (who: U, query: Record<string, string | number>) => http().get(`/v1/schools/${school.id}/classes`).query(query).set('Authorization', `Bearer ${who.token}`);

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT'): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `classes-review-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Review',
        passcodeHash: 'x',
        dateOfBirth: new Date('1995-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
    return { id: user.id, email: user.email, token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    // Count the seat offers without running the waitlist job itself.
    waitlistAdd = jest.spyOn(app.get<Queue>(getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE)), 'add').mockResolvedValue(undefined as never);

    await superuser.school.create({ data: { id: school.id, name: 'Classes Review School', timezone: 'UTC' } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    coach = await mkUser('coach', 'INSTRUCTOR');
    subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    friendPassPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Friend Pass', price: 0, classesIncluded: 1 } })).id;
    for (let i = 0; i < 6; i++) {
      const s = await mkUser(`student${i}`, 'STUDENT');
      students.push(s);
      await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: subscriptionPlanId, frequency: 'RECURRING' } });
    }
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'classes-review-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('date views and the instructor filter (C3, C17)', () => {
    it('upcoming is soonest first across pages, includes a Class in progress, and leaves out ended ones', async () => {
      const ended = await mkClass({ title: 'Ended', startDate: at(-3 * HOUR), endDate: at(-2 * HOUR) });
      const inProgress = await mkClass({ title: 'In progress', startDate: at(-HOUR), endDate: at(HOUR) });
      // Created in reverse date order, so id/creation order can't pass by luck.
      const future: { id: string }[] = [];
      for (let d = 5; d >= 1; d--) future.push(await mkClass({ title: `Day ${d}`, startDate: at(d * DAY), endDate: at(d * DAY + HOUR) }));
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const res = await list(owner, { when: 'upcoming', limit: 2, ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((c: { id: string }) => c.id));
        cursor = res.body.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).not.toContain(ended.id);
      expect(seen).toEqual([inProgress.id, ...future.reverse().map((c) => c.id)]);

      const past = await list(owner, { when: 'past' });
      expect(past.body.items.map((c: { id: string }) => c.id)).toEqual([ended.id]);
    });

    it('a bad cursor is a 400, not a 500', async () => {
      expect((await list(owner, { when: 'upcoming', cursor: 'nonsense' })).status).toBe(400);
    });

    it("instructorId returns only that coach's Classes, and the coach may ask", async () => {
      const mine = await mkClass({ title: 'Mine', instructorId: coach.id, startDate: at(10 * DAY), endDate: at(10 * DAY + HOUR) });
      const res = await list(coach, { when: 'upcoming', instructorId: coach.id });
      expect(res.status).toBe(200);
      expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([mine.id]);
      expect(res.body.items[0].timetableSlotId).toBeNull();
    });
  });

  describe('capacity and the waitlist (C6)', () => {
    it('making a full Class unlimited offers a seat to each Student waiting', async () => {
      const cls = await mkClass({ capacity: 1 });
      expect((await book(cls.id, students[0])).status).toBe(201);
      for (const s of students.slice(1, 3)) {
        expect((await http().post(`/v1/classes/${cls.id}/waitlist`).set('Authorization', `Bearer ${s.token}`).send({})).status).toBe(201);
      }
      waitlistAdd.mockClear();
      expect((await patch(cls.id, { capacity: null })).status).toBe(200);
      expect(waitlistAdd).toHaveBeenCalledTimes(2);
      expect(waitlistAdd).toHaveBeenCalledWith('seat-freed', { classId: cls.id });
    });
  });

  describe('title and dates (C7, C8, C11)', () => {
    const base = () => ({ activities: ['BJJ'], startDate: at(DAY).toISOString(), endDate: at(DAY + HOUR).toISOString() });
    const create = (body: Record<string, unknown>) => http().post(`/v1/schools/${school.id}/classes`).set('Authorization', `Bearer ${owner.token}`).send(body);

    it('a blank or spaces-only title is refused; a padded one is trimmed', async () => {
      expect((await create({ ...base(), title: '   ' })).status).toBe(400);
      const ok = await create({ ...base(), title: '  Kids BJJ  ' });
      expect(ok.status).toBe(201);
      expect(ok.body.title).toBe('Kids BJJ');
    });

    it('a QR window closing before the start, or cut-offs after the end, are refused', async () => {
      const qr = await create({ ...base(), title: 'QR', qrAttendanceEndAt: at(DAY - HOUR).toISOString() });
      expect(qr.status).toBe(400);
      expect(qr.body.error.code).toBe('QR_WINDOW_BEFORE_START');
      const cutoff = await create({ ...base(), title: 'Cutoff', bookingEndAt: at(DAY + 2 * HOUR).toISOString() });
      expect(cutoff.body.error.code).toBe('BOOKING_CUTOFF_AFTER_END');
      const refund = await create({ ...base(), title: 'Refund', refundFeeDate: at(DAY + 2 * HOUR).toISOString() });
      expect(refund.body.error.code).toBe('REFUND_CUTOFF_AFTER_END');
    });

    it('moving the start past an existing QR window is checked too', async () => {
      const cls = await mkClass({ startDate: at(DAY), endDate: at(DAY + HOUR), qrAttendanceEndAt: at(DAY + 30 * 60_000) });
      const res = await patch(cls.id, { startDate: at(DAY + 45 * 60_000).toISOString() });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('QR_WINDOW_BEFORE_START');
    });

    it('cut-off dates can be cleared with null, and are kept when left out', async () => {
      const cls = await mkClass({ bookingEndAt: at(HOUR), refundFeeDate: at(HOUR) });
      expect((await patch(cls.id, { title: 'Renamed' })).body.bookingEndAt).not.toBeNull();
      const res = await patch(cls.id, { bookingEndAt: null, refundFeeDate: null });
      expect(res.status).toBe(200);
      expect(res.body.bookingEndAt).toBeNull();
      expect(res.body.refundFeeDate).toBeNull();
    });

    it('an archived Class has to be unarchived before it can be edited', async () => {
      const cls = await mkClass({ archivedAt: new Date(), purgeAt: at(90 * DAY) });
      const res = await patch(cls.id, { title: 'Edited' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLASS_ARCHIVED');
    });
  });

  describe('guests (C13)', () => {
    it("a guest can't ride on the organizer's own Subscription", async () => {
      const cls = await mkClass({ capacity: 10 });
      const own = await superuser.membership.findFirstOrThrow({ where: { studentId: students[3].id, schoolId: school.id } });
      const res = await book(cls.id, students[3], { attendeeMembershipIds: [own.id] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GUEST_NEEDS_FRIEND_PASS');
    });

    it('one Friend Pass covers one guest, never the same pass twice', async () => {
      const cls = await mkClass({ capacity: 10 });
      const pass = await superuser.membership.create({
        data: { id: randomUUID(), studentId: students[4].id, schoolId: school.id, membershipPlanId: friendPassPlanId, frequency: 'ONE_TIME', classesRemaining: 1 },
      });
      const twice = await book(cls.id, students[4], { attendeeMembershipIds: [pass.id, pass.id] });
      expect(twice.status).toBe(400);
      expect(twice.body.error.code).toBe('GUEST_PASS_REPEATED');
      expect((await book(cls.id, students[4], { attendeeMembershipIds: [pass.id] })).status).toBe(201);
      expect(await superuser.bookingAttendee.count({ where: { booking: { classId: cls.id } } })).toBe(1);
    });
  });

  describe('closed School (C16)', () => {
    it('refuses new bookings and waitlist entries once the School is closed', async () => {
      const open = await mkClass({ capacity: 1 });
      const full = await mkClass({ capacity: 1 });
      expect((await book(full.id, students[0])).status).toBe(201);
      await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
      try {
        expect((await book(open.id, students[5])).status).toBe(403);
        expect((await http().post(`/v1/classes/${full.id}/waitlist`).set('Authorization', `Bearer ${students[5].token}`).send({})).status).toBe(403);
      } finally {
        await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
      }
    });
  });
});
