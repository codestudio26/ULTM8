/**
 * Promotion fee (Decisions 287, 297, 300, 307, 313): the owner's switches and
 * prices, fee requests made at grading (single and bulk), the payer's
 * accept/decline, waiting promotions applied once when paid or waived, "to
 * decide" after a cancel or a waived decline, its one reminder, and the
 * tenant boundary. Real HTTP, real queues (Redis), the real ultm8_app and
 * ultm8_jobs roles.
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
import { PromotionFeeService } from '../src/ranks/promotion-fee.service';
import { giveLiveMembership } from './live-membership';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && process.env.REDIS_URL && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-promotion-fee.e2e-spec] Skipped — database / Redis / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const DAY = 86_400_000;
const isoDay = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

describeIfDb('Promotion fee (Decisions 287, 297, 300, 307, 313)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let schoolB: { id: string };
  let downtown: { id: string };
  let bjj: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const user: Record<string, { id: string; email: string }> = {};
  const token: Record<string, string> = {};
  const userIds: string[] = [];

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `promo-fee-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Fee',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    user[label] = u;
    return u;
  }

  function sign(label: string, grants: Array<{ role: string; schoolId: string | null; branchId?: string | null }>) {
    token[label] = jwt.sign({
      sub: user[label].id,
      email: user[label].email,
      grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId ?? null })),
    });
  }

  async function mkStudent(label: string, at: string, opts: { classes?: number } = {}) {
    const u = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
    await giveLiveMembership(superuser, school.id, u.id);
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: u.id, branchId: downtown.id } });
    await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: u.id, disciplineId: bjj.id, schoolId: school.id,
        currentRankId: rung[at].rankId, currentStripeId: rung[at].id,
        classesAttendedTowardCheckpoint: opts.classes ?? 0,
        dateOfCurrentRank: new Date(Date.now() - 30 * DAY),
      },
    });
    sign(label, [{ role: 'STUDENT', schoolId: school.id }]);
    return u;
  }

  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({ Authorization: `Bearer ${token[label]}` });
  const grade = (by: string, student: string, action: 'promote' | 'stripe-award', body: object = {}) =>
    http().post(`/v1/students/${user[student].id}/ranks/${bjj.id}/${action}`).set(as(by)).send(body);
  const feeAction = (by: string, id: string, action: 'accept' | 'decline' | 'waive' | 'cancel' | 'dismiss') =>
    http().post(`/v1/promotion-fee-requests/${id}/${action}`).set(as(by)).send({});
  const rankOf = (label: string) => superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: user[label].id, disciplineId: bjj.id } } });
  const requestsOf = (label: string) => superuser.promotionFeeRequest.findMany({ where: { studentId: user[label].id }, orderBy: { createdAt: 'asc' } });
  const setFee = (promotionFeeEnabled: boolean, promotionFeeGradeBeforePaid = false) =>
    superuser.school.update({ where: { id: school.id }, data: { promotionFeeEnabled, promotionFeeGradeBeforePaid } });
  const boardCard = async (label: string) => {
    const res = await http().get(`/v1/schools/${school.id}/grading-board?disciplineId=${bjj.id}`).set(as('owner'));
    expect(res.status).toBe(200);
    return (res.body.items as Array<{ studentId: string; feeStatus: string | null; feeRequest: Record<string, unknown> | null }>).find((i) => i.studentId === user[label].id);
  };

  async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (done(v) || Date.now() - start > timeoutMs) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const settle = () => new Promise((r) => setTimeout(r, 1500));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Promotion Fee School', ranksToggle: true, defaultCurrency: 'GBP' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Fee School', ranksToggle: true, defaultCurrency: 'GBP' } });
    downtown = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Downtown' } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
    // white-0 → white-1 (free) → white-2 (a stripe, priced 15.00) → blue-0 (priced 30.00); 3 classes each.
    for (const [name, order, tiers] of [['white', 0, 3], ['blue', 1, 1]] as Array<[string, number, number]>) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t < tiers; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: {
            id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name}-${t}`,
            stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], classesRequired: 3,
            promotionFeeMinor: name === 'white' && t === 2 ? 1500 : name === 'blue' ? 3000 : null,
          },
        });
        rung[`${name}-${t}`] = { id: tier.id, rankId: rank.id };
      }
    }

    await mkUser('owner');
    await mkUser('carla'); // coach with Promote, Downtown
    await mkUser('wes'); // coach without grading permission, Downtown
    await mkUser('ownerB'); // owner of another School
    await mkUser('coachB'); // coach of another School
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.carla.id, schoolId: school.id, branchId: downtown.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.wes.id, schoolId: school.id, branchId: downtown.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.ownerB.id, schoolId: schoolB.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.coachB.id, schoolId: schoolB.id },
      ],
    });
    await superuser.gradingPermission.create({ data: { id: randomUUID(), userId: user.carla.id, disciplineId: bjj.id, schoolId: school.id } });
    sign('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    sign('carla', [{ role: 'INSTRUCTOR', schoolId: school.id, branchId: downtown.id }]);
    sign('wes', [{ role: 'INSTRUCTOR', schoolId: school.id, branchId: downtown.id }]);
    sign('ownerB', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: schoolB.id }]);
    sign('coachB', [{ role: 'INSTRUCTOR', schoolId: schoolB.id }]);
  });

  afterAll(async () => {
    const schools = [school.id, schoolB.id];
    // Accepting a fee makes its charge (backlog §3.6 step 6): the ledger first.
    await superuser.chargeAllocation.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.balanceEntry.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.charge.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.promotionFeeRequest.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { studentRank: { schoolId: { in: schools } } } });
    await superuser.skillSignOffLog.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.guardianLink.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schools } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schools } } });
    // A notification job can still be writing as the suite ends: clear and retry.
    for (let attempt = 0; ; attempt++) {
      await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
      try {
        await superuser.user.deleteMany({ where: { id: { in: userIds } } });
        break;
      } catch (err) {
        if (attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await superuser.school.deleteMany({ where: { id: { in: schools } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  describe('the switches (owner only, both off by default)', () => {
    it('start off, and any staff member can read them', async () => {
      for (const who of ['owner', 'carla']) {
        const res = await http().get(`/v1/schools/${school.id}/promotion-fee-settings`).set(as(who));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ promotionFeeEnabled: false, gradeBeforeFeePaid: false, currency: 'GBP' });
      }
    });

    it('a coach, other staff and another School\'s owner get 403; the owner changes them', async () => {
      for (const who of ['carla', 'wes', 'ownerB']) {
        const res = await http().put(`/v1/schools/${school.id}/promotion-fee-settings`).set(as(who)).send({ promotionFeeEnabled: true });
        expect(res.status).toBe(403);
      }
      const res = await http().put(`/v1/schools/${school.id}/promotion-fee-settings`).set(as('owner')).send({ promotionFeeEnabled: true, gradeBeforeFeePaid: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ promotionFeeEnabled: true, gradeBeforeFeePaid: true });
      const back = await http().put(`/v1/schools/${school.id}/promotion-fee-settings`).set(as('owner')).send({ promotionFeeEnabled: false, gradeBeforeFeePaid: false });
      expect(back.body).toMatchObject({ promotionFeeEnabled: false, gradeBeforeFeePaid: false });
    });
  });

  describe('prices per grade', () => {
    const tiersOf = async (who: string) => {
      const res = await http().get(`/v1/styles/${bjj.id}/ranks`).set(as(who));
      expect(res.status).toBe(200);
      return (res.body.items as Array<{ stripeTiers: Array<Record<string, unknown>> }>).flatMap((r) => r.stripeTiers);
    };
    const whiteBelt = () => ({
      stripeTiers: [0, 1, 2].map((t) => ({ id: rung[`white-${t}`].id, order: t, count: t, colour: '#000000', classesRequired: 3 })),
    });

    it('with the fee off: no price is returned anywhere, and none can be set (400)', async () => {
      await setFee(false);
      for (const tier of await tiersOf('owner')) expect(tier).not.toHaveProperty('promotionFeeMinor');
      const one = await http().get(`/v1/ranks/${rung['white-2'].rankId}`).set(as('owner'));
      for (const tier of one.body.stripeTiers) expect(tier).not.toHaveProperty('promotionFeeMinor');
      const body = whiteBelt();
      (body.stripeTiers[1] as Record<string, unknown>).promotionFeeMinor = 999;
      const res = await http().patch(`/v1/ranks/${rung['white-0'].rankId}`).set(as('owner')).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/promotion fee is off/);
      // An edit that sends no prices still works, and keeps the stored ones.
      const plain = await http().patch(`/v1/ranks/${rung['white-0'].rankId}`).set(as('owner')).send(whiteBelt());
      expect(plain.status).toBe(200);
      expect((await superuser.rankStripeTier.findUniqueOrThrow({ where: { id: rung['white-2'].id } })).promotionFeeMinor).toBe(1500);
    });

    it('with the fee on: the owner sets and clears prices, and they are returned; a coach cannot set them', async () => {
      await setFee(true);
      const body = whiteBelt();
      (body.stripeTiers[1] as Record<string, unknown>).promotionFeeMinor = 700;
      const res = await http().patch(`/v1/ranks/${rung['white-0'].rankId}`).set(as('owner')).send(body);
      expect(res.status).toBe(200);
      expect(res.body.stripeTiers.map((t: { promotionFeeMinor: number | null }) => t.promotionFeeMinor)).toEqual([null, 700, 1500]);
      const cleared = whiteBelt();
      (cleared.stripeTiers[1] as Record<string, unknown>).promotionFeeMinor = null;
      expect((await http().patch(`/v1/ranks/${rung['white-0'].rankId}`).set(as('owner')).send(cleared)).body.stripeTiers[1].promotionFeeMinor).toBeNull();
      const zero = whiteBelt();
      (zero.stripeTiers[1] as Record<string, unknown>).promotionFeeMinor = 0;
      expect((await http().patch(`/v1/ranks/${rung['white-0'].rankId}`).set(as('owner')).send(zero)).status).toBe(400);
      expect((await http().patch(`/v1/ranks/${rung['white-0'].rankId}`).set(as('carla')).send(body)).status).toBe(403);
      expect((await tiersOf('carla')).map((t) => t.promotionFeeMinor)).toEqual([null, null, 1500, 3000]);
      // Decision 314 item 1: only the owner and people with grading permission see prices.
      expect((await tiersOf('wes')).some((t) => 'promotionFeeMinor' in t)).toBe(false);
    });
  });

  describe('grading with the fee off, or to a free grade', () => {
    it('fee off: a priced grade makes no request and applies at once', async () => {
      await setFee(false);
      await mkStudent('olive', 'white-1');
      const res = await grade('owner', 'olive', 'stripe-award');
      expect(res.status).toBe(201);
      expect(res.body.promotionEvent).not.toBeNull();
      expect(res.body.feeRequest).toBeNull();
      expect((await rankOf('olive')).currentStripeId).toBe(rung['white-2'].id);
      expect(await requestsOf('olive')).toEqual([]);
    });

    it('fee on: an unpriced grade is free', async () => {
      await setFee(true);
      await mkStudent('fred', 'white-0');
      const res = await grade('carla', 'fred', 'stripe-award');
      expect(res.status).toBe(201);
      expect(res.body.feeRequest).toBeNull();
      expect((await rankOf('fred')).currentStripeId).toBe(rung['white-1'].id);
      expect(await requestsOf('fred')).toEqual([]);
    });
  });

  describe('"Allow grading before the fee is paid" off (the default): the promotion waits', () => {
    let waitingId: string;
    const coachDate = isoDay(3 * DAY);

    it('a priced grade makes a request, changes nothing yet, and tells the payer', async () => {
      await setFee(true, false);
      await mkStudent('pat', 'white-1');
      const res = await grade('carla', 'pat', 'stripe-award', { effectiveDate: coachDate, note: 'Great guard' });
      expect(res.status).toBe(201);
      expect(res.body.promotionEvent).toBeNull();
      expect(res.body.feeRequest).toMatchObject({ status: 'PENDING', promotionWaits: true, amountMinor: 1500, currency: 'GBP', toRungId: rung['white-2'].id, promotionEventId: null });
      waitingId = res.body.feeRequest.id;
      expect((await rankOf('pat')).currentStripeId).toBe(rung['white-1'].id);

      const n = await waitFor(() => superuser.notification.findUnique({ where: { id: `grading-fee-${waitingId}` } }), (v) => v !== null);
      expect(n).toMatchObject({ userId: user.pat.id, title: 'Promotion fee', type: 'GRADING_PROMOTION_FEE' });
      expect(n?.body).toMatch(/white-2 \(BJJ\) has a fee of £15\.00/);

      expect(await boardCard('pat')).toMatchObject({ feeStatus: 'waiting', feeRequest: { id: waitingId, toRungId: rung['white-2'].id, promotionApplied: false, feeFree: false } });
      // The coach sees it too (the board's own rule).
      const coachBoard = await http().get(`/v1/schools/${school.id}/grading-board?disciplineId=${bjj.id}`).set(as('carla'));
      expect(coachBoard.body.items.find((i: { studentId: string }) => i.studentId === user.pat.id).feeStatus).toBe('waiting');
    });

    it('while it waits, the student is not graded up again', async () => {
      expect((await grade('owner', 'pat', 'stripe-award')).status).toBe(409);
      expect((await grade('owner', 'pat', 'promote', { targetRungId: rung['blue-0'].id })).status).toBe(409);
      expect(await requestsOf('pat')).toHaveLength(1);
    });

    it('accepting does not apply it; paying applies it once, with the coach\'s date and as the coach\'s grade', async () => {
      const accepted = await feeAction('pat', waitingId, 'accept');
      expect(accepted.status).toBe(201);
      expect(accepted.body).toMatchObject({ status: 'ACCEPTED', promotionApplied: false, gradingDate: coachDate });
      expect((await rankOf('pat')).currentStripeId).toBe(rung['white-1'].id);

      const fees = app.get(PromotionFeeService);
      const paid = await fees.markPaid(user.pat.id, waitingId);
      expect(paid).toMatchObject({ status: 'PAID', promotionApplied: true });
      const sr = await rankOf('pat');
      expect(sr.currentStripeId).toBe(rung['white-2'].id);
      const event = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: paid.promotionEventId! } });
      expect(event).toMatchObject({ type: 'STRIPE_AWARD', performedById: user.carla.id, toStripeTierId: rung['white-2'].id, note: 'Great guard' });
      expect(event.effectiveDate.toISOString()).toBe(`${coachDate}T00:00:00.000Z`);

      await expect(fees.markPaid(user.pat.id, waitingId)).rejects.toThrow(/Only an accepted fee/);
      expect(await superuser.promotionEvent.count({ where: { studentId: user.pat.id, type: 'STRIPE_AWARD' } })).toBe(1);
      expect((await boardCard('pat'))?.feeStatus ?? null).toBeNull();
    });

    it('a pending (not accepted) fee cannot be marked paid', async () => {
      await mkStudent('quin', 'white-1');
      const res = await grade('owner', 'quin', 'stripe-award');
      await expect(app.get(PromotionFeeService).markPaid(user.quin.id, res.body.feeRequest.id)).rejects.toThrow(/Only an accepted fee/);
      expect((await rankOf('quin')).currentStripeId).toBe(rung['white-1'].id);
    });

    it('declined: nothing changes and the owner sees "Fee declined"', async () => {
      await mkStudent('dora', 'white-1');
      const res = await grade('carla', 'dora', 'stripe-award');
      const declined = await feeAction('dora', res.body.feeRequest.id, 'decline');
      expect(declined.status).toBe(201);
      expect(declined.body.status).toBe('DECLINED');
      expect((await rankOf('dora')).currentStripeId).toBe(rung['white-1'].id);
      expect((await boardCard('dora'))?.feeStatus).toBe('declined');
      // An answered fee can't be answered again.
      expect((await feeAction('dora', res.body.feeRequest.id, 'accept')).status).toBe(409);
    });

    it('the owner waives a waiting promotion: it applies now, as the coach made it', async () => {
      await mkStudent('walt', 'white-1');
      const res = await grade('carla', 'walt', 'stripe-award', { effectiveDate: coachDate });
      const id = res.body.feeRequest.id;
      expect((await feeAction('carla', id, 'waive')).status).toBe(403);
      expect((await feeAction('wes', id, 'waive')).status).toBe(403);
      const waived = await feeAction('owner', id, 'waive');
      expect(waived.status).toBe(201);
      expect(waived.body).toMatchObject({ status: 'WAIVED', promotionApplied: true, toDecide: false });
      expect((await rankOf('walt')).currentStripeId).toBe(rung['white-2'].id);
      const event = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: waived.body.promotionEventId } });
      expect(event.performedById).toBe(user.carla.id);
      expect(event.effectiveDate.toISOString()).toBe(`${coachDate}T00:00:00.000Z`);
      expect((await feeAction('owner', id, 'waive')).status).toBe(409);
    });

    it('the owner cancels a waiting promotion: nothing applies, it is "to decide", and promoting it is fee-free', async () => {
      await mkStudent('cleo', 'white-1');
      const res = await grade('carla', 'cleo', 'stripe-award');
      const id = res.body.feeRequest.id;
      expect((await feeAction('carla', id, 'cancel')).status).toBe(403);
      const cancelled = await feeAction('owner', id, 'cancel');
      expect(cancelled.status).toBe(201);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', promotionApplied: false, toDecide: true });
      expect((await rankOf('cleo')).currentStripeId).toBe(rung['white-1'].id);
      expect(await boardCard('cleo')).toMatchObject({ feeStatus: 'toDecide', feeRequest: { id, toRungId: rung['white-2'].id, feeFree: true } });

      // A coach confirms it with the normal Promote: no new request.
      const promoted = await grade('carla', 'cleo', 'promote', { targetRungId: rung['white-2'].id, expectedCurrentRungId: rung['white-1'].id });
      expect(promoted.status).toBe(201);
      expect(promoted.body.promotionEvent).not.toBeNull();
      expect(promoted.body.feeRequest).toBeNull();
      expect((await rankOf('cleo')).currentStripeId).toBe(rung['white-2'].id);
      const all = await requestsOf('cleo');
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ toDecideResolution: 'PROMOTED', toDecideResolvedById: user.carla.id });
      expect((await boardCard('cleo'))?.feeStatus ?? null).toBeNull();
    });

    it('the owner waives a declined fee: nothing applies, it is "to decide"; a coach who may promote can decide not to', async () => {
      await mkStudent('dan', 'white-1');
      const res = await grade('carla', 'dan', 'stripe-award');
      const id = res.body.feeRequest.id;
      await feeAction('dan', id, 'decline');
      const waived = await feeAction('owner', id, 'waive');
      expect(waived.body).toMatchObject({ status: 'WAIVED', promotionApplied: false, toDecide: true });
      expect((await rankOf('dan')).currentStripeId).toBe(rung['white-1'].id);
      expect((await boardCard('dan'))?.feeStatus).toBe('toDecide');

      expect((await feeAction('wes', id, 'dismiss')).status).toBe(403); // no grading permission
      expect((await feeAction('dan', id, 'dismiss')).status).toBe(403); // the student
      // Decision 314 item 2: any grading permission for the style will do, even without "Promote".
      const wesPermission = await superuser.gradingPermission.create({ data: { id: randomUUID(), userId: user.wes.id, disciplineId: bjj.id, schoolId: school.id, canPromote: false } });
      const dismissed = await feeAction('wes', id, 'dismiss');
      await superuser.gradingPermission.delete({ where: { id: wesPermission.id } });
      expect(dismissed.status).toBe(201);
      expect(dismissed.body).toMatchObject({ toDecide: false, toDecideResolution: 'DISMISSED' });
      expect((await rankOf('dan')).currentStripeId).toBe(rung['white-1'].id);
      expect((await boardCard('dan'))?.feeStatus ?? null).toBeNull();
      expect((await feeAction('carla', id, 'dismiss')).status).toBe(409);
    });
  });

  describe('"Allow grading before the fee is paid" on: the promotion applies at once', () => {
    it('promoted now, the request waits; declined shows "Fee declined" and the promotion stays', async () => {
      await setFee(true, true);
      await mkStudent('gina', 'white-2');
      const res = await grade('carla', 'gina', 'promote');
      expect(res.status).toBe(201);
      expect(res.body.promotionEvent).not.toBeNull();
      expect(res.body.feeRequest).toMatchObject({ status: 'PENDING', promotionWaits: false, amountMinor: 3000, promotionEventId: res.body.promotionEvent.id });
      expect((await rankOf('gina')).currentStripeId).toBe(rung['blue-0'].id);

      const declined = await feeAction('gina', res.body.feeRequest.id, 'decline');
      expect(declined.body.status).toBe('DECLINED');
      expect((await rankOf('gina')).currentStripeId).toBe(rung['blue-0'].id);
      // blue-0 is the top rank, so gina has no card; the request still says it.
      const list = await http().get(`/v1/schools/${school.id}/promotion-fee-requests?status=DECLINED&studentId=${user.gina.id}`).set(as('owner'));
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ status: 'DECLINED', promotionApplied: true });
      // Decision 314 item 1: amounts are prices, so the list needs grading permission for the style.
      expect((await http().get(`/v1/schools/${school.id}/promotion-fee-requests?studentId=${user.gina.id}`).set(as('wes'))).status).toBe(403);
      const carlaList = await http().get(`/v1/schools/${school.id}/promotion-fee-requests?studentId=${user.gina.id}`).set(as('carla'));
      expect(carlaList.status).toBe(200);
      expect(carlaList.body.items.length).toBeGreaterThan(0);
      expect((await http().get(`/v1/schools/${school.id}/promotion-fee-requests?disciplineId=${randomUUID()}`).set(as('carla'))).body.items).toEqual([]);

      // Waiving it closes it; the promotion stays and nothing is "to decide".
      const waived = await feeAction('owner', res.body.feeRequest.id, 'waive');
      expect(waived.body).toMatchObject({ status: 'WAIVED', toDecide: false });
      expect((await rankOf('gina')).currentStripeId).toBe(rung['blue-0'].id);
    });

    it('paying an accepted fee for a promotion that already applied only marks it paid', async () => {
      await mkStudent('ivy', 'white-1');
      const res = await grade('carla', 'ivy', 'stripe-award');
      const id = res.body.feeRequest.id;
      expect((await feeAction('ivy', id, 'accept')).body.status).toBe('ACCEPTED');
      const paid = await app.get(PromotionFeeService).markPaid(user.ivy.id, id);
      expect(paid).toMatchObject({ status: 'PAID', promotionEventId: res.body.promotionEvent.id });
      expect(await superuser.promotionEvent.count({ where: { studentId: user.ivy.id, type: 'STRIPE_AWARD' } })).toBe(1);
      expect((await rankOf('ivy')).currentStripeId).toBe(rung['white-2'].id);
    });

    it('on a card that has a next rank, a declined fee shows "declined"', async () => {
      await mkStudent('hal', 'white-1');
      const res = await grade('carla', 'hal', 'stripe-award');
      await feeAction('hal', res.body.feeRequest.id, 'decline');
      expect((await boardCard('hal'))?.feeStatus).toBe('declined');
    });
  });

  describe('bulk promote', () => {
    it('one request per promoted student, for their own grade; with the switch off they wait', async () => {
      await setFee(true, false);
      await mkStudent('bo', 'white-1');
      await mkStudent('bea', 'white-2');
      await mkStudent('bix', 'white-0'); // to white-1: free
      const res = await http()
        .post(`/v1/schools/${school.id}/grading/bulk-promote`)
        .set(as('carla'))
        .send({ disciplineId: bjj.id, studentIds: [user.bo.id, user.bea.id, user.bix.id], acknowledgedStudentIds: [user.bo.id, user.bea.id, user.bix.id] });
      expect(res.status).toBe(201);
      expect(res.body.ready.map((r: { studentId: string }) => r.studentId)).toEqual([user.bix.id]);
      expect(res.body.ready[0].feeRequestId).toBeUndefined();
      const waiting = res.body.waitingForFee as Array<{ studentId: string; feeRequestId: string }>;
      expect(waiting.map((r) => r.studentId).sort()).toEqual([user.bo.id, user.bea.id].sort());
      const bo = await requestsOf('bo');
      const bea = await requestsOf('bea');
      expect(bo).toHaveLength(1);
      expect(bea).toHaveLength(1);
      expect(bo[0]).toMatchObject({ amountMinor: 1500, toRungId: rung['white-2'].id, promotionWaits: true });
      expect(bea[0]).toMatchObject({ amountMinor: 3000, toRungId: rung['blue-0'].id, promotionWaits: true });
      expect((await rankOf('bo')).currentStripeId).toBe(rung['white-1'].id);

      // Sent again: waiting students are skipped, never asked twice.
      const again = await http()
        .post(`/v1/schools/${school.id}/grading/bulk-promote`)
        .set(as('carla'))
        .send({ disciplineId: bjj.id, studentIds: [user.bo.id], acknowledgedStudentIds: [user.bo.id] });
      expect(again.body.cannotPromote).toEqual([{ studentId: user.bo.id, reasons: ['a promotion is waiting for its fee'] }]);
      expect(await requestsOf('bo')).toHaveLength(1);

      // Waiving applies the bulk grade with its own history type.
      const waived = await feeAction('owner', bo[0].id, 'waive');
      const event = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: waived.body.promotionEventId } });
      expect(event.type).toBe('BULK_STRIPE_AWARD');
    });
  });

  describe('the payer: the student, or the Guardian of a linked minor', () => {
    let kidRequest: string;
    let patRequest: string;

    beforeAll(async () => {
      await setFee(true, false);
      await mkStudent('kid', 'white-1');
      await mkUser('parent');
      await mkUser('stranger');
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: user.parent.id, studentId: user.kid.id } });
      sign('parent', []);
      sign('stranger', []);
      kidRequest = (await grade('carla', 'kid', 'stripe-award')).body.feeRequest.id;
      await mkStudent('sue', 'white-1');
      patRequest = (await grade('carla', 'sue', 'stripe-award')).body.feeRequest.id;
    });

    it('the guardian is told, not the minor', async () => {
      const n = await waitFor(() => superuser.notification.findUnique({ where: { id: `grading-fee-${kidRequest}-${user.parent.id}` } }), (v) => v !== null);
      expect(n?.body).toMatch(/^kid's promotion to white-2 \(BJJ\) has a fee of/);
      expect(await superuser.notification.findUnique({ where: { id: `grading-fee-${kidRequest}` } })).toBeNull();
    });

    it('lists only their own requests', async () => {
      const mine = await http().get(`/v1/students/${user.kid.id}/promotion-fee-requests`).set(as('parent'));
      expect(mine.status).toBe(200);
      expect(mine.body.items.map((r: { id: string }) => r.id)).toEqual([kidRequest]);
      expect(mine.body.items[0]).toMatchObject({ schoolName: 'Promotion Fee School', disciplineName: 'BJJ', amountMinor: 1500 });
      expect((await http().get(`/v1/students/${user.kid.id}/promotion-fee-requests`).set(as('stranger'))).status).toBe(403);
      expect((await http().get(`/v1/students/${user.kid.id}/promotion-fee-requests`).set(as('sue'))).status).toBe(403);
      expect((await http().get(`/v1/students/${user.kid.id}/promotion-fee-requests`).set(as('carla'))).status).toBe(403);
    });

    it('accept and decline only their own: another student, a stranger and staff cannot', async () => {
      expect((await feeAction('sue', kidRequest, 'accept')).status).toBe(404);
      expect((await feeAction('stranger', kidRequest, 'decline')).status).toBe(404);
      expect((await feeAction('parent', patRequest, 'accept')).status).toBe(404);
      expect((await feeAction('carla', kidRequest, 'accept')).status).toBe(403);
      expect((await feeAction('owner', kidRequest, 'decline')).status).toBe(403);
      const accepted = await feeAction('parent', kidRequest, 'accept');
      expect(accepted.status).toBe(201);
      expect(accepted.body.status).toBe('ACCEPTED');
      const row = await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: kidRequest } });
      expect(row.respondedById).toBe(user.parent.id);
    });
  });

  describe('"to decide" reminder (Decision 313)', () => {
    const queue = () => app.get<Queue>(getQueueToken(GRADING_NOTIFICATIONS_QUEUE));
    const remindersFor = (requestId: string) => superuser.notification.findMany({ where: { type: 'GRADING_TO_DECIDE', id: { startsWith: `grading-to-decide-${requestId}-` } } });

    async function toDecide(label: string, classes: number, daysAgo: number) {
      await setFee(true, false);
      await mkStudent(label, 'white-1', { classes });
      const res = await grade('carla', label, 'stripe-award', { acknowledgeWithoutSkillSignoff: true });
      const id = res.body.feeRequest.id as string;
      await feeAction('owner', id, 'cancel');
      await superuser.promotionFeeRequest.update({ where: { id }, data: { toDecideAt: new Date(Date.now() - daysAgo * DAY) } });
      return id;
    }

    it('sent once, after 3 days, to the owner and the coaches who may promote, only when the student is fully ready', async () => {
      const ready = await toDecide('rae', 3, 4); // 3 of 3 classes: fully ready
      const notReady = await toDecide('nell', 2, 4); // 2 of 3 classes
      const tooSoon = await toDecide('tia', 3, 2); // ready, but only 2 days

      await queue().add('sweep', {}, { removeOnComplete: true });
      const got = await waitFor(() => remindersFor(ready), (v) => v.length >= 2);
      expect(got.map((n) => n.userId).sort()).toEqual([user.owner.id, user.carla.id].sort()); // not wes: no Promote
      expect(got[0]).toMatchObject({ title: 'Promotion to decide' });
      expect(got[0].body).toBe("rae Fee's promotion to white-2 (BJJ) is waiting for your decision. Promote them, or decide not to.");
      await settle();
      expect(await remindersFor(notReady)).toEqual([]);
      expect(await remindersFor(tooSoon)).toEqual([]);
      expect((await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: notReady } })).toDecideRemindedAt).toBeNull();
      expect((await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: ready } })).toDecideRemindedAt).not.toBeNull();

      // Never twice.
      await queue().add('sweep', {}, { removeOnComplete: true });
      await settle();
      expect(await remindersFor(ready)).toHaveLength(2);
    });

    it('a decided promotion is not reminded', async () => {
      const id = await toDecide('dex', 3, 5);
      expect((await feeAction('carla', id, 'dismiss')).status).toBe(201);
      await queue().add('sweep', {}, { removeOnComplete: true });
      await settle();
      expect(await remindersFor(id)).toEqual([]);
    });

    it('the jobs role may only mark the reminder as sent', async () => {
      const id = (await superuser.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.rae.id } })).id;
      const asJobs = (sql: string) =>
        superuser.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE ultm8_jobs');
          return tx.$executeRawUnsafe(sql, id);
        });
      await expect(asJobs('UPDATE "PromotionFeeRequest" SET "toDecideRemindedAt" = now() WHERE id = $1')).resolves.toBe(1);
      await expect(asJobs('UPDATE "PromotionFeeRequest" SET "status" = \'PAID\' WHERE id = $1')).rejects.toThrow(/permission denied/);
      await expect(asJobs('DELETE FROM "PromotionFeeRequest" WHERE id = $1')).rejects.toThrow(/permission denied/);
    });
  });

  describe('cross-tenant isolation', () => {
    let requestId: string;

    beforeAll(async () => {
      requestId = (await superuser.promotionFeeRequest.findFirstOrThrow({ where: { schoolId: school.id, status: 'PENDING' } })).id;
    });

    it('another School\'s owner and coach never see or act on this School\'s requests', async () => {
      expect((await http().get(`/v1/schools/${school.id}/promotion-fee-requests`).set(as('ownerB'))).status).toBe(403);
      expect((await http().get(`/v1/schools/${school.id}/promotion-fee-settings`).set(as('coachB'))).status).toBe(403);
      const own = await http().get(`/v1/schools/${schoolB.id}/promotion-fee-requests`).set(as('ownerB'));
      expect(own.status).toBe(200);
      expect(own.body.items).toEqual([]);
      for (const action of ['waive', 'cancel', 'dismiss', 'accept', 'decline'] as const) {
        expect((await feeAction('ownerB', requestId, action)).status).toBe(404);
        expect((await feeAction('coachB', requestId, action)).status).toBe(404);
      }
      const row = await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(row.status).toBe('PENDING');
    });

    it('RLS: another School\'s owner and a stranger read and write no rows; the owner, coach and student read theirs', async () => {
      const withUser = <T>(userId: string, fn: (tx: PrismaClient) => Promise<T>) =>
        appDb.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
          return fn(tx as unknown as PrismaClient);
        });
      const count = (userId: string) => withUser(userId, (tx) => tx.promotionFeeRequest.count({ where: { schoolId: school.id } }));
      expect(await count(user.ownerB.id)).toBe(0);
      expect(await count(user.coachB.id)).toBe(0);
      expect(await count(user.stranger.id)).toBe(0);
      expect(await count('')).toBe(0);
      const total = await superuser.promotionFeeRequest.count({ where: { schoolId: school.id } });
      expect(await count(user.owner.id)).toBe(total);
      expect(await count(user.carla.id)).toBe(total); // every student here is in her branch
      expect(await count(user.wes.id)).toBe(total); // read only, like the board
      expect(await withUser(user.pat.id, (tx) => tx.promotionFeeRequest.count())).toBe(1);
      const updated = await withUser(user.ownerB.id, (tx) => tx.promotionFeeRequest.updateMany({ where: { id: requestId }, data: { status: 'WAIVED' } }));
      expect(updated.count).toBe(0);
      const byCoach = await withUser(user.carla.id, (tx) => tx.promotionFeeRequest.updateMany({ where: { id: requestId }, data: { status: 'WAIVED' } }));
      expect(byCoach.count).toBe(0); // staff read only; writes go through the API's checks
      await expect(
        withUser(user.ownerB.id, (tx) =>
          tx.promotionFeeRequest.create({
            data: { schoolId: school.id, studentId: user.pat.id, disciplineId: bjj.id, toRungId: rung['blue-0'].id, toRungName: 'x', amountMinor: 1, promotionWaits: false },
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
