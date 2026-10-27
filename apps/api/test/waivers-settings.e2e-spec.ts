/**
 * Decision 354 — the Waivers follow-ups: archive always allowed (W2), "everyone
 * signs again" after an edit (W3b), and the School's Waiver settings (Q4 to Q8):
 * archived signatures counting, renewals, signing again at 18, paper
 * signatures, the join notice and reminders.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';
import { NOTIFICATION_FANOUT_QUEUE, WAIVER_SIGNATURE_REQUESTS_QUEUE } from '../src/jobs/queue.constants';
import { WaiverSignatureRequestsProcessor, type WaiverSignatureRequestJobData } from '../src/jobs/waiver-signature-requests.processor';
import { WaiverRenewalSweepProcessor } from '../src/jobs/waiver-renewal-sweep.processor';
import { hasCountingWaiverSignature } from '../src/waivers/waiver-signed-check';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[waivers-settings.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 3_600_000;
const yearsAgo = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d;
};

describeIfDb('Waiver settings and follow-ups (Decision 354)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const school = { id: randomUUID() };
  const otherSchool = { id: randomUUID() };
  type U = { id: string; email: string; token: string };
  let owner: U;
  let otherOwner: U;
  let objectExists = true;
  let notices: WaiverSignatureRequestJobData[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  async function mkUser(label: string, schoolId: string | null, role?: string, dateOfBirth: Date | null = new Date('1990-01-01')): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `waivers-settings-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Settings',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    if (role && schoolId) await superuser.roleGrant.create({ data: { id: randomUUID(), role: role as never, userId: user.id, schoolId } });
    const grants = role && schoolId ? [{ role, franchiseId: null, schoolId, branchId: null }] : [];
    return { id: user.id, email: user.email, token: jwt.sign({ sub: user.id, email: user.email, grants }) };
  }
  const mkWaiver = async (title = 'Liability', body = 'Version one') =>
    (await http().post(`/v1/schools/${school.id}/waivers`).set(auth(owner)).send({ title, body })).body as { id: string; version: number };
  const sign = (waiverId: string, who: U) =>
    http().post(`/v1/waivers/${waiverId}/sign`).set(auth(who)).send({ signerFullName: 'Signer', signatureText: 'Signer' });
  const rowsFor = (waiverId: string, studentId: string) =>
    superuser.waiverSignature.findMany({ where: { waiverId, studentId }, orderBy: { createdAt: 'asc' } });
  const setSettings = (data: Record<string, unknown>) => superuser.school.update({ where: { id: school.id }, data });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ClientService)
      .useValue({
        isConfigured: () => true,
        getPresignedUploadUrl: async (key: string) => `https://r2.example.test/${key}?upload`,
        getPresignedDownloadUrl: async (key: string) => `https://r2.example.test/${key}`,
        objectExists: async () => objectExists,
        deleteObject: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    // Listening once: an unbound server makes supertest open a new listener per
    // request, and parallel requests then reset each other's connections.
    await app.listen(0);

    await superuser.school.create({ data: { id: school.id, name: 'Settings Dojo', timezone: 'UTC' } });
    await superuser.school.create({ data: { id: otherSchool.id, name: 'Other Dojo', timezone: 'UTC' } });
    owner = await mkUser('owner', school.id, 'SCHOOL_OWNER_MANAGER');
    otherOwner = await mkUser('other-owner', otherSchool.id, 'SCHOOL_OWNER_MANAGER');
  });

  beforeEach(() => {
    notices = [];
    jest.spyOn(app.get(getQueueToken(WAIVER_SIGNATURE_REQUESTS_QUEUE)), 'add').mockImplementation(async (_name: unknown, data: unknown) => {
      notices.push(data as WaiverSignatureRequestJobData);
      return {} as never;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'waivers-settings-' } }, select: { id: true } })).map((u) => u.id);
    const schoolIds = [school.id, otherSchool.id];
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiver.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('settings: the defaults, an owner can change them, a student and another School cannot, and bad values are refused', async () => {
    const student = await mkUser('settings-student', school.id, 'STUDENT');
    const read = await http().get(`/v1/schools/${school.id}/waiver-settings`).set(auth(owner));
    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      waiverArchivedSignaturesCount: true,
      waiverRenewalMonths: null,
      waiverMinorsSignAgainAt18: true,
      waiverPaperSignaturesAllowed: true,
      waiverNoticeOnJoin: true,
      waiverReminderDays: null,
    });

    const changed = await http().patch(`/v1/schools/${school.id}/waiver-settings`).set(auth(owner)).send({ waiverRenewalMonths: 12, waiverReminderDays: 7 });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ waiverRenewalMonths: 12, waiverReminderDays: 7, waiverNoticeOnJoin: true });
    const cleared = await http().patch(`/v1/schools/${school.id}/waiver-settings`).set(auth(owner)).send({ waiverRenewalMonths: null, waiverReminderDays: null });
    expect(cleared.body).toMatchObject({ waiverRenewalMonths: null, waiverReminderDays: null });

    expect((await http().patch(`/v1/schools/${school.id}/waiver-settings`).set(auth(owner)).send({ waiverRenewalMonths: 0 })).status).toBe(400);
    expect((await http().patch(`/v1/schools/${school.id}/waiver-settings`).set(auth(owner)).send({ waiverReminderDays: 91 })).status).toBe(400);
    expect((await http().get(`/v1/schools/${school.id}/waiver-settings`).set(auth(student))).status).toBe(403);
    expect([403, 404]).toContain((await http().patch(`/v1/schools/${school.id}/waiver-settings`).set(auth(otherOwner)).send({ waiverNoticeOnJoin: false })).status);
    await superuser.roleGrant.updateMany({ where: { userId: student.id }, data: { revokedAt: new Date() } });
  });

  it('W3b: "everyone signs again" expires the signatures (kept with their copy), adds new entries and tells those students; a small fix keeps them', async () => {
    const a = await mkUser('resign-a', school.id, 'STUDENT');
    const b = await mkUser('resign-b', school.id, 'STUDENT');
    const waiver = await mkWaiver('Resign', 'Old terms');
    expect((await sign(waiver.id, a)).status).toBe(201);
    notices = [];

    const smallFix = await http().patch(`/v1/waivers/${waiver.id}`).set(auth(owner)).send({ body: 'Old terms, typo fixed' });
    expect(smallFix.status).toBe(200);
    expect((await rowsFor(waiver.id, a.id)).map((r) => r.status)).toEqual(['SIGNED']);
    expect(notices).toEqual([]);

    const newTerms = await http().patch(`/v1/waivers/${waiver.id}`).set(auth(owner)).send({ body: 'New terms', resign: true });
    expect(newTerms.status).toBe(200);
    expect(newTerms.body.version).toBe(3);
    const rowsA = await rowsFor(waiver.id, a.id);
    expect(rowsA.map((r) => r.status)).toEqual(['EXPIRED', 'UNSIGNED']);
    expect(rowsA[0].signedWaiverBody).toBe('Old terms');
    expect((await rowsFor(waiver.id, b.id)).map((r) => r.status)).toEqual(['UNSIGNED']);
    expect(notices).toEqual([{ waiverId: waiver.id, schoolId: school.id, studentIds: [a.id], reason: 'updated', batchId: 'v3' }]);

    // resign with no change of wording does nothing.
    notices = [];
    await http().patch(`/v1/waivers/${waiver.id}`).set(auth(owner)).send({ body: 'New terms', resign: true });
    expect((await rowsFor(waiver.id, a.id)).length).toBe(2);
    expect(notices).toEqual([]);

    // The roster counts each student once: the expired row is history.
    const list = await http().get(`/v1/schools/${school.id}/waivers/${waiver.id}/signatures?limit=100`).set(auth(owner));
    const mine = list.body.items.filter((i: { studentId: string }) => [a.id, b.id].includes(i.studentId));
    expect(mine.length).toBe(3);
    expect(list.body.summary.expired).toBe(1);
    expect(list.body.summary.total).toBe(list.body.summary.signed + list.body.summary.unsigned + list.body.summary.pending);

    expect((await sign(waiver.id, a)).status).toBe(201);
    await superuser.roleGrant.updateMany({ where: { userId: { in: [a.id, b.id] } }, data: { revokedAt: new Date() } });
  });

  it('W2: a waiver with signatures can be archived; Q4: its signature still counts unless the School turns that off', async () => {
    const s = await mkUser('archived-counts', school.id, 'STUDENT');
    const waiver = await mkWaiver('Archive me');
    expect((await sign(waiver.id, s)).status).toBe(201);
    const archived = await http().post(`/v1/waivers/${waiver.id}/archive`).set(auth(owner));
    expect(archived.status).toBe(201);
    expect((await rowsFor(waiver.id, s.id)).map((r) => r.status)).toEqual(['SIGNED']);

    expect(await hasCountingWaiverSignature(superuser, s.id, school.id)).toBe(true);
    await setSettings({ waiverArchivedSignaturesCount: false });
    expect(await hasCountingWaiverSignature(superuser, s.id, school.id)).toBe(false);
    await setSettings({ waiverArchivedSignaturesCount: true });
    await superuser.roleGrant.updateMany({ where: { userId: s.id }, data: { revokedAt: new Date() } });
  });

  it('Q6: the Owner records a paper signature with a photo; refused when turned off, for a future date, a wrong photo or an already signed entry', async () => {
    const s = await mkUser('paper', school.id, 'STUDENT');
    const waiver = await mkWaiver('Paper', 'Paper terms');
    const [row] = await rowsFor(waiver.id, s.id);
    const base = `/v1/schools/${school.id}/waivers/${waiver.id}/signatures/${row.id}`;

    await setSettings({ waiverPaperSignaturesAllowed: false });
    expect((await http().post(`${base}/paper-upload-url`).set(auth(owner)).send({ contentType: 'image/jpeg' })).status).toBe(403);
    await setSettings({ waiverPaperSignaturesAllowed: true });

    const upload = await http().post(`${base}/paper-upload-url`).set(auth(owner)).send({ contentType: 'image/jpeg' });
    expect(upload.status).toBe(201);
    expect(upload.body.objectKey).toMatch(new RegExp(`^waiver-signatures/${school.id}/${waiver.id}/${s.id}/paper-.+\\.jpg$`));

    const tomorrow = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    expect((await http().post(`${base}/paper`).set(auth(owner)).send({ signerFullName: 'Pat Paper', signedDate: tomorrow, imageKey: upload.body.objectKey })).status).toBe(400);
    expect(
      (await http().post(`${base}/paper`).set(auth(owner)).send({ signerFullName: 'Pat Paper', signedDate: '2026-10-01', imageKey: `waiver-signatures/${school.id}/other/paper-x.jpg` })).status,
    ).toBe(400);
    objectExists = false;
    expect((await http().post(`${base}/paper`).set(auth(owner)).send({ signerFullName: 'Pat Paper', signedDate: '2026-10-01', imageKey: upload.body.objectKey })).status).toBe(400);
    objectExists = true;
    expect((await http().post(`${base}/paper`).set(auth(s)).send({ signerFullName: 'Pat Paper', signedDate: '2026-10-01', imageKey: upload.body.objectKey })).status).toBe(403);

    const recorded = await http().post(`${base}/paper`).set(auth(owner)).send({ signerFullName: 'Pat Paper', signedDate: '2026-10-01', imageKey: upload.body.objectKey });
    expect(recorded.status).toBe(201);
    expect(recorded.body).toMatchObject({ status: 'SIGNED', method: 'PAPER', recordedById: owner.id, signedById: null, signerFullName: 'Pat Paper', signedWaiverBody: 'Paper terms', signedWaiverVersion: 1 });
    expect(recorded.body.signedDate.slice(0, 10)).toBe('2026-10-01');
    expect(recorded.body.signatureImageUrl).toContain('paper-');

    const detail = await http().get(base).set(auth(owner));
    expect(detail.body).toMatchObject({ method: 'PAPER', recordedByName: 'owner Settings' });
    expect((await http().post(`${base}/paper`).set(auth(owner)).send({ signerFullName: 'Pat Paper', signedDate: '2026-10-01', imageKey: upload.body.objectKey })).status).toBe(409);
    expect(await hasCountingWaiverSignature(superuser, s.id, school.id)).toBe(true);
    await superuser.roleGrant.updateMany({ where: { userId: s.id }, data: { revokedAt: new Date() } });
  });

  it('Q8: "Remind everyone" reminds unsigned current students once a day, and not for an archived waiver', async () => {
    const a = await mkUser('remind-a', school.id, 'STUDENT');
    const b = await mkUser('remind-b', school.id, 'STUDENT');
    const waiver = await mkWaiver('Remind');
    expect((await sign(waiver.id, b)).status).toBe(201);
    notices = [];

    const first = await http().post(`/v1/schools/${school.id}/waivers/${waiver.id}/remind`).set(auth(owner));
    expect(first.status).toBe(201);
    expect(first.body.reminded).toBeGreaterThanOrEqual(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ waiverId: waiver.id, reason: 'reminder' });
    expect(notices[0].studentIds).toContain(a.id);
    expect(notices[0].studentIds).not.toContain(b.id);

    const again = await http().post(`/v1/schools/${school.id}/waivers/${waiver.id}/remind`).set(auth(owner));
    expect(again.body.reminded).toBe(0);
    expect((await http().post(`/v1/schools/${school.id}/waivers/${waiver.id}/remind`).set(auth(a))).status).toBe(403);

    await http().post(`/v1/waivers/${waiver.id}/archive`).set(auth(owner));
    expect((await http().post(`/v1/schools/${school.id}/waivers/${waiver.id}/remind`).set(auth(owner))).status).toBe(409);
    await superuser.roleGrant.updateMany({ where: { userId: { in: [a.id, b.id] } }, data: { revokedAt: new Date() } });
  });

  describe('requests at the same moment (stress test round 3)', () => {
    it('new terms saved while students sign leave no signature on the old version', async () => {
      const students = await Promise.all(Array.from({ length: 8 }, (_, i) => mkUser(`race-sign-${i}`, school.id, 'STUDENT')));
      const waiver = await mkWaiver('Racing terms', 'Terms 1');
      for (let round = 2; round <= 4; round++) {
        await superuser.waiverSignature.deleteMany({ where: { waiverId: waiver.id, status: 'SIGNED' } });
        const [edit, ...signs] = await Promise.all([
          http().patch(`/v1/waivers/${waiver.id}`).set(auth(owner)).send({ body: `Terms ${round}`, resign: true }),
          ...students.map((st) => sign(waiver.id, st)),
        ]);
        expect(edit.status).toBe(200);
        signs.forEach((r) => expect([201, 409]).toContain(r.status));
        const signed = await superuser.waiverSignature.findMany({ where: { waiverId: waiver.id, status: 'SIGNED' } });
        expect(signed.filter((r) => r.signedWaiverVersion !== edit.body.version)).toEqual([]);
      }
      await superuser.roleGrant.updateMany({ where: { userId: { in: students.map((st) => st.id) } }, data: { revokedAt: new Date() } });
    });

    it('a double-clicked signature is saved once; the other clicks get 409', async () => {
      const st = await mkUser('double-click', school.id, 'STUDENT');
      const waiver = await mkWaiver('Double click');
      const res = await Promise.all(Array.from({ length: 6 }, () => sign(waiver.id, st)));
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      expect(res.filter((r) => r.status === 409)).toHaveLength(5);
      expect((await rowsFor(waiver.id, st.id)).map((r) => r.status)).toEqual(['SIGNED']);
      await superuser.roleGrant.updateMany({ where: { userId: st.id }, data: { revokedAt: new Date() } });
    });
  });

  it('Q8: a new member is told which waivers to sign when they join, unless the School turned that off', async () => {
    const waiver = await mkWaiver('Join notice');
    const joiner = await mkUser('joiner', null);
    notices = [];
    const joined = await http().post(`/v1/schools/${school.id}/join`).set(auth(owner)).send({ studentId: joiner.id });
    expect(joined.status).toBe(201);
    const mine = notices.filter((n) => n.studentIds?.includes(joiner.id));
    expect(mine.map((n) => n.waiverId)).toContain(waiver.id);
    expect(mine.every((n) => n.reason === 'assigned' && n.batchId)).toBe(true);

    await setSettings({ waiverNoticeOnJoin: false });
    const quiet = await mkUser('quiet-joiner', null);
    notices = [];
    expect((await http().post(`/v1/schools/${school.id}/join`).set(auth(owner)).send({ studentId: quiet.id })).status).toBe(201);
    expect(notices).toEqual([]);
    await setSettings({ waiverNoticeOnJoin: true });
    await superuser.roleGrant.updateMany({ where: { userId: { in: [joiner.id, quiet.id] } }, data: { revokedAt: new Date() } });
  });

  it('the notice job tells only the named, current students, with the wording for its reason', async () => {
    const a = await mkUser('notice-a', school.id, 'STUDENT');
    const left = await mkUser('notice-left', school.id, 'STUDENT');
    const waiver = await mkWaiver('Notice text');
    await superuser.roleGrant.updateMany({ where: { userId: left.id }, data: { revokedAt: new Date() } });
    const fanout: Array<{ data: { userId: string; title: string; body: string; notificationId: string } }> = [];
    jest.spyOn(app.get(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'addBulk').mockImplementation(async (jobs: unknown) => {
      fanout.push(...(jobs as typeof fanout));
      return [];
    });
    const processor = app.get(WaiverSignatureRequestsProcessor);
    await processor.process({ data: { waiverId: waiver.id, schoolId: school.id, studentIds: [a.id, left.id], reason: 'reminder', batchId: 'b1' } } as never);
    expect(fanout.map((j) => j.data.userId)).toEqual([a.id]);
    expect(fanout[0].data).toMatchObject({
      title: 'Waiver reminder',
      body: 'Settings Dojo reminds you to sign the waiver "Notice text".',
      notificationId: `waiver-reminder-b1-${waiver.id}-${a.id}`,
    });

    fanout.length = 0;
    await http().post(`/v1/waivers/${waiver.id}/archive`).set(auth(owner));
    await processor.process({ data: { waiverId: waiver.id, schoolId: school.id, studentIds: [a.id], reason: 'reminder', batchId: 'b2' } } as never);
    expect(fanout).toEqual([]);
    await superuser.roleGrant.updateMany({ where: { userId: a.id }, data: { revokedAt: new Date() } });
  });

  it('Q5: the daily sweep expires old signatures and child signatures at 18, asks them to sign again, and sends repeat reminders', async () => {
    const now = new Date();
    const veteran = await mkUser('veteran', school.id, 'STUDENT');
    const recent = await mkUser('recent', school.id, 'STUDENT');
    const grownUp = await mkUser('grown-up', school.id, 'STUDENT', yearsAgo(18));
    const pending = await mkUser('pending', school.id, 'STUDENT');
    const waiver = await mkWaiver('Sweep');
    const signRow = async (studentId: string, signedDate: Date, signedById = studentId) =>
      superuser.waiverSignature.updateMany({
        where: { waiverId: waiver.id, studentId, status: 'UNSIGNED' },
        data: { status: 'SIGNED', signedById, signerFullName: 'S', signatureText: 'S', signedDate },
      });
    await signRow(veteran.id, new Date(now.getTime() - 400 * DAY));
    await signRow(recent.id, new Date(now.getTime() - 30 * DAY));
    await signRow(grownUp.id, new Date(now.getTime() - 200 * DAY), owner.id); // signed for them at 17
    await superuser.waiverSignature.updateMany({ where: { waiverId: waiver.id, studentId: pending.id }, data: { createdAt: new Date(now.getTime() - 10 * DAY) } });

    const sweep = app.get(WaiverRenewalSweepProcessor);
    await setSettings({ waiverRenewalMonths: null, waiverMinorsSignAgainAt18: false, waiverReminderDays: null });
    notices = [];
    await sweep.sweep(now);
    expect(notices.filter((n) => n.waiverId === waiver.id)).toEqual([]);

    await setSettings({ waiverRenewalMonths: 12, waiverMinorsSignAgainAt18: true, waiverReminderDays: 7 });
    await sweep.sweep(now);
    expect((await rowsFor(waiver.id, veteran.id)).map((r) => r.status)).toEqual(['EXPIRED', 'UNSIGNED']);
    expect((await rowsFor(waiver.id, recent.id)).map((r) => r.status)).toEqual(['SIGNED']);
    expect((await rowsFor(waiver.id, grownUp.id)).map((r) => r.status)).toEqual(['EXPIRED', 'UNSIGNED']);
    const pendingRows = await rowsFor(waiver.id, pending.id);
    expect(pendingRows[0].lastRemindedAt?.getTime()).toBe(now.getTime());

    const byReason = (reason: string) => notices.filter((n) => n.waiverId === waiver.id && n.reason === reason).flatMap((n) => n.studentIds);
    expect(byReason('renewal')).toEqual([veteran.id]);
    expect(byReason('adult')).toEqual([grownUp.id]);
    expect(byReason('reminder')).toEqual([pending.id]);

    // Next day: nothing new expires, and no one is reminded again so soon.
    notices = [];
    await sweep.sweep(new Date(now.getTime() + DAY));
    expect(notices.filter((n) => n.waiverId === waiver.id)).toEqual([]);

    await setSettings({ waiverRenewalMonths: null, waiverReminderDays: null });
    await superuser.roleGrant.updateMany({ where: { userId: { in: [veteran.id, recent.id, grownUp.id, pending.id] } }, data: { revokedAt: new Date() } });
  });
});
