/**
 * Bulk promote, roadmap Phase 3c (Decision 130): up to 200 students one rung
 * each on one date; a "Needs a look" list (skills not signed off, days short)
 * acknowledged with one tick; students blocked by the "skills required" switch,
 * with no next rank or not the coach's skipped. Real HTTP throughout.
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
  console.warn('[grading-bulk-promote.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describeIfDb('Bulk promote (Phase 3c)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let downtown: { id: string };
  let riverside: { id: string };
  let bjj: { id: string };
  let armbar: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const token: Record<string, string> = {};
  const userIds: string[] = [];

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `bulk-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Bulk',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  /** A student on a rung (or none), whose rank date was `daysInRank` days ago. */
  async function student(label: string, at: string | null, daysInRank = 400, branchId = downtown.id) {
    const u = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: u.id, branchId } });
    if (at) {
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: u.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: rung[at].rankId, currentStripeId: rung[at].id,
          dateOfCurrentRank: new Date(Date.now() - daysInRank * 86_400_000),
        },
      });
    }
    return u.id;
  }

  const bulk = (body: object, who = 'owner') =>
    request(app.getHttpServer()).post(`/v1/schools/${school.id}/grading/bulk-promote`).set('Authorization', `Bearer ${token[who]}`).send({ disciplineId: bjj.id, ...body });
  const ids = (rows: Array<{ studentId: string }>) => rows.map((r) => r.studentId).sort();
  const rankOf = (studentId: string) => superuser.studentRank.findUnique({ where: { studentId_disciplineId: { studentId, disciplineId: bjj.id } } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Bulk Promote School', ranksToggle: true } });
    downtown = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Downtown' } });
    riverside = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Riverside' } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    armbar = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name: 'Armbar' } });

    // white-0 → white-1 (needs the Armbar) → white-2 (30 days) → blue-0 → black-0 (top).
    const belts: Array<[string, number, object[]]> = [
      ['white', 0, [{}, {}, { minimumDaysInRank: 30 }]],
      ['blue', 1, [{}]],
      ['black', 2, [{}]],
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
    await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: rung['white-1'].id, skillId: armbar.id } });

    const owner = await mkUser('owner');
    const carla = await mkUser('carla');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: carla.id, schoolId: school.id, branchId: downtown.id },
      ],
    });
    await superuser.gradingPermission.create({ data: { id: randomUUID(), userId: carla.id, disciplineId: bjj.id, schoolId: school.id } });
    token.owner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    token.carla = jwt.sign({ sub: carla.id, email: carla.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: downtown.id }] });
  });

  afterAll(async () => {
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skillId: armbar.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.skill.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    // Bulk promotions notify each student (the grading notifications from #116).
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('dry run: ready, "Needs a look" with reasons, and can\'t be promoted — nothing changes', async () => {
    const stripe = await student('stripe', 'white-1', 60); // → white-2, 60 ≥ 30 days
    const belt = await student('belt', 'white-2', 60); // → blue-0
    const skills = await student('skills', 'white-0'); // → white-1, Armbar not signed off
    const short = await student('short', 'white-1', 18); // → white-2, 12 days short
    const top = await student('top', 'black-0');
    const none = await student('none', null);
    const res = await bulk({ studentIds: [stripe, belt, skills, short, top, none], dryRun: true });
    expect(res.status).toBe(201);
    expect(ids(res.body.ready)).toEqual([stripe, belt].sort());
    expect(res.body.needsAcknowledgement).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: skills, reasons: ['1 skill not signed off'] }),
        expect.objectContaining({ studentId: short, reasons: ['12 days short'] }),
      ]),
    );
    expect(res.body.cannotPromote).toEqual(
      expect.arrayContaining([
        { studentId: top, reasons: ['no next rank'] },
        { studentId: none, reasons: ['no rank in this style'] },
      ]),
    );
    expect((await rankOf(stripe))?.currentStripeId).toBe(rung['white-1'].id);
  });

  it('a flagged student must be acknowledged or removed; with the one tick, everyone is promoted and it is recorded', async () => {
    const stripe = await student('stripe2', 'white-1', 60);
    const belt = await student('belt2', 'white-2', 60);
    const skills = await student('skills2', 'white-0');
    const short = await student('short2', 'white-1', 18);
    const studentIds = [stripe, belt, skills, short];
    expect((await bulk({ studentIds })).status).toBe(400);
    expect((await bulk({ studentIds, acknowledgedStudentIds: [skills] })).status).toBe(400); // `short` not acknowledged
    expect((await rankOf(stripe))?.currentStripeId).toBe(rung['white-1'].id); // nothing promoted by a refused request

    const res = await bulk({ studentIds, acknowledgedStudentIds: [skills, short], note: 'Spring Grading Day' });
    expect(res.status).toBe(201);
    expect(ids(res.body.ready)).toEqual([...studentIds].sort());
    expect(res.body.cannotPromote).toEqual([]);
    expect((await rankOf(stripe))?.currentStripeId).toBe(rung['white-2'].id);
    expect((await rankOf(belt))?.currentStripeId).toBe(rung['blue-0'].id);

    const events = await superuser.promotionEvent.findMany({ where: { studentId: { in: studentIds } } });
    const ev = (sid: string) => events.find((e) => e.studentId === sid)!;
    expect(ev(stripe)).toMatchObject({ type: 'BULK_STRIPE_AWARD', note: 'Spring Grading Day', systemNote: 'Promoted in a batch.', acknowledgedWithoutSkillSignoff: false });
    expect(ev(belt).type).toBe('BULK_PROMOTION');
    expect(ev(skills)).toMatchObject({ acknowledgedWithoutSkillSignoff: true, systemNote: 'Promoted in a batch; acknowledged: 1 skill not signed off (Decision 130).' });
    expect(ev(short).systemNote).toBe('Promoted in a batch; acknowledged: 12 days short (Decision 130).');
  });

  it('the style\'s "skills required" switch: those students are skipped, the rest promoted', async () => {
    const skills = await student('skills3', 'white-0');
    const ok = await student('ok3', 'white-2', 60);
    await superuser.discipline.update({ where: { id: bjj.id }, data: { skillsRequiredToGrade: true } });
    try {
      const res = await bulk({ studentIds: [skills, ok] });
      expect(res.status).toBe(201);
      expect(ids(res.body.ready)).toEqual([ok]);
      expect(res.body.cannotPromote).toEqual([{ studentId: skills, reasons: ['required skills not signed off (this style requires them)'] }]);
      expect((await rankOf(skills))?.currentStripeId).toBe(rung['white-0'].id);
    } finally {
      await superuser.discipline.update({ where: { id: bjj.id }, data: { skillsRequiredToGrade: false } });
    }
  });

  it('one date for the batch: it must suit every student', async () => {
    const recent = await student('recent', 'white-2', 5);
    const old = await student('old', 'white-2', 400);
    expect((await bulk({ studentIds: [recent, old], effectiveDate: daysAgo(-1) })).status).toBe(400); // future
    expect((await bulk({ studentIds: [recent, old], effectiveDate: daysAgo(10) })).status).toBe(400); // before `recent`'s rank date
    const res = await bulk({ studentIds: [recent, old], effectiveDate: daysAgo(2) });
    expect(res.status).toBe(201);
    const ev = await superuser.promotionEvent.findFirstOrThrow({ where: { studentId: old } });
    expect(ev.effectiveDate.toISOString().slice(0, 10)).toBe(daysAgo(2));
  });

  it('a coach: students outside their branches are skipped (Decision 168)', async () => {
    const mine = await student('mine', 'white-2', 60);
    const theirs = await student('theirs', 'white-2', 60, riverside.id);
    const res = await bulk({ studentIds: [mine, theirs] }, 'carla');
    expect(res.status).toBe(201);
    expect(ids(res.body.ready)).toEqual([mine]);
    expect(res.body.cannotPromote).toEqual([{ studentId: theirs, reasons: ['not a student you can grade in this style'] }]);
  });

  it('at most 200 students, no duplicates', async () => {
    const many = Array.from({ length: 201 }, () => randomUUID());
    expect((await bulk({ studentIds: many, dryRun: true })).status).toBe(400);
    const one = randomUUID();
    expect((await bulk({ studentIds: [one, one], dryRun: true })).status).toBe(400);
    expect((await bulk({ studentIds: [], dryRun: true })).status).toBe(400);
  });
});
