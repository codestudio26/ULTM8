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
import { PushNotificationService } from '../src/notifications/push-notification.service';
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
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
  // GET /notifications/me/counts — true, caller-wide total/unread (v1.2
  // backend backlog, Decision 204's Concept 5 finding: "Total/Unread are
  // real but page-scoped" — this endpoint is the fix for that, so it must be
  // proven over MORE rows than a single page would ever hold, not just a
  // couple of notifications that would pass either way.
  // ---------------------------------------------------------------------------

  describe('GET /notifications/me/counts', () => {
    it('counts are correct for a caller with a mix of read/unread notifications, across more rows than a single list page holds', async () => {
      // A fresh caller (not studentA/studentB, whose rows the earlier `it`
      // above already seeded) — avoids this test's exact counts depending on
      // execution order against shared fixture rows.
      const counter = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `notifications-http-counts-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: 'Counts',
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      userIds.push(counter.id);
      await superuser.roleGrant.create({
        data: { id: randomUUID(), role: 'STUDENT', userId: counter.id, schoolId: school.id },
      });
      const tokenCounter = signAccessToken(counter, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);

      // `resolveLimit`'s DEFAULT_LIMIT is 20 (resolveLimit.ts) — so 30 rows
      // (18 unread, 12 read) genuinely spans more than one default-sized
      // page of GET /notifications/me, proving this endpoint counts ALL of
      // the caller's rows via its own direct `count()`, not derived from
      // whatever page of the list endpoint happens to be loaded.
      const rows = Array.from({ length: 30 }, (_, i) => ({
        id: randomUUID(),
        userId: counter.id,
        title: `Counts fixture ${i}`,
        body: 'body',
        read: i < 12,
      }));
      await superuser.notification.createMany({ data: rows });
      notificationIds.push(...rows.map((r) => r.id));

      const res = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenCounter}`);
      expect(res.status).toBe(200);
      // v1.2 backend backlog (Snooze + Read within 24h, approved by the
      // product owner) added three fields to this response — none of this
      // fixture's 30 rows were ever marked read, so the read-metric fields
      // are all zero/null regardless.
      expect(res.body).toEqual({ total: 30, unread: 18, readWithin24hPercent: null, readWithin24hCount: 0, readTotalCount: 0 });
    });

    it('a caller with no notifications at all gets { total: 0, unread: 0 }', async () => {
      const empty = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `notifications-http-counts-empty-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: 'Empty',
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      userIds.push(empty.id);
      await superuser.roleGrant.create({
        data: { id: randomUUID(), role: 'STUDENT', userId: empty.id, schoolId: school.id },
      });
      const tokenEmpty = signAccessToken(empty, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);

      const res = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenEmpty}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 0, unread: 0, readWithin24hPercent: null, readWithin24hCount: 0, readTotalCount: 0 });
    });

    it("never counts a DIFFERENT caller's notifications, and is rejected unauthenticated", async () => {
      // studentB has its own fixture row from the list/mark-read `it` above
      // (`forB`) — studentA must never see it reflected in its own counts.
      const resA = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(resA.status).toBe(200);
      const resB = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentB}`);
      expect(resB.status).toBe(200);
      // Each caller's own total/unread must account for exactly their own
      // rows — cross-checked against a superuser (RLS-bypassing) count per
      // caller, not a guessed literal, so this stays correct regardless of
      // what the list/mark-read `it` above left behind.
      const [expectedTotalA, expectedUnreadA, expectedTotalB, expectedUnreadB] = await Promise.all([
        superuser.notification.count({ where: { userId: studentA.id } }),
        superuser.notification.count({ where: { userId: studentA.id, read: false } }),
        superuser.notification.count({ where: { userId: studentB.id } }),
        superuser.notification.count({ where: { userId: studentB.id, read: false } }),
      ]);
      // Asserted field-by-field (not a whole-object toEqual) — the v1.2
      // backend backlog's read-metric fields (readWithin24hPercent/Count,
      // readTotalCount) have their own dedicated correctness tests below;
      // this test's own job is isolation of total/unread specifically.
      expect(resA.body.total).toBe(expectedTotalA);
      expect(resA.body.unread).toBe(expectedUnreadA);
      expect(resB.body.total).toBe(expectedTotalB);
      expect(resB.body.unread).toBe(expectedUnreadB);
      // A's own rows include at least `older`/`newer` from the earlier `it`
      // above, so if isolation were broken and A's count silently included
      // B's `forB` row too, resA.total would overshoot expectedTotalA by one
      // — already ruled out by the `toEqual` above, restated here as the
      // concrete scenario this test exists to catch.
      expect(resA.body.total).toBeGreaterThanOrEqual(2);

      const unauthRes = await request(app.getHttpServer()).get('/v1/notifications/me/counts');
      expect(unauthRes.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /notifications/:id/snooze + notification-unsnooze-sweep (v1.2
  // backend backlog — Snooze, approved by the product owner).
  // ---------------------------------------------------------------------------

  it('GET /notifications/me answers a cursor it never wrote with a 400, not a server error', async () => {
    for (const cursor of ['garbage', Buffer.from('{"createdAt":"x","id":"y"}').toString('base64url'), Buffer.from('[]').toString('base64url')]) {
      const res = await request(app.getHttpServer()).get('/v1/notifications/me').query({ cursor }).set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(400);
    }
  });

  describe('PATCH /notifications/:id/snooze', () => {
    it('hides the Notification from the unread count while snoozed; validates input; self-only', async () => {
      const before = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);
      const unreadBefore = before.body.unread as number;

      const n = await superuser.notification.create({
        data: { id: randomUUID(), userId: studentA.id, title: 'Snooze me', body: 'body' },
      });
      notificationIds.push(n.id);

      // Neither `until` nor `minutes` — a real 400, not a silent no-op.
      const missingBoth = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/snooze`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({});
      expect(missingBoth.status).toBe(400);

      // A past timestamp — snoozing "until the past" would be a no-op that
      // silently claims success.
      const pastSnooze = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/snooze`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ until: new Date(Date.now() - 60_000).toISOString() });
      expect(pastSnooze.status).toBe(400);

      // Further than 7 days — `minutes` already stops there, and `until` now
      // does too, rather than hiding a notification for years.
      const tooLong = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/snooze`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ until: '3000-01-01T00:00:00.000Z' });
      expect(tooLong.status).toBe(400);

      // Cross-caller snooze is RLS-blocked — indistinguishable from
      // not-found, same design as every other self-only resource.
      const crossSnooze = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/snooze`)
        .set('Authorization', `Bearer ${tokenStudentB}`)
        .send({ minutes: 60 });
      expect(crossSnooze.status).toBe(404);

      const snoozeRes = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/snooze`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ minutes: 60 });
      expect(snoozeRes.status).toBe(200);
      expect(new Date(snoozeRes.body.snoozedUntil).getTime()).toBeGreaterThan(Date.now());

      // Counts the exact same unread total as before this Notification was
      // created — the newly-created, newly-snoozed row is excluded, not just
      // "no worse than before any fixture existed".
      const after = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(after.body.unread).toBe(unreadBefore);
    });

    it('notification-unsnooze-sweep clears an elapsed snoozedUntil, returning the Notification to the unread list (direct processor invocation, no Redis/polling)', async () => {
      const n = await superuser.notification.create({
        data: {
          id: randomUUID(),
          userId: studentA.id,
          title: 'Already elapsed',
          body: 'body',
          snoozedUntil: new Date(Date.now() - 60_000), // already in the past
        },
      });
      notificationIds.push(n.id);

      const before = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);
      // Live-computed (NotificationsService.getCountsForCaller) — already
      // counts as unread even before the sweep runs, since snoozedUntil is
      // in the past.
      const n0 = await superuser.notification.findUnique({ where: { id: n.id } });
      expect(n0!.snoozedUntil).not.toBeNull();

      const { NotificationUnsnoozeSweepProcessor } = await import('../src/jobs/notification-unsnooze-sweep.processor');
      const moduleRef = await Test.createTestingModule({
        providers: [NotificationUnsnoozeSweepProcessor, PrismaJobsService],
      }).compile();
      const processor = moduleRef.get(NotificationUnsnoozeSweepProcessor);
      await processor.process({ id: 'test-unsnooze-sweep' } as never);

      const n1 = await superuser.notification.findUnique({ where: { id: n.id } });
      expect(n1!.snoozedUntil).toBeNull();

      const after = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(after.body.unread).toBeGreaterThanOrEqual(before.body.unread);
    });
  });

  // ---------------------------------------------------------------------------
  // readAt — set once, never overwritten (v1.2 backend backlog — Read within
  // 24h metric, approved by the product owner).
  // ---------------------------------------------------------------------------

  describe('readAt + readWithin24hPercent', () => {
    it('PATCH :id/read sets readAt only the FIRST time, never overwriting it on a later call', async () => {
      const n = await superuser.notification.create({
        data: { id: randomUUID(), userId: studentA.id, title: 'Read-at fixture', body: 'body' },
      });
      notificationIds.push(n.id);

      const firstRead = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/read`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(firstRead.status).toBe(200);
      expect(firstRead.body.readAt).not.toBeNull();
      const firstReadAt = firstRead.body.readAt;

      // A later mark-read call (idempotent on `read`) must NOT move readAt —
      // this is "time to FIRST read", not "time of last read".
      await new Promise((resolve) => setTimeout(resolve, 10));
      const secondRead = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/read`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(secondRead.status).toBe(200);
      expect(secondRead.body.readAt).toBe(firstReadAt);
    });

    it('readWithin24hPercent is computed only over READ Notifications, excluding ones never read', async () => {
      const counter = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `notifications-http-readmetric-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: 'ReadMetric',
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      userIds.push(counter.id);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: counter.id, schoolId: school.id } });
      const tokenCounter = signAccessToken(counter, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);

      // One read within 24h, one read AFTER 24h (readAt backdated via direct
      // DB write — PATCH :id/read always reads "now"), one never read at all
      // (must be excluded from both numerator and denominator).
      const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const withinWindow = await superuser.notification.create({
        data: { id: randomUUID(), userId: counter.id, title: 'Within', body: 'b', createdAt, read: true, readAt: new Date(createdAt.getTime() + 60_000) },
      });
      const outsideWindow = await superuser.notification.create({
        data: { id: randomUUID(), userId: counter.id, title: 'Outside', body: 'b', createdAt, read: true, readAt: new Date(createdAt.getTime() + 25 * 60 * 60 * 1000) },
      });
      const neverRead = await superuser.notification.create({
        data: { id: randomUUID(), userId: counter.id, title: 'Never read', body: 'b', createdAt },
      });
      notificationIds.push(withinWindow.id, outsideWindow.id, neverRead.id);

      const res = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenCounter}`);
      expect(res.status).toBe(200);
      expect(res.body.readTotalCount).toBe(2); // neverRead excluded
      expect(res.body.readWithin24hCount).toBe(1);
      expect(res.body.readWithin24hPercent).toBe(50);
    });
  });

  // ---------------------------------------------------------------------------
  // Soft delete + "Clear all read" (Decision 277).
  // ---------------------------------------------------------------------------

  describe('DELETE /notifications/:id and POST /notifications/me/clear-read', () => {
    async function listIds(token: string): Promise<string[]> {
      const res = await request(app.getHttpServer()).get('/v1/notifications/me?limit=100').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return (res.body.items as Array<{ id: string }>).map((n) => n.id);
    }

    it('hides one Notification from the list and Total/Unread counts but keeps the row; self-only; a second delete is a 404', async () => {
      const n = await superuser.notification.create({
        data: { id: randomUUID(), userId: studentA.id, title: 'Delete me', body: 'body' },
      });
      notificationIds.push(n.id);
      const before = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);

      // Cross-caller delete is RLS-blocked, indistinguishable from not-found.
      const cross = await request(app.getHttpServer()).delete(`/v1/notifications/${n.id}`).set('Authorization', `Bearer ${tokenStudentB}`);
      expect(cross.status).toBe(404);
      expect((await superuser.notification.findUniqueOrThrow({ where: { id: n.id } })).deletedAt).toBeNull();

      const del = await request(app.getHttpServer()).delete(`/v1/notifications/${n.id}`).set('Authorization', `Bearer ${tokenStudentA}`);
      expect(del.status).toBe(204);

      // Soft delete: the record is still there, only hidden.
      const row = await superuser.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(await listIds(tokenStudentA)).not.toContain(n.id);

      const after = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(after.body.total).toBe(before.body.total - 1);
      expect(after.body.unread).toBe(before.body.unread - 1);

      // Already deleted: gone from the caller's point of view.
      const again = await request(app.getHttpServer()).delete(`/v1/notifications/${n.id}`).set('Authorization', `Bearer ${tokenStudentA}`);
      expect(again.status).toBe(404);
      const markRead = await request(app.getHttpServer()).patch(`/v1/notifications/${n.id}/read`).set('Authorization', `Bearer ${tokenStudentA}`);
      expect(markRead.status).toBe(404);
      const snooze = await request(app.getHttpServer())
        .patch(`/v1/notifications/${n.id}/snooze`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ minutes: 60 });
      expect(snooze.status).toBe(404);

      const unauth = await request(app.getHttpServer()).delete(`/v1/notifications/${n.id}`);
      expect(unauth.status).toBe(401);
    });

    it("clears only the caller's READ Notifications, leaves unread ones and other callers' alone, and keeps the read metric", async () => {
      const readOne = await superuser.notification.create({
        data: { id: randomUUID(), userId: studentA.id, title: 'Read one', body: 'b', read: true, readAt: new Date() },
      });
      const unreadOne = await superuser.notification.create({
        data: { id: randomUUID(), userId: studentA.id, title: 'Unread one', body: 'b' },
      });
      const otherCallersRead = await superuser.notification.create({
        data: { id: randomUUID(), userId: studentB.id, title: "B's read one", body: 'b', read: true, readAt: new Date() },
      });
      notificationIds.push(readOne.id, unreadOne.id, otherCallersRead.id);

      const metricBefore = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);

      const res = await request(app.getHttpServer()).post('/v1/notifications/me/clear-read').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(200);
      expect(res.body.cleared).toBeGreaterThanOrEqual(1);

      const idsA = await listIds(tokenStudentA);
      expect(idsA).not.toContain(readOne.id);
      expect(idsA).toContain(unreadOne.id);
      expect(await listIds(tokenStudentB)).toContain(otherCallersRead.id);

      // Every read row A had is now hidden; Total is just the unread ones left.
      expect(await superuser.notification.count({ where: { userId: studentA.id, read: true, deletedAt: null } })).toBe(0);
      const after = await request(app.getHttpServer()).get('/v1/notifications/me/counts').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(after.body.total).toBe(await superuser.notification.count({ where: { userId: studentA.id, deletedAt: null } }));
      // Hidden rows were still read, so the Read-within-24h metric keeps them.
      expect(after.body.readTotalCount).toBe(metricBefore.body.readTotalCount);

      // Nothing read left: a plain zero, not an error.
      const second = await request(app.getHttpServer()).post('/v1/notifications/me/clear-read').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(second.status).toBe(200);
      expect(second.body.cleared).toBe(0);
    });
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
    const fakeDelivery = { sendEmail: jest.fn().mockResolvedValue(undefined), isConfigured: jest.fn().mockReturnValue(true) };
    // Same reasoning as fakeDelivery above, for push (Decision 223/264) — this
    // suite's scope is the Notification-row write/idempotency and the
    // email/push wiring itself, not live FCM delivery (no real credentials in
    // this test environment either). Defaults to "no device tokens, nothing
    // to send" via an empty staleTokens/sent response; individual tests below
    // override this mock to exercise the stale-token cleanup and the
    // push-failure-doesn't-block-email paths.
    const fakePush = { send: jest.fn().mockResolvedValue({ sent: 0, staleTokens: [] }) };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          WaiverSignatureRequestsProcessor,
          NotificationFanoutProcessor,
          PrismaJobsService,
          { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: fakeNotificationFanoutQueue },
          { provide: NotificationDeliveryService, useValue: fakeDelivery },
          { provide: PushNotificationService, useValue: fakePush },
        ],
      }).compile();
      waiverProcessor = moduleRef.get(WaiverSignatureRequestsProcessor);
      fanoutProcessor = moduleRef.get(NotificationFanoutProcessor);
    });

    beforeEach(() => {
      fakePush.send.mockReset().mockResolvedValue({ sent: 0, staleTokens: [] });
      fakeDelivery.sendEmail.mockReset().mockResolvedValue(undefined);
      fakeDelivery.isConfigured.mockReset().mockReturnValue(true);
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
      // Names the School as the sender and the waiver by its title (it used
      // to put the waiver's title where the sender belongs).
      expect(studentAJob.data.body).toBe('Notifications HTTP School has invited you to sign the waiver "Direct-Invocation Waiver".');
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

    it("push (Decision 223/264): dispatches to every DeviceToken row for the target User, deletes any FCM reports as stale, and never blocks email/the Notification row when push fails or is unconfigured", async () => {
      const notificationId = `push-test-${randomUUID()}`;
      const jobData: NotificationFanoutJobData = { notificationId, userId: studentA.id, title: 'Push test', body: 'push body' };

      // No DeviceToken rows registered yet — push.send must not even be called
      // (nothing to send to), and the rest of the pipeline is unaffected.
      await fanoutProcessor.process({ id: 'push-test-1', data: jobData } as never);
      expect(fakePush.send).not.toHaveBeenCalled();
      const createdNoTokens = await superuser.notification.findUnique({ where: { id: notificationId } });
      expect(createdNoTokens).not.toBeNull();
      notificationIds.push(notificationId);

      // Register two DeviceToken rows for the same target, one of which FCM
      // will report back as stale.
      const goodToken = await superuser.deviceToken.create({
        data: { id: randomUUID(), userId: studentA.id, platform: 'IOS', token: `good-${randomUUID()}` },
      });
      const staleToken = await superuser.deviceToken.create({
        data: { id: randomUUID(), userId: studentA.id, platform: 'ANDROID', token: `stale-${randomUUID()}` },
      });
      fakePush.send.mockResolvedValueOnce({ sent: 1, staleTokens: [staleToken.token] });

      const notificationId2 = `push-test-2-${randomUUID()}`;
      await fanoutProcessor.process(
        { id: 'push-test-2', data: { notificationId: notificationId2, userId: studentA.id, title: 'Push test 2', body: 'push body 2' } } as never,
      );
      notificationIds.push(notificationId2);

      expect(fakePush.send).toHaveBeenCalledWith(
        expect.arrayContaining([goodToken.token, staleToken.token]),
        'Push test 2',
        'push body 2',
      );
      // The stale token is deleted — FCM's own documented signal that the app
      // was uninstalled or the token rotated (see PushNotificationService's
      // own header comment); the still-good token is left alone.
      expect(await superuser.deviceToken.findUnique({ where: { id: staleToken.id } })).toBeNull();
      expect(await superuser.deviceToken.findUnique({ where: { id: goodToken.id } })).not.toBeNull();

      // Push genuinely unavailable (e.g. unconfigured FCM credentials, the
      // real posture in every environment today per Decision 223/250) must
      // not fail the job or block email — see NotificationFanoutProcessor's
      // own header comment for why this asymmetry with email is deliberate.
      fakePush.send.mockRejectedValueOnce(new Error('PushNotificationService is not configured'));
      const notificationId3 = `push-test-3-${randomUUID()}`;
      await expect(
        fanoutProcessor.process(
          { id: 'push-test-3', data: { notificationId: notificationId3, userId: studentA.id, title: 'Push test 3', body: 'push body 3' } } as never,
        ),
      ).resolves.toBeUndefined();
      notificationIds.push(notificationId3);
      const createdDespitePushFailure = await superuser.notification.findUnique({ where: { id: notificationId3 } });
      expect(createdDespitePushFailure).not.toBeNull();
      expect(fakeDelivery.sendEmail).toHaveBeenCalledWith(studentA.email, 'Push test 3', 'push body 3');

      await superuser.deviceToken.delete({ where: { id: goodToken.id } });
    });

    it('push does not wait on email: no email service skips email quietly, a failing email still retries, and a retry never re-sends push', async () => {
      const token = await superuser.deviceToken.create({
        data: { id: randomUUID(), userId: studentA.id, platform: 'IOS', token: `order-${randomUUID()}` },
      });

      // No email service configured (staging this round): push goes out, the
      // job succeeds, and email is not attempted at all.
      fakeDelivery.isConfigured.mockReturnValue(false);
      const idNoEmail = `order-no-email-${randomUUID()}`;
      await expect(
        fanoutProcessor.process({ id: 'order-1', data: { notificationId: idNoEmail, userId: studentA.id, title: 'T', body: 'B' } } as never),
      ).resolves.toBeUndefined();
      notificationIds.push(idNoEmail);
      expect(fakePush.send).toHaveBeenCalledTimes(1);
      expect(fakeDelivery.sendEmail).not.toHaveBeenCalled();

      // Email configured but failing: push has already gone out, and the job
      // still fails so BullMQ retries the email.
      fakeDelivery.isConfigured.mockReturnValue(true);
      fakeDelivery.sendEmail.mockRejectedValueOnce(new Error('Postmark down'));
      const idEmailDown = `order-email-down-${randomUUID()}`;
      const jobData = { notificationId: idEmailDown, userId: studentA.id, title: 'T2', body: 'B2' };
      await expect(fanoutProcessor.process({ id: 'order-2', data: jobData, attemptsMade: 0 } as never)).rejects.toThrow('Postmark down');
      notificationIds.push(idEmailDown);
      expect(fakePush.send).toHaveBeenCalledTimes(2);

      // The retry sends the email but not a second push.
      await expect(fanoutProcessor.process({ id: 'order-2', data: jobData, attemptsMade: 1 } as never)).resolves.toBeUndefined();
      expect(fakePush.send).toHaveBeenCalledTimes(2);
      expect(fakeDelivery.sendEmail).toHaveBeenLastCalledWith(studentA.email, 'T2', 'B2');

      await superuser.deviceToken.delete({ where: { id: token.id } });
    });

    it("parents (Decision 333): a child's notification is copied to each linked guardian, a minor's placeholder address gets no push or email, and a copy is never copied on", async () => {
      const guardian = await superuser.user.create({
        data: { id: randomUUID(), email: `notifications-guardian-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`, firstName: 'Parent', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('1980-01-01'), phoneVerifiedAt: new Date() },
      });
      const revokedGuardian = await superuser.user.create({
        data: { id: randomUUID(), email: `notifications-guardian-old-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`, firstName: 'OldParent', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('1980-01-01'), phoneVerifiedAt: new Date() },
      });
      const minorId = randomUUID();
      const minor = await superuser.user.create({
        data: { id: minorId, email: `minor+${minorId}@guardian-managed.ultm8.internal`, phone: `+000${Math.floor(100_000_000_000 + Math.random() * 899_999_999_999)}`, firstName: 'Mia', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('2018-01-01') },
      });
      userIds.push(guardian.id, revokedGuardian.id, minor.id);
      await superuser.guardianLink.createMany({
        data: [
          { id: randomUUID(), guardianId: guardian.id, studentId: minor.id },
          { id: randomUUID(), guardianId: revokedGuardian.id, studentId: minor.id, revokedAt: new Date() },
        ],
      });
      fakeNotificationFanoutQueue.addBulk.mockClear();

      const id = `guardian-test-${randomUUID()}`;
      await fanoutProcessor.process({ id: 'guardian-1', data: { notificationId: id, userId: minor.id, title: 'Class cancelled', body: 'Kids Judo was cancelled.' } } as never);
      notificationIds.push(id);

      // The child's own in-app row is still written…
      expect(await superuser.notification.findUnique({ where: { id } })).not.toBeNull();
      // …but nothing goes to the placeholder address.
      expect(fakeDelivery.sendEmail).not.toHaveBeenCalled();
      expect(fakePush.send).not.toHaveBeenCalled();

      // One copy, for the live link only.
      expect(fakeNotificationFanoutQueue.addBulk).toHaveBeenCalledTimes(1);
      const copies: Array<{ data: NotificationFanoutJobData; opts: { jobId: string } }> = fakeNotificationFanoutQueue.addBulk.mock.calls[0][0];
      expect(copies).toHaveLength(1);
      expect(copies[0].data).toEqual({
        notificationId: `${id}-guardian-${guardian.id}`,
        userId: guardian.id,
        title: 'Class cancelled',
        body: 'For Mia: Kids Judo was cancelled.',
        type: undefined,
        guardianCopyOf: minor.id,
      });
      expect(copies[0].opts.jobId).toBe(copies[0].data.notificationId);

      // Processing the copy delivers to the parent and copies nothing further.
      fakeNotificationFanoutQueue.addBulk.mockClear();
      await fanoutProcessor.process({ id: 'guardian-2', data: copies[0].data } as never);
      notificationIds.push(copies[0].data.notificationId);
      expect(fakeNotificationFanoutQueue.addBulk).not.toHaveBeenCalled();
      expect(fakeDelivery.sendEmail).toHaveBeenCalledWith(guardian.email, 'Class cancelled', 'For Mia: Kids Judo was cancelled.');

      // A Student with no guardians is untouched.
      const plainId = `guardian-test-plain-${randomUUID()}`;
      await fanoutProcessor.process({ id: 'guardian-3', data: { notificationId: plainId, userId: studentA.id, title: 'T', body: 'B' } } as never);
      notificationIds.push(plainId);
      expect(fakeNotificationFanoutQueue.addBulk).not.toHaveBeenCalled();

      await superuser.guardianLink.deleteMany({ where: { studentId: minor.id } });
    });
  });
});
