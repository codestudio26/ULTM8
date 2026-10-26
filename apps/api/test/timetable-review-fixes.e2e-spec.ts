/**
 * Regression gate for the Timetable section review of 26 Oct 2026 (Decision 332).
 * Each test pins one bug the review proved over real HTTP, numbered as in the
 * review (T1–T18):
 *
 * - T1/T2: the nightly job skips archived slots and closed Schools; an archived
 *   slot can't be edited;
 * - T3: a new or unarchived slot is bookable straight away;
 * - T4: a slot's capacity raise offers the new seats to the waitlist;
 * - T5: a capacity cut is refused with the count, and once confirmed, fuller
 *   Classes keep their size; CANCEL isn't accepted for it;
 * - T6: booking-rule changes ask about booked Classes; title and coach don't;
 * - T8/T9: times and breaks are checked, and a break can be removed;
 * - T15: switching a slot back on brings back the dates it cancelled;
 * - T16: the cancel notice names the day in the School's zone;
 * - T17: a slot can't go on an archived Branch;
 * - T18: waiting Students are told when a class moves;
 * - a slot's title is trimmed and can't be blank.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET (and REDIS_URL for the queues).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ClassOccurrenceGenerationProcessor } from '../src/jobs/class-occurrence-generation.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[timetable-review-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const HOUR = 3_600_000;

/** Polls until `check` returns true (queues run in the background), up to ~5s. */
async function eventually(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describeIfDb('Timetable review fixes (Decision 332)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const school = { id: randomUUID() };
  type U = { id: string; token: string };
  let owner: U;
  const students: U[] = [];

  const http = () => request(app.getHttpServer());
  const dayAhead = (days: number) => WEEKDAYS[new Date(Date.now() + days * 24 * HOUR).getUTCDay()];
  const live = (slotId: string) =>
    superuser.class.findMany({ where: { timetableSlotId: slotId, archivedAt: null, startDate: { gt: new Date() } }, orderBy: { startDate: 'asc' } });
  const patch = (slotId: string, body: Record<string, unknown>) => http().patch(`/v1/timetable/${slotId}`).set('Authorization', `Bearer ${owner.token}`).send(body);
  const post = (path: string) => http().post(path).set('Authorization', `Bearer ${owner.token}`).send({});
  const book = (classId: string, who: U) => http().post(`/v1/classes/${classId}/book`).set('Authorization', `Bearer ${who.token}`).send({});
  const joinWaitlist = (classId: string, who: U) => http().post(`/v1/classes/${classId}/waitlist`).set('Authorization', `Bearer ${who.token}`).send({});
  const runNightlyJob = () => app.get(ClassOccurrenceGenerationProcessor).process({} as never);
  const createSlot = (body: Record<string, unknown> = {}) =>
    http()
      .post(`/v1/schools/${school.id}/timetable`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ weekday: dayAhead(1), startTime: '18:00', endTime: '19:00', title: 'Evening', activities: ['BJJ'], capacity: 20, ...body });
  async function mkSlot(body: Record<string, unknown> = {}): Promise<string> {
    const res = await createSlot(body);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT'): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tt-fixes-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Timetable',
        passcodeHash: 'x',
        dateOfBirth: new Date('1995-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id } });
    return { id: user.id, token: jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] }) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: 'Timetable Fixes School', timezone: 'UTC', waitlistClaimWindowMinutes: 60 } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    for (let i = 0; i < 12; i++) {
      const s = await mkUser(`student${i}`, 'STUDENT');
      students.push(s);
      await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: plan.id, frequency: 'RECURRING' } });
    }
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'tt-fixes-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  // Every slot a test leaves On is switched off at the end, so the nightly-job
  // tests only see their own slots' Classes change.
  afterEach(async () => {
    await superuser.timetableSlot.updateMany({ where: { schoolId: school.id }, data: { status: 'OFF' } });
  });

  it('T3: a new slot is bookable straight away, and so is an unarchived one', async () => {
    const slot = await mkSlot();
    expect(await live(slot)).toHaveLength(4);
    const date = new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 10);
    const occurrence = await http().get(`/v1/timetable/${slot}/occurrence?date=${date}`).set('Authorization', `Bearer ${owner.token}`);
    expect(occurrence.status).toBe(200);

    expect((await post(`/v1/timetable/${slot}/archive`)).status).toBe(201);
    expect(await live(slot)).toHaveLength(0);
    expect((await post(`/v1/timetable/${slot}/unarchive`)).status).toBe(201);
    expect(await live(slot)).toHaveLength(4);
  });

  it('T1: the nightly job leaves an archived slot archived, and an archived slot can\'t be edited', async () => {
    const slot = await mkSlot();
    expect((await post(`/v1/timetable/${slot}/archive`)).status).toBe(201);
    await runNightlyJob();
    expect(await live(slot)).toHaveLength(0);
    const edit = await patch(slot, { title: 'Edited while archived' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.message).toMatch(/Unarchive it first/);
  });

  it('T2: the nightly job makes nothing for a closed School', async () => {
    const slot = await mkSlot();
    await superuser.class.deleteMany({ where: { timetableSlotId: slot } });
    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
    try {
      await runNightlyJob();
      expect(await live(slot)).toHaveLength(0);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
    }
  });

  it('T4: raising a slot\'s capacity offers the new seat to the waitlist', async () => {
    const slot = await mkSlot({ capacity: 1 });
    const [first] = await live(slot);
    expect((await book(first.id, students[0])).status).toBe(201);
    expect((await joinWaitlist(first.id, students[1])).status).toBe(201);
    expect((await patch(slot, { capacity: 2 })).status).toBe(200);
    expect((await superuser.class.findUniqueOrThrow({ where: { id: first.id } })).capacity).toBe(2);
    const offered = await eventually(async () => (await superuser.waitlistEntry.findFirstOrThrow({ where: { classId: first.id } })).status === 'NOTIFIED');
    expect(offered).toBe(true);
  });

  it('T5: a capacity cut is refused with the count; confirmed, fuller Classes keep their size; CANCEL is refused', async () => {
    const slot = await mkSlot({ capacity: 10 });
    const [first, second, third] = await live(slot);
    for (const s of students.slice(2, 5)) expect((await book(first.id, s)).status).toBe(201);
    expect((await book(second.id, students[5])).status).toBe(201);

    const refused = await patch(slot, { capacity: 2 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('CAPACITY_BELOW_BOOKED');
    expect(refused.body.error.message).toMatch(/3 students booked/);
    expect((await patch(slot, { capacity: 2, bookedClasses: 'CANCEL' })).status).toBe(400);

    expect((await patch(slot, { capacity: 2, bookedClasses: 'KEEP' })).status).toBe(200);
    const after = await superuser.class.findMany({ where: { id: { in: [first.id, second.id, third.id] } } });
    const cap = (id: string) => after.find((c) => c.id === id)!.capacity;
    expect(cap(first.id)).toBe(10); // 3 booked: keeps its size
    expect(cap(second.id)).toBe(2); // 1 booked: fits
    expect(cap(third.id)).toBe(2); // unbooked
    expect(after.every((c) => c.archivedAt === null)).toBe(true);
    expect(await superuser.booking.count({ where: { classId: first.id, status: 'UPCOMING' } })).toBe(3);
  });

  it('T6: a booking-rule change asks about booked Classes; KEEP leaves them, MOVE applies; a title change just follows', async () => {
    const slot = await mkSlot();
    const [booked, unbooked] = await live(slot);
    expect((await book(booked.id, students[6])).status).toBe(201);

    const ask = await patch(slot, { termsWaiverRequired: true });
    expect(ask.status).toBe(409);
    expect(ask.body.error.code).toBe('BOOKED_CLASSES_CHOICE_REQUIRED');
    expect((await patch(slot, { termsWaiverRequired: true, bookedClasses: 'CANCEL' })).status).toBe(400);

    expect((await patch(slot, { termsWaiverRequired: true, title: 'Evening Gi', bookedClasses: 'KEEP' })).status).toBe(200);
    let [b, u] = await Promise.all([booked.id, unbooked.id].map((id) => superuser.class.findUniqueOrThrow({ where: { id } })));
    expect(b.termsWaiverRequired).toBe(false);
    expect(u.termsWaiverRequired).toBe(true);
    expect(b.title).toBe('Evening Gi'); // title follows whatever the choice

    expect((await patch(slot, { refundCutoffHoursBeforeStart: 12, bookedClasses: 'MOVE' })).status).toBe(200);
    [b, u] = await Promise.all([booked.id, unbooked.id].map((id) => superuser.class.findUniqueOrThrow({ where: { id } })));
    expect(b.refundFeeDate?.getTime()).toBe(b.startDate.getTime() - 12 * HOUR);

    expect((await patch(slot, { title: 'Evening No-Gi' })).status).toBe(200);
    expect((await superuser.class.findUniqueOrThrow({ where: { id: booked.id } })).title).toBe('Evening No-Gi');
  });

  it('T8: times and breaks are checked on create and edit', async () => {
    expect((await createSlot({ startTime: '19:00', endTime: '18:00' })).status).toBe(400);
    expect((await createSlot({ startTime: '18:00', endTime: '18:00' })).status).toBe(400);
    expect((await createSlot({ breakStart: '18:20' })).status).toBe(400);
    expect((await createSlot({ breakStart: '18:40', breakEnd: '18:20' })).status).toBe(400);
    expect((await createSlot({ breakStart: '20:00', breakEnd: '20:15' })).status).toBe(400);
    const slot = await mkSlot({ breakStart: '18:25', breakEnd: '18:35' });
    const edit = await patch(slot, { endTime: '18:30' });
    expect(edit.status).toBe(400);
    expect(edit.body.error.message).toMatch(/break must fall inside/);
  });

  it('T9: a break can be removed', async () => {
    const slot = await mkSlot({ breakStart: '18:25', breakEnd: '18:35' });
    expect((await patch(slot, { breakStart: null })).status).toBe(400); // both or neither
    const res = await patch(slot, { breakStart: null, breakEnd: null });
    expect(res.status).toBe(200);
    expect(res.body.breakStart).toBeNull();
    expect(res.body.breakEnd).toBeNull();
  });

  it('T15: switching a slot off with CANCEL and back on brings the cancelled date back', async () => {
    const slot = await mkSlot();
    const [first] = await live(slot);
    const booking = await book(first.id, students[7]);
    expect(booking.status).toBe(201);
    expect((await patch(slot, { status: 'OFF', bookedClasses: 'CANCEL' })).status).toBe(200);
    // The cancelled Class and its booking stay, unlinked from the slot.
    const cancelled = await superuser.class.findUniqueOrThrow({ where: { id: first.id } });
    expect(cancelled.archivedAt).not.toBeNull();
    expect(cancelled.timetableSlotId).toBeNull();
    expect((await superuser.booking.findUniqueOrThrow({ where: { id: booking.body.id } })).status).toBe('CANCELLED');

    expect((await patch(slot, { status: 'ON' })).status).toBe(200);
    const back = await live(slot);
    expect(back).toHaveLength(4);
    expect(back.some((c) => c.occurrenceDate?.getTime() === first.occurrenceDate?.getTime())).toBe(true);
  });

  it('T16: the cancel notice names the day in the School\'s time zone', async () => {
    await superuser.school.update({ where: { id: school.id }, data: { timezone: 'America/Los_Angeles' } });
    try {
      // 20:00 in Los Angeles is the next day in UTC.
      const slot = await mkSlot({ weekday: dayAhead(3), startTime: '20:00', endTime: '21:00' });
      const [first] = await live(slot);
      expect((await book(first.id, students[8])).status).toBe(201);
      expect((await patch(slot, { status: 'OFF', bookedClasses: 'CANCEL' })).status).toBe(200);
      const localDay = new Date(first.occurrenceDate!.getTime()).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
      const told = await eventually(async () => !!(await superuser.notification.findFirst({ where: { userId: students[8].id, type: 'CLASS_CANCELLED' } })));
      expect(told).toBe(true);
      const notice = await superuser.notification.findFirstOrThrow({ where: { userId: students[8].id, type: 'CLASS_CANCELLED' } });
      expect(notice.body).toContain(`${localDay} `);
      expect(notice.body).toContain('at 20:00');
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { timezone: 'UTC' } });
    }
  });

  it('T17: a slot can\'t be put on an archived Branch', async () => {
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Closed branch', archivedAt: new Date() } });
    const created = await createSlot({ branchId: branch.id });
    expect(created.status).toBe(400);
    expect(created.body.error.message).toMatch(/archived/);
    const slot = await mkSlot({ status: 'OFF' });
    expect((await patch(slot, { branchId: branch.id })).status).toBe(400);
  });

  it('T18: moving a class tells the Students waiting for it', async () => {
    const slot = await mkSlot({ capacity: 1 });
    const [first] = await live(slot);
    expect((await book(first.id, students[9])).status).toBe(201);
    expect((await joinWaitlist(first.id, students[10])).status).toBe(201);
    expect((await patch(slot, { startTime: '17:00', endTime: '18:00', bookedClasses: 'MOVE' })).status).toBe(200);
    const told = await eventually(async () => (await superuser.notification.count({ where: { userId: students[10].id, type: 'CLASS_MOVED' } })) === 1);
    expect(told).toBe(true);
  });

  it('a slot\'s title is trimmed and can\'t be blank', async () => {
    expect((await createSlot({ title: '   ' })).status).toBe(400);
    const res = await createSlot({ title: '  Kids BJJ  ', status: 'OFF' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Kids BJJ');
    expect((await patch(res.body.id, { title: ' ' })).status).toBe(400);
  });
});
