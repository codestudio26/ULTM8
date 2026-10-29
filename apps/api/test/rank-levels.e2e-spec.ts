/**
 * Backlog 3.19 / Decision 290 over real HTTP: a style shows its ranks as
 * Belts or as Levels (no belt). A level is one badge colour with numbered
 * steps ("Beginner 1, 2, 3"); steps are rungs without stripes, so grading
 * works on them exactly as on a belt style. "Ranks shown as" is set when the
 * style is created or edited, or in Grading → Settings by the owner or a
 * coach with "Change grading settings".
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
import { giveLiveMembership } from './live-membership';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[rank-levels.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Ranks shown as Levels (backlog 3.19, Decision 290)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tag = `rank-levels-${randomUUID().slice(0, 8)}`;
  let school: { id: string };
  const users: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let noGi: { id: string };
  let beginner: { id: string; stripeTiers: Array<{ id: string; name: string }> };

  const as = (who: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string) => auth(server().post(path)),
      put: (path: string) => auth(server().put(path)),
      patch: (path: string) => auth(server().patch(path)),
    };
  };
  const step = (order: number) => ({ order, count: 0, colour: '#FFFFFF', classesRequired: 2 });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: tag, ranksToggle: true } });
    for (const label of ['owner', 'coach', 'settingsCoach', 'student']) {
      const u = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `${tag}-${label}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Levels',
          passcodeHash: 'x',
          dateOfBirth: new Date('1990-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      users[label] = u.id;
    }
    const roles = { owner: 'SCHOOL_OWNER_MANAGER', coach: 'INSTRUCTOR', settingsCoach: 'INSTRUCTOR', student: 'STUDENT' } as const;
    for (const [label, role] of Object.entries(roles)) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label], schoolId: school.id } });
      tokens[label] = jwt.sign({ sub: users[label], email: `${tag}-${label}@example.test`, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
    }
    await giveLiveMembership(superuser, school.id, users.student);
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    await superuser.promotionEvent.deleteMany({ where });
    await superuser.studentRankSkillStatus.deleteMany({ where });
    await superuser.studentRank.deleteMany({ where });
    await superuser.gradingPermission.deleteMany({ where });
    await superuser.rankStripeTier.deleteMany({ where });
    await superuser.rank.deleteMany({ where });
    await superuser.discipline.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a style is Belts unless created as Levels; anything else is refused', async () => {
    const gi = await as('owner').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Gi' });
    expect(gi.status).toBe(201);
    expect(gi.body.rankDisplay).toBe('BELTS');
    expect((await as('owner').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Bad', rankDisplay: 'STARS' })).status).toBe(400);
    const created = await as('owner').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'No-Gi', rankDisplay: 'LEVELS' });
    expect(created.status).toBe(201);
    expect(created.body.rankDisplay).toBe('LEVELS');
    noGi = created.body;
    // A belt style still takes stripes.
    const white = await as('owner').post(`/v1/styles/${gi.body.id}/ranks`).send({
      order: 0, name: 'White Belt', primaryColour: '#FFFFFF', stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF' }, { order: 1, count: 1, colour: '#FFFFFF' }],
    });
    expect(white.status).toBe(201);
    expect(white.body.rankDisplay).toBe('BELTS');
    expect(white.body.stripeTiers.map((t: { name: string }) => t.name)).toEqual(['White Belt', 'White Belt · 1 Stripe']);
  });

  it('a level saves with one badge colour and numbered steps, never stripes', async () => {
    const url = `/v1/styles/${noGi.id}/ranks`;
    const stripes = await as('owner').post(url).send({ order: 0, name: 'Beginner', primaryColour: '#2A9D8F', stripeTiers: [step(0), { order: 1, count: 1, colour: '#000000' }] });
    expect(stripes.status).toBe(400);
    const segments = await as('owner').post(url).send({
      order: 0, name: 'Beginner', primaryColour: '#2A9D8F', stripeTiers: [{ ...step(0), stripeSegments: [{ count: 0, colour: '#000000' }] }],
    });
    expect(segments.status).toBe(400);
    const twoTone = await as('owner').post(url).send({ order: 0, name: 'Beginner', primaryColour: '#2A9D8F', secondaryColour: '#FFFFFF', stripeTiers: [step(0)] });
    expect(twoTone.status).toBe(400);

    const created = await as('owner').post(url).send({ order: 0, name: 'Beginner', primaryColour: '#2A9D8F', stripeTiers: [step(0), step(1), step(2)] });
    expect(created.status).toBe(201);
    expect(created.body.rankDisplay).toBe('LEVELS');
    expect(created.body.secondaryColour).toBeNull();
    expect(created.body.stripeTiers.map((t: { name: string; count: number; stripeSegments: unknown[] }) => [t.name, t.count, t.stripeSegments])).toEqual([
      ['Beginner 1', 0, []],
      ['Beginner 2', 0, []],
      ['Beginner 3', 0, []],
    ]);
    beginner = created.body;
    const list = await as('coach').get(url);
    expect(list.body.items.every((r: { rankDisplay: string }) => r.rankDisplay === 'LEVELS')).toBe(true);
  });

  it('renaming a level renames its generated steps; a custom step name is kept', async () => {
    const url = `/v1/ranks/${beginner.id}`;
    const custom = await as('owner').patch(url).send({ stripeTiers: [{ ...step(0), id: beginner.stripeTiers[0].id, name: 'First steps' }, { ...step(1), id: beginner.stripeTiers[1].id }, { ...step(2), id: beginner.stripeTiers[2].id }] });
    expect(custom.status).toBe(200);
    const renamed = await as('owner').patch(url).send({ name: 'Novice' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.stripeTiers.map((t: { name: string }) => t.name)).toEqual(['First steps', 'Novice 2', 'Novice 3']);
    // A step added later gets its number.
    const added = await as('owner').patch(url).send({
      stripeTiers: [...renamed.body.stripeTiers.map((t: { id: string; order: number }) => ({ ...step(t.order), id: t.id })), step(3)],
    });
    expect(added.status).toBe(200);
    expect(added.body.stripeTiers.map((t: { name: string }) => t.name)).toEqual(['First steps', 'Novice 2', 'Novice 3', 'Novice 4']);
    expect((await as('owner').patch(url).send({ tagColour: '#000000' })).status).toBe(400);
    beginner = added.body;
  });

  it('grading on a level works as on a belt; the student app gets the step of each rung', async () => {
    await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: users.student, disciplineId: noGi.id, schoolId: school.id, currentRankId: beginner.id, currentStripeId: beginner.stripeTiers[0].id,
        classesAttendedTowardCheckpoint: 5, dateOfCurrentRank: new Date(Date.now() - 90 * 86_400_000),
      },
    });
    const promoted = await as('owner').post(`/v1/students/${users.student}/ranks/${noGi.id}/promote`).send({ acknowledgeWithoutSkillSignoff: true });
    expect(promoted.status).toBe(201);
    const held = await superuser.studentRank.findFirstOrThrow({ where: { studentId: users.student, disciplineId: noGi.id } });
    expect(held.currentStripeId).toBe(beginner.stripeTiers[1].id);

    const overview = await as('student').get(`/v1/students/${users.student}/grading`);
    expect(overview.status).toBe(200);
    const style = overview.body.items.find((i: { disciplineId: string }) => i.disciplineId === noGi.id);
    expect(style.ladder.map((r: { name: string; rankDisplay: string; step: number; steps: number }) => [r.name, r.rankDisplay, r.step, r.steps])).toEqual([
      ['First steps', 'LEVELS', 1, 4],
      ['Novice 2', 'LEVELS', 2, 4],
      ['Novice 3', 'LEVELS', 3, 4],
      ['Novice 4', 'LEVELS', 4, 4],
    ]);
  });

  it('"Ranks shown as" in Grading → Settings: the owner, or a coach with "Change grading settings"', async () => {
    for (const [label, settings] of [['coach', false], ['settingsCoach', true]] as const) {
      await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: users[label], disciplineId: noGi.id, canChangeBoardThresholds: settings } });
    }
    const url = `/v1/disciplines/${noGi.id}/rank-display`;
    expect((await as('coach').put(url).send({ rankDisplay: 'BELTS' })).status).toBe(403);
    expect((await as('student').put(url).send({ rankDisplay: 'BELTS' })).status).toBe(403);
    expect((await as('owner').put(url).send({ rankDisplay: 'STARS' })).status).toBe(400);
    // Display only: it changes while a student holds a step.
    const belts = await as('settingsCoach').put(url).send({ rankDisplay: 'BELTS' });
    expect(belts.status).toBe(200);
    expect(belts.body.rankDisplay).toBe('BELTS');
    expect((await as('owner').get(`/v1/ranks/${beginner.id}`)).body.rankDisplay).toBe('BELTS');
    expect((await as('owner').put(url).send({ rankDisplay: 'LEVELS' })).body.rankDisplay).toBe('LEVELS');
    // The edit dialog sets it too.
    const edited = await as('owner').patch(`/v1/disciplines/${noGi.id}`).send({ rankDisplay: 'LEVELS' });
    expect(edited.status).toBe(200);
    expect(edited.body.rankDisplay).toBe('LEVELS');
  });

  it('a duplicated Levels style is Levels too', async () => {
    const copy = await as('owner').post(`/v1/disciplines/${noGi.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.rankDisplay).toBe('LEVELS');
    const ranks = await as('owner').get(`/v1/styles/${copy.body.id}/ranks`);
    expect(ranks.body.items[0].rankDisplay).toBe('LEVELS');
  });
});
