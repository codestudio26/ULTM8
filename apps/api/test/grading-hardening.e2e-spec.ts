/**
 * Grading hardening fixes (Phase 7; Decision 185), each from the stress round
 * or Gus's scenarios re-run against the API: history in date order, the
 * board's "N inactive hidden" count, refusing a stale rank, two coaches
 * grading the same step, ladder edits at the same time, grading only the
 * School's students, and input bounds. Real HTTP.
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
  console.warn('[grading-hardening.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Grading hardening (Phase 7, Decision 185)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  let school: { id: string };
  let bjj: { id: string };
  const belts: Array<{ id: string }> = [];
  const rungs: Array<{ id: string; rankId: string }> = []; // White 0..3, Blue 0..3, Purple 0..3
  let ownerToken = '';

  async function mkUser(first: string, surname = 'Hardening') {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `hardening-${first}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: first,
        surname,
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }
  async function student(first: string, rung: number | null, opts: { classes?: number; active?: boolean; surname?: string } = {}) {
    const u = await mkUser(first, opts.surname);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
    if (rung !== null) {
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: u.id, disciplineId: bjj.id, schoolId: school.id,
          currentRankId: rungs[rung].rankId, currentStripeId: rungs[rung].id,
          classesAttendedTowardCheckpoint: opts.classes ?? 0,
          dateOfCurrentRank: new Date(Date.now() - 400 * 86_400_000),
          boardActiveOverride: opts.active === undefined ? null : opts.active,
        },
      });
    }
    return u;
  }
  const http = () => request(app.getHttpServer());
  const post = (url: string, body: object = {}, token = ownerToken) => http().post(url).set('Authorization', `Bearer ${token}`).send(body);
  const currentRung = async (studentId: string) =>
    (await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId, disciplineId: bjj.id } } })).currentStripeId;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Hardening Dojo', ranksToggle: true } });
    schoolIds.push(school.id);
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    for (const [order, name] of ['White', 'Blue', 'Purple'].entries()) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      belts.push(rank);
      for (let t = 0; t < 4; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name} ${t}`, classesRequired: 10 },
        });
        rungs.push({ id: tier.id, rankId: rank.id });
      }
    }
    const owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    ownerToken = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('with no target, promote goes one rung up and downgrade one rung down', async () => {
    const s = await student('Step', 1);
    const up = await post(`/v1/students/${s.id}/ranks/${bjj.id}/promote`, { acknowledgeWithoutSkillSignoff: true });
    expect(up.status).toBe(201);
    expect(up.body.promotionEvent.toStripeTierId).toBe(rungs[2].id);
    const down = await post(`/v1/students/${s.id}/ranks/${bjj.id}/downgrade`, { reason: 'Back one' });
    expect(down.status).toBe(201);
    expect(down.body.promotionEvent.toStripeTierId).toBe(rungs[1].id);
  });

  it('rank history is newest first by grading date, back-dated entries included', async () => {
    const s = await student('History', 0);
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    // Six grades, 60 days ago up to today, some back-dated. History used to
    // come back in id order (random), so six entries would rarely line up.
    for (let r = 1; r <= 6; r++) {
      const res = await post(`/v1/students/${s.id}/ranks/${bjj.id}/promote`, { targetRungId: rungs[r].id, effectiveDate: day(60 - r * 10) });
      expect(res.status).toBe(201);
    }
    const res = await http().get(`/v1/students/${s.id}/rank-history?schoolId=${school.id}&limit=100`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const dates = (res.body.items as Array<{ effectiveDate: string }>).map((e) => e.effectiveDate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(res.body.items.map((e: { toStripeTierId: string }) => e.toStripeTierId)).toEqual([6, 5, 4, 3, 2, 1].map((r) => rungs[r].id));
  });

  it('"N inactive hidden" counts every inactive student in the style, whatever the search', async () => {
    await student('Quinn', 4, { active: false, surname: 'Silva' });
    await student('Rae', 5, { active: false, surname: 'Other' });
    const board = (search?: string) =>
      http()
        .get(`/v1/schools/${school.id}/grading-board?disciplineId=${bjj.id}&activeOnly=true${search ? `&search=${search}` : ''}`)
        .set('Authorization', `Bearer ${ownerToken}`);
    const before = await board();
    // The top stripe: never on the board, but counted when inactive (Decision 194).
    await student('Sol', 11, { active: false, surname: 'Top' });
    const all = await board();
    expect(all.body.hiddenInactive).toBe(before.body.hiddenInactive + 1);
    const searched = await board('silva');
    expect(all.status).toBe(200);
    expect(all.body.hiddenInactive).toBeGreaterThanOrEqual(3);
    expect(searched.body.hiddenInactive).toBe(all.body.hiddenInactive);
  });

  it('a grade refers to the rung the grader saw: a stale one is refused (409)', async () => {
    const s = await student('Stale', 4);
    const stale = await post(`/v1/students/${s.id}/ranks/${bjj.id}/stripe-award`, { expectedCurrentRungId: rungs[3].id });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toContain('changed since you opened it');
    expect(await currentRung(s.id)).toBe(rungs[4].id);
    const fresh = await post(`/v1/students/${s.id}/ranks/${bjj.id}/stripe-award`, { expectedCurrentRungId: rungs[4].id });
    expect(fresh.status).toBe(201);
    // No rank yet: null means "no rank", as the portal's first grade sends.
    const newcomer = await student('Newcomer', null);
    expect((await post(`/v1/students/${newcomer.id}/ranks/${bjj.id}/promote`, { expectedCurrentRungId: rungs[0].id })).status).toBe(409);
    expect((await post(`/v1/students/${newcomer.id}/ranks/${bjj.id}/promote`, { expectedCurrentRungId: null })).status).toBe(201);
  });

  it('two coaches awarding the same stripe at once: exactly one wins', async () => {
    for (let pair = 0; pair < 5; pair++) {
      const s = await student(`Race${pair}`, 4);
      const [a, b] = await Promise.all([
        post(`/v1/students/${s.id}/ranks/${bjj.id}/stripe-award`, { expectedCurrentRungId: rungs[4].id }),
        post(`/v1/students/${s.id}/ranks/${bjj.id}/stripe-award`, { expectedCurrentRungId: rungs[4].id }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await currentRung(s.id)).toBe(rungs[5].id);
    }
  });

  it('belt reorders and belt edits at the same time take turns: no 500, the ladder stays whole', async () => {
    const ids = belts.map((b) => b.id);
    for (let i = 0; i < 5; i++) {
      const results = await Promise.all([
        http().put(`/v1/styles/${bjj.id}/ranks/order`).set('Authorization', `Bearer ${ownerToken}`).send({ rankIds: ids }),
        http().put(`/v1/styles/${bjj.id}/ranks/order`).set('Authorization', `Bearer ${ownerToken}`).send({ rankIds: [...ids].reverse() }),
        http().patch(`/v1/ranks/${ids[1]}`).set('Authorization', `Bearer ${ownerToken}`).send({ name: `Blue ${i}` }),
      ]);
      for (const r of results) expect([200, 409]).toContain(r.status);
    }
    const orders = (await superuser.rank.findMany({ where: { disciplineId: bjj.id } })).map((r) => r.order).sort();
    expect(orders).toEqual([0, 1, 2]);
    // Put the ladder back for the other tests.
    expect((await http().put(`/v1/styles/${bjj.id}/ranks/order`).set('Authorization', `Bearer ${ownerToken}`).send({ rankIds: ids })).status).toBe(200);
  });

  it('only the School\'s own students can be graded', async () => {
    const outsider = await mkUser('Outsider');
    const res = await post(`/v1/students/${outsider.id}/ranks/${bjj.id}/promote`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('isn\'t a student at this School');
    expect(await superuser.promotionEvent.count({ where: { studentId: outsider.id } })).toBe(0);
    // A random id gets the same answer.
    expect((await post(`/v1/students/${randomUUID()}/ranks/${bjj.id}/promote`)).status).toBe(404);
  });

  it('bad ids and out-of-range numbers are a 400, not a 500', async () => {
    const s = await student('Bounds', 0);
    expect((await post(`/v1/students/not-a-uuid/ranks/${bjj.id}/promote`)).status).toBe(400);
    expect((await post(`/v1/students/${s.id}/ranks/nope/promote`)).status).toBe(400);
    expect((await post(`/v1/students/${s.id}/ranks/${bjj.id}/promote`, { startingClasses: 10_001 })).status).toBe(400);
    expect((await post(`/v1/students/${s.id}/ranks/${bjj.id}/promote`, { expectedCurrentRungId: 'x' })).status).toBe(400);
  });
});
