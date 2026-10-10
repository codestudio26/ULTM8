/**
 * Grading permission toggles (Decision 181): seven per person per style, set
 * by the owner; each grading action needs its own. Real HTTP.
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
  console.warn('[grading-permission-toggles.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const NONE = {
  canPromote: false,
  canDowngrade: false,
  canSignOffSkills: false,
  canAdjustProgress: false,
  canVerifyRanks: false,
  canVoidHistory: false,
  canChangeBoardThresholds: false,
};

describeIfDb('Grading permission toggles (Decision 181)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let bjj: { id: string };
  let judo: { id: string };
  let skillId: string;
  const rung: Record<string, { id: string; rankId: string }> = {};
  const userIds: string[] = [];
  let ownerToken: string;
  let coach: { id: string; email: string };
  let coachToken: string;
  let student: { id: string };

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `perm-toggles-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Toggles',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  const http = () => request(app.getHttpServer());
  const setFor = (body: object) =>
    http().put(`/v1/schools/${school.id}/grading-permissions/${coach.id}`).set('Authorization', `Bearer ${ownerToken}`).send(body);
  const allow = (toggles: Partial<typeof NONE>) => setFor({ styles: [{ disciplineId: bjj.id, ...NONE, ...toggles }] });
  const asCoach = (method: 'post' | 'patch' | 'put', path: string, body: object = {}) =>
    http()[method](`/v1${path}`).set('Authorization', `Bearer ${coachToken}`).send(body);
  const ranksPath = (action: string) => `/students/${student.id}/ranks/${bjj.id}/${action}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // No branches: the School is the branch, so the coach covers every student (Decision 168).
    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Permission Toggles School', ranksToggle: true } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
    judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo', classTypesOffered: [] } });
    skillId = (await superuser.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name: 'Armbar' } })).id;
    for (const [name, order, tiers] of [['White', 0, 3], ['Blue', 1, 1]] as const) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t < tiers; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name} ${t}`, stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], classesRequired: 3 },
        });
        rung[`${name} ${t}`] = { id: tier.id, rankId: rank.id };
      }
    }
    await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: rung['White 2'].id, skillId } });

    const owner = await mkUser('owner');
    coach = await mkUser('coach');
    student = await mkUser('student');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
      ],
    });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: student.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: rung['White 1'].rankId, currentStripeId: rung['White 1'].id, verificationStatus: 'UNVERIFIED' },
    });
    ownerToken = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    coachToken = jwt.sign({ sub: coach.id, email: coach.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.skillSignOffLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: school.id } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: school.id } });
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

  it('the owner sets toggles per style, and reads them back', async () => {
    const res = await setFor({
      styles: [
        { disciplineId: bjj.id, ...NONE, canPromote: true, canSignOffSkills: true },
        { disciplineId: judo.id, ...NONE, canChangeBoardThresholds: true },
      ],
    });
    expect(res.status).toBe(200);
    const list = await http().get(`/v1/schools/${school.id}/grading-permissions`).set('Authorization', `Bearer ${ownerToken}`);
    const bjjRow = list.body.items.find((p: { disciplineId: string }) => p.disciplineId === bjj.id);
    const judoRow = list.body.items.find((p: { disciplineId: string }) => p.disciplineId === judo.id);
    expect(bjjRow).toMatchObject({ ...NONE, canPromote: true, canSignOffSkills: true });
    expect(judoRow).toMatchObject({ ...NONE, canChangeBoardThresholds: true });
    expect(list.body.staff).toEqual([{ userId: coach.id, firstName: 'coach', surname: 'Toggles', roles: ['INSTRUCTOR'] }]);
  });

  it('the older disciplineIds form turns every toggle on; bad input is refused', async () => {
    expect((await setFor({ disciplineIds: [bjj.id] })).status).toBe(200);
    const row = await superuser.gradingPermission.findFirstOrThrow({ where: { userId: coach.id, disciplineId: bjj.id } });
    expect(row).toMatchObject({ canPromote: true, canDowngrade: true, canSignOffSkills: true, canAdjustProgress: true, canVerifyRanks: true, canVoidHistory: true, canChangeBoardThresholds: true });

    expect((await setFor({})).status).toBe(400);
    expect((await setFor({ styles: [{ disciplineId: bjj.id, ...NONE }, { disciplineId: bjj.id, ...NONE }] })).status).toBe(400);
    expect((await setFor({ styles: [{ disciplineId: bjj.id, canPromote: true }] })).status).toBe(400); // every toggle must be given
  });

  it('with only "Sign off skills", every other grading action is refused, naming the toggle', async () => {
    expect((await allow({ canSignOffSkills: true })).status).toBe(200);
    expect((await asCoach('patch', `/students/${student.id}/skills/${skillId}`)).status).toBe(200);

    const promote = await asCoach('post', ranksPath('promote'), { acknowledgeWithoutSkillSignoff: true });
    expect(promote.status).toBe(403);
    expect(promote.body.error.message).toContain('Promote');
    expect((await asCoach('post', ranksPath('stripe-award'), { acknowledgeWithoutSkillSignoff: true })).status).toBe(403);
    const down = await asCoach('post', ranksPath('downgrade'), { reason: 'Test' });
    expect(down.status).toBe(403);
    expect(down.body.error.message).toContain('Move down');
    expect((await asCoach('post', ranksPath('board-move'), { column: 'READY_TO_GRADE' })).status).toBe(403);
    expect((await asCoach('post', ranksPath('log-class'), {})).status).toBe(403);
    expect((await asCoach('put', ranksPath('board-active'), { active: false })).status).toBe(403);
    expect((await asCoach('patch', ranksPath('rank-date'), { date: '2026-01-01' })).status).toBe(403);
    expect((await asCoach('post', ranksPath('verify'), {})).status).toBe(403);
    const bulk = await asCoach('post', `/schools/${school.id}/grading/bulk-promote`, { disciplineId: bjj.id, studentIds: [student.id] });
    expect(bulk.status === 403 || (bulk.status < 300 && bulk.body.cannotPromote.length === 1)).toBe(true);
  });

  it('each toggle allows its own actions', async () => {
    await allow({ canAdjustProgress: true });
    expect((await asCoach('post', ranksPath('log-class'), {})).status).toBe(201);
    expect((await asCoach('put', ranksPath('board-active'), { active: true })).status).toBe(200);

    await allow({ canVerifyRanks: true });
    expect((await asCoach('post', ranksPath('verify'), {})).status).toBe(201);

    await allow({ canPromote: true });
    const graded = await asCoach('post', ranksPath('stripe-award'), { acknowledgeWithoutSkillSignoff: true });
    expect(graded.status).toBe(201);

    await allow({ canDowngrade: true });
    const down = await asCoach('post', ranksPath('downgrade'), { reason: 'Back to basics', targetRungId: rung['White 0'].id });
    expect(down.status).toBe(201);

    await allow({ canVoidHistory: true });
    const voided = await asCoach('post', `/students/${student.id}/rank-history/${down.body.promotionEvent.id}/void?schoolId=${school.id}`, { reason: 'Mistake' });
    expect(voided.status).toBe(201);
  });

  it('only the owner changes permissions', async () => {
    const res = await http()
      .put(`/v1/schools/${school.id}/grading-permissions/${coach.id}`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ styles: [{ disciplineId: bjj.id, ...NONE, canPromote: true }] });
    expect(res.status).toBe(403);
  });
});
