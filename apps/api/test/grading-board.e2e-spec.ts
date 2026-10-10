/**
 * Grading Board, roadmap Phase 3b (Decisions 128, 136, 152, 168, 174, 176):
 * the board read (owner and branch staff), "currently attending", board drag,
 * "Log a class" and the manual Active switch. Real HTTP throughout.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-board.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Grading Board (Phase 3b)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  // The application's own database role, so RLS applies (same pattern as ranks.e2e-spec).
  const appDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let downtown: { id: string };
  let riverside: { id: string };
  let bjj: { id: string };
  let planId: string;
  const rung: Record<string, { id: string; rankId: string }> = {};
  const token: Record<string, string> = {};
  const student: Record<string, { id: string }> = {};
  const userIds: string[] = [];

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `grading-board-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Board',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  async function mkStudent(label: string, opts: { branchId: string; at?: string; classes?: number; byType?: Record<string, number>; membership?: boolean; override?: boolean | null; daysInRank?: number }) {
    const u = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: u.id, branchId: opts.branchId } });
    if (opts.at) {
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: u.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: rung[opts.at].rankId, currentStripeId: rung[opts.at].id,
          classesAttendedTowardCheckpoint: opts.classes ?? 0, classesAttendedByType: opts.byType ?? {}, boardActiveOverride: opts.override ?? null,
          dateOfCurrentRank: new Date(Date.now() - (opts.daysInRank ?? 400) * 86_400_000),
        },
      });
    }
    if (opts.membership) {
      await superuser.membership.create({ data: { id: randomUUID(), studentId: u.id, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null } });
    }
    student[label] = u;
    return u;
  }

  const board = (who: string, query = '') =>
    request(app.getHttpServer()).get(`/v1/schools/${school.id}/grading-board?disciplineId=${bjj.id}${query}`).set('Authorization', `Bearer ${token[who]}`);
  const write = (who: string, label: string, action: string, body: object, method: 'post' | 'put' = 'post') =>
    request(app.getHttpServer())[method](`/v1/students/${student[label].id}/ranks/${bjj.id}/${action}`).set('Authorization', `Bearer ${token[who]}`).send(body);
  const rankOf = (label: string) => superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: student[label].id, disciplineId: bjj.id } } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Grading Board School', ranksToggle: true } });
    downtown = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Downtown' } });
    riverside = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Riverside' } });
    planId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;

    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals', 'Sparring', 'Kata'] } });
    // white-0 → white-1 (30 classes, Fundamentals or Sparring) → blue-0 (each
    // type: 20 Fundamentals + 10 Sparring) → black-0 / black-1 (time-only).
    const belts: Array<[string, number, object[]]> = [
      ['white', 0, [{}, { classesRequired: 30, eligibleClassTypes: ['Fundamentals', 'Sparring'] }]],
      ['blue', 1, [{ eligibleClassTypes: ['Fundamentals', 'Sparring'], classCountMode: 'EACH_TYPE', classTypeRequirements: [{ classType: 'Fundamentals', classesRequired: 20 }, { classType: 'Sparring', classesRequired: 10 }] }]],
      ['black', 2, [{ timeOnly: true, minimumDaysInRank: 1095 }, { timeOnly: true, minimumDaysInRank: 1095 }]],
    ];
    for (const [name, order, tiers] of belts) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t < tiers.length; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name}-${t}`, stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], ...tiers[t] },
        });
        rung[`${name}-${t}`] = { id: tier.id, rankId: rank.id };
      }
    }

    const owner = await mkUser('owner');
    const carla = await mkUser('carla');
    const wes = await mkUser('wes');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: carla.id, schoolId: school.id, branchId: downtown.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: wes.id, schoolId: school.id, branchId: downtown.id },
      ],
    });
    await superuser.gradingPermission.create({ data: { id: randomUUID(), userId: carla.id, disciplineId: bjj.id, schoolId: school.id } });
    token.owner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    token.carla = jwt.sign({ sub: carla.id, email: carla.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: downtown.id }] });
    token.wes = jwt.sign({ sub: wes.id, email: wes.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: downtown.id }] });

    await mkStudent('ana', { branchId: downtown.id, at: 'white-0', classes: 30, membership: true }); // 30/30 = 100%
    await mkStudent('ben', { branchId: downtown.id, at: 'white-1', byType: { Fundamentals: 18, Sparring: 4 }, classes: 22, membership: true }); // each type: 18/20 + 4/10 = 73%
    await mkStudent('cat', { branchId: riverside.id, at: 'white-0', classes: 5 }); // 5/30 = 17%; no membership: inactive
    await mkStudent('dan', { branchId: downtown.id, at: 'black-1', membership: true }); // top rung: not on the board
    await mkStudent('eve', { branchId: downtown.id, membership: true }); // no rank: not on the board
    await mkStudent('fay', { branchId: downtown.id, at: 'white-0', classes: 9, membership: true, override: false }); // 9/30 = 30%; switched off by hand
    await mkStudent('gus', { branchId: downtown.id, at: 'black-0', daysInRank: 30, membership: true }); // time-only
  });

  afterAll(async () => {
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
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
    await appDb.$disconnect();
    await app.close();
  });

  const names = (res: request.Response) => res.body.items.map((i: { firstName: string }) => i.firstName);

  it('the owner sees every student with a next rank, highest progress first', async () => {
    const res = await board('owner');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['ana', 'ben', 'fay', 'cat', 'gus']); // 100, 73, 30, 17, 3 %
    const ben = res.body.items.find((i: { firstName: string }) => i.firstName === 'ben');
    expect(ben).toMatchObject({ active: true, activeSource: 'MEMBERSHIP', hasActiveMembership: true, hardBlocked: false });
    expect(ben.eligibility).toMatchObject({ progressPercent: 73, boardColumn: 'READY_TO_GRADE', nextRungId: rung['blue-0'].id });
  });

  it('"currently attending only": membership decides, the manual switch overrides (Decision 152)', async () => {
    const res = await board('owner', '&activeOnly=true');
    expect(names(res).sort()).toEqual(['ana', 'ben', 'gus']);
    expect(res.body.hiddenInactive).toBe(2);
    const fay = (await board('owner')).body.items.find((i: { firstName: string }) => i.firstName === 'fay');
    expect(fay).toMatchObject({ active: false, activeSource: 'MANUAL', hasActiveMembership: true });
  });

  it('search by name', async () => {
    expect(names(await board('owner', '&search=BE'))).toEqual(['ben']);
  });

  it('branch staff see only their own branch\'s students (Decision 168)', async () => {
    const res = await board('carla');
    expect(res.status).toBe(200);
    expect(names(res)).not.toContain('cat');
    expect(names(res).sort()).toEqual(['ana', 'ben', 'fay', 'gus']);
  });

  it('a style that requires skills marks students with missing skills as blocked', async () => {
    const skill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name: 'Armbar' } });
    await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: rung['blue-0'].id, skillId: skill.id } });
    await superuser.discipline.update({ where: { id: bjj.id }, data: { skillsRequiredToGrade: true } });
    try {
      const ben = (await board('owner')).body.items.find((i: { firstName: string }) => i.firstName === 'ben');
      expect(ben.hardBlocked).toBe(true);
    } finally {
      await superuser.discipline.update({ where: { id: bjj.id }, data: { skillsRequiredToGrade: false } });
      await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skillId: skill.id } });
      await superuser.skill.delete({ where: { id: skill.id } });
    }
  });

  it('drag on an "any type" rung rewrites the class count and records it (Decision 128, item 13)', async () => {
    expect((await write('carla', 'cat', 'board-move', { column: 'READY_TO_GRADE' })).status).toBe(403); // Riverside student
    const res = await write('carla', 'fay', 'board-move', { column: 'READY_TO_GRADE' });
    expect(res.status).toBe(201);
    expect((await rankOf('fay')).classesAttendedTowardCheckpoint).toBe(20); // smallest count that shows ≥ 66%
    expect(res.body.promotionEvent).toMatchObject({ type: 'ADJUSTMENT', systemNote: 'Progress adjusted by hand on the Grading Board: classes attended changed from 9 to 20 (moved to "Ready to Grade").' });
    expect((await write('carla', 'fay', 'board-move', { column: 'READY_TO_GRADE' })).status).toBe(400); // already there
  });

  it('drag on an "each type" rung sets every type to the column\'s % (Decision 174)', async () => {
    await mkStudent('hal', { branchId: downtown.id, at: 'white-1', membership: true }); // next is blue-0, each type
    const res = await write('owner', 'hal', 'board-move', { column: 'GETTING_THERE' });
    expect(res.status).toBe(201);
    expect(await rankOf('hal')).toMatchObject({ classesAttendedTowardCheckpoint: 11, classesAttendedByType: { Fundamentals: 7, Sparring: 4 } }); // 7/20 and 4/10: the smallest at ≥ 33%
  });

  it('drag on a time-only rung moves the rank date', async () => {
    const res = await write('owner', 'gus', 'board-move', { column: 'GETTING_THERE' });
    expect(res.status).toBe(201);
    const gus = (await board('owner')).body.items.find((i: { firstName: string }) => i.firstName === 'gus');
    expect(gus.eligibility.elapsedDays).toBe(356); // smallest day count showing ≥ 33% of 1095
    expect(gus.eligibility.boardColumn).toBe('GETTING_THERE');
  });

  it('"Log a class": a type from the next rank\'s list, always counted, recorded (Decision 176)', async () => {
    expect((await write('carla', 'ben', 'log-class', {})).status).toBe(400);
    expect((await write('carla', 'ben', 'log-class', { classType: 'Kata' })).status).toBe(400);
    const before = await rankOf('ben');
    const res = await write('carla', 'ben', 'log-class', { classType: 'Sparring' });
    expect(res.status).toBe(201);
    expect(await rankOf('ben')).toMatchObject({ classesAttendedTowardCheckpoint: before.classesAttendedTowardCheckpoint + 1, classesAttendedByType: { Fundamentals: 18, Sparring: 5 } });
    expect(res.body.promotionEvent.systemNote).toBe(`Class logged by hand: Sparring (classes ${before.classesAttendedTowardCheckpoint} → ${before.classesAttendedTowardCheckpoint + 1}).`);
    expect((await write('owner', 'gus', 'log-class', {})).status).toBe(400); // time-only rung counts no classes
  });

  it('writes need grading permission for the style (Decision 138)', async () => {
    expect((await write('wes', 'ben', 'log-class', { classType: 'Sparring' })).status).toBe(403);
    expect((await write('wes', 'ben', 'board-move', { column: 'JUST_STARTING' })).status).toBe(403);
    expect((await write('wes', 'ben', 'board-active', { active: false }, 'put')).status).toBe(403);
    expect((await board('wes')).status).toBe(200); // reading the board is any staff of the branch
  });

  it('the manual Active switch: set, then back to following membership', async () => {
    expect((await write('carla', 'ben', 'board-active', { active: false }, 'put')).body.boardActiveOverride).toBe(false);
    expect(names(await board('owner', '&activeOnly=true'))).not.toContain('ben');
    expect((await write('carla', 'ben', 'board-active', { active: null }, 'put')).body.boardActiveOverride).toBeNull();
    expect(names(await board('owner', '&activeOnly=true'))).toContain('ben');
    expect((await write('carla', 'ben', 'board-active', {}, 'put')).status).toBe(400);
  });

  it('a student with no home branch shows as "No branch" to the owner only, until the owner assigns one (Decision 148.2)', async () => {
    const ida = await mkUser('ida');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: ida.id, schoolId: school.id } });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: ida.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: rung['white-0'].rankId, currentStripeId: rung['white-0'].id, classesAttendedTowardCheckpoint: 3 },
    });
    const flag = (res: request.Response, name: string) => res.body.items.find((i: { firstName: string }) => i.firstName === name)?.noHomeBranch;

    let res = await board('owner');
    expect(flag(res, 'ida')).toBe(true);
    expect(flag(res, 'ana')).toBe(false);
    expect(flag(res, 'cat')).toBe(false);
    expect(names(await board('carla'))).not.toContain('ida');

    const assign = await request(app.getHttpServer())
      .put(`/v1/schools/${school.id}/students/${ida.id}/home-branch`)
      .set('Authorization', `Bearer ${token.owner}`)
      .send({ branchId: downtown.id });
    expect(assign.status).toBe(200);
    res = await board('owner');
    expect(flag(res, 'ida')).toBe(false);
    const carlaRes = await board('carla');
    expect(names(carlaRes)).toContain('ida');
    expect(flag(carlaRes, 'ida')).toBe(false);

    // A coach can't assign one.
    const byCoach = await request(app.getHttpServer())
      .put(`/v1/schools/${school.id}/students/${ida.id}/home-branch`)
      .set('Authorization', `Bearer ${token.carla}`)
      .send({ branchId: riverside.id });
    expect(byCoach.status).toBe(403);
  });

  it('with ranks switched off, every newer grading write is refused (Decision 87)', async () => {
    const ana = student.ana.id;
    const event = await superuser.promotionEvent.create({
      data: { id: randomUUID(), studentRankId: (await rankOf('ana')).id, schoolId: school.id, studentId: ana, type: 'ADJUSTMENT', toRankId: rung['white-0'].rankId, toStripeTierId: rung['white-0'].id },
    });
    const ownerReq = () => request(app.getHttpServer());
    const auth = { Authorization: `Bearer ${token.owner}` };
    const writes: Array<[string, () => request.Test]> = [
      ['board move', () => ownerReq().post(`/v1/students/${ana}/ranks/${bjj.id}/board-move`).set(auth).send({ column: 'JUST_STARTING' })],
      ['log a class', () => ownerReq().post(`/v1/students/${ana}/ranks/${bjj.id}/log-class`).set(auth).send({ classType: 'Fundamentals' })],
      ['active switch', () => ownerReq().put(`/v1/students/${ana}/ranks/${bjj.id}/board-active`).set(auth).send({ active: true })],
      ['board %', () => ownerReq().put(`/v1/disciplines/${bjj.id}/board-thresholds`).set(auth).send({ gettingThere: 30, readyToGrade: 70 })],
      ['bulk promote', () => ownerReq().post(`/v1/schools/${school.id}/grading/bulk-promote`).set(auth).send({ disciplineId: bjj.id, studentIds: [ana] })],
      ['void', () => ownerReq().post(`/v1/students/${ana}/rank-history/${event.id}/void?schoolId=${school.id}`).set(auth).send({ reason: 'Test' })],
      ['edit rank date', () => ownerReq().patch(`/v1/students/${ana}/ranks/${bjj.id}/rank-date`).set(auth).send({ date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10) })],
      ['verify', () => ownerReq().post(`/v1/students/${ana}/ranks/${bjj.id}/verify`).set(auth).send({})],
    ];
    const before = await rankOf('ana');
    await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: false } });
    try {
      for (const [name, send] of writes) {
        const res = await send();
        expect({ name, status: res.status }).toEqual({ name, status: 403 });
      }
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: true } });
    }
    const after = await rankOf('ana');
    expect(after.classesAttendedTowardCheckpoint).toBe(before.classesAttendedTowardCheckpoint);
    expect((await superuser.promotionEvent.findUniqueOrThrow({ where: { id: event.id } })).voidedAt).toBeNull();
  });

  describe('the two read-only rules coaches need (Decision 168, approved for the board)', () => {
    it('a coach reads the home-branch rows of their own branches only, and cannot change them', async () => {
      const carla = await superuser.user.findFirstOrThrow({ where: { id: { in: userIds }, firstName: 'carla' } });
      const rows = await withUser(carla.id, (tx) => tx.studentHomeBranch.findMany({ where: { schoolId: school.id } }));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.branchId === downtown.id)).toBe(true);
      const changed = await withUser(carla.id, (tx) => tx.studentHomeBranch.updateMany({ where: { schoolId: school.id }, data: { branchId: riverside.id } }));
      expect(changed.count).toBe(0);
      // A revoked grant gives nothing.
      await superuser.roleGrant.updateMany({ where: { userId: carla.id, schoolId: school.id }, data: { revokedAt: new Date() } });
      try {
        expect(await withUser(carla.id, (tx) => tx.studentHomeBranch.count({ where: { schoolId: school.id } }))).toBe(0);
      } finally {
        await superuser.roleGrant.updateMany({ where: { userId: carla.id, schoolId: school.id }, data: { revokedAt: null } });
      }
    });

    it('a School with no branches: its coaches see its STUDENT grants (the School is the branch), no other grants, no other School, and not once branches exist', async () => {
      const mkSchool = (name: string) => superuser.school.create({ data: { id: randomUUID(), name, ranksToggle: true } });
      const solo = await mkSchool('Solo Dojo');
      const other = await mkSchool('Other Dojo');
      const coach = await mkUser('solo-coach');
      const kid = await mkUser('solo-kid');
      const otherKid = await mkUser('other-kid');
      const otherOwner = await mkUser('other-owner');
      await superuser.roleGrant.createMany({
        data: [
          { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: solo.id },
          { id: randomUUID(), role: 'STUDENT', userId: kid.id, schoolId: solo.id },
          { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: solo.id },
          { id: randomUUID(), role: 'STUDENT', userId: otherKid.id, schoolId: other.id },
        ],
      });
      try {
        const seen = await withUser(coach.id, (tx) => tx.roleGrant.findMany({ where: { userId: { not: coach.id } } }));
        expect(seen.map((g) => [g.userId, g.role])).toEqual([[kid.id, 'STUDENT']]);
        const changed = await withUser(coach.id, (tx) => tx.roleGrant.updateMany({ where: { userId: kid.id }, data: { revokedAt: new Date() } }));
        expect(changed.count).toBe(0);

        // The board for that School lists the student once they have a rank.
        const soloBjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: solo.id, name: 'BJJ' } });
        const r = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: soloBjj.id, schoolId: solo.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
        const t0 = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: r.id, schoolId: solo.id, order: 0, count: 0, colour: '#000', name: 'W0', classesRequired: 0 } });
        await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: r.id, schoolId: solo.id, order: 1, count: 1, colour: '#000', name: 'W1', classesRequired: 10, stripeSegments: [{ count: 1, colour: '#000' }] } });
        await superuser.studentRank.create({ data: { id: randomUUID(), studentId: kid.id, disciplineId: soloBjj.id, schoolId: solo.id, currentRankId: r.id, currentStripeId: t0.id } });
        const coachToken = jwt.sign({ sub: coach.id, email: coach.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: solo.id, branchId: null }] });
        const soloBoard = await request(app.getHttpServer()).get(`/v1/schools/${solo.id}/grading-board?disciplineId=${soloBjj.id}`).set('Authorization', `Bearer ${coachToken}`);
        expect(soloBoard.status).toBe(200);
        expect(soloBoard.body.items.map((i: { studentId: string }) => i.studentId)).toEqual([kid.id]);

        // Once the School has a branch, the branch rule applies instead.
        const b = await superuser.branch.create({ data: { id: randomUUID(), schoolId: solo.id, name: 'First branch' } });
        try {
          expect(await withUser(coach.id, (tx) => tx.roleGrant.count({ where: { userId: kid.id } }))).toBe(0);
        } finally {
          await superuser.branch.delete({ where: { id: b.id } });
        }
      } finally {
        await superuser.studentRank.deleteMany({ where: { schoolId: solo.id } });
        await superuser.rankStripeTier.deleteMany({ where: { schoolId: solo.id } });
        await superuser.rank.deleteMany({ where: { schoolId: solo.id } });
        await superuser.discipline.deleteMany({ where: { schoolId: solo.id } });
        await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [solo.id, other.id] } } });
        await superuser.school.deleteMany({ where: { id: { in: [solo.id, other.id] } } });
      }
    });
  });
});
