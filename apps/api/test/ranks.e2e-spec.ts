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
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
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
    await superuser.guardianLink.deleteMany({ where: { guardian: { email: { contains: 'ranks-http-' } } } });
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

  // ---------------------------------------------------------------------------
  // Phase 1 / PR 1 (grading foundation) — gates and tests the original phase
  // left out. Decision 87 (ranksToggle gates grading writes), Decision 110
  // (closed Schools accept no writes), Decision 132 (Guardian read access),
  // plus the downgrade and concurrent-grading paths that had no test.
  // ---------------------------------------------------------------------------

  async function mkExtraUser(label: string) {
    return superuser.user.create({
      data: {
        id: randomUUID(),
        email: `ranks-http-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('1985-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  }

  it('ranksToggle=false blocks every grading WRITE (promote, downgrade, stripe-award, skill sign-off) but not grading reads — Decision 87', async () => {
    const eventsBefore = await superuser.promotionEvent.count({ where: { schoolId: school.id } });
    const statusesBefore = await superuser.studentRankSkillStatus.findMany({ where: { schoolId: school.id }, select: { id: true, status: true } });
    await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: false } });
    try {
      const writes = [
        request(app.getHttpServer()).post(`/v1/students/${studentB.id}/ranks/${disciplineId}/promote`).set('Authorization', `Bearer ${tokenOwner}`).send({ acknowledgeWithoutSkillSignoff: true }),
        request(app.getHttpServer()).post(`/v1/students/${studentA.id}/ranks/${disciplineId}/downgrade`).set('Authorization', `Bearer ${tokenOwner}`).send({ reason: 'Test downgrade' }),
        request(app.getHttpServer()).post(`/v1/students/${studentB.id}/ranks/${disciplineId}/stripe-award`).set('Authorization', `Bearer ${tokenOwner}`).send({ acknowledgeWithoutSkillSignoff: true }),
        request(app.getHttpServer()).patch(`/v1/students/${studentB.id}/skills/${requiredSkillId}`).set('Authorization', `Bearer ${tokenOwner}`),
      ];
      for (const res of await Promise.all(writes)) {
        expect(res.status).toBe(403);
      }

      const read = await request(app.getHttpServer())
        .get(`/v1/students/${studentA.id}/rank-history`)
        .query({ schoolId: school.id })
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(read.status).toBe(200);

      // Nothing was written while the gate was closed: no grading event of any
      // type, and no skill sign-off change.
      expect(await superuser.promotionEvent.count({ where: { schoolId: school.id } })).toBe(eventsBefore);
      expect(await superuser.studentRankSkillStatus.findMany({ where: { schoolId: school.id }, select: { id: true, status: true } })).toEqual(statusesBefore);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: true } });
    }
  });

  it('a closed (archived) School blocks every grading WRITE but not grading reads — Decision 110', async () => {
    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
    try {
      const writes = [
        request(app.getHttpServer()).post(`/v1/students/${studentB.id}/ranks/${disciplineId}/promote`).set('Authorization', `Bearer ${tokenOwner}`).send({ acknowledgeWithoutSkillSignoff: true }),
        request(app.getHttpServer()).post(`/v1/students/${studentA.id}/ranks/${disciplineId}/downgrade`).set('Authorization', `Bearer ${tokenOwner}`).send({ reason: 'Test downgrade' }),
        request(app.getHttpServer()).post(`/v1/students/${studentB.id}/ranks/${disciplineId}/stripe-award`).set('Authorization', `Bearer ${tokenOwner}`).send({ acknowledgeWithoutSkillSignoff: true }),
        request(app.getHttpServer()).patch(`/v1/students/${studentB.id}/skills/${requiredSkillId}`).set('Authorization', `Bearer ${tokenOwner}`),
      ];
      for (const res of await Promise.all(writes)) {
        expect(res.status).toBe(403);
      }

      const read = await request(app.getHttpServer())
        .get(`/v1/students/${studentA.id}/ranks`)
        .query({ schoolId: school.id })
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(read.status).toBe(200);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
    }
  });

  it('downgrade moves one Rank down, records a DOWNGRADE event, and is rejected at the lowest Rank, for a Student with no rank, and for a Student acting on themselves', async () => {
    // studentA is at Blue (the top Rank) after the promotion tests above.
    const selfDowngrade = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/downgrade`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ reason: 'Test downgrade' });
    expect(selfDowngrade.status).toBe(403);

    // A written reason is required (Decision 128, item 11).
    for (const body of [{}, { reason: '' }, { reason: '   ' }]) {
      const noReason = await request(app.getHttpServer())
        .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/downgrade`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send(body);
      expect({ body, status: noReason.status }).toEqual({ body, status: 400 });
    }

    const res = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/downgrade`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ reason: 'Test downgrade' });
    expect(res.status).toBe(201);
    expect(res.body.studentRank.currentRankId).toBe(whiteBeltRankId);
    expect(res.body.studentRank.classesAttendedTowardCheckpoint).toBe(0);
    expect(res.body.promotionEvent.type).toBe('DOWNGRADE');
    expect(res.body.promotionEvent.reason).toBe('Test downgrade');
    expect(res.body.promotionEvent.fromRankId).toBe(blueBeltRankId);
    expect(res.body.promotionEvent.toRankId).toBe(whiteBeltRankId);

    const belowLowest = await request(app.getHttpServer())
      .post(`/v1/students/${studentA.id}/ranks/${disciplineId}/downgrade`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ reason: 'Test downgrade' });
    expect(belowLowest.status).toBe(400);

    const unranked = await mkExtraUser('unranked');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: unranked.id, schoolId: school.id } });
    const noRank = await request(app.getHttpServer())
      .post(`/v1/students/${unranked.id}/ranks/${disciplineId}/downgrade`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ reason: 'Test downgrade' });
    expect(noRank.status).toBe(400);
  });

  it('two concurrent grading actions on the same Student: exactly one succeeds, the other is refused (409, or 400 if it ran second)', async () => {
    const racer = await mkExtraUser('racer');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: racer.id, schoolId: school.id } });

    const first = await request(app.getHttpServer())
      .post(`/v1/students/${racer.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({});
    expect(first.status).toBe(201); // White Belt, tier 0 of 2

    // Only one more stripe exists on White Belt, so at most one award can win.
    const award = () =>
      request(app.getHttpServer())
        .post(`/v1/students/${racer.id}/ranks/${disciplineId}/stripe-award`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ acknowledgeWithoutSkillSignoff: true });
    const results = await Promise.all([award(), award()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect([400, 409]).toContain(statuses.find((s) => s !== 201));

    const awards = await superuser.promotionEvent.count({ where: { studentId: racer.id, type: 'STRIPE_AWARD' } });
    expect(awards).toBe(1);
  });

  it('an active Guardian CAN read a linked Student\'s ranks, eligibility and rank history, but cannot grade them — Decision 132', async () => {
    const guardian = await mkExtraUser('guardian');
    const minor = await superuser.user.update({
      where: { id: (await mkExtraUser('minor')).id },
      data: { dateOfBirth: new Date('2016-05-01'), phoneVerifiedAt: null },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: minor.id, schoolId: school.id } });
    const graded = await request(app.getHttpServer())
      .post(`/v1/students/${minor.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({});
    expect(graded.status).toBe(201);
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: minor.id } });
    const tokenGuardian = signAccessToken(guardian, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);

    for (const path of ['ranks', 'eligibility', 'rank-history']) {
      const res = await request(app.getHttpServer())
        .get(`/v1/students/${minor.id}/${path}`)
        .query({ schoolId: school.id })
        .set('Authorization', `Bearer ${tokenGuardian}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    }

    const grade = await request(app.getHttpServer())
      .post(`/v1/students/${minor.id}/ranks/${disciplineId}/promote`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ acknowledgeWithoutSkillSignoff: true });
    // Refused before any write. 404, not 403: a Guardian holds no RoleGrant at
    // the School, so Discipline's RLS hides the row from them and the lookup in
    // gradeRankChange() 404s first, the repo's documented "RLS-blocked and
    // missing are indistinguishable" convention (TenantAuthorizationService).
    expect(grade.status).toBe(404);
    const guardianEvents = await superuser.promotionEvent.count({ where: { performedById: guardian.id } });
    expect(guardianEvents).toBe(0);

    // The Guardian link grants nothing for a Student they are not linked to.
    const other = await request(app.getHttpServer())
      .get(`/v1/students/${studentB.id}/ranks`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenGuardian}`);
    expect(other.status).toBe(403);
  });

  it('a revoked Guardian link, or no link at all, gives no read access', async () => {
    const revoked = await mkExtraUser('revoked-guardian');
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: revoked.id, studentId: studentA.id, revokedAt: new Date() } });
    const tokenRevoked = signAccessToken(revoked, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);
    const revokedRes = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/ranks`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenRevoked}`);
    expect(revokedRes.status).toBe(403);

    const outsider = await mkExtraUser('outsider');
    const tokenOutsider = signAccessToken(outsider, []);
    const outsiderRes = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/rank-history`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenOutsider}`);
    expect(outsiderRes.status).toBe(403);

    // Student B (same School, no link) is still refused, as before.
    const peer = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/ranks`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(peer.status).toBe(403);
  });

  it('grading reads require a valid schoolId: staff at another School cannot read a Student across tenants (independent review, PR 1)', async () => {
    const otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Ranks HTTP Other School', ranksToggle: true } });
    const otherOwner = await mkExtraUser('other-owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: otherSchool.id } });
    const tokenOtherOwner = signAccessToken(otherOwner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: otherSchool.id, branchId: null }]);
    try {
      for (const path of ['ranks', 'eligibility', 'rank-history']) {
        // No schoolId: previously matched ANY staff grant and returned the
        // Student's rows from every School (200 with data). Now refused.
        const noSchool = await request(app.getHttpServer())
          .get(`/v1/students/${studentA.id}/${path}`)
          .set('Authorization', `Bearer ${tokenOtherOwner}`);
        expect(noSchool.status).toBe(400);

        // The Student's real School: the other School's owner holds no grant there.
        const wrongSchool = await request(app.getHttpServer())
          .get(`/v1/students/${studentA.id}/${path}`)
          .query({ schoolId: school.id })
          .set('Authorization', `Bearer ${tokenOtherOwner}`);
        expect(wrongSchool.status).toBe(403);
        expect(wrongSchool.body.error.message).not.toMatch(/Guardian/);
      }

      const malformed = await request(app.getHttpServer())
        .get(`/v1/students/${studentA.id}/ranks`)
        .query({ schoolId: 'not-a-uuid' })
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(malformed.status).toBe(400);

      // The Student themselves must name a School too.
      const selfNoSchool = await request(app.getHttpServer())
        .get(`/v1/students/${studentA.id}/ranks`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(selfNoSchool.status).toBe(400);
    } finally {
      await superuser.roleGrant.deleteMany({ where: { schoolId: otherSchool.id } });
      await superuser.school.delete({ where: { id: otherSchool.id } });
    }
  });

  it('an impersonation session scoped to another School cannot read grading at this School (Decision 102 / Spec 55 Decision 39)', async () => {
    const elsewhere = randomUUID();
    const scopedElsewhere = jwt.sign({
      sub: studentA.id,
      email: studentA.email,
      grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }],
      impersonation: { adminUserId: randomUUID(), startedAt: new Date().toISOString(), schoolId: elsewhere },
    });
    const refused = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/ranks`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${scopedElsewhere}`);
    expect(refused.status).toBe(403);

    const scopedHere = jwt.sign({
      sub: studentA.id,
      email: studentA.email,
      grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }],
      impersonation: { adminUserId: randomUUID(), startedAt: new Date().toISOString(), schoolId: school.id },
    });
    const allowed = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/ranks`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${scopedHere}`);
    expect(allowed.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Phase 1 / PR 2 (grading foundation) — per-rung ladder fields
  // (Decisions 126, 128): belt name and drawing fields; rung name, mixed stripe
  // segments, weekly cap, time-in-rank-only switch and required Skills.
  // Uses its own Discipline so the grading-flow tests above are unaffected.
  // ---------------------------------------------------------------------------

  describe('per-rung ladder fields (grading foundation PR 2)', () => {
    let ladderDisciplineId: string;
    let otherDisciplineId: string;
    let skillRnc: string;
    let skillSweep: string;
    let foreignSkill: string;

    beforeAll(async () => {
      const mkDiscipline = async (name: string) => {
        const res = await request(app.getHttpServer())
          .post(`/v1/schools/${school.id}/disciplines`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({ name });
        expect(res.status).toBe(201);
        disciplineIds.push(res.body.id);
        return res.body.id as string;
      };
      const mkSkill = async (discipline: string, name: string) => {
        const res = await request(app.getHttpServer())
          .post(`/v1/styles/${discipline}/skills`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({ name });
        expect(res.status).toBe(201);
        return res.body.id as string;
      };
      ladderDisciplineId = await mkDiscipline('Ladder Fields BJJ');
      otherDisciplineId = await mkDiscipline('Ladder Fields Judo');
      skillRnc = await mkSkill(ladderDisciplineId, 'Rear Naked Choke');
      skillSweep = await mkSkill(ladderDisciplineId, 'Scissor Sweep');
      foreignSkill = await mkSkill(otherDisciplineId, 'Osoto Gari');
    });

    it('creates a belt with a name and drawing fields, and rungs with every per-rung setting', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          order: 0,
          name: 'Grey/White Belt',
          primaryColour: '#9CA3AF',
          secondaryColour: '#FFFFFF',
          tagColour: '#17181A',
          stripeTiers: [
            { order: 0, count: 0, colour: '#FFFFFF', classesRequired: 8, minimumDaysInRank: 36, eligibleClassTypes: ['Kids Fundamentals'] },
            {
              order: 1,
              name: 'Grey/White Belt · 3 Yellow + 1 Red',
              count: 4,
              colour: '#F0C419',
              stripeSegments: [{ count: 3, colour: '#F0C419' }, { count: 1, colour: '#C23B3B' }],
              classesRequired: 8,
              minimumDaysInRank: 36,
              weeklyClassCountCap: 3,
              requiredSkillIds: [skillRnc, skillSweep],
            },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Grey/White Belt');
      expect(res.body.tagColour).toBe('#17181A');
      expect(res.body.coralAccent).toBeNull();

      const [plain, mixed] = res.body.stripeTiers;
      // Omitted name -> generated from the belt name; omitted segments -> none for 0 stripes.
      expect(plain.name).toBe('Grey/White Belt');
      expect(plain.stripeSegments).toEqual([]);
      expect(plain.timeOnly).toBe(false);
      expect(plain.weeklyClassCountCap).toBeNull();
      expect(plain.requiredSkillIds).toEqual([]);

      expect(mixed.name).toBe('Grey/White Belt · 3 Yellow + 1 Red');
      expect(mixed.stripeSegments).toEqual([{ count: 3, colour: '#F0C419' }, { count: 1, colour: '#C23B3B' }]);
      expect(mixed.weeklyClassCountCap).toBe(3);
      expect([...mixed.requiredSkillIds].sort()).toEqual([skillRnc, skillSweep].sort());

      // Persisted, not just echoed: GET returns the same per-rung fields.
      const ladder = await request(app.getHttpServer())
        .get(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(ladder.status).toBe(200);
      expect(ladder.body.items[0].stripeTiers[1].stripeSegments).toHaveLength(2);
      expect([...ladder.body.items[0].stripeTiers[1].requiredSkillIds].sort()).toEqual([skillRnc, skillSweep].sort());
    });

    it('generates belt and rung names when omitted, and a time-in-rank-only rung keeps its years in minimumDaysInRank', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          order: 1,
          primaryColour: '#17181A',
          stripeTiers: [
            { order: 0, count: 0, colour: '#FFFFFF', minimumDaysInRank: 1095, timeOnly: true },
            { order: 1, count: 1, colour: '#FFFFFF', minimumDaysInRank: 1095, timeOnly: true },
            { order: 2, count: 2, colour: '#FFFFFF', minimumDaysInRank: 1095, timeOnly: true },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Belt 2');
      expect(res.body.stripeTiers.map((t: { name: string }) => t.name)).toEqual(['Belt 2', 'Belt 2 · 1 Stripe', 'Belt 2 · 2 Stripes']);
      expect(res.body.stripeTiers[2].stripeSegments).toEqual([{ count: 2, colour: '#FFFFFF' }]);
      expect(res.body.stripeTiers.every((t: { timeOnly: boolean; minimumDaysInRank: number }) => t.timeOnly && t.minimumDaysInRank === 1095)).toBe(true);
    });

    it('rejects stripe segments that do not add up to the stripe count — 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          order: 2,
          primaryColour: '#3B5FCB',
          stripeTiers: [{ order: 0, count: 4, colour: '#FFFFFF', stripeSegments: [{ count: 3, colour: '#FFFFFF' }] }],
        });
      expect(res.status).toBe(400);
    });

    it('rejects a rung requiring a Skill from another Discipline — 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          order: 2,
          primaryColour: '#3B5FCB',
          stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF', requiredSkillIds: [foreignSkill] }],
        });
      expect(res.status).toBe(400);
    });

    it('PATCH: renames the belt, clears a drawing field, replaces a rung\'s Skills when sent, keeps them when omitted, and keeps rung ids', async () => {
      const ladder = await request(app.getHttpServer())
        .get(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      const greyWhite = ladder.body.items[0];
      const [tier0, tier1] = greyWhite.stripeTiers;

      // Send rung 0 with a new Skill list, rung 1 without one.
      const res = await request(app.getHttpServer())
        .patch(`/v1/ranks/${greyWhite.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          name: 'Grey & White Belt',
          tagColour: null,
          stripeTiers: [
            { order: 0, count: 0, colour: '#FFFFFF', requiredSkillIds: [skillSweep] },
            { order: 1, count: 4, colour: '#F0C419', stripeSegments: [{ count: 3, colour: '#F0C419' }, { count: 1, colour: '#C23B3B' }] },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Grey & White Belt');
      expect(res.body.tagColour).toBeNull();

      const [after0, after1] = res.body.stripeTiers;
      expect(after0.id).toBe(tier0.id);
      expect(after1.id).toBe(tier1.id);
      expect(after0.requiredSkillIds).toEqual([skillSweep]);
      expect([...after1.requiredSkillIds].sort()).toEqual([skillRnc, skillSweep].sort());
      // An omitted generated name follows the new belt name; an omitted
      // custom name is kept (independent review, PR 2).
      expect(after0.name).toBe('Grey & White Belt');
      expect(after1.name).toBe('Grey/White Belt · 3 Yellow + 1 Red');
    });

    it('PATCH with exactly what the school portal\'s RankFormModal sends keeps custom rung names, mixed stripes, timeOnly and rung Skills (independent review, PR 2)', async () => {
      const ladder = await request(app.getHttpServer())
        .get(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      const [greyWhite, belt2] = ladder.body.items;

      // Same shape as RankFormModal.handleSubmit: no name, stripeSegments,
      // timeOnly or per-rung requiredSkillIds.
      type Tier = { order: number; count: number; colour: string; classesRequired: number | null; minimumDaysInRank: number | null; eligibleClassTypes: string[] };
      const portalPayload = (rank: { primaryColour: string; stripeTiers: Tier[] }) => ({
        primaryColour: rank.primaryColour,
        secondaryColour: null,
        weeklyClassCountCap: null,
        yearsInRankFlag: false,
        stripeTiers: rank.stripeTiers.map((t) => ({
          order: t.order,
          count: t.count,
          colour: t.colour,
          classesRequired: t.classesRequired ?? undefined,
          minimumDaysInRank: t.minimumDaysInRank ?? undefined,
          eligibleClassTypes: t.eligibleClassTypes,
        })),
        requiredSkillIds: [],
      });

      const res = await request(app.getHttpServer())
        .patch(`/v1/ranks/${greyWhite.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send(portalPayload(greyWhite));
      expect(res.status).toBe(200);
      const mixed = res.body.stripeTiers[1];
      expect(mixed.name).toBe('Grey/White Belt · 3 Yellow + 1 Red');
      expect(mixed.stripeSegments).toEqual([{ count: 3, colour: '#F0C419' }, { count: 1, colour: '#C23B3B' }]);
      expect([...mixed.requiredSkillIds].sort()).toEqual([skillRnc, skillSweep].sort());
      expect(res.body.stripeTiers[0].requiredSkillIds).toEqual([skillSweep]);

      const res2 = await request(app.getHttpServer())
        .patch(`/v1/ranks/${belt2.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send(portalPayload(belt2));
      expect(res2.status).toBe(200);
      expect(res2.body.stripeTiers.map((t: { timeOnly: boolean }) => t.timeOnly)).toEqual([true, true, true]);
      expect(res2.body.stripeTiers.map((t: { name: string }) => t.name)).toEqual(['Belt 2', 'Belt 2 · 1 Stripe', 'Belt 2 · 2 Stripes']);

      // Changing a rung's stripe count without sending segments redraws it as
      // one run of the new count (the old segments no longer add up).
      const changed = portalPayload(greyWhite);
      changed.stripeTiers[1].count = 2;
      const res3 = await request(app.getHttpServer())
        .patch(`/v1/ranks/${greyWhite.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send(changed);
      expect(res3.status).toBe(200);
      expect(res3.body.stripeTiers[1].stripeSegments).toEqual([{ count: 2, colour: '#F0C419' }]);
      expect(res3.body.stripeTiers[1].name).toBe('Grey/White Belt · 3 Yellow + 1 Red');
    });

    it('PATCH renaming a belt without sending rungs renames generated rung names and keeps custom ones (independent review, PR 2)', async () => {
      const ladder = await request(app.getHttpServer())
        .get(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      const [greyWhite, belt2] = ladder.body.items;

      const res = await request(app.getHttpServer())
        .patch(`/v1/ranks/${belt2.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Black Belt' });
      expect(res.status).toBe(200);
      expect(res.body.stripeTiers.map((t: { name: string }) => t.name)).toEqual(['Black Belt', 'Black Belt · 1 Stripe', 'Black Belt · 2 Stripes']);

      const res2 = await request(app.getHttpServer())
        .patch(`/v1/ranks/${greyWhite.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Grey Belt' });
      expect(res2.status).toBe(200);
      expect(res2.body.stripeTiers.map((t: { name: string }) => t.name)).toEqual(['Grey Belt', 'Grey/White Belt · 3 Yellow + 1 Red']);
    });

    it('refuses null, empty names and duplicate rung Skills with 400, not 500/409, and changes nothing (independent review, PR 2)', async () => {
      const ladder = await request(app.getHttpServer())
        .get(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      const greyWhite = ladder.body.items[0];
      const tiers = [
        { order: 0, count: 0, colour: '#FFFFFF' },
        { order: 1, count: 2, colour: '#F0C419' },
      ];
      const bad: Record<string, unknown>[] = [
        { name: null },
        { name: '' },
        { requiredSkillIds: null },
        { stripeTiers: null },
        { stripeTiers: [tiers[0], { ...tiers[1], requiredSkillIds: null }] },
        { stripeTiers: [tiers[0], { ...tiers[1], requiredSkillIds: [skillRnc, skillRnc] }] },
        { stripeTiers: [tiers[0], { ...tiers[1], name: '' }] },
      ];
      for (const body of bad) {
        const res = await request(app.getHttpServer())
          .patch(`/v1/ranks/${greyWhite.id}`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send(body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      const created = await request(app.getHttpServer())
        .post(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ order: 2, name: '', primaryColour: '#3B5FCB', stripeTiers: [tiers[0]] });
      expect(created.status).toBe(400);

      const after = await request(app.getHttpServer())
        .get(`/v1/styles/${ladderDisciplineId}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(after.body.items).toEqual(ladder.body.items);
    });

    it('Decision 165: a rung\'s colour follows the first stripe in its list; a colour-only edit repaints a one-colour rung and is refused on a mixed one', async () => {
      const disc = await request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/disciplines`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Rung Colour BJJ' });
      expect(disc.status).toBe(201);
      disciplineIds.push(disc.body.id);
      const YELLOW = '#F0C419';
      const RED = '#C23B3B';
      const WHITE = '#FFFFFF';

      // The prototype's "1 Yellow Stripe" rung: 1 yellow then 3 red. The
      // colour sent (white) disagrees and is ignored: the list wins.
      const created = await request(app.getHttpServer())
        .post(`/v1/styles/${disc.body.id}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          order: 0,
          name: 'Grey/White Belt',
          primaryColour: '#9CA3AF',
          stripeTiers: [
            { order: 0, count: 0, colour: WHITE },
            { order: 1, count: 4, colour: WHITE, stripeSegments: [{ count: 1, colour: YELLOW }, { count: 3, colour: RED }] },
            { order: 2, count: 2, colour: RED },
          ],
        });
      expect(created.status).toBe(201);
      const [plain, mixed, oneColour] = created.body.stripeTiers;
      expect(plain.colour).toBe(WHITE); // no stripes: kept as entered
      expect(mixed.colour).toBe(YELLOW); // first stripe, not the majority (red)
      expect(oneColour.colour).toBe(RED);
      expect(oneColour.stripeSegments).toEqual([{ count: 2, colour: RED }]);

      const tiersAsSent = (overrides: Record<number, { colour: string }>) =>
        created.body.stripeTiers.map((t: { order: number; count: number; colour: string }) => ({
          order: t.order,
          count: t.count,
          colour: overrides[t.order]?.colour ?? t.colour,
        }));

      // Round-tripping what was read (as the school portal form does) keeps everything.
      const roundTrip = await request(app.getHttpServer())
        .patch(`/v1/ranks/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ stripeTiers: tiersAsSent({}) });
      expect(roundTrip.status).toBe(200);
      expect(roundTrip.body.stripeTiers[1].stripeSegments).toEqual([{ count: 1, colour: YELLOW }, { count: 3, colour: RED }]);
      expect(roundTrip.body.stripeTiers[1].colour).toBe(YELLOW);

      // Colour-only edit of a mixed rung: refused, nothing changes.
      const refused = await request(app.getHttpServer())
        .patch(`/v1/ranks/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ stripeTiers: tiersAsSent({ 1: { colour: RED } }) });
      expect(refused.status).toBe(400);
      const unchanged = await request(app.getHttpServer())
        .get(`/v1/ranks/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(unchanged.body.stripeTiers).toEqual(roundTrip.body.stripeTiers);

      // Colour-only edit of a one-colour rung repaints its stripes.
      const repainted = await request(app.getHttpServer())
        .patch(`/v1/ranks/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ stripeTiers: tiersAsSent({ 2: { colour: YELLOW } }) });
      expect(repainted.status).toBe(200);
      expect(repainted.body.stripeTiers[2].colour).toBe(YELLOW);
      expect(repainted.body.stripeTiers[2].stripeSegments).toEqual([{ count: 2, colour: YELLOW }]);

      // Sending a new list recolours a mixed rung, and the colour follows it.
      const relisted = await request(app.getHttpServer())
        .patch(`/v1/ranks/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          stripeTiers: [
            ...tiersAsSent({}).slice(0, 1),
            { order: 1, count: 4, colour: YELLOW, stripeSegments: [{ count: 2, colour: RED }, { count: 2, colour: WHITE }] },
            { order: 2, count: 2, colour: YELLOW },
          ],
        });
      expect(relisted.status).toBe(200);
      expect(relisted.body.stripeTiers[1].colour).toBe(RED);
    });

    it('RLS: per-rung required Skills are invisible to a user with no role at the School', async () => {
      const outsider = await mkExtraUser('rung-skills-outsider');
      const rows = await withUser(outsider.id, (tx) => tx.rankStripeTierRequiredSkill.findMany({ where: { skillId: skillSweep } }));
      expect(rows).toHaveLength(0);

      const asOwner = await withUser(owner.id, (tx) => tx.rankStripeTierRequiredSkill.findMany({ where: { skillId: skillSweep } }));
      expect(asOwner.length).toBeGreaterThan(0);
    });
  });
  // ---------------------------------------------------------------------------
  // Phase 1 / PR 3 (grading foundation) — history fields: downgrade reason and
  // notes (Decision 128, item 11), the skill sign-off log (Decision 156), void
  // with a reason (Decision 129), edit rank date (Decisions 153, 166), and
  // "Former instructor" (Decision 141). Uses its own Discipline and Students.
  // ---------------------------------------------------------------------------
  describe('history fields (grading foundation PR 3)', () => {
    let histDisciplineId: string;
    let histSkillId: string;
    const beltIds: string[] = [];
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

    const promote = (studentId: string, token: string, body: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .post(`/v1/students/${studentId}/ranks/${histDisciplineId}/promote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ acknowledgeWithoutSkillSignoff: true, ...body });
    const history = (studentId: string, token: string, query: Record<string, string> = {}) =>
      request(app.getHttpServer())
        .get(`/v1/students/${studentId}/rank-history`)
        .query({ schoolId: school.id, ...query })
        .set('Authorization', `Bearer ${token}`);
    const voidEntry = (studentId: string, eventId: string, token: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/v1/students/${studentId}/rank-history/${eventId}/void`)
        .query({ schoolId: school.id })
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    const editDate = (studentId: string, token: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .patch(`/v1/students/${studentId}/ranks/${histDisciplineId}/rank-date`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    const mkStudent = async (label: string) => {
      const u = await mkExtraUser(label);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
      return { user: u, token: signAccessToken(u, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]) };
    };

    beforeAll(async () => {
      const disc = await request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/disciplines`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'History Fields BJJ' });
      expect(disc.status).toBe(201);
      histDisciplineId = disc.body.id;
      disciplineIds.push(histDisciplineId);
      const skill = await request(app.getHttpServer())
        .post(`/v1/styles/${histDisciplineId}/skills`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Armbar' });
      expect(skill.status).toBe(201);
      histSkillId = skill.body.id;
      for (const order of [0, 1, 2]) {
        const rank = await request(app.getHttpServer())
          .post(`/v1/styles/${histDisciplineId}/ranks`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({
            order,
            primaryColour: '#FFFFFF',
            stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF' }],
            requiredSkillIds: order === 0 ? [histSkillId] : [],
          });
        expect(rank.status).toBe(201);
        beltIds.push(rank.body.id);
      }
    });

    it('logs every skill sign-off change with who, the old and the new status, and keeps the log when a grading wipes the statuses (Decision 156)', async () => {
      const { user } = await mkStudent('signoff-log');
      expect((await promote(user.id, tokenOwner)).status).toBe(201);

      for (let i = 0; i < 2; i++) {
        const res = await request(app.getHttpServer())
          .patch(`/v1/students/${user.id}/skills/${histSkillId}`)
          .set('Authorization', `Bearer ${tokenOwner}`);
        expect(res.status).toBe(200);
      }
      const log = await superuser.skillSignOffLog.findMany({ where: { studentId: user.id }, orderBy: { createdAt: 'asc' } });
      expect(log.map((l) => [l.fromStatus, l.toStatus, l.changedById, l.skillId])).toEqual([
        ['NOT_STARTED', 'LEARNING', owner.id, histSkillId],
        ['LEARNING', 'SIGNED_OFF', owner.id, histSkillId],
      ]);

      // A refused change logs nothing.
      await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: false } });
      try {
        const refused = await request(app.getHttpServer())
          .patch(`/v1/students/${user.id}/skills/${histSkillId}`)
          .set('Authorization', `Bearer ${tokenOwner}`);
        expect(refused.status).toBe(403);
      } finally {
        await superuser.school.update({ where: { id: school.id }, data: { ranksToggle: true } });
      }
      expect(await superuser.skillSignOffLog.count({ where: { studentId: user.id } })).toBe(2);

      // Grading wipes the statuses (Decision 128, item 16) but not the log.
      expect((await promote(user.id, tokenOwner)).status).toBe(201);
      expect(await superuser.studentRankSkillStatus.count({ where: { studentId: user.id } })).toBe(0);
      expect(await superuser.skillSignOffLog.count({ where: { studentId: user.id } })).toBe(2);
    });

    it('a grader\'s note is stored on the history entry (Decision 128, item 11)', async () => {
      const { user } = await mkStudent('note');
      const res = await promote(user.id, tokenOwner, { note: 'Great first class' });
      expect(res.status).toBe(201);
      expect(res.body.promotionEvent.note).toBe('Great first class');
      expect(res.body.promotionEvent.reason).toBeNull();
      expect(res.body.promotionEvent.rungsSkipped).toBe(0);
      expect(new Date(res.body.promotionEvent.effectiveDate).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('voids a history entry with a reason: hidden from the normal history, kept for staff, never changes the rank, and cannot be voided twice (Decision 129)', async () => {
      const { user, token } = await mkStudent('void');
      const first = await promote(user.id, tokenOwner);
      const second = await promote(user.id, tokenOwner);
      expect(second.status).toBe(201);
      const firstId = first.body.promotionEvent.id;
      const rankBefore = await superuser.studentRank.findFirstOrThrow({ where: { studentId: user.id } });

      // Refused: no reason, a blank reason, the student themselves, and a peer.
      expect((await voidEntry(user.id, firstId, tokenOwner, {})).status).toBe(400);
      expect((await voidEntry(user.id, firstId, tokenOwner, { reason: '  ' })).status).toBe(400);
      expect((await voidEntry(user.id, firstId, token, { reason: 'mine' })).status).toBe(403);
      expect((await voidEntry(user.id, firstId, tokenStudentB, { reason: 'peer' })).status).toBe(403);
      expect((await voidEntry(user.id, randomUUID(), tokenOwner, { reason: 'missing' })).status).toBe(404);

      const res = await voidEntry(user.id, firstId, tokenOwner, { reason: 'Entered by mistake' });
      expect(res.status).toBe(201);
      expect(res.body.voidedById).toBe(owner.id);
      expect(res.body.voidReason).toBe('Entered by mistake');
      expect(res.body.voidedAt).not.toBeNull();

      const again = await voidEntry(user.id, firstId, tokenOwner, { reason: 'Second try' });
      expect(again.status).toBe(409);
      expect((await superuser.promotionEvent.findUniqueOrThrow({ where: { id: firstId } })).voidReason).toBe('Entered by mistake');

      // Hidden from the normal history (student and staff); staff can ask for it.
      for (const t of [token, tokenOwner]) {
        const normal = await history(user.id, t);
        expect(normal.status).toBe(200);
        expect(normal.body.items.map((e: { id: string }) => e.id)).toEqual([second.body.promotionEvent.id]);
      }
      const withVoided = await history(user.id, tokenOwner, { includeVoided: 'true' });
      expect(withVoided.body.items.map((e: { id: string }) => e.id).sort()).toEqual([firstId, second.body.promotionEvent.id].sort());
      expect((await history(user.id, token, { includeVoided: 'true' })).status).toBe(403);

      // Never deleted, and the rank is unchanged.
      expect(await superuser.promotionEvent.count({ where: { studentId: user.id } })).toBe(2);
      const rankAfter = await superuser.studentRank.findFirstOrThrow({ where: { studentId: user.id } });
      expect([rankAfter.currentRankId, rankAfter.currentStripeId, rankAfter.dateOfCurrentRank]).toEqual([
        rankBefore.currentRankId,
        rankBefore.currentStripeId,
        rankBefore.dateOfCurrentRank,
      ]);
    });

    it('edit rank date: not in the future, not before the previous grading; corrects the rank and its entry and writes an ADJUSTMENT note (Decisions 153, 166)', async () => {
      const { user, token } = await mkStudent('rank-date');
      const first = await promote(user.id, tokenOwner);
      const second = await promote(user.id, tokenOwner);
      expect(second.status).toBe(201);
      // History: reached belt 0 200 days ago, belt 1 100 days ago.
      await superuser.promotionEvent.update({ where: { id: first.body.promotionEvent.id }, data: { effectiveDate: new Date(`${daysAgo(200)}T00:00:00.000Z`) } });
      await superuser.promotionEvent.update({ where: { id: second.body.promotionEvent.id }, data: { effectiveDate: new Date(`${daysAgo(100)}T00:00:00.000Z`) } });
      await superuser.studentRank.updateMany({ where: { studentId: user.id }, data: { dateOfCurrentRank: new Date(`${daysAgo(100)}T00:00:00.000Z`) } });

      const refused: Array<[Record<string, unknown>, string, number]> = [
        [{ date: daysAgo(-1) }, tokenOwner, 400], // future
        [{ date: daysAgo(201) }, tokenOwner, 400], // before the previous grading
        [{ date: daysAgo(100) }, tokenOwner, 400], // unchanged
        [{ date: '2026-02-30' }, tokenOwner, 400], // not a real date
        [{ date: `${daysAgo(150)}T00:00:00Z` }, tokenOwner, 400], // not date-only
        [{}, tokenOwner, 400],
        [{ date: daysAgo(150) }, token, 403], // the student themselves
      ];
      for (const [body, t, status] of refused) {
        const res = await editDate(user.id, t, body);
        expect({ body, status: res.status }).toEqual({ body, status });
      }
      expect(await superuser.promotionEvent.count({ where: { studentId: user.id, type: 'ADJUSTMENT' } })).toBe(0);

      // The previous grading's own day is allowed (boundary).
      const res = await editDate(user.id, tokenOwner, { date: daysAgo(200), note: 'Paper records' });
      expect(res.status).toBe(200);
      expect(res.body.studentRank.dateOfCurrentRank.slice(0, 10)).toBe(daysAgo(200));
      expect(res.body.promotionEvent.type).toBe('ADJUSTMENT');
      expect(res.body.promotionEvent.performedById).toBe(owner.id);
      expect(res.body.promotionEvent.systemNote).toBe(`Rank date corrected from ${daysAgo(100)} to ${daysAgo(200)}.`);
      expect(res.body.promotionEvent.note).toBe('Paper records');
      expect(res.body.promotionEvent.toRankId).toBe(res.body.studentRank.currentRankId);
      // The entry that put the student on this rung now shows the corrected date.
      const corrected = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: second.body.promotionEvent.id } });
      expect(corrected.effectiveDate.toISOString().slice(0, 10)).toBe(daysAgo(200));

      // Voiding the previous grading moves the lower bound with it.
      expect((await editDate(user.id, tokenOwner, { date: daysAgo(300) })).status).toBe(400);
      expect((await voidEntry(user.id, first.body.promotionEvent.id, tokenOwner, { reason: 'Wrong student' })).status).toBe(201);
      expect((await editDate(user.id, tokenOwner, { date: daysAgo(300) })).status).toBe(200);
    });

    it('a stripe award restarts the time-in-rank clock, and edit rank date then corrects the stripe\'s own date (Decisions 126, 166, 167)', async () => {
      const disc = await request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/disciplines`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ name: 'Stripe Clock BJJ' });
      expect(disc.status).toBe(201);
      disciplineIds.push(disc.body.id);
      const rank = await request(app.getHttpServer())
        .post(`/v1/styles/${disc.body.id}/ranks`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ order: 0, primaryColour: '#FFFFFF', stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF' }, { order: 1, count: 1, colour: '#FFFFFF' }] });
      expect(rank.status).toBe(201);

      const { user } = await mkStudent('stripe-clock');
      const first = await request(app.getHttpServer())
        .post(`/v1/students/${user.id}/ranks/${disc.body.id}/promote`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(first.status).toBe(201);
      // Reached the belt 100 days ago.
      const hundredDaysAgo = new Date(`${daysAgo(100)}T00:00:00.000Z`);
      await superuser.promotionEvent.update({ where: { id: first.body.promotionEvent.id }, data: { effectiveDate: hundredDaysAgo } });
      await superuser.studentRank.updateMany({ where: { studentId: user.id }, data: { dateOfCurrentRank: hundredDaysAgo } });

      const before = Date.now();
      const stripe = await request(app.getHttpServer())
        .post(`/v1/students/${user.id}/ranks/${disc.body.id}/stripe-award`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({});
      expect(stripe.status).toBe(201);
      expect(new Date(stripe.body.studentRank.dateOfCurrentRank).getTime()).toBeGreaterThanOrEqual(before - 1000);

      // The stripe is now the current rung: its date can be corrected, but
      // not to before the belt grading.
      const editStripeDate = (date: string) =>
        request(app.getHttpServer())
          .patch(`/v1/students/${user.id}/ranks/${disc.body.id}/rank-date`)
          .set('Authorization', `Bearer ${tokenOwner}`)
          .send({ date });
      expect((await editStripeDate(daysAgo(101))).status).toBe(400);
      const corrected = await editStripeDate(daysAgo(50));
      expect(corrected.status).toBe(200);
      const stripeEntry = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: stripe.body.promotionEvent.id } });
      expect(stripeEntry.effectiveDate.toISOString().slice(0, 10)).toBe(daysAgo(50));
    });

    it('deleting an instructor\'s account keeps the students\' history and sign-off log; "graded by" becomes empty (Former instructor, Decision 141)', async () => {
      const { user } = await mkStudent('former-graded');
      const instructor = await mkExtraUser('former-instructor');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: instructor.id, schoolId: school.id } });
      const tokenInstructor = signAccessToken(instructor, [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }]);
      // Grading permission for this style, from the owner (Decision 138).
      const granted = await request(app.getHttpServer())
        .put(`/v1/schools/${school.id}/grading-permissions/${instructor.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ disciplineIds: [histDisciplineId] });
      expect(granted.status).toBe(200);

      const graded = await promote(user.id, tokenInstructor);
      expect(graded.status).toBe(201);
      expect(graded.body.promotionEvent.performedById).toBe(instructor.id);
      const cycled = await request(app.getHttpServer())
        .patch(`/v1/students/${user.id}/skills/${histSkillId}`)
        .set('Authorization', `Bearer ${tokenInstructor}`);
      expect(cycled.status).toBe(200);

      // Before Decision 141 this delete was blocked (ON DELETE RESTRICT).
      await superuser.roleGrant.deleteMany({ where: { userId: instructor.id } });
      await superuser.user.delete({ where: { id: instructor.id } });

      const entry = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: graded.body.promotionEvent.id } });
      expect(entry.performedById).toBeNull();
      const log = await superuser.skillSignOffLog.findFirstOrThrow({ where: { studentId: user.id } });
      expect(log.changedById).toBeNull();
      const res = await history(user.id, tokenOwner);
      expect(res.body.items[0].performedById).toBeNull();
    });

    it('RLS: the sign-off log is visible only to the School Owner/Manager and the Student, and the app role cannot change or delete it', async () => {
      const { user } = await mkStudent('signoff-rls');
      expect((await promote(user.id, tokenOwner)).status).toBe(201);
      expect(
        (await request(app.getHttpServer()).patch(`/v1/students/${user.id}/skills/${histSkillId}`).set('Authorization', `Bearer ${tokenOwner}`)).status,
      ).toBe(200);

      const outsider = await mkExtraUser('signoff-outsider');
      expect(await withUser(outsider.id, (tx) => tx.skillSignOffLog.count({ where: { studentId: user.id } }))).toBe(0);
      expect(await withUser(studentB.id, (tx) => tx.skillSignOffLog.count({ where: { studentId: user.id } }))).toBe(0);
      expect(await withUser(user.id, (tx) => tx.skillSignOffLog.count({ where: { studentId: user.id } }))).toBe(1);
      expect(await withUser(owner.id, (tx) => tx.skillSignOffLog.count({ where: { studentId: user.id } }))).toBe(1);

      await expect(withUser(owner.id, (tx) => tx.skillSignOffLog.deleteMany({ where: { studentId: user.id } }))).rejects.toThrow();
      await expect(withUser(owner.id, (tx) => tx.skillSignOffLog.updateMany({ where: { studentId: user.id }, data: { toStatus: 'SIGNED_OFF' } }))).rejects.toThrow();
      expect(await superuser.skillSignOffLog.count({ where: { studentId: user.id, toStatus: 'LEARNING' } })).toBe(1);
    });
  });
  // ---------------------------------------------------------------------------
  // Phase 1 / PR 4 (grading foundation) — grading permission per discipline
  // and branch scoping (Decisions 138, 139, 148, 168). Its own School with two
  // branches, so the tests above (a School with no branches) are unaffected.
  // ---------------------------------------------------------------------------
  describe('grading permission and branches (grading foundation PR 4)', () => {
    let schoolP: { id: string };
    let downtown: { id: string };
    let riverside: { id: string };
    let ownerP: { id: string; email: string };
    let tokenOwnerP: string;
    let bjjId: string;
    let judoId: string;
    let judoSkillId: string;
    const people: Record<string, { user: { id: string; email: string }; token: string }> = {};

    const staffToken = (user: { id: string; email: string }, grants: Array<{ role: string; branchId: string | null }>) =>
      signAccessToken(user, grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: schoolP.id, branchId: g.branchId })));
    const grade = (studentId: string, disciplineId: string, token: string) =>
      request(app.getHttpServer())
        .post(`/v1/students/${studentId}/ranks/${disciplineId}/promote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ acknowledgeWithoutSkillSignoff: true });
    const viewRanks = (studentId: string, token: string) =>
      request(app.getHttpServer()).get(`/v1/students/${studentId}/ranks`).query({ schoolId: schoolP.id }).set('Authorization', `Bearer ${token}`);
    const setPermissions = (userId: string, disciplineIds: string[], token = tokenOwnerP) =>
      request(app.getHttpServer())
        .put(`/v1/schools/${schoolP.id}/grading-permissions/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ disciplineIds });

    beforeAll(async () => {
      schoolP = await superuser.school.create({ data: { id: randomUUID(), name: 'Ranks HTTP Branches School', ranksToggle: true } });
      downtown = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolP.id, name: 'Downtown' } });
      riverside = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolP.id, name: 'Riverside' } });
      ownerP = await mkExtraUser('branches-owner');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerP.id, schoolId: schoolP.id } });
      tokenOwnerP = staffToken(ownerP, [{ role: 'SCHOOL_OWNER_MANAGER', branchId: null }]);

      const mkDiscipline = async (name: string, beltCount: number) => {
        const disc = await request(app.getHttpServer())
          .post(`/v1/schools/${schoolP.id}/disciplines`)
          .set('Authorization', `Bearer ${tokenOwnerP}`)
          .send({ name });
        expect(disc.status).toBe(201);
        for (let order = 0; order < beltCount; order++) {
          const rank = await request(app.getHttpServer())
            .post(`/v1/styles/${disc.body.id}/ranks`)
            .set('Authorization', `Bearer ${tokenOwnerP}`)
            .send({ order, primaryColour: '#FFFFFF', stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF' }] });
          expect(rank.status).toBe(201);
        }
        return disc.body.id as string;
      };
      bjjId = await mkDiscipline('Branches BJJ', 4);
      judoId = await mkDiscipline('Branches Judo', 3);
      const skill = await request(app.getHttpServer())
        .post(`/v1/styles/${judoId}/skills`)
        .set('Authorization', `Bearer ${tokenOwnerP}`)
        .send({ name: 'Osoto Gari' });
      expect(skill.status).toBe(201);
      judoSkillId = skill.body.id;
      const firstJudoRank = await superuser.rank.findFirstOrThrow({ where: { disciplineId: judoId, order: 0 } });
      await superuser.rankRequiredSkill.create({ data: { rankId: firstJudoRank.id, skillId: judoSkillId } });

      // Coaches and staff: Carla at Downtown, Max at both branches, Wes with
      // no branch, Rita (Branch Staff) at Riverside.
      const staff: Array<[string, Array<{ role: string; branchId: string | null }>]> = [
        ['carla', [{ role: 'INSTRUCTOR', branchId: downtown.id }]],
        ['max', [{ role: 'INSTRUCTOR', branchId: downtown.id }, { role: 'INSTRUCTOR', branchId: riverside.id }]],
        ['wes', [{ role: 'INSTRUCTOR', branchId: null }]],
        ['rita', [{ role: 'BRANCH_STAFF', branchId: riverside.id }]],
      ];
      for (const [label, grants] of staff) {
        const u = await mkExtraUser(`branches-${label}`);
        for (const g of grants) {
          await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role as 'INSTRUCTOR' | 'BRANCH_STAFF', userId: u.id, schoolId: schoolP.id, branchId: g.branchId } });
        }
        people[label] = { user: u, token: staffToken(u, grants) };
      }

      // Students: Ana joins Downtown, Ben joins Riverside (through the real
      // join endpoint); Noor was enrolled before branches, with no home branch.
      for (const [label, branchId] of [['ana', downtown.id], ['ben', riverside.id]] as const) {
        const u = await mkExtraUser(`branches-${label}`);
        const t = signAccessToken(u, []);
        const joined = await request(app.getHttpServer()).post(`/v1/schools/${schoolP.id}/join`).set('Authorization', `Bearer ${t}`).send({ branchId });
        expect(joined.status).toBe(201);
        people[label] = { user: u, token: joined.body.accessToken };
      }
      const noor = await mkExtraUser('branches-noor');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: noor.id, schoolId: schoolP.id } });
      people.noor = { user: noor, token: signAccessToken(noor, [{ role: 'STUDENT', franchiseId: null, schoolId: schoolP.id, branchId: null }]) };
    });

    afterAll(async () => {
      await superuser.promotionEvent.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.studentRank.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.rankRequiredSkill.deleteMany({ where: { rank: { schoolId: schoolP.id } } });
      await superuser.skill.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.rankStripeTier.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.rank.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.gradingPermission.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.discipline.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.studentHomeBranch.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.branch.deleteMany({ where: { schoolId: schoolP.id } });
      await superuser.school.delete({ where: { id: schoolP.id } });
    });

    it('only the owner manages grading permission; only Instructors/Branch Staff of this School can hold it, for this School\'s styles (Decision 138)', async () => {
      const { carla, ana } = people;
      expect((await request(app.getHttpServer()).get(`/v1/schools/${schoolP.id}/grading-permissions`).set('Authorization', `Bearer ${carla.token}`)).status).toBe(403);
      expect((await setPermissions(carla.user.id, [bjjId], carla.token)).status).toBe(403);
      expect((await setPermissions(ana.user.id, [bjjId])).status).toBe(400); // a student, not staff
      expect((await setPermissions(carla.user.id, [disciplineId])).status).toBe(400); // another School's style
      expect((await setPermissions(carla.user.id, [bjjId, bjjId])).status).toBe(400); // duplicates

      const res = await setPermissions(carla.user.id, [bjjId]);
      expect(res.status).toBe(200);
      expect(res.body.items.map((p: { disciplineId: string; grantedById: string }) => [p.disciplineId, p.grantedById])).toEqual([[bjjId, ownerP.id]]);
      const list = await request(app.getHttpServer()).get(`/v1/schools/${schoolP.id}/grading-permissions`).set('Authorization', `Bearer ${tokenOwnerP}`);
      expect(list.status).toBe(200);
      expect(list.body.items.filter((p: { userId: string }) => p.userId === carla.user.id)).toHaveLength(1);

      // Replacing with [] removes it.
      expect((await setPermissions(carla.user.id, [])).body.items).toEqual([]);
    });

    it('a coach grades only in the styles granted to them, and only students of their own branches (Decisions 138, 168)', async () => {
      const { carla, ana, ben, noor } = people;
      // No permission yet: refused, nothing written.
      expect((await grade(ana.user.id, bjjId, carla.token)).status).toBe(403);
      expect(await superuser.promotionEvent.count({ where: { schoolId: schoolP.id } })).toBe(0);

      expect((await setPermissions(carla.user.id, [bjjId])).status).toBe(200);
      expect((await grade(ana.user.id, bjjId, carla.token)).status).toBe(201); // Downtown student, BJJ
      expect((await grade(ana.user.id, judoId, carla.token)).status).toBe(403); // no Judo permission
      expect((await grade(ben.user.id, bjjId, carla.token)).status).toBe(403); // Riverside student
      expect((await grade(noor.user.id, bjjId, carla.token)).status).toBe(403); // no home branch yet

      // Viewing: Carla sees her branch's student without needing permission
      // for that style, but not another branch's student (Decision 168).
      expect((await viewRanks(ana.user.id, carla.token)).status).toBe(200);
      expect((await viewRanks(ben.user.id, carla.token)).status).toBe(403);
      expect((await viewRanks(noor.user.id, carla.token)).status).toBe(403);
    });

    it('a coach assigned to two branches grades both; staff with no branch, in a School that has branches, grade no one (Decision 168)', async () => {
      const { max, wes, rita, ana, ben } = people;
      for (const who of [max, wes, rita]) {
        expect((await setPermissions(who.user.id, [bjjId])).status).toBe(200);
      }
      expect((await grade(ana.user.id, bjjId, max.token)).status).toBe(201);
      expect((await grade(ben.user.id, bjjId, max.token)).status).toBe(201);
      expect((await grade(ana.user.id, bjjId, wes.token)).status).toBe(403);
      expect((await viewRanks(ana.user.id, wes.token)).status).toBe(403);
      expect((await grade(ben.user.id, bjjId, rita.token)).status).toBe(201); // Branch Staff at Riverside
      expect((await grade(ana.user.id, bjjId, rita.token)).status).toBe(403);
    });

    it('the owner grades everyone, including students with no home branch, and assigns home branches (Decisions 138, 148)', async () => {
      const { rita, noor, carla, ana } = people;
      expect((await grade(noor.user.id, bjjId, tokenOwnerP)).status).toBe(201);
      expect((await viewRanks(noor.user.id, tokenOwnerP)).status).toBe(200);
      expect((await grade(noor.user.id, bjjId, rita.token)).status).toBe(403);

      const assign = (studentId: string, branchId: string, token = tokenOwnerP) =>
        request(app.getHttpServer())
          .put(`/v1/schools/${schoolP.id}/students/${studentId}/home-branch`)
          .set('Authorization', `Bearer ${token}`)
          .send({ branchId });
      expect((await assign(noor.user.id, riverside.id, carla.token)).status).toBe(403); // owner only
      expect((await assign(noor.user.id, randomUUID())).status).toBe(400); // not a branch of this School
      expect((await assign(carla.user.id, riverside.id)).status).toBe(404); // not a student here

      const res = await assign(noor.user.id, riverside.id);
      expect(res.status).toBe(200);
      expect([res.body.branchId, res.body.assignedById]).toEqual([riverside.id, ownerP.id]);
      expect((await grade(noor.user.id, bjjId, rita.token)).status).toBe(201);

      // The owner can move a student; their coach changes with them.
      expect((await assign(ana.user.id, riverside.id)).status).toBe(200);
      expect((await grade(ana.user.id, bjjId, carla.token)).status).toBe(403);
      expect((await assign(ana.user.id, downtown.id)).status).toBe(200);
    });

    it('skill sign-off, void and edit rank date need the same grading permission (Decision 138)', async () => {
      const { carla, ana } = people;
      // The owner grades Ana in Judo (first rung, which requires a skill).
      const judo = await grade(ana.user.id, judoId, tokenOwnerP);
      expect(judo.status).toBe(201);

      const signOff = () => request(app.getHttpServer()).patch(`/v1/students/${ana.user.id}/skills/${judoSkillId}`).set('Authorization', `Bearer ${carla.token}`);
      const voidIt = () =>
        request(app.getHttpServer())
          .post(`/v1/students/${ana.user.id}/rank-history/${judo.body.promotionEvent.id}/void`)
          .query({ schoolId: schoolP.id })
          .set('Authorization', `Bearer ${carla.token}`)
          .send({ reason: 'test' });
      const editDate = () =>
        request(app.getHttpServer())
          .patch(`/v1/students/${ana.user.id}/ranks/${judoId}/rank-date`)
          .set('Authorization', `Bearer ${carla.token}`)
          .send({ date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) });

      for (const call of [signOff, voidIt, editDate]) {
        expect((await call()).status).toBe(403);
      }
      expect(await superuser.skillSignOffLog.count({ where: { studentId: ana.user.id } })).toBe(0);

      expect((await setPermissions(carla.user.id, [bjjId, judoId])).status).toBe(200);
      expect((await signOff()).status).toBe(200);
      expect((await editDate()).status).toBe(200);
      expect((await voidIt()).status).toBe(201);
    });

    it('RLS: grading permissions and home branches are visible only to the owner and the person themselves; staff cannot grant themselves permission', async () => {
      const { carla, max, ana, ben } = people;
      expect(await withUser(carla.user.id, (tx) => tx.gradingPermission.count({ where: { schoolId: schoolP.id } }))).toBe(
        await superuser.gradingPermission.count({ where: { schoolId: schoolP.id, userId: carla.user.id } }),
      );
      expect(await withUser(max.user.id, (tx) => tx.gradingPermission.count({ where: { userId: carla.user.id } }))).toBe(0);
      expect(await withUser(ownerP.id, (tx) => tx.gradingPermission.count({ where: { schoolId: schoolP.id } }))).toBe(
        await superuser.gradingPermission.count({ where: { schoolId: schoolP.id } }),
      );
      await expect(
        withUser(carla.user.id, (tx) => tx.gradingPermission.create({ data: { id: randomUUID(), schoolId: schoolP.id, userId: carla.user.id, disciplineId: judoId } })),
      ).rejects.toThrow();

      expect(await withUser(ana.user.id, (tx) => tx.studentHomeBranch.count({ where: { schoolId: schoolP.id } }))).toBe(1);
      expect(await withUser(ben.user.id, (tx) => tx.studentHomeBranch.count({ where: { studentId: ana.user.id } }))).toBe(0);
      expect(await withUser(carla.user.id, (tx) => tx.studentHomeBranch.count({ where: { schoolId: schoolP.id } }))).toBe(0);
      expect(await withUser(ownerP.id, (tx) => tx.studentHomeBranch.count({ where: { schoolId: schoolP.id } }))).toBe(3);
    });
  });
});
