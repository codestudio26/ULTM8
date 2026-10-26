/**
 * HTTP-level gate for NotificationBroadcastModule (v1.2 backend backlog —
 * "Notifications page" Broadcast/compose, approved by the product owner):
 * `POST /schools/:schoolId/notifications/broadcast`. Same ground rule as
 * every other e2e spec in this repo — proved over real HTTP against real
 * Postgres, not just by reading the code.
 *
 * Two describe blocks, sharing one set of fixtures:
 *  - HTTP (real app.init(), the real notification-fanout queue/Redis, same
 *    as WaiversController's own create-via-HTTP test never mocks its own
 *    queue either): the School-Owner-only gate, cross-School isolation, and
 *    validation — proven over real status codes and `recipientCount`.
 *  - Direct service invocation (FOUND ON REVIEW: an earlier draft of this
 *    file tried overriding the notification-fanout queue provider on a
 *    FULLY-INITIALIZED AppModule to inspect exact recipient ids — this
 *    broke `app.init()` outright ("Worker requires a connection"), because
 *    `NotificationFanoutProcessor`'s own `@Processor(NOTIFICATION_FANOUT_QUEUE)`
 *    also lives in this same AppModule and `BullExplorer`'s worker
 *    registration — which only runs during `app.init()`/`moduleRef.init()`,
 *    confirmed by removing that call — depends on the REAL Queue/connection
 *    config the override had just replaced with a bare mock. Fixed by never
 *    calling `app.init()` for this half at all: a second `TestingModule`
 *    compiled from the same `AppModule` with the queue overridden, resolved
 *    via `moduleRef.get()` alone — no HTTP server, no Worker ever
 *    constructed — same "compile, don't init, call the method directly"
 *    shape `notifications.e2e-spec.ts`'s own direct-invocation describe
 *    block already established for a Processor, applied here to a Service.
 *    This is what actually proves exactly WHICH Students each audience
 *    resolves to; the HTTP half only proves the resulting count.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS, JWT_ACCESS_SECRET.
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
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import { NotificationBroadcastService } from '../src/notifications/broadcast/notification-broadcast.service';
import { BroadcastAudienceDto, BroadcastClassAudienceDto } from '../src/notifications/broadcast/dto/broadcast-notification.dto';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[notification-broadcast.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / ' +
      'JWT_ACCESS_SECRET not set. This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('NotificationBroadcastModule — POST /schools/:schoolId/notifications/broadcast', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let branchX: { id: string };
  let branchY: { id: string };
  let branchEmpty: { id: string };
  let otherSchoolBranch: { id: string };
  let classInBranchX: { id: string };
  let otherSchoolClass: { id: string };
  let subscriptionPlanId: string;

  let owner: { id: string; email: string };
  let otherSchoolOwner: { id: string; email: string };
  let branchStaff: { id: string; email: string };
  let studentPlain: { id: string; email: string };
  let studentBranchX: { id: string; email: string };
  let studentBranchY: { id: string; email: string };
  let studentRevoked: { id: string; email: string };
  let studentClassBooker: { id: string; email: string };
  let studentCancelledBooker: { id: string; email: string };

  let tokenOwner: string;
  let tokenOtherSchoolOwner: string;
  let tokenBranchStaff: string;

  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const branchIds: string[] = [];
  const classIds: string[] = [];
  const membershipIds: string[] = [];
  const bookingIds: string[] = [];
  const membershipPlanIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  const mkUser = (label: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `broadcast-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Broadcast School' } });
    schoolIds.push(school.id);
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Broadcast Other School' } });
    schoolIds.push(otherSchool.id);

    branchX = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch X' } });
    branchY = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch Y' } });
    branchEmpty = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch Empty' } });
    branchIds.push(branchX.id, branchY.id, branchEmpty.id);
    otherSchoolBranch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: otherSchool.id, name: 'Other Branch' } });
    branchIds.push(otherSchoolBranch.id);

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    classInBranchX = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, branchId: branchX.id, title: 'Kids Fundamentals', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classIds.push(classInBranchX.id);
    otherSchoolClass = await superuser.class.create({
      data: { id: randomUUID(), schoolId: otherSchool.id, title: 'Other School Class', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classIds.push(otherSchoolClass.id);

    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
    });
    membershipPlanIds.push(plan.id);
    subscriptionPlanId = plan.id;

    owner = await mkUser('owner');
    otherSchoolOwner = await mkUser('other-owner');
    branchStaff = await mkUser('branch-staff');
    studentPlain = await mkUser('student-plain');
    studentBranchX = await mkUser('student-branch-x');
    studentBranchY = await mkUser('student-branch-y');
    studentRevoked = await mkUser('student-revoked');
    studentClassBooker = await mkUser('student-class-booker');
    studentCancelledBooker = await mkUser('student-cancelled-booker');
    userIds.push(
      owner.id,
      otherSchoolOwner.id,
      branchStaff.id,
      studentPlain.id,
      studentBranchX.id,
      studentBranchY.id,
      studentRevoked.id,
      studentClassBooker.id,
      studentCancelledBooker.id,
    );

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherSchoolOwner.id, schoolId: otherSchool.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaff.id, schoolId: school.id, branchId: branchX.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentPlain.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentBranchX.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentBranchY.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentRevoked.id, schoolId: school.id, revokedAt: new Date() },
        { id: randomUUID(), role: 'STUDENT', userId: studentClassBooker.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentCancelledBooker.id, schoolId: school.id },
      ],
    });

    await superuser.studentHomeBranch.createMany({
      data: [
        { id: randomUUID(), schoolId: school.id, studentId: studentBranchX.id, branchId: branchX.id },
        { id: randomUUID(), schoolId: school.id, studentId: studentBranchY.id, branchId: branchY.id },
        // A home Branch for the REVOKED Student too — proves BRANCH audience
        // intersects with an active RoleGrant, not just StudentHomeBranch
        // alone (a home-branch row can outlive the enrollment that created it).
        { id: randomUUID(), schoolId: school.id, studentId: studentRevoked.id, branchId: branchX.id },
      ],
    });

    const membershipBooker = await superuser.membership.create({
      data: { id: randomUUID(), studentId: studentClassBooker.id, membershipPlanId: subscriptionPlanId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
    membershipIds.push(membershipBooker.id);
    const bookingUpcoming = await superuser.booking.create({
      data: { id: randomUUID(), studentId: studentClassBooker.id, classId: classInBranchX.id, schoolId: school.id, sourceMembershipId: membershipBooker.id, status: 'UPCOMING' },
    });
    bookingIds.push(bookingUpcoming.id);

    const membershipCancelled = await superuser.membership.create({
      data: { id: randomUUID(), studentId: studentCancelledBooker.id, membershipPlanId: subscriptionPlanId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
    membershipIds.push(membershipCancelled.id);
    const bookingCancelled = await superuser.booking.create({
      data: { id: randomUUID(), studentId: studentCancelledBooker.id, classId: classInBranchX.id, schoolId: school.id, sourceMembershipId: membershipCancelled.id, status: 'CANCELLED' },
    });
    bookingIds.push(bookingCancelled.id);

    // Decision 333's class audience: studentBranchY waits for a place;
    // studentBranchX's place expired, so it is never on the list.
    await superuser.waitlistEntry.createMany({
      data: [
        { id: randomUUID(), studentId: studentBranchY.id, classId: classInBranchX.id, schoolId: school.id, branchId: branchX.id, position: 1, status: 'WAITING' },
        { id: randomUUID(), studentId: studentBranchX.id, classId: classInBranchX.id, schoolId: school.id, branchId: branchX.id, position: 2, status: 'EXPIRED' },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOtherSchoolOwner = signAccessToken(otherSchoolOwner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: otherSchool.id, branchId: null }]);
    tokenBranchStaff = signAccessToken(branchStaff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchX.id }]);
  });

  afterAll(async () => {
    // The HTTP describe block below deliberately does NOT mock the
    // notification-fanout queue (see this file's own header comment) — its
    // "audience ALL/BRANCH/CLASS... COUNT" test fans out through the REAL
    // queue/worker, which durably writes real Notification rows for these
    // fixture Students. Those must go before the Users they reference, same
    // FK-ordering notifications.e2e-spec.ts's own cleanup already follows.
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { id: { in: branchIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // HTTP — School-Owner-only gate, cross-School isolation, validation.
  // Real app.init(), real notification-fanout queue/Redis — same as every
  // other e2e spec's own enqueue side effect (WaiversController's own
  // create-via-HTTP test never mocks its queue either).
  // ---------------------------------------------------------------------------

  it('is School-Owner-gated — Branch Staff and unauthenticated callers are rejected', async () => {
    const asBranchStaff = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenBranchStaff}`)
      .send({ title: 'Hi', body: 'Body', audience: 'ALL' });
    expect(asBranchStaff.status).toBe(403);

    const unauth = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .send({ title: 'Hi', body: 'Body', audience: 'ALL' });
    expect(unauth.status).toBe(401);
  });

  it("a School Owner cannot broadcast to a DIFFERENT School, and cannot reference another School's Branch/Class", async () => {
    // otherSchoolOwner has no RoleGrant at all at `school` — findOne()'s own
    // visibility check 404s it, same as every other School-Owner-gated write
    // in this codebase (WaiversService.createWaiver's own two-step order).
    const wrongOwner = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOtherSchoolOwner}`)
      .send({ title: 'Hi', body: 'Body', audience: 'ALL' });
    expect(wrongOwner.status).toBe(404);

    // The School's own owner, but naming a Branch that belongs to a
    // DIFFERENT School — assertBranchBelongsToSchool rejects it.
    const wrongBranch = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Hi', body: 'Body', audience: 'BRANCH', branchId: otherSchoolBranch.id });
    expect(wrongBranch.status).toBe(400);

    // Same for a Class belonging to a different School.
    const wrongClass = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Hi', body: 'Body', audience: 'CLASS', classId: otherSchoolClass.id });
    expect(wrongClass.status).toBe(404);
  });

  it('audience ALL/BRANCH/CLASS resolve to the expected recipient COUNT over real HTTP (exact recipient identity is proven below, by direct service invocation)', async () => {
    const all = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'All hands', body: 'Body', audience: 'ALL' });
    expect(all.status).toBe(201);
    expect(all.body.audience).toBe('ALL');
    // studentPlain, studentBranchX, studentBranchY, studentClassBooker,
    // studentCancelledBooker — 5 active Students; studentRevoked excluded.
    expect(all.body.recipientCount).toBe(5);

    const branch = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Branch X only', body: 'Body', audience: 'BRANCH', branchId: branchX.id });
    expect(branch.status).toBe(201);
    expect(branch.body.recipientCount).toBe(1); // studentRevoked's home-branch row doesn't count — revoked.

    const cls = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Class roster', body: 'Body', audience: 'CLASS', classId: classInBranchX.id });
    expect(cls.status).toBe(201);
    expect(cls.body.recipientCount).toBe(1); // Booked only by default: studentClassBooker.

    const ticked = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Class roster', body: 'Body', audience: 'CLASS', classId: classInBranchX.id, classAudience: ['BOOKED', 'WAITLIST', 'CANCELLED'] });
    expect(ticked.status).toBe(201);
    expect(ticked.body.recipientCount).toBe(3);

    const badGroup = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Class roster', body: 'Body', audience: 'CLASS', classId: classInBranchX.id, classAudience: ['EVERYONE'] });
    expect(badGroup.status).toBe(400);
  });

  it('BRANCH/CLASS audiences require their matching id; an empty-audience broadcast is a no-op (0 recipients, still 201)', async () => {
    const missingBranchId = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Hi', body: 'Body', audience: 'BRANCH' });
    expect(missingBranchId.status).toBe(400);

    const missingClassId = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Hi', body: 'Body', audience: 'CLASS' });
    expect(missingClassId.status).toBe(400);

    // Branch Empty has no Students at all — a real, valid audience that
    // legitimately resolves to zero recipients, not an error.
    const emptyAudience = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/notifications/broadcast`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Hi', body: 'Body', audience: 'BRANCH', branchId: branchEmpty.id });
    expect(emptyAudience.status).toBe(201);
    expect(emptyAudience.body.recipientCount).toBe(0);
  });

  it('refuses an archived Branch, an archived Class, and a title or message of only spaces', async () => {
    const archivedBranch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Archived Branch', archivedAt: new Date() } });
    branchIds.push(archivedBranch.id);
    const past = new Date(Date.now() - 86_400_000);
    const archivedClass = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Old Class', startDate: past, endDate: past, archivedAt: new Date() },
    });
    classIds.push(archivedClass.id);
    const send = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post(`/v1/schools/${school.id}/notifications/broadcast`).set('Authorization', `Bearer ${tokenOwner}`).send(body);

    const toArchivedBranch = await send({ title: 'Hi', body: 'Body', audience: 'BRANCH', branchId: archivedBranch.id });
    expect(toArchivedBranch.status).toBe(400);
    expect(JSON.stringify(toArchivedBranch.body)).toMatch(/archived/);

    const toArchivedClass = await send({ title: 'Hi', body: 'Body', audience: 'CLASS', classId: archivedClass.id });
    expect(toArchivedClass.status).toBe(400);
    expect(JSON.stringify(toArchivedClass.body)).toMatch(/archived/);

    expect((await send({ title: '   ', body: 'Body', audience: 'ALL' })).status).toBe(400);
    expect((await send({ title: 'Hi', body: ' \n ', audience: 'ALL' })).status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Direct service invocation — exact recipient identity per audience scope.
  // See this file's own header comment for why this does NOT call
  // `app.init()`/`createNestApplication()` at all: that is what triggers
  // BullMQ Worker registration for every real `@Processor` in `AppModule`
  // (including `NotificationFanoutProcessor`, on this SAME queue), which
  // breaks outright once the queue provider is swapped for a bare mock.
  // Resolving the service straight from a compiled (not initialized)
  // `TestingModule` sidesteps that entirely — the real DB logic runs, only
  // the enqueue call is faked and inspected.
  // ---------------------------------------------------------------------------

  describe('NotificationBroadcastService.broadcast — direct invocation, exact recipients', () => {
    let broadcastService: NotificationBroadcastService;
    const fakeQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(getQueueToken(NOTIFICATION_FANOUT_QUEUE))
        .useValue(fakeQueue)
        .compile();
      // Deliberately no `.createNestApplication()`/`.init()` — see header comment.
      broadcastService = moduleRef.get(NotificationBroadcastService);
    });

    afterEach(() => {
      fakeQueue.addBulk.mockClear();
    });

    function recipientIdsFromLastCall(): string[] {
      const calls = fakeQueue.addBulk.mock.calls;
      expect(calls.length).toBe(1);
      const jobs: Array<{ data: { userId: string } }> = calls[0][0];
      return jobs.map((j) => j.data.userId);
    }

    it('audience ALL — every active Student at the School, not a revoked grant', async () => {
      const result = await broadcastService.broadcast(owner.id, school.id, { title: 'All hands', body: 'Body', audience: BroadcastAudienceDto.ALL });
      expect(result.recipientCount).toBe(5);

      const recipients = recipientIdsFromLastCall();
      expect(recipients).toContain(studentPlain.id);
      expect(recipients).toContain(studentBranchX.id);
      expect(recipients).toContain(studentBranchY.id);
      expect(recipients).toContain(studentClassBooker.id);
      expect(recipients).toContain(studentCancelledBooker.id);
      expect(recipients).not.toContain(studentRevoked.id);
    });

    it('audience BRANCH — only the Student whose home Branch is this one AND who is currently active (StudentHomeBranch alone is not enough)', async () => {
      const result = await broadcastService.broadcast(owner.id, school.id, {
        title: 'Branch X only',
        body: 'Body',
        audience: BroadcastAudienceDto.BRANCH,
        branchId: branchX.id,
      });
      expect(result.recipientCount).toBe(1);

      const recipients = recipientIdsFromLastCall();
      expect(recipients).toEqual([studentBranchX.id]);
      // studentRevoked has a StudentHomeBranch row for branchX too, but their
      // STUDENT RoleGrant is revoked — excluded.
      expect(recipients).not.toContain(studentRevoked.id);
      expect(recipients).not.toContain(studentBranchY.id);
      expect(recipients).not.toContain(studentPlain.id);
    });

    it('audience CLASS — booked Students only by default (not cancelled, not the waitlist)', async () => {
      const result = await broadcastService.broadcast(owner.id, school.id, {
        title: 'Class roster',
        body: 'Body',
        audience: BroadcastAudienceDto.CLASS,
        classId: classInBranchX.id,
      });
      expect(result.recipientCount).toBe(1);
      expect(recipientIdsFromLastCall()).toEqual([studentClassBooker.id]);
    });

    it('audience CLASS — the Owner ticks which groups get it (Decision 333)', async () => {
      const send = (classAudience: BroadcastClassAudienceDto[]) => {
        fakeQueue.addBulk.mockClear();
        return broadcastService.broadcast(owner.id, school.id, { title: 'Class roster', body: 'Body', audience: BroadcastAudienceDto.CLASS, classId: classInBranchX.id, classAudience });
      };

      await send([BroadcastClassAudienceDto.WAITLIST]);
      // Only the open waitlist place; the expired one is not on the list.
      expect(recipientIdsFromLastCall()).toEqual([studentBranchY.id]);

      await send([BroadcastClassAudienceDto.CANCELLED]);
      expect(recipientIdsFromLastCall()).toEqual([studentCancelledBooker.id]);

      const all = await send([BroadcastClassAudienceDto.BOOKED, BroadcastClassAudienceDto.WAITLIST, BroadcastClassAudienceDto.CANCELLED]);
      expect(all.recipientCount).toBe(3);
      expect(recipientIdsFromLastCall().sort()).toEqual([studentClassBooker.id, studentBranchY.id, studentCancelledBooker.id].sort());
      expect(recipientIdsFromLastCall()).not.toContain(studentBranchX.id);
    });

    it('a per-recipient notificationId/jobId is derived from this one broadcastId — dedup-safe the same way WaiverSignatureRequestsProcessor already established', async () => {
      const result = await broadcastService.broadcast(owner.id, school.id, { title: 'Dedup check', body: 'Body', audience: BroadcastAudienceDto.ALL });
      const calls = fakeQueue.addBulk.mock.calls;
      const jobs: Array<{ data: { notificationId: string; userId: string }; opts: { jobId: string } }> = calls[calls.length - 1][0];
      for (const job of jobs) {
        expect(job.data.notificationId).toBe(`broadcast-${result.broadcastId}-${job.data.userId}`);
        expect(job.opts.jobId).toBe(job.data.notificationId);
      }
    });
  });
});
