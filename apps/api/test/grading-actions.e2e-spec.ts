/**
 * Grading actions, roadmap Phase 3a (Decisions 127, 128, 174): grade to any
 * higher rung (skips recorded), downgrade to any lower rung, back-dated
 * grading in the student's local time, starting classes (a number per type for
 * "each type" rungs), the per-style "skills required" switch, and skill
 * sign-off on the next rung's skills. Real HTTP throughout.
 *
 * The School is in America/Los_Angeles, behind UTC, so a date stored as UTC
 * midnight would read back as the day before; these tests catch that.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-actions.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const TZ = 'America/Los_Angeles';
const localToday = () => DateTime.now().setZone(TZ).toISODate() as string;
const localDaysAgo = (n: number) => DateTime.now().setZone(TZ).minus({ days: n }).toISODate() as string;

describeIfDb('Grading actions (Phase 3a)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let tokenOwner: string;
  let bjj: { id: string };
  let skill: { id: string };
  let otherSkill: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const userIds: string[] = [];

  const post = (path: string, body: object) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenOwner}`).send(body);
  const promote = (studentId: string, body: object = {}) => post(`/v1/students/${studentId}/ranks/${bjj.id}/promote`, body);
  const downgrade = (studentId: string, body: object) => post(`/v1/students/${studentId}/ranks/${bjj.id}/downgrade`, body);
  const stripeAward = (studentId: string, body: object = {}) => post(`/v1/students/${studentId}/ranks/${bjj.id}/stripe-award`, body);

  async function mkStudent(label: string, at: string | null, rankDateDaysAgo = 0) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `grading-actions-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
    if (at) {
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: user.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: rung[at].rankId, currentStripeId: rung[at].id,
          dateOfCurrentRank: DateTime.now().setZone(TZ).minus({ days: rankDateDaysAgo }).startOf('day').toJSDate(),
        },
      });
    }
    return user;
  }

  const studentRank = (studentId: string) => superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId, disciplineId: bjj.id } } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Grading Actions School', ranksToggle: true, timezone: TZ } });
    owner = await superuser.user.create({
      data: {
        id: randomUUID(), email: `grading-actions-owner-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Owner', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(owner.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    tokenOwner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });

    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals', 'Sparring'] } });
    skill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name: 'Armbar' } });
    otherSkill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name: 'Kimura' } });

    // White 0–2, Blue 0–1 (Blue · 1 counts each type: 20 Fundamentals + 10
    // Sparring), Black 0–1 time-only. White · 1 needs the Armbar.
    const belts: Array<[string, number, number, object[]]> = [
      ['white', 0, 3, [{}, { requiredSkills: { create: [{ skillId: '' }] } }, {}]],
      ['blue', 1, 2, [{}, { eligibleClassTypes: ['Fundamentals', 'Sparring'], classCountMode: 'EACH_TYPE', classTypeRequirements: [{ classType: 'Fundamentals', classesRequired: 20 }, { classType: 'Sparring', classesRequired: 10 }] }]],
      ['black', 2, 2, [{ timeOnly: true, minimumDaysInRank: 1095 }, { timeOnly: true, minimumDaysInRank: 1095 }]],
    ];
    for (const [name, order, tiers, extras] of belts) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t < tiers; t++) {
        const extra = { ...(extras[t] as Record<string, unknown>) };
        delete extra.requiredSkills;
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name}-${t}`, stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], ...extra },
        });
        rung[`${name}-${t}`] = { id: tier.id, rankId: rank.id };
      }
    }
    await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: rung['white-1'].id, skillId: skill.id } });
  });

  afterAll(async () => {
    await superuser.skillSignOffLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: school.id } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.skill.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('grade can skip rungs; the skip is recorded (Decision 128, item 7)', async () => {
    const s = await mkStudent('skip', 'white-0');
    const res = await promote(s.id, { targetRungId: rung['blue-0'].id, acknowledgeWithoutSkillSignoff: true });
    expect(res.status).toBe(201);
    expect(res.body.studentRank.currentStripeId).toBe(rung['blue-0'].id);
    expect(res.body.promotionEvent).toMatchObject({ rungsSkipped: 2, systemNote: 'Skipped 2 ranks in between.', fromStripeTierId: rung['white-0'].id });
  });

  it('grade only moves up and downgrade only moves down (Decision 128, item 12)', async () => {
    const s = await mkStudent('direction', 'white-2');
    expect((await promote(s.id, { targetRungId: rung['white-1'].id })).status).toBe(400);
    expect((await downgrade(s.id, { targetRungId: rung['blue-0'].id, reason: 'x' })).status).toBe(400);
    expect((await promote(s.id, { targetRungId: randomUUID() })).status).toBe(400);
  });

  it('downgrade to any lower rung, with a reason, dated today; no back-date or starting classes', async () => {
    const s = await mkStudent('down', 'blue-1');
    expect((await downgrade(s.id, { targetRungId: rung['white-1'].id, reason: 'x', effectiveDate: localDaysAgo(1) })).status).toBe(400);
    const res = await downgrade(s.id, { targetRungId: rung['white-1'].id, reason: 'Missed six months' });
    expect(res.status).toBe(201);
    expect(res.body.promotionEvent).toMatchObject({ type: 'DOWNGRADE', reason: 'Missed six months', toStripeTierId: rung['white-1'].id, rungsSkipped: 0 });
  });

  it('skills for the next rung: acknowledgement when the switch is off, blocked when on (Decisions 127, 128 item 10)', async () => {
    const s = await mkStudent('skills', 'white-0');
    expect((await stripeAward(s.id)).status).toBe(400); // White · 1 needs the Armbar
    const patch = (on: boolean) =>
      request(app.getHttpServer()).patch(`/v1/disciplines/${bjj.id}`).set('Authorization', `Bearer ${tokenOwner}`).send({ skillsRequiredToGrade: on });
    expect((await patch(true)).body.skillsRequiredToGrade).toBe(true);
    try {
      expect((await stripeAward(s.id, { acknowledgeWithoutSkillSignoff: true })).status).toBe(400);
    } finally {
      expect((await patch(false)).body.skillsRequiredToGrade).toBe(false);
    }
    const res = await stripeAward(s.id, { acknowledgeWithoutSkillSignoff: true });
    expect(res.status).toBe(201);
    expect(res.body.promotionEvent.acknowledgedWithoutSkillSignoff).toBe(true);
  });

  it('signed-off skills let grading go ahead with no acknowledgement, and only the next rung\'s skills can be signed off', async () => {
    const s = await mkStudent('signoff', 'white-0');
    const cycle = (skillId: string) => request(app.getHttpServer()).patch(`/v1/students/${s.id}/skills/${skillId}`).set('Authorization', `Bearer ${tokenOwner}`);
    expect((await cycle(otherSkill.id)).status).toBe(400); // not a skill of White · 1
    expect((await cycle(skill.id)).body.status).toBe('LEARNING');
    expect((await cycle(skill.id)).body.status).toBe('SIGNED_OFF');
    const res = await stripeAward(s.id);
    expect(res.status).toBe(201);
    expect(res.body.promotionEvent.acknowledgedWithoutSkillSignoff).toBe(false);
  });

  it('back-dated grading: local days, not in the future, not before the current rank date (Decision 128, item 8)', async () => {
    const s = await mkStudent('backdate', 'white-1', 30);
    expect((await promote(s.id, { effectiveDate: localDaysAgo(-1) })).status).toBe(400);
    expect((await promote(s.id, { effectiveDate: localDaysAgo(31) })).status).toBe(400);
    expect((await promote(s.id, { effectiveDate: '2026-02-30' })).status).toBe(400);
    const res = await promote(s.id, { targetRungId: rung['white-2'].id, effectiveDate: localDaysAgo(10) });
    expect(res.status).toBe(201);
    const eligibility = await request(app.getHttpServer())
      .get(`/v1/students/${s.id}/eligibility?schoolId=${school.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    // Exactly 10 days in rank in the School's time zone, not 11.
    expect(eligibility.body.items[0].eligibility.elapsedDays).toBe(10);
    expect(DateTime.fromISO(res.body.promotionEvent.effectiveDate).setZone(TZ).toISODate()).toBe(localDaysAgo(10));
  });

  it('edit rank date also uses local days', async () => {
    const s = await mkStudent('editdate', 'white-1', 30);
    const res = await request(app.getHttpServer())
      .patch(`/v1/students/${s.id}/ranks/${bjj.id}/rank-date`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ date: localDaysAgo(20) });
    expect(res.status).toBe(200);
    const eligibility = await request(app.getHttpServer())
      .get(`/v1/students/${s.id}/eligibility?schoolId=${school.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(eligibility.body.items[0].eligibility.elapsedDays).toBe(20);
    expect((await request(app.getHttpServer()).patch(`/v1/students/${s.id}/ranks/${bjj.id}/rank-date`).set('Authorization', `Bearer ${tokenOwner}`).send({ date: localDaysAgo(-1) })).status).toBe(400);
  });

  it('starting classes: one number for an "any type" next rung', async () => {
    const s = await mkStudent('start-any', 'white-1');
    expect((await promote(s.id, { targetRungId: rung['white-2'].id, startingClassesByType: { Fundamentals: 3 } })).status).toBe(400);
    const res = await promote(s.id, { targetRungId: rung['white-2'].id, startingClasses: 7 });
    expect(res.status).toBe(201);
    expect(res.body.promotionEvent.startingClasses).toBe(7);
    expect(await studentRank(s.id)).toMatchObject({ classesAttendedTowardCheckpoint: 7, classesAttendedByType: {} });
  });

  it('starting classes: a number per type when the next rung counts each type (Decision 174)', async () => {
    const s = await mkStudent('start-each', 'white-2');
    const toBlue0 = (body: object) => promote(s.id, { targetRungId: rung['blue-0'].id, ...body });
    expect((await toBlue0({ startingClasses: 7 })).status).toBe(400);
    expect((await toBlue0({ startingClassesByType: { Kata: 2 } })).status).toBe(400);
    expect((await toBlue0({ startingClassesByType: { Fundamentals: -1 } })).status).toBe(400);
    const res = await toBlue0({ startingClassesByType: { Fundamentals: 5, Sparring: 2 } });
    expect(res.status).toBe(201);
    expect(res.body.promotionEvent).toMatchObject({ startingClasses: 7, startingClassesByType: { Fundamentals: 5, Sparring: 2 } });
    expect(await studentRank(s.id)).toMatchObject({ classesAttendedTowardCheckpoint: 7, classesAttendedByType: { Fundamentals: 5, Sparring: 2 } });
    const eligibility = await request(app.getHttpServer())
      .get(`/v1/students/${s.id}/eligibility?schoolId=${school.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(eligibility.body.items[0].eligibility).toMatchObject({ progressPercent: 23, byType: [{ classType: 'Fundamentals', counted: 5 }, { classType: 'Sparring', counted: 2 }] });
  });

  it('a time-only new rank takes no starting classes', async () => {
    const s = await mkStudent('start-time', 'blue-1');
    expect((await promote(s.id, { startingClasses: 3 })).status).toBe(400); // Blue · 1 → Black · 0
    expect((await promote(s.id)).status).toBe(201);
  });

  it('a first grade starts on the first rung, or on the rung picked', async () => {
    const s = await mkStudent('first', null);
    const res = await promote(s.id, { targetRungId: rung['white-2'].id });
    expect(res.status).toBe(201);
    expect(res.body.studentRank.currentStripeId).toBe(rung['white-2'].id);
    expect(res.body.promotionEvent.fromStripeTierId).toBeNull();
  });
});
