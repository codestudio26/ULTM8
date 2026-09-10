/**
 * HTTP-level gate for RanksModule (Phase 10b) — Discipline/Rank/Skill CRUD, the
 * ranksToggle write-gate, the full first-promotion/second-promotion/stripe-award
 * grading flow, the required-skill-acknowledgment gate, skill sign-off cycling,
 * and the Branch-Staff-via-target-context RLS fix (the same class of bug Phase 9
 * found for GET /students/{id}/membership-status, applied proactively here).
 * Same ground rule as every other e2e spec in this repo: prove over real HTTP,
 * not just by reading the code.
 *
 * Also includes ONE direct-Prisma RLS test (not HTTP), mirroring
 * memberships.e2e-spec.ts's own — StudentRank/PromotionEvent deliberately reuse
 * Phase 9's narrow "School Owner/Manager or the row's own Student" RLS shape.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[ranks.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('RanksModule — HTTP-level CRUD, grading flow, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let branchStaff: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let tokenOwner: string;
  let tokenBranchStaff: string;
  let tokenStudentA: string;
  let tokenStudentB: string;

  const disciplineIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Ranks HTTP School', ranksToggle: true } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `ranks-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    owner = await mkUser('owner');
    branchStaff = await mkUser('branch-staff');
    studentA = await mkUser('student-a');
    studentB = await mkUser('student-b');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaff.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenBranchStaff = signAccessToken(branchStaff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
  });

  afterAll(async () => {
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankRequiredSkill.deleteMany({ where: { rank: { schoolId: school.id } } });
    await superuser.skill.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { id: { in: disciplineIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'ranks-http-' } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  let disciplineId: string;
  let whiteBeltRankId: string;
  let blueBeltRankId: string;
  let requiredSkillId: string;

  // ---------------------------------------------------------------------------
  // Discipline/Rank/Skill CRUD + ranksToggle gate
  // ---------------------------------------------------------------------------

  it('School Owner CAN create a Discipline; a Student cannot', async () => {
    const forbidden = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/disciplines`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ name: 'Denied' });
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/disciplines`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Jiu Jitsu', classTypesOffered: ['Kids Fundamentals', 'Adult Sparring'] });
    expect(res.status).toBe(201);
    disciplineId = res.body.id;
    disciplineIds.push(disciplineId);
  });

  it('ranksToggle=false blocks WRITES (403) but not reads', async () => {
    await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: false } });

    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/disciplines`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Should Be Blocked' });
    expect(createRes.status).toBe(403);

    const readRes = await request(app.getHttpServer())
      .get(`/v1/disciplines/${disciplineId}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(readRes.status).toBe(200);

    await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: true } });
  });

  it('School Owner CAN create a Rank with stripe tiers and required Skills', async () => {
    const skillRes = await request(app.getHttpServer())
      .post(`/v1/styles/${disciplineId}/skills`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Forward Roll', description: 'Basic breakfall.' });
    expect(skillRes.status).toBe(201);
    requiredSkillId = skillRes.body.id;

    const whiteBeltRes = await request(app.getHttpServer())
      .post(`/v1/styles/${disciplineId}/ranks`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        order: 0,
        primaryColour: 'White',
        stripeTiers: [
          { order: 0, count: 0, colour: 'White' },
          { order: 1, count: 1, colour: 'White' },
        ],
        requiredSkillIds: [requiredSkillId],
      });
    expect(whiteBeltRes.status).toBe(201);
    whiteBeltRankId = whiteBeltRes.body.id;
    // FOUND ON REVIEW (Phase 21): the response body itself was never
    // asserted on here before — only the status code — which is exactly how
    // RanksService.createRank() shipped for phases returning a bare `Rank`
    // row with no `stripeTiers`/`requiredSkillIds` populated at all (Prisma
    // doesn't include relations unless asked), silently violating
    // RankResponseDto's own declared shape until school-portal's Rank
    // management screen became the first real client to actually read these
    // fields. Asserted directly now so a regression can't ship unnoticed a
    // second time.
    expect(whiteBeltRes.body.stripeTiers).toHaveLength(2);
    expect(whiteBeltRes.body.requiredSkillIds).toEqual([requiredSkillId]);

    const blueBeltRes = await request(app.getHttpServer())
      .post(`/v1/styles/${disciplineId}/ranks`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ order: 1, primaryColour: 'Blue', stripeTiers: [{ order: 0, count: 0, colour: 'Blue' }] });
    expect(blueBeltRes.status).toBe(201);
    blueBeltRankId = blueBeltRes.body.id;
  });

  it('a non-contiguous Rank order is rejected — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/styles/${disciplineId}/ranks`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ order: 5, primaryColour: 'Purple', stripeTiers: [{ order: 0, count: 0, colour: 'Purple' }] });
    expect(res.status).toBe(400);
  });

  it('GET /styles/:disciplineId/ranks and GET /ranks/:id both return the full shape — requiredSkillIds as a flat array, not the raw requiredSkills join rows', async () => {
    const listRes = await request(app.getHttpServer())
      .get(`/v1/styles/${disciplineId}/ranks`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(listRes.status).toBe(200);
    const whiteBelt = listRes.body.items.find((r: { id: string }) => r.id === whiteBeltRankId);
    expect(whiteBelt.requiredSkillIds).toEqual([requiredSkillId]);
    expect(whiteBelt.stripeTiers).toHaveLength(2);
    expect(whiteBelt.requiredSkills).toBeUndefined(); // the raw Prisma relation must not leak onto the wire

    const oneRes = await request(app.getHttpServer())
      .get(`/v1/ranks/${whiteBeltRankId}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(oneRes.status).toBe(200);
    expect(oneRes.body.requiredSkillIds).toEqual([requiredSkillId]);
    expect(oneRes.body.stripeTiers).toHaveLength(2);
  });

  it('PATCH clears secondaryColour/weeklyClassCountCap with explicit null; omitted fields stay unchanged', async () => {
    const setRes = await request(app.getHttpServer())
      .patch(`/v1/ranks/${blueBeltRankId}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ secondaryColour: 'Black', weeklyClassCountCap: 3 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.secondaryColour).toBe('Black');
    expect(setRes.body.weeklyClassCountCap).toBe(3);

    const clearRes = await request(app.getHttpServer())
      .patch(`/v1/ranks/${blueBeltRankId}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ secondaryColour: null, weeklyClassCountCap: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.secondaryColour).toBeNull();
    expect(clearRes.body.weeklyClassCountCap).toBeNull();
    expect(clearRes.body.primaryColour).toBe('Blue'); // untouched field survives
  });

  it('PATCH stripeTiers at unchanged order positions preserves each tier\'s stable id (StudentRank.currentStripeId FK safety) — only genuinely removed positions get deleted', async () => {
    // Deliberately exercised against blueBeltRankId, not whiteBeltRankId —
    // whiteBeltRankId's own 2 stripe tiers are still needed, unmodified, by
    // the later "stripe-award moves to the next tier" grading test below.
    const grow = await request(app.getHttpServer())
      .patch(`/v1/ranks/${blueBeltRankId}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        stripeTiers: [
          { order: 0, count: 0, colour: 'Blue' },
          { order: 1, count: 1, colour: 'Blue' },
        ],
      });
    expect(grow.status).toBe(200);
    const [tier0Before, tier1Before] = grow.body.stripeTiers;
    expect(tier0Before.order).toBe(0);
    expect(tier1Before.order).toBe(1);

    // Same two positions (order 0 and 1), only tier 1's `count` changes —
    // both tiers' own stable ids must survive this PATCH.
    const patchRes = await request(app.getHttpServer())
      .patch(`/v1/ranks/${blueBeltRankId}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        stripeTiers: [
          { order: 0, count: 0, colour: 'Blue' },
          { order: 1, count: 5, colour: 'Blue' },
        ],
      });
    expect(patchRes.status).toBe(200);
    const [tier0After, tier1After] = patchRes.body.stripeTiers;
    expect(tier0After.id).toBe(tier0Before.id);
    expect(tier1After.id).toBe(tier1Before.id);
    expect(tier1After.count).toBe(5);

    // Now genuinely remove the last position (order 1) — only that tier's
    // row should be gone; the first tier's id must still survive.
    const shrinkRes = await request(app.getHttpServer())
      .patch(`/v1/ranks/${blueBeltRankId}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ stripeTiers: [{ order: 0, count: 0, colour: 'Blue' }] });
    expect(shrinkRes.status).toBe(200);
    expect(shrinkRes.body.stripeTiers).toHaveLength(1);
    expect(shrinkRes.body.stripeTiers[0].id).toBe(tier0Before.id);
  });

  // ---------------------------------------------------------------------------
  // Grading flow
  // ---------------------------------------------------------------------------

  it('first promote() creates StudentRank at the Discipline\'s first Rank; a Student cannot promote themselves', async () => {
    const forbidden = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.studentRank.currentRankId).toBe(whiteBeltRankId);
    expect(res.body.promotionEvent.fromRankId).toBeNull();
    expect(res.body.promotionEvent.toRankId).toBe(whiteBeltRankId);
  });

  it('a required-skill-unsigned promotion is rejected without acknowledgment, accepted with it', async () => {
    const rejected = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({});
    expect(rejected.status).toBe(400);

    const accepted = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ acknowledgeWithoutSkillSignoff: true });
    expect(accepted.status).toBe(201);
    expect(accepted.body.studentRank.currentRankId).toBe(blueBeltRankId);
    expect(accepted.body.promotionEvent.acknowledgedWithoutSkillSignoff).toBe(true);
  });

  it('promoting past the highest Rank is rejected — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ acknowledgeWithoutSkillSignoff: true });
    expect(res.status).toBe(400);
  });

  it('stripe-award moves to the next tier and resets classesAttendedTowardCheckpoint', async () => {
    // studentB starts fresh at White belt (2 stripe tiers: 0 and 1).
    const promoteRes = await request(app.getHttpServer())
      .post(`/v1/students/${studentB.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({});
    expect(promoteRes.status).toBe(201);

    const awardRes = await request(app.getHttpServer())
      .post(`/v1/students/${studentB.id}/ranks/${disciplineId}/stripe-award`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ acknowledgeWithoutSkillSignoff: true });
    expect(awardRes.status).toBe(201);
    expect(awardRes.body.studentRank.classesAttendedTowardCheckpoint).toBe(0);
    expect(awardRes.body.promotionEvent.type).toBe('STRIPE_AWARD');
    expect(awardRes.body.promotionEvent.toRankId).toBe(awardRes.body.promotionEvent.fromRankId); // rank unchanged

    // Already at White's highest tier (order 1) now — a second award must reject.
    const secondAwardRes = await request(app.getHttpServer())
      .post(`/v1/students/${studentB.id}/ranks/${disciplineId}/stripe-award`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ acknowledgeWithoutSkillSignoff: true });
    expect(secondAwardRes.status).toBe(400);
  });

  it('skill sign-off cycles NOT_STARTED -> LEARNING -> SIGNED_OFF -> NOT_STARTED', async () => {
    const first = await request(app.getHttpServer())
      .patch(`/v1/students/${studentB.id}/skills/${requiredSkillId}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('LEARNING');

    const second = await request(app.getHttpServer())
      .patch(`/v1/students/${studentB.id}/skills/${requiredSkillId}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(second.body.status).toBe('SIGNED_OFF');

    const third = await request(app.getHttpServer())
      .patch(`/v1/students/${studentB.id}/skills/${requiredSkillId}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(third.body.status).toBe('NOT_STARTED');
  });

  // ---------------------------------------------------------------------------
  // Staff-via-target-context read fix (Phase 9's own membership-status lesson,
  // applied proactively here rather than found on a second pass).
  // ---------------------------------------------------------------------------

  it('Branch Staff CAN read a Student\'s ranks/eligibility/rank-history (staff-via-target-context, not RLS-broadened)', async () => {
    const ranksRes = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/ranks`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenBranchStaff}`);
    expect(ranksRes.status).toBe(200);
    expect(ranksRes.body.items.length).toBeGreaterThan(0);

    const historyRes = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/rank-history`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenBranchStaff}`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.items.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // RLS — StudentRank/PromotionEvent deliberately reuse Phase 9's narrow shape.
  // Direct Prisma, not HTTP — same reasoning memberships.e2e-spec.ts documents.
  // ---------------------------------------------------------------------------

  it('RLS: Student B cannot read Student A\'s StudentRank/PromotionEvent rows, even sharing a School', async () => {
    const asStudentB = await withUser(studentB.id, (tx) => tx.studentRank.findMany({ where: { studentId: studentA.id } }));
    expect(asStudentB).toHaveLength(0);

    const asStudentBEvents = await withUser(studentB.id, (tx) => tx.promotionEvent.findMany({ where: { studentId: studentA.id } }));
    expect(asStudentBEvents).toHaveLength(0);

    const asOwner = await withUser(owner.id, (tx) => tx.studentRank.findMany({ where: { studentId: studentA.id } }));
    expect(asOwner.length).toBeGreaterThan(0);
  });

  it('RLS: Branch Staff gets zero raw StudentRank row access — same shape as Membership/Transaction (Phase 9)', async () => {
    const asBranchStaff = await withUser(branchStaff.id, (tx) => tx.studentRank.findMany({ where: { schoolId: school.id } }));
    expect(asBranchStaff).toHaveLength(0);
  });

  it('RLS: Discipline/Rank (catalog data) IS broadly readable by Branch Staff', async () => {
    const asBranchStaff = await withUser(branchStaff.id, (tx) => tx.discipline.findMany({ where: { id: disciplineId } }));
    expect(asBranchStaff.length).toBeGreaterThan(0);
  });
});
