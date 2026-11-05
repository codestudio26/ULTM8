/**
 * Decision 431 (stress test round 5, TIME area):
 *
 * - item 1: time zones must be IANA names; a slot can't be made on a bad zone;
 *   the nightly generator skips a bad slot and keeps going;
 * - item 2: a Branch's new zone re-times its upcoming timetable classes, and
 *   booked students are told "Class moved";
 * - item 3: a weekly class can end after midnight (up to 12 hours);
 * - item 7: the Dashboard's week follows the School's week start;
 * - item 9: removing a student keeps the credit inside the School's default
 *   cut-off, like a staff cancel;
 * - item 11: a closure's dates can change: newly covered classes are cancelled,
 *   released ones listed for "Recreate class" (a one-off copy);
 * - item 13: a one-off class on a closed day needs confirmClosedDay;
 * - item 14: "Who can book" (women or men only, ages) at booking and waitlist,
 *   with the staff override.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET (and REDIS_URL for the queues).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ClassOccurrenceGenerationProcessor } from '../src/jobs/class-occurrence-generation.processor';

async function waitFor<T>(read: () => Promise<T | null>): Promise<T | null> {
  for (let i = 0; i < 25; i++) {
    const value = await read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  return read();
}

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[round5-time.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const DAY = 24 * 3_600_000;
const TAG = 'r5-time-';

describeIfDb('Round 5 time and timetable fixes (Decision 431)', () => {
  let app: INestApplication;
  let generator: ClassOccurrenceGenerationProcessor;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const school = { id: randomUUID() };
  const branch = { id: randomUUID() };
  const otherSchools: string[] = [];
  type U = { id: string; token: string; grantId: string };
  let owner: U;
  let woman: U;
  let man: U;
  let child: U;
  let noGender: U;
  let plan: { id: string };

  const http = () => request(app.getHttpServer());
  const auth = (who: U) => ({ Authorization: `Bearer ${who.token}` });
  const weekdayIn = (days: number, zone: string) => WEEKDAYS[DateTime.now().setZone(zone).plus({ days }).weekday % 7];

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT', extra: { gender?: string | null; dateOfBirth?: Date | null } = {}): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `${TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Time',
        passcodeHash: 'x',
        dateOfBirth: extra.dateOfBirth === undefined ? new Date('1990-01-01') : extra.dateOfBirth,
        gender: extra.gender ?? null,
        phoneVerifiedAt: new Date(),
      },
    });
    const grant = await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id } });
    if (role === 'STUDENT') {
      await superuser.membership.create({ data: { id: randomUUID(), studentId: user.id, schoolId: school.id, membershipPlanId: plan.id, frequency: 'RECURRING' } });
    }
    return { id: user.id, grantId: grant.id, token: jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] }) };
  }

  async function mkClass(body: Record<string, unknown>): Promise<request.Response> {
    const start = new Date(Date.now() + 3 * DAY);
    return http()
      .post(`/v1/schools/${school.id}/classes`)
      .set(auth(owner))
      .send({ title: 'One-off', activities: ['BJJ'], capacity: 10, startDate: start.toISOString(), endDate: new Date(start.getTime() + 3_600_000).toISOString(), membershipInclusion: true, ...body });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    generator = moduleRef.get(ClassOccurrenceGenerationProcessor);

    await superuser.school.create({ data: { id: school.id, name: 'Time School', timezone: 'Asia/Tokyo' } });
    await superuser.branch.create({ data: { id: branch.id, schoolId: school.id, name: 'Main', timezone: 'Asia/Tokyo' } });
    plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    woman = await mkUser('woman', 'STUDENT', { gender: 'FEMALE' });
    man = await mkUser('man', 'STUDENT', { gender: 'MALE' });
    child = await mkUser('child', 'STUDENT', { gender: 'FEMALE', dateOfBirth: new Date(`${new Date().getUTCFullYear() - 10}-01-01`) });
    noGender = await mkUser('nogender', 'STUDENT');
  });

  afterAll(async () => {
    const schoolIds = [school.id, ...otherSchools];
    const userIds = (await superuser.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.closure.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('item 1: time zones', () => {
    it('refuses a zone name that is not IANA on Branch and School', async () => {
      const b = await http().patch(`/v1/branches/${branch.id}`).set(auth(owner)).send({ timezone: 'Mountain Standard Time' });
      expect(b.status).toBe(400);
      const s = await http().patch(`/v1/schools/${school.id}`).set(auth(owner)).send({ timezone: 'Mountain Standard Time' });
      expect(s.status).toBe(400);
      const ok = await http().patch(`/v1/schools/${school.id}`).set(auth(owner)).send({ timezone: 'Asia/Tokyo' });
      expect(ok.status).toBe(200);
    });

    it('refuses a slot on a stored bad zone before saving it', async () => {
      const bad = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Bad zone', timezone: 'Mountain Standard Time' } });
      const before = await superuser.timetableSlot.count({ where: { schoolId: school.id } });
      const res = await http()
        .post(`/v1/schools/${school.id}/timetable`)
        .set(auth(owner))
        .send({ branchId: bad.id, weekday: 'MONDAY', startTime: '18:00', endTime: '19:00', title: 'Bad', activities: ['BJJ'], capacity: 10 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TIME_ZONE');
      expect(await superuser.timetableSlot.count({ where: { schoolId: school.id } })).toBe(before);
      await superuser.branch.delete({ where: { id: bad.id } });
    });

    it('the generator skips a bad slot and still makes other Schools\' classes', async () => {
      const badSchool = randomUUID();
      const goodSchool = randomUUID();
      otherSchools.push(badSchool, goodSchool);
      await superuser.school.create({ data: { id: badSchool, name: 'Bad', timezone: 'Mountain Standard Time' } });
      await superuser.school.create({ data: { id: goodSchool, name: 'Good', timezone: 'Europe/London' } });
      const today = DateTime.utc().toISODate()!;
      await superuser.closure.create({ data: { schoolId: badSchool, startDate: new Date(`${today}T00:00:00Z`), endDate: new Date(Date.now() + 10 * DAY), reason: 'Holiday' } });
      const slot = (schoolId: string) => ({
        id: randomUUID(), schoolId, weekday: 'MONDAY' as const, startTime: new Date('1970-01-01T18:00:00Z'), endTime: new Date('1970-01-01T19:00:00Z'), title: 'Gen', activities: ['BJJ'], capacity: 5,
      });
      await superuser.timetableSlot.create({ data: slot(badSchool) });
      const good = await superuser.timetableSlot.create({ data: slot(goodSchool) });
      await generator.process({} as never);
      expect(await superuser.class.count({ where: { timetableSlotId: good.id } })).toBe(4);
      expect(await superuser.class.count({ where: { schoolId: badSchool } })).toBe(0);
    });
  });

  describe('item 3: classes past midnight', () => {
    it('makes a 23:00–00:30 weekly class 90 minutes long, belonging to its start date', async () => {
      const res = await http()
        .post(`/v1/schools/${school.id}/timetable`)
        .set(auth(owner))
        .send({ branchId: branch.id, weekday: weekdayIn(2, 'Asia/Tokyo'), startTime: '23:00', endTime: '00:30', breakStart: '23:45', breakEnd: '00:05', title: 'Night', activities: ['BJJ'], capacity: 10 });
      expect(res.status).toBe(201);
      const first = await superuser.class.findFirstOrThrow({ where: { timetableSlotId: res.body.id }, orderBy: { startDate: 'asc' } });
      expect((first.endDate.getTime() - first.startDate.getTime()) / 60_000).toBe(90);
      expect(DateTime.fromJSDate(first.startDate).setZone('Asia/Tokyo').toISODate()).toBe(first.occurrenceDate!.toISOString().slice(0, 10));
      await superuser.timetableSlot.update({ where: { id: res.body.id }, data: { status: 'OFF' } });
    });

    it('refuses an end equal to the start or a class over 12 hours', async () => {
      const send = (startTime: string, endTime: string) =>
        http().post(`/v1/schools/${school.id}/timetable`).set(auth(owner)).send({ weekday: 'MONDAY', startTime, endTime, title: 'x', activities: ['BJJ'], capacity: 10 });
      expect((await send('18:00', '18:00')).status).toBe(400);
      expect((await send('19:00', '18:00')).status).toBe(400);
    });
  });

  describe('item 2: a zone change re-times the classes', () => {
    it('moves upcoming classes to the new zone and tells the booked student', async () => {
      const slotRes = await http()
        .post(`/v1/schools/${school.id}/timetable`)
        .set(auth(owner))
        .send({ branchId: branch.id, weekday: weekdayIn(3, 'Asia/Tokyo'), startTime: '18:00', endTime: '19:00', title: 'Zone', activities: ['BJJ'], capacity: 10 });
      expect(slotRes.status).toBe(201);
      const first = await superuser.class.findFirstOrThrow({ where: { timetableSlotId: slotRes.body.id }, orderBy: { startDate: 'asc' } });
      expect((await http().post(`/v1/classes/${first.id}/book`).set(auth(woman)).send({})).status).toBe(201);

      expect((await http().patch(`/v1/branches/${branch.id}`).set(auth(owner)).send({ timezone: 'Asia/Dubai' })).status).toBe(200);
      const moved = await superuser.class.findUniqueOrThrow({ where: { id: first.id } });
      expect(DateTime.fromJSDate(moved.startDate).setZone('Asia/Dubai').toFormat('HH:mm')).toBe('18:00');
      expect(moved.startDate.getTime() - first.startDate.getTime()).toBe(5 * 3_600_000);
      const notice = await waitFor(() => superuser.notification.findFirst({ where: { userId: woman.id, title: 'Class moved' } }));
      expect(notice).not.toBeNull();

      await http().patch(`/v1/branches/${branch.id}`).set(auth(owner)).send({ timezone: 'Asia/Tokyo' });
      await superuser.booking.deleteMany({ where: { classId: first.id } });
      await superuser.timetableSlot.update({ where: { id: slotRes.body.id }, data: { status: 'OFF' } });
    });
  });

  describe('item 7: the week follows the School\'s week start', () => {
    it('a Sunday-start School gets a week from Sunday', async () => {
      await superuser.school.update({ where: { id: school.id }, data: { weekStartsOn: 'SUNDAY' } });
      const res = await http().get(`/v1/schools/${school.id}/bookings/summary`).set(auth(owner));
      expect(res.status).toBe(200);
      expect(DateTime.fromISO(res.body.from).weekday).toBe(7);
      await superuser.school.update({ where: { id: school.id }, data: { weekStartsOn: 'MONDAY' } });
      const monday = await http().get(`/v1/schools/${school.id}/bookings/summary`).set(auth(owner));
      expect(DateTime.fromISO(monday.body.from).weekday).toBe(1);
    });
  });

  describe('items 11 and 13: closures', () => {
    it('warns before a one-off class on a closed day, and allows it when confirmed', async () => {
      const day = DateTime.now().setZone('Asia/Tokyo').plus({ days: 3 }).toISODate()!;
      const closure = await http().post(`/v1/schools/${school.id}/closures`).set(auth(owner)).send({ startDate: day, endDate: day, reason: 'Golden Week' });
      expect(closure.status).toBe(201);
      const start = DateTime.fromISO(`${day}T10:00`, { zone: 'Asia/Tokyo' }).toJSDate();
      const body = { startDate: start.toISOString(), endDate: new Date(start.getTime() + 3_600_000).toISOString() };
      const warned = await mkClass(body);
      expect(warned.status).toBe(409);
      expect(warned.body.error.code).toBe('CLASS_ON_CLOSED_DAY');
      expect((await mkClass({ ...body, confirmClosedDay: true })).status).toBe(201);
      await superuser.closure.delete({ where: { id: closure.body.id } });
    });

    it('changing a closure\'s dates cancels newly covered classes and offers Recreate for released ones', async () => {
      const zone = 'Asia/Tokyo';
      const d = (n: number) => DateTime.now().setZone(zone).plus({ days: n }).toISODate()!;
      const at = (n: number) => DateTime.fromISO(`${d(n)}T10:00`, { zone }).toJSDate();
      const mk = async (n: number) => {
        const res = await mkClass({ title: `Eid ${n}`, startDate: at(n).toISOString(), endDate: new Date(at(n).getTime() + 3_600_000).toISOString() });
        expect(res.status).toBe(201);
        return res.body.id as string;
      };
      const c4 = await mk(4);
      const c5 = await mk(5);
      const c6 = await mk(6);
      const created = await http().post(`/v1/schools/${school.id}/closures`).set(auth(owner)).send({ startDate: d(4), endDate: d(5), reason: 'Eid' });
      expect(created.body.cancelledClasses).toBe(2);

      // The moon is sighted a day later: closed 5–6 instead of 4–5.
      const changed = await http().patch(`/v1/closures/${created.body.id}`).set(auth(owner)).send({ startDate: d(5), endDate: d(6) });
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({ startDate: d(5), endDate: d(6), cancelledClasses: 1 });
      expect((await superuser.class.findUniqueOrThrow({ where: { id: c6 } })).cancelledAt).not.toBeNull();
      expect(changed.body.recreatable.map((c: { id: string }) => c.id)).toEqual([c4]);
      expect((await superuser.class.findUniqueOrThrow({ where: { id: c5 } })).cancelledAt).not.toBeNull();

      const copy = await http().post(`/v1/classes/${c4}/recreate`).set(auth(owner));
      expect(copy.status).toBe(201);
      expect(copy.body.id).not.toBe(c4);
      expect(copy.body.cancelledAt).toBeNull();
      expect(new Date(copy.body.startDate).getTime()).toBe(at(4).getTime());
      const again = await http().post(`/v1/classes/${c4}/recreate`).set(auth(owner));
      expect(again.body.id).toBe(copy.body.id);
      // Only a cancelled class can be recreated.
      expect((await http().post(`/v1/classes/${copy.body.id}/recreate`).set(auth(owner))).status).toBe(409);
      // Only the owner changes a closure; a student can't even see it (RLS), as for DELETE.
      expect((await http().patch(`/v1/closures/${created.body.id}`).set(auth(woman)).send({ reason: 'x' })).status).toBe(404);
      await superuser.closure.delete({ where: { id: created.body.id } });
    });
  });

  describe('item 14: who can book', () => {
    let womenOnly: string;
    beforeAll(async () => {
      const res = await mkClass({ title: 'Ladies only', audience: 'WOMEN', minAge: 16, capacity: 1 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ audience: 'WOMEN', minAge: 16, maxAge: null });
      womenOnly = res.body.id;
    });

    it('refuses a man, a member with no gender and a child; books a woman', async () => {
      const m = await http().post(`/v1/classes/${womenOnly}/book`).set(auth(man)).send({});
      expect(m.status).toBe(403);
      expect(m.body.error.code).toBe('WHO_CAN_BOOK_GENDER');
      expect((await http().post(`/v1/classes/${womenOnly}/book`).set(auth(noGender)).send({})).body.error.code).toBe('WHO_CAN_BOOK_GENDER_MISSING');
      expect((await http().post(`/v1/classes/${womenOnly}/book`).set(auth(child)).send({})).body.error.code).toBe('WHO_CAN_BOOK_AGE');
      expect((await http().post(`/v1/classes/${womenOnly}/book`).set(auth(woman)).send({})).status).toBe(201);
    });

    it('refuses the waitlist too', async () => {
      const res = await http().post(`/v1/classes/${womenOnly}/waitlist`).set(auth(man)).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('WHO_CAN_BOOK_GENDER');
    });

    it('staff can book anyone with an override reason, and not without one', async () => {
      const open = await mkClass({ title: 'Women 2', audience: 'WOMEN' });
      expect((await http().post(`/v1/classes/${open.body.id}/book`).set(auth(owner)).send({ studentId: man.id })).status).toBe(403);
      expect((await http().post(`/v1/classes/${open.body.id}/book`).set(auth(owner)).send({ studentId: man.id, overrideReason: 'Coach assisting' })).status).toBe(201);
    });

    it('refuses an age range out of order, and a slot copies who can book onto its classes', async () => {
      expect((await mkClass({ minAge: 20, maxAge: 10 })).status).toBe(400);
      const slot = await http()
        .post(`/v1/schools/${school.id}/timetable`)
        .set(auth(owner))
        .send({ weekday: 'TUESDAY', startTime: '20:00', endTime: '21:00', title: 'Sisters', activities: ['BJJ'], capacity: 10, audience: 'WOMEN', maxAge: 60 });
      expect(slot.status).toBe(201);
      expect(slot.body).toMatchObject({ audience: 'WOMEN', maxAge: 60 });
      const cls = await superuser.class.findFirstOrThrow({ where: { timetableSlotId: slot.body.id } });
      expect(cls).toMatchObject({ audience: 'WOMEN', minAge: null, maxAge: 60 });
      expect((await http().patch(`/v1/timetable/${slot.body.id}`).set(auth(owner)).send({ audience: 'EVERYONE' })).status).toBe(200);
      expect((await superuser.class.findUniqueOrThrow({ where: { id: cls.id } })).audience).toBe('EVERYONE');
      await superuser.timetableSlot.update({ where: { id: slot.body.id }, data: { status: 'OFF' } });
    });
  });

  describe('item 9: removing a student uses the default cut-off', () => {
    it('keeps the credit inside the School\'s default cut-off', async () => {
      await superuser.school.update({ where: { id: school.id }, data: { defaultRefundCutoffHours: 72 } });
      const leaver = await mkUser('leaver', 'STUDENT', { gender: 'MALE' });
      const pack = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Pack', price: 1000, classesIncluded: 5 } });
      await superuser.membership.deleteMany({ where: { studentId: leaver.id } });
      const m = await superuser.membership.create({ data: { id: randomUUID(), studentId: leaver.id, schoolId: school.id, membershipPlanId: pack.id, frequency: 'ONE_TIME', classesRemaining: 5 } });
      const soon = await mkClass({ title: 'Soon', startDate: new Date(Date.now() + DAY).toISOString(), endDate: new Date(Date.now() + DAY + 3_600_000).toISOString() });
      expect((await http().post(`/v1/classes/${soon.body.id}/book`).set(auth(leaver)).send({})).status).toBe(201);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: m.id } })).classesRemaining).toBe(4);
      expect((await http().delete(`/v1/users/${leaver.id}/role-grants/${leaver.grantId}`).set(auth(owner))).status).toBe(200);
      const booking = await superuser.booking.findFirstOrThrow({ where: { studentId: leaver.id, classId: soon.body.id } });
      expect(booking).toMatchObject({ status: 'CANCELLED', refundResolution: 'WITHHELD' });
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: m.id } })).classesRemaining).toBe(4);
      await superuser.school.update({ where: { id: school.id }, data: { defaultRefundCutoffHours: null } });
    });
  });
});
