/**
 * Grading notifications (Decisions 145, 178): "ready to grade" to the owner and
 * the coaches who may grade the student, once per rank, after a grading action
 * and in the daily sweep; "you've been promoted" to the student, or to a
 * minor's guardians. Real HTTP, real queues (Redis) and the real ultm8_jobs
 * role.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { GRADING_NOTIFICATIONS_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && process.env.REDIS_URL && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-ready-notification.e2e-spec] Skipped — database / Redis / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Grading notifications (Decisions 145, 178)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let downtown: { id: string };
  let riverside: { id: string };
  let bjj: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const user: Record<string, { id: string; email: string }> = {};
  const userIds: string[] = [];
  let ownerToken: string;

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `grading-ready-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Ready',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    user[label] = u;
    return u;
  }

  async function mkStudent(label: string, opts: { branchId?: string; at: string; classes?: number; enrolled?: boolean }) {
    const u = await mkUser(label);
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id, revokedAt: opts.enrolled === false ? new Date() : null },
    });
    if (opts.branchId) {
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: u.id, branchId: opts.branchId } });
    }
    await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: u.id, disciplineId: bjj.id, schoolId: school.id,
        currentRankId: rung[opts.at].rankId, currentStripeId: rung[opts.at].id,
        classesAttendedTowardCheckpoint: opts.classes ?? 0,
      },
    });
    return u;
  }

  const act = (label: string, action: string, body: object = {}) =>
    request(app.getHttpServer()).post(`/v1/students/${user[label].id}/ranks/${bjj.id}/${action}`).set('Authorization', `Bearer ${ownerToken}`).send(body);
  const rankOf = (label: string) => superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: user[label].id, disciplineId: bjj.id } } });
  const readyFor = async (label: string) =>
    (await superuser.notification.findMany({ where: { type: 'GRADING_READY', body: { startsWith: `${label} Ready ` } } })).map((n) => n.userId);

  async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (done(v) || Date.now() - start > timeoutMs) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const settle = () => new Promise((r) => setTimeout(r, 1500));
  const sorted = (ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Ready To Grade School', ranksToggle: true } });
    downtown = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Downtown' } });
    riverside = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Riverside' } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
    // white-0 → white-1 (3 classes) → white-2 (3 classes) → blue-0 (3 classes).
    const belts: Array<[string, number, number]> = [['white', 0, 3], ['blue', 1, 1]];
    for (const [name, order, tiers] of belts) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t < tiers; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: {
            id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name}-${t}`,
            stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], classesRequired: name === 'white' && t === 0 ? 0 : 3,
          },
        });
        rung[`${name}-${t}`] = { id: tier.id, rankId: rank.id };
      }
    }

    const owner = await mkUser('owner');
    const carla = await mkUser('carla'); // permission, Downtown
    const wes = await mkUser('wes'); // no permission, Downtown
    const rita = await mkUser('rita'); // permission, Riverside
    const pia = await mkUser('pia'); // permission, Downtown, but Promote switched off
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: carla.id, schoolId: school.id, branchId: downtown.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: wes.id, schoolId: school.id, branchId: downtown.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: rita.id, schoolId: school.id, branchId: riverside.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: pia.id, schoolId: school.id, branchId: downtown.id },
      ],
    });
    await superuser.gradingPermission.createMany({
      data: [
        { id: randomUUID(), userId: carla.id, disciplineId: bjj.id, schoolId: school.id },
        { id: randomUUID(), userId: rita.id, disciplineId: bjj.id, schoolId: school.id },
        { id: randomUUID(), userId: pia.id, disciplineId: bjj.id, schoolId: school.id, canPromote: false },
      ],
    });
    ownerToken = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  afterAll(async () => {
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { studentRank: { schoolId: school.id } } });
    await superuser.skillSignOffLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skill: { schoolId: school.id } } });
    await superuser.skill.deleteMany({ where: { schoolId: school.id } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.guardianLink.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a logged class that makes the student ready tells the owner and the permitted coach of their branch only', async () => {
    await mkStudent('ana', { branchId: downtown.id, at: 'white-1', classes: 2 });
    expect((await act('ana', 'log-class')).status).toBe(201);

    const got = await waitFor(() => readyFor('ana'), (ids) => ids.length >= 2);
    // Not wes (no permission), not rita (other branch), not pia (may not Promote, Decision 181.3).
    expect(sorted(got)).toEqual(sorted([user.owner.id, user.carla.id]));
    const n = await superuser.notification.findFirstOrThrow({ where: { type: 'GRADING_READY', userId: user.owner.id, body: { startsWith: 'ana Ready ' } } });
    expect(n).toMatchObject({ title: 'Ready to grade', body: 'ana Ready is ready for white-2 (BJJ).' });
    expect((await rankOf('ana')).readyNotifiedAt).not.toBeNull();
  });

  it('once per rank: more progress on the same rank sends nothing new', async () => {
    expect((await act('ana', 'log-class')).status).toBe(201);
    await settle();
    expect(await readyFor('ana')).toHaveLength(2);
  });

  it('a grade clears it for the new rank, and the student is told they were promoted', async () => {
    const res = await act('ana', 'stripe-award', {});
    expect(res.status).toBe(201);
    expect((await rankOf('ana')).readyNotifiedAt).toBeNull();
    const promoted = await waitFor(() => superuser.notification.findUnique({ where: { id: `grading-${res.body.promotionEvent.id}` } }), (n) => n !== null);
    expect(promoted).toMatchObject({ userId: user.ana.id, title: 'New stripe!', body: "You've earned white-2. (BJJ)" });

    // Ready again on the new rank: a new notification.
    for (let i = 0; i < 3; i++) expect((await act('ana', 'log-class')).status).toBe(201);
    expect(await waitFor(() => readyFor('ana'), (ids) => ids.length >= 4)).toHaveLength(4);
  });

  it('a minor\'s promotion goes to their guardians, not the minor (Decision 145, item 2)', async () => {
    await mkStudent('kid', { branchId: downtown.id, at: 'white-1' });
    const parent = await mkUser('parent');
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: user.kid.id } });

    const res = await act('kid', 'stripe-award', {});
    expect(res.status).toBe(201);
    const id = `grading-${res.body.promotionEvent.id}`;
    const n = await waitFor(() => superuser.notification.findUnique({ where: { id: `${id}-${parent.id}` } }), (v) => v !== null);
    expect(n).toMatchObject({ userId: parent.id, title: 'New stripe!', body: 'kid has earned white-2. (BJJ)', type: 'GRADING_RANK_CHANGE' });
    expect(await superuser.notification.findUnique({ where: { id } })).toBeNull();
  });

  it('the daily sweep finds students ready by other means; not those who have left', async () => {
    await mkStudent('sam', { branchId: riverside.id, at: 'white-1', classes: 3 }); // ready already
    await mkStudent('lou', { branchId: downtown.id, at: 'white-1', classes: 3, enrolled: false }); // left the school
    await mkStudent('nia', { at: 'white-1', classes: 3 }); // no home branch: the owner's alone

    const queue = app.get<Queue>(getQueueToken(GRADING_NOTIFICATIONS_QUEUE));
    await queue.add('sweep', {}, { removeOnComplete: true });

    expect(sorted(await waitFor(() => readyFor('sam'), (ids) => ids.length >= 2))).toEqual(sorted([user.owner.id, user.rita.id]));
    expect(await waitFor(() => readyFor('nia'), (ids) => ids.length >= 1)).toEqual([user.owner.id]);
    expect(await readyFor('lou')).toEqual([]);
    expect((await rankOf('lou')).readyNotifiedAt).toBeNull();
  });
  // Every event that can make a student ready runs the check (Decision 178.1),
  // and the check only sends at an open School with ranks on (178.3). A Judo
  // ladder of its own: j0 → j1 (nothing needed) → j2 (1 class, 30 days) →
  // j3 (1 class, the Osoto skill). Only the owner grades Judo.
  describe('what runs the ready check, and where it is quiet (Decision 178)', () => {
    let judo: { id: string };
    const jr: Record<string, { id: string; rankId: string }> = {};
    let osoto: { id: string };
    let planId: string;

    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    async function judoStudent(label: string, at: string, opts: { classes?: number; since?: Date; unverified?: boolean } = {}) {
      const u = await mkUser(label);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: u.id, branchId: downtown.id } });
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: u.id, disciplineId: judo.id, schoolId: school.id, currentRankId: jr[at].rankId, currentStripeId: jr[at].id,
          classesAttendedTowardCheckpoint: opts.classes ?? 0, dateOfCurrentRank: opts.since ?? daysAgo(400),
          verificationStatus: opts.unverified ? 'UNVERIFIED' : 'VERIFIED',
        },
      });
      return u;
    }
    const owner = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${ownerToken}` });
    const readyOnce = (label: string) => waitFor(() => readyFor(label), (ids) => ids.length >= 1);

    beforeAll(async () => {
      judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo', classTypesOffered: [] } });
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: judo.id, schoolId: school.id, order: 0, name: 'yellow', primaryColour: '#FFFF00' } });
      const reqs: Array<{ classesRequired: number; minimumDaysInRank: number }> = [
        { classesRequired: 0, minimumDaysInRank: 0 },
        { classesRequired: 0, minimumDaysInRank: 0 },
        { classesRequired: 1, minimumDaysInRank: 30 },
        { classesRequired: 1, minimumDaysInRank: 0 },
      ];
      for (const [t, r] of reqs.entries()) {
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `j${t}`, stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], ...r },
        });
        jr[`j${t}`] = { id: tier.id, rankId: rank.id };
      }
      osoto = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: judo.id, schoolId: school.id, name: 'Osoto' } });
      await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: jr.j3.id, skillId: osoto.id } });
      planId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    });

    it('a check-in', async () => {
      const u = await judoStudent('cy', 'j1');
      const membership = await superuser.membership.create({
        data: { id: randomUUID(), studentId: u.id, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
      });
      const start = new Date(Date.now() - 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Judo', activities: ['Judo'], styles: [{ disciplineId: judo.id, classType: null }], startDate: start, endDate: new Date(start.getTime() + 3_600_000), qrAttendanceEndAt: new Date(Date.now() + 86_400_000) },
      });
      await superuser.booking.create({ data: { id: randomUUID(), studentId: u.id, classId: cls.id, schoolId: school.id, sourceMembershipId: membership.id, status: 'UPCOMING' } });
      const res = await owner().post(`/v1/classes/${cls.id}/attendance-scan`).set(auth()).send({ studentId: u.id });
      expect(res.status).toBe(201);
      expect(await readyOnce('cy')).toEqual([user.owner.id]);
    });

    it('a skill sign-off', async () => {
      const u = await judoStudent('sid', 'j2', { classes: 1 });
      for (let i = 0; i < 2; i++) expect((await owner().patch(`/v1/students/${u.id}/skills/${osoto.id}`).set(auth())).status).toBe(200); // Learning, then Signed Off
      expect(await readyOnce('sid')).toEqual([user.owner.id]);
    });

    it('a board drag', async () => {
      const u = await judoStudent('bea', 'j1');
      expect((await owner().post(`/v1/students/${u.id}/ranks/${judo.id}/board-move`).set(auth()).send({ column: 'READY_TO_GRADE' })).status).toBe(201);
      expect(await readyOnce('bea')).toEqual([user.owner.id]);
    });

    it('a rank-date edit', async () => {
      const u = await judoStudent('rod', 'j1', { classes: 1, since: new Date() });
      const res = await owner().patch(`/v1/students/${u.id}/ranks/${judo.id}/rank-date`).set(auth()).send({ date: daysAgo(60).toISOString().slice(0, 10) });
      expect(res.status).toBe(200);
      expect(await readyOnce('rod')).toEqual([user.owner.id]);
    });

    it('a student declaring their belt', async () => {
      const u = await mkUser('dee');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: u.id, branchId: downtown.id } });
      const token = jwt.sign({ sub: u.id, email: u.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
      const res = await request(app.getHttpServer())
        .post(`/v1/students/${u.id}/ranks/${judo.id}/declare`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rankId: jr.j0.rankId, stripeTierId: jr.j0.id });
      expect(res.status).toBe(201);
      expect(await readyOnce('dee')).toEqual([user.owner.id]);
    });

    it('verifying a declared belt', async () => {
      const u = await judoStudent('vic', 'j0', { unverified: true });
      expect((await owner().post(`/v1/students/${u.id}/ranks/${judo.id}/verify`).set(auth()).send({})).status).toBe(201);
      expect(await readyOnce('vic')).toEqual([user.owner.id]);
    });

    it('quiet while ranks are off or the School is archived; sent once ranks are back on (Decision 178.3)', async () => {
      await judoStudent('ola', 'j0'); // ready already; nothing has run the check yet
      const queue = app.get<Queue>(getQueueToken(GRADING_NOTIFICATIONS_QUEUE));
      try {
        await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: false } });
        await queue.add('sweep', {}, { removeOnComplete: true });
        await settle();
        expect(await readyFor('ola')).toEqual([]);

        await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: true, archivedAt: new Date() } });
        await queue.add('sweep', {}, { removeOnComplete: true });
        await settle();
        expect(await readyFor('ola')).toEqual([]);
      } finally {
        await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: true, archivedAt: null } });
      }
      await queue.add('sweep', {}, { removeOnComplete: true });
      expect(await readyOnce('ola')).toEqual([user.owner.id]);
    });

    it('the jobs role may only mark a student as notified, nothing else in grading (Decision 178.5)', async () => {
      const sr = await rankOf('ana');
      const asJobs = (sql: string) =>
        superuser.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE ultm8_jobs');
          return tx.$executeRawUnsafe(sql, sr.id);
        });
      await expect(asJobs('UPDATE "StudentRank" SET "readyNotifiedAt" = now() WHERE id = $1')).resolves.toBe(1);
      await expect(asJobs('UPDATE "StudentRank" SET "classesAttendedTowardCheckpoint" = 99 WHERE id = $1')).rejects.toThrow(/permission denied/);
      await expect(asJobs('UPDATE "StudentRank" SET "currentStripeId" = NULL WHERE id = $1')).rejects.toThrow(/permission denied/);
      await expect(asJobs('DELETE FROM "PromotionEvent" WHERE "studentRankId" = $1')).rejects.toThrow(/permission denied/);
      await expect(asJobs('DELETE FROM "StudentRank" WHERE id = $1')).rejects.toThrow(/permission denied/);
      expect((await rankOf('ana')).classesAttendedTowardCheckpoint).toBe(sr.classesAttendedTowardCheckpoint);
    });
  });
});
