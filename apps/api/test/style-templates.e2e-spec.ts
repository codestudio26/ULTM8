/**
 * Style templates and duplicate (Decisions 131, 182): a new style from one of
 * the three IBJJF ladders, with the prototype's numbers; a copy of a style
 * with its ladder, skills and settings but none of its students. Owner only.
 * Real HTTP.
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
  console.warn('[style-templates.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Style templates and duplicate (Decisions 131, 182)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  const userIds: string[] = [];
  const token: Record<string, string> = {};

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `style-templates-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Templates',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  const http = () => request(app.getHttpServer());
  const fromTemplate = (who: string, body: object) =>
    http().post(`/v1/schools/${school.id}/disciplines/from-template`).set('Authorization', `Bearer ${token[who]}`).send(body);
  const duplicate = (who: string, id: string) => http().post(`/v1/disciplines/${id}/duplicate`).set('Authorization', `Bearer ${token[who]}`);
  const ladder = (disciplineId: string) =>
    superuser.rank.findMany({
      where: { disciplineId },
      orderBy: { order: 'asc' },
      include: { stripeTiers: { orderBy: { order: 'asc' }, include: { requiredSkills: true } } },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Style Templates School', ranksToggle: true } });
    const owner = await mkUser('owner');
    const coach = await mkUser('coach');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id },
      ],
    });
    token.owner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    token.coach = jwt.sign({ sub: coach.id, email: coach.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  afterAll(async () => {
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { stripeTier: { schoolId: school.id } } });
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

  it('lists the three IBJJF templates with their rung counts', async () => {
    const res = await http().get('/v1/style-templates').set('Authorization', `Bearer ${token.owner}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((t: { id: string; rungs: number }) => [t.id, t.rungs])).toEqual([
      ['ibjjf', 90],
      ['ibjjf_kids_red', 139],
      ['ibjjf_kids_yellow', 175],
    ]);
  });

  it.each([
    ['ibjjf', 90],
    ['ibjjf_kids_red', 139],
    ['ibjjf_kids_yellow', 175],
  ])('builds the %s ladder with the prototype\'s numbers (%i rungs)', async (templateId, rungs) => {
    const res = await fromTemplate('owner', { templateId, name: `BJJ ${templateId}` });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(`BJJ ${templateId}`);
    expect(res.body.classTypesOffered).toEqual(['Kids Fundamentals', 'Kids Sparring', 'Adult Fundamentals', 'Adult Sparring', 'Competition Team']);

    const belts = await ladder(res.body.id);
    expect(belts).toHaveLength(20);
    expect(belts.reduce((n, b) => n + b.stripeTiers.length, 0)).toBe(rungs);
    expect(belts.map((b) => b.order)).toEqual([...Array(20).keys()]);

    // White Belt: 40 classes over 180 days, spread over five stripes; 3 a week; Kids Fundamentals.
    const white = belts[0];
    expect(white.name).toBe('White Belt');
    expect(white.stripeTiers[1]).toMatchObject({
      name: 'White Belt · 1 Stripe',
      classesRequired: 8,
      minimumDaysInRank: 36,
      weeklyClassCountCap: 3,
      eligibleClassTypes: ['Kids Fundamentals'],
      timeOnly: false,
      stripeSegments: [{ count: 1, colour: '#FFFFFF' }],
    });
    // Blue Belt: 200 classes over 730 days.
    const blue = belts.find((b) => b.name === 'Blue Belt')!;
    expect(blue.stripeTiers[0]).toMatchObject({ classesRequired: 40, minimumDaysInRank: 146, weeklyClassCountCap: 4, eligibleClassTypes: ['Adult Fundamentals'] });
    // Black belt degrees are time only.
    const black = belts.find((b) => b.name === 'Black Belt')!;
    expect(black.stripeTiers).toHaveLength(7);
    expect(black.stripeTiers.every((t) => t.timeOnly && t.classesRequired === null)).toBe(true);
    expect(black.stripeTiers.map((t) => t.minimumDaysInRank)).toEqual([1095, 1095, 1095, 1825, 1825, 1825, 2555]);
    expect(belts[19]).toMatchObject({ name: 'Red Belt (9th Degree)', coralAccent: '#D9A441' });
  });

  it('the style is named after the template when no name is given', async () => {
    const res = await fromTemplate('owner', { templateId: 'ibjjf' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('IBJJF Adult & Kid (White Stripes)');
  });

  it('refuses an unknown template, and anyone but the owner', async () => {
    expect((await fromTemplate('owner', { templateId: 'karate' })).status).toBe(400);
    expect((await fromTemplate('coach', { templateId: 'ibjjf' })).status).toBe(403);
  });

  it('duplicate copies the ladder, skills and settings — not the students', async () => {
    const src = await superuser.discipline.create({
      data: { id: randomUUID(), schoolId: school.id, name: 'Judo', classTypesOffered: ['Randori'], skillsRequiredToGrade: true, boardGettingThere: 40, boardReadyToGrade: 80 },
    });
    const throwSkill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: src.id, schoolId: school.id, name: 'O-goshi', description: 'Hip throw' } });
    const pinSkill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: src.id, schoolId: school.id, name: 'Kesa-gatame' } });
    const rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: src.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' },
    });
    const tier = await superuser.rankStripeTier.create({
      data: {
        id: randomUUID(),
        rankId: rank.id,
        schoolId: school.id,
        order: 0,
        count: 1,
        colour: '#C23B3B',
        name: 'White · 1',
        stripeSegments: [{ count: 1, colour: '#C23B3B' }],
        classesRequired: 12,
        minimumDaysInRank: 30,
        weeklyClassCountCap: 2,
        eligibleClassTypes: ['Randori'],
      },
    });
    await superuser.rankStripeTierRequiredSkill.createMany({ data: [throwSkill.id, pinSkill.id].map((skillId) => ({ stripeTierId: tier.id, skillId })) });
    const student = await mkUser('student');
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: student.id, disciplineId: src.id, schoolId: school.id, currentRankId: rank.id, currentStripeId: tier.id },
    });

    expect((await duplicate('coach', src.id)).status).toBe(403);

    const res = await duplicate('owner', src.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Judo (Copy)', classTypesOffered: ['Randori'], skillsRequiredToGrade: true, boardGettingThere: 40, boardReadyToGrade: 80 });
    const copyId = res.body.id;
    expect(copyId).not.toBe(src.id);

    const skills = await superuser.skill.findMany({ where: { disciplineId: copyId }, orderBy: { name: 'asc' } });
    expect(skills.map((s) => [s.name, s.description])).toEqual([
      ['Kesa-gatame', null],
      ['O-goshi', 'Hip throw'],
    ]);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s.id]));

    const [belt] = await ladder(copyId);
    expect(belt).toMatchObject({ name: 'White', primaryColour: '#FFFFFF', schoolId: school.id });
    expect(belt.id).not.toBe(rank.id);
    expect(belt.stripeTiers).toHaveLength(1);
    expect(belt.stripeTiers[0]).toMatchObject({
      name: 'White · 1',
      classesRequired: 12,
      minimumDaysInRank: 30,
      weeklyClassCountCap: 2,
      eligibleClassTypes: ['Randori'],
      stripeSegments: [{ count: 1, colour: '#C23B3B' }],
    });
    expect(belt.stripeTiers[0].requiredSkills.map((r) => r.skillId).sort()).toEqual([byName['O-goshi'], byName['Kesa-gatame']].sort());

    // No students come across; the original is untouched.
    expect(await superuser.studentRank.count({ where: { disciplineId: copyId } })).toBe(0);
    expect(await superuser.studentRank.count({ where: { disciplineId: src.id } })).toBe(1);
    expect(await superuser.skill.count({ where: { disciplineId: src.id } })).toBe(2);
  });

  it('a style from a template can be duplicated too', async () => {
    const made = await fromTemplate('owner', { templateId: 'ibjjf_kids_red', name: 'Kids BJJ' });
    const res = await duplicate('owner', made.body.id);
    expect(res.status).toBe(201);
    const belts = await ladder(res.body.id);
    expect(belts.reduce((n, b) => n + b.stripeTiers.length, 0)).toBe(139);
  });
});
