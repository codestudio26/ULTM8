/**
 * HTTP-level gate for Phase 15 (NotificationsModule) — the read-side API
 * (list-mine, mark-read), DeviceToken registration/deregistration, and
 * self-only isolation for both — plus direct-processor-invocation coverage
 * (not HTTP) for the async fan-out pipeline: WaiverSignatureRequestsProcessor
 * -> notification-fanout -> a real Notification row.
 *
 * FOUND ON REVIEW: an earlier draft drove the fan-out proof entirely through
 * real HTTP + a real BullMQ/Redis worker + a bounded poll loop, and called
 * itself "the first async-job-driven e2e test in this codebase" — that claim
 * was wrong. `class-occurrence-generation.e2e-spec.ts` already established
 * (and this file now follows) the actual precedent: instantiate the
 * processor directly via a minimal `Test.createTestingModule`, call
 * `.process()` against a fake `Job`, and assert against real Postgres — no
 * Redis, no timing dependency, no polling. `WaiverSignatureRequestsProcessor`
 * itself enqueues onto a SECOND queue (`notification-fanout`), which this
 * suite mocks (a plain `jest.fn`-backed fake `Queue`) rather than requiring a
 * live worker for that hop too — the same deterministic principle applied
 * one level deeper.
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
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { WaiverSignatureRequestsProcessor } from '../src/jobs/waiver-signature-requests.processor';
import { NotificationFanoutProcessor } from '../src/jobs/notification-fanout.processor';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import { NotificationFanoutJobData } from '../src/jobs/notification-fanout.types';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[notifications.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('NotificationsModule — HTTP read-side, device tokens, and direct-invocation fan-out', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let owner: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let studentRevoked: { id: string; email: string };
  let studentOtherSchool: { id: string; email: string };
  let tokenOwner: string;
  let tokenStudentA: string;
  let tokenStudentB: string;

  const userIds: string[] = [];
  const notificationIds: string[] = [];
  const deviceTokenIds: string[] = [];
  const waiverIds: string[] = [];
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

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Notifications HTTP School' } });
    schoolIds.push(school.id);
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Notifications HTTP Other School' } });
    schoolIds.push(otherSchool.id);

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `notifications-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    owner = await mkUser('owner');
    userIds.push(owner.id);
    studentA = await mkUser('student-a');
    userIds.push(studentA.id);
    studentB = await mkUser('student-b');
    userIds.push(studentB.id);
    studentRevoked = await mkUser('student-revoked');
    userIds.push(studentRevoked.id);
    studentOtherSchool = await mkUser('student-other-school');
    userIds.push(studentOtherSchool.id);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentRevoked.id, schoolId: school.id, revokedAt: new Date() },
        { id: randomUUID(), role: 'STUDENT', userId: studentOtherSchool.id, schoolId: otherSchool.id },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.deviceToken.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waiver.deleteMany({ where: { id: { in: waiverIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Read-side: list (time-ordered), mark-read, self-only isolation
  // ---------------------------------------------------------------------------

  it("GET /notifications/me lists the caller's own notifications only, newest first; PATCH :id/read is self-only and idempotent", async () => {
    const older = await superuser.notification.create({
      data: { id: randomUUID(), userId: studentA.id, title: 'Older', body: 'body', createdAt: new Date(Date.now() - 60_000) },
    });
    notificationIds.push(older.id);
    const newer = await superuser.notification.create({
      data: { id: randomUUID(), userId: studentA.id, title: 'Newer', body: 'body', createdAt: new Date() },
    });
    notificationIds.push(newer.id);
    const forB = await superuser.notification.create({
      data: { id: randomUUID(), userId: studentB.id, title: 'For B', body: 'body B' },
    });
    notificationIds.push(forB.id);

    const listA = await request(app.getHttpServer()).get('/v1/notifications/me').set('Authorization', `Bearer ${tokenStudentA}`);
    expect(listA.status).toBe(200);
    const ids = listA.body.items.map((n: { id: string }) => n.id);
    expect(ids).toContain(older.id);
    expect(ids).not.toContain(forB.id);
    // Newest-first — the actual bug an earlier draft's reuse of the shared,
    // id-ordered cursorPaginate helper produced (a random-UUID id carries no
    // chronological meaning).
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

    // Cross-caller mark-read is RLS-blocked — indistinguishable from not-found,
    // same design as every other self-only resource in this codebase.
    const crossRead = await request(app.getHttpServer())
      .patch(`/v1/notifications/${forB.id}/read`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(crossRead.status).toBe(404);

    const readRes = await request(app.getHttpServer())
      .patch(`/v1/notifications/${older.id}/read`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.read).toBe(true);

    // Idempotent — marking an already-read notification read again succeeds,
    // not a conflict.
    const readAgain = await request(app.getHttpServer())
      .patch(`/v1/notifications/${older.id}/read`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(readAgain.status).toBe(200);
    expect(readAgain.body.read).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // DeviceToken registration
  // ---------------------------------------------------------------------------

  it('POST /notifications/device-tokens registers (re-registration by the SAME caller upserts); a DIFFERENT caller registering the same token is a 409, not a silent reassignment', async () => {
    const token = `test-device-token-${randomUUID()}`;
    const registerRes = await request(app.getHttpServer())
      .post('/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ platform: 'IOS', token });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.userId).toBe(studentA.id);
    deviceTokenIds.push(registerRes.body.id);

    // Re-registering the same token, same caller (app relaunch) upserts, not a
    // duplicate-key error.
    const reRegisterRes = await request(app.getHttpServer())
      .post('/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ platform: 'IOS', token });
    expect(reRegisterRes.status).toBe(201);
    expect(reRegisterRes.body.id).toBe(registerRes.body.id);

    // A DIFFERENT caller registering the same token — a real conflict, not
    // silently reassigned (see NotificationsService.registerDeviceToken's own
    // header comment for why an earlier draft's claimed reassignment behavior
    // was never actually reachable).
    const conflictRes = await request(app.getHttpServer())
      .post('/v1/notifications/device-tokens')
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({ platform: 'ANDROID', token });
    expect(conflictRes.status).toBe(409);

    const crossDelete = await request(app.getHttpServer())
      .delete(`/v1/notifications/device-tokens/${registerRes.body.id}`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(crossDelete.status).toBe(404);

    const deleteRes = await request(app.getHttpServer())
      .delete(`/v1/notifications/device-tokens/${registerRes.body.id}`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(deleteRes.status).toBe(204);
  });

  // ---------------------------------------------------------------------------
  // Async fan-out — direct processor invocation (no Redis, no HTTP, no
  // polling), same established pattern class-occurrence-generation.e2e-spec.ts
  // already uses for a BullMQ processor.
  // ---------------------------------------------------------------------------

  describe('WaiverSignatureRequestsProcessor -> notification-fanout (direct invocation)', () => {
    let waiverProcessor: WaiverSignatureRequestsProcessor;
    let fanoutProcessor: NotificationFanoutProcessor;
    const fakeNotificationFanoutQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };
    // Deliberately faked, not the real NotificationDeliveryService — this
    // suite's own scope is the Notification-row write and idempotency, not
    // live email delivery (which needs real, network-reachable Postmark/SES
    // credentials this test environment doesn't have and shouldn't depend on
    // being absent either — a real class here would make process() reject
    // with a config error today and silently change behavior the moment
    // someone sets those env vars locally).
    const fakeDelivery = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          WaiverSignatureRequestsProcessor,
          NotificationFanoutProcessor,
          PrismaJobsService,
          { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: fakeNotificationFanoutQueue },
          { provide: NotificationDeliveryService, useValue: fakeDelivery },
        ],
      }).compile();
      waiverProcessor = moduleRef.get(WaiverSignatureRequestsProcessor);
      fanoutProcessor = moduleRef.get(NotificationFanoutProcessor);
    });

    it("fans out to every active Student at the Waiver's own School only — not a revoked grant, not a different School", async () => {
      const waiver = await superuser.waiver.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Direct-Invocation Waiver', body: 'terms...' },
      });
      waiverIds.push(waiver.id);

      await waiverProcessor.process({ id: 'test-waiver-fanout', data: { waiverId: waiver.id, schoolId: school.id } } as never);

      expect(fakeNotificationFanoutQueue.addBulk).toHaveBeenCalledTimes(1);
      const enqueued: Array<{ data: NotificationFanoutJobData }> = fakeNotificationFanoutQueue.addBulk.mock.calls[0][0];
      const enqueuedUserIds = enqueued.map((job) => job.data.userId);

      expect(enqueuedUserIds).toContain(studentA.id);
      expect(enqueuedUserIds).toContain(studentB.id);
      expect(enqueuedUserIds).not.toContain(studentRevoked.id);
      expect(enqueuedUserIds).not.toContain(studentOtherSchool.id);
      expect(enqueuedUserIds).not.toContain(owner.id);

      const studentAJob = enqueued.find((job) => job.data.userId === studentA.id)!;
      expect(studentAJob.data.body).toBe('Direct-Invocation Waiver has invited you to sign the following waiver.');
      expect(studentAJob.data.type).toBe('WAIVER_SIGNATURE_REQUEST');
      expect(studentAJob.data.notificationId).toBe(`waiver-${waiver.id}-${studentA.id}`);

      // The second half of the pipeline — NotificationFanoutProcessor actually
      // writing the row — is a separate processor with its own queue; proven
      // directly here rather than assuming the mocked addBulk call means the
      // whole pipeline works.
      await fanoutProcessor.process({ id: 'test-fanout-1', data: studentAJob.data } as never);
      const created = await superuser.notification.findUnique({ where: { id: studentAJob.data.notificationId } });
      expect(created).not.toBeNull();
      expect(created!.userId).toBe(studentA.id);
      expect(created!.title).toBe('Waiver signature requested');
      expect(fakeDelivery.sendEmail).toHaveBeenCalledWith(studentA.email, 'Waiver signature requested', studentAJob.data.body);
      notificationIds.push(created!.id);

      // Idempotency — re-processing the identical job (simulating a BullMQ
      // retry after email delivery failed) must not create a second row.
      await fanoutProcessor.process({ id: 'test-fanout-1-retry', data: studentAJob.data } as never);
      const countAfterRetry = await superuser.notification.count({ where: { id: studentAJob.data.notificationId } });
      expect(countAfterRetry).toBe(1);
    });
  });
});
