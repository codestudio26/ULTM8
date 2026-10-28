/**
 * "Remove from School" for a coach who still teaches (Decision 361 follow-up,
 * product owner 28 Oct 2026): the removal always works, and the owner chooses
 * what happens to their upcoming classes and weekly slots — another coach,
 * no coach for now, or cancel the classes.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import { CancellationService } from '../src/bookings/cancellation.service';
import { ClassOccurrenceGenerationProcessor } from '../src/jobs/class-occurrence-generation.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[staff-remove-teaching.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Remove from School: what happens to the classes the person teaches', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);

  let school: { id: string };
  let other: { id: string };
  let north: { id: string };
  let owner: { id: string; email: string };
  let ownerToken: string;
  let student: { id: string };
  let packPlanId: string;
  let fanout: Array<{ userId: string; type: string; targetId: string }>;

  const http = () => request(app.getHttpServer());
  const remove = (userId: string, body?: object) =>
    http().post(`/v1/schools/${school.id}/staff/${userId}/remove`).set('Authorization', `Bearer ${ownerToken}`).send(body ?? {});
  const teaching = (userId: string) => http().get(`/v1/schools/${school.id}/staff/${userId}/teaching`).set('Authorization', `Bearer ${ownerToken}`);

  const mkUser = (firstName: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `staff-teach-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname: 'Coach',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  const grant = (userId: string, role: 'INSTRUCTOR' | 'BRANCH_STAFF' | 'STUDENT', schoolId: string, branchId: string | null = null) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId, branchId, grantedById: owner.id } });
  const coach = async (name: string, branchId: string | null = null) => {
    const u = await mkUser(name);
    await grant(u.id, 'INSTRUCTOR', school.id, branchId);
    return u;
  };
  const mkClass = (instructorId: string | null, extra: { branchId?: string; startInHours?: number; cancelledAt?: Date } = {}) => {
    const start = new Date(Date.now() + (extra.startInHours ?? 48) * 3_600_000);
    return superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: extra.branchId ?? null,
        instructorId,
        title: `Class ${randomUUID().slice(0, 6)}`,
        startDate: start,
        endDate: new Date(start.getTime() + 3_600_000),
        cancelledAt: extra.cancelledAt ?? null,
      },
    });
  };
  const mkSlot = (instructorId: string, branchId: string | null = null) =>
    superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId,
        instructorId,
        weekday: 'MONDAY',
        startTime: new Date('1970-01-01T18:00:00Z'),
        endTime: new Date('1970-01-01T19:00:00Z'),
        title: 'Monday Kids',
      },
    });
  /** A booking on `classId` paid from a fresh 5-class pack with one credit spent. */
  const mkBooking = async (classId: string) => {
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: packPlanId, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 4 },
    });
    const booking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId, schoolId: school.id, sourceMembershipId: membership.id },
    });
    return { membership, booking };
  };
  const activeRoles = (userId: string) => superuser.roleGrant.count({ where: { userId, schoolId: school.id, revokedAt: null } });

  beforeAll(async () => {
    // A nightly run catching up when the app starts would add Classes from
    // the slots made here; the counts below are about the rows each test makes.
    jest.spyOn(ClassOccurrenceGenerationProcessor.prototype, 'process').mockResolvedValue(undefined as never);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({ sendEmail: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    jest.spyOn(app.get(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'add').mockImplementation(async (...args: unknown[]) => {
      fanout.push(args[1] as { userId: string; type: string; targetId: string });
      return {} as never;
    });

    school = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Teaching ${tag}`, schoolCancelledClassResolution: 'CREDIT_ALL' } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Teaching other ${tag}` } });
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    owner = await mkUser('Olive');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    ownerToken = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    student = await mkUser('Stu');
    await grant(student.id, 'STUDENT', school.id);
    packPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5, currency: 'gbp' } })).id;
  });

  beforeEach(() => {
    fanout = [];
  });

  afterAll(async () => {
    const schools = await superuser.school.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const where = { schoolId: { in: schools.map((s) => s.id) } };
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.notification.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await superuser.booking.deleteMany({ where });
    await superuser.waitlistEntry.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.timetableSlot.deleteMany({ where });
    await superuser.coachInvite.deleteMany({ where });
    await superuser.gradingPermission.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schools.map((s) => s.id) } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('counts what they teach, and without a choice refuses with 409 STAFF_STILL_TEACHING and keeps their roles', async () => {
    const ana = await coach('Ana');
    await mkClass(ana.id);
    await mkClass(ana.id);
    await mkClass(ana.id, { cancelledAt: new Date() }); // cancelled: nobody teaches it
    await mkClass(ana.id, { startInHours: -48 }); // over
    await mkSlot(ana.id);

    const counts = await teaching(ana.id);
    expect(counts.status).toBe(200);
    expect(counts.body).toEqual({ upcomingClasses: 2, activeSlots: 1 });

    const res = await remove(ana.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAFF_STILL_TEACHING');
    expect(res.body.error.message).toContain('2 upcoming classes and 1 weekly timetable slot');
    expect(await activeRoles(ana.id)).toBe(1);
  });

  it('REASSIGN gives their upcoming classes and weekly slots to the other coach and removes their roles', async () => {
    const ana = await coach('Ana');
    const ben = await coach('Ben');
    const c1 = await mkClass(ana.id);
    const c2 = await mkClass(ana.id, { branchId: north.id });
    const past = await mkClass(ana.id, { startInHours: -48 });
    const slot = await mkSlot(ana.id);

    const res = await remove(ana.id, { classes: 'REASSIGN', toUserId: ben.id });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ removedRoles: 1, classesReassigned: 2, classesCleared: 0, classesCancelled: 0, slotsReassigned: 1, slotsCleared: 0 });
    expect(await activeRoles(ana.id)).toBe(0);
    const classes = await superuser.class.findMany({ where: { id: { in: [c1.id, c2.id, past.id] } } });
    expect(classes.find((c) => c.id === c1.id)!.instructorId).toBe(ben.id);
    expect(classes.find((c) => c.id === c2.id)!.instructorId).toBe(ben.id);
    expect(classes.find((c) => c.id === past.id)!.instructorId).toBe(ana.id); // history stays
    expect((await superuser.timetableSlot.findUniqueOrThrow({ where: { id: slot.id } })).instructorId).toBe(ben.id);
    expect((await teaching(ana.id)).body).toEqual({ upcomingClasses: 0, activeSlots: 0 });
  });

  it('NONE leaves their upcoming classes and slots with no instructor', async () => {
    const ana = await coach('Ana');
    const c1 = await mkClass(ana.id);
    const slot = await mkSlot(ana.id);

    const res = await remove(ana.id, { classes: 'NONE' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ removedRoles: 1, classesCleared: 1, slotsCleared: 1, classesReassigned: 0, classesCancelled: 0 });
    expect((await superuser.class.findUniqueOrThrow({ where: { id: c1.id } })).instructorId).toBeNull();
    expect((await superuser.timetableSlot.findUniqueOrThrow({ where: { id: slot.id } })).instructorId).toBeNull();
    expect(await activeRoles(ana.id)).toBe(0);
  });

  it('CANCEL cancels their classes as the School would (bookings cancelled, credit back, students told), clears their slots, and removes them', async () => {
    const ana = await coach('Ana');
    const c1 = await mkClass(ana.id);
    const c2 = await mkClass(ana.id);
    const slot = await mkSlot(ana.id);
    const { membership, booking } = await mkBooking(c1.id);

    const res = await remove(ana.id, { classes: 'CANCEL' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ removedRoles: 1, classesReassigned: 0, classesCleared: 0, classesCancelled: 2, slotsReassigned: 0, slotsCleared: 1 });
    const classes = await superuser.class.findMany({ where: { id: { in: [c1.id, c2.id] } } });
    for (const c of classes) {
      expect(c.cancelledAt).not.toBeNull();
      expect(c.cancelledById).toBe(owner.id);
    }
    const b = await superuser.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('CANCELLED');
    expect(b.refundResolution).toBe('REFUNDED');
    expect((await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } })).classesRemaining).toBe(5);
    expect(fanout).toEqual([expect.objectContaining({ userId: student.id, type: 'CLASS_CANCELLED', targetId: c1.id })]);
    expect((await superuser.timetableSlot.findUniqueOrThrow({ where: { id: slot.id } })).instructorId).toBeNull();
    expect(await activeRoles(ana.id)).toBe(0);

    // Sent again once everything is done: nothing left, the usual 404.
    expect((await remove(ana.id, { classes: 'CANCEL' })).status).toBe(404);
  });

  it('CANCEL sent again finishes cancellations that stopped part-way after the roles were removed', async () => {
    const ana = await coach('Ana');
    const c1 = await mkClass(ana.id);
    const c2 = await mkClass(ana.id);
    await mkBooking(c2.id);
    const cancellation = app.get(CancellationService);
    const original = cancellation.cancelClass.bind(cancellation);
    const spy = jest.spyOn(cancellation, 'cancelClass').mockImplementation(async (callerId, classId, reason) => {
      if (classId === c2.id) throw new Error('worker died');
      return original(callerId, classId, reason);
    });
    const first = await remove(ana.id, { classes: 'CANCEL' });
    expect(first.status).toBe(500);
    expect(await activeRoles(ana.id)).toBe(0); // access ended at once
    spy.mockRestore();

    const retry = await remove(ana.id, { classes: 'CANCEL' });
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ removedRoles: 0, classesCancelled: 1 });
    const classes = await superuser.class.findMany({ where: { id: { in: [c1.id, c2.id] } } });
    expect(classes.every((c) => c.cancelledAt !== null)).toBe(true);
    expect(fanout.filter((n) => n.targetId === c2.id)).toHaveLength(1);
  });

  it('refuses a missing, wrong or same coach for REASSIGN, and a coach without REASSIGN', async () => {
    const ana = await coach('Ana');
    await mkClass(ana.id);
    const elsewhere = await mkUser('Eli');
    await grant(elsewhere.id, 'INSTRUCTOR', other.id);
    const desk = await mkUser('Dee');
    await grant(desk.id, 'BRANCH_STAFF', school.id);
    const northOnly = await coach('Nia', north.id);
    const south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    await mkClass(ana.id, { branchId: south.id }); // a North-only coach can't take a South class

    expect((await remove(ana.id, { classes: 'REASSIGN' })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'REASSIGN', toUserId: ana.id })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'REASSIGN', toUserId: elsewhere.id })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'REASSIGN', toUserId: desk.id })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'REASSIGN', toUserId: randomUUID() })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'REASSIGN', toUserId: 'not-a-uuid' })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'REASSIGN', toUserId: northOnly.id })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'NONE', toUserId: northOnly.id })).status).toBe(400);
    expect((await remove(ana.id, { classes: 'SOMETHING' })).status).toBe(400);
    expect(await activeRoles(ana.id)).toBe(1);
  });

  it('removes someone who teaches nothing with no body, and only the owner may read what someone teaches', async () => {
    const quiet = await coach('Quinn');
    const res = await http().post(`/v1/schools/${school.id}/staff/${quiet.id}/remove`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ removedRoles: 1, classesReassigned: 0, classesCleared: 0, classesCancelled: 0, slotsReassigned: 0, slotsCleared: 0 });

    const ana = await coach('Ana');
    const anaToken = jwt.sign({ sub: ana.id, email: 'x', grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });
    expect((await http().get(`/v1/schools/${school.id}/staff/${ana.id}/teaching`).set('Authorization', `Bearer ${anaToken}`)).status).toBe(403);
  });
});
