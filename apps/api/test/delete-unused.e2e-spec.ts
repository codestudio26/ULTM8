/**
 * Deleting (Decision 198): the School owner can delete a lesson, and a skill,
 * belt or style that has never been used. Anything in a student's record, an
 * instructor's declared belt, a class or a lesson keeps it, with a clear 409.
 * Owner only. Real HTTP.
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
  console.warn('[delete-unused.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Deleting what was never used (Decision 198)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  let school = '';
  let other = '';

  async function person(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT', schoolId: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `del-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Delete',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: u.id, schoolId } });
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
  }
  const del = (label: string, url: string) => request(app.getHttpServer()).delete(url).set('Authorization', `Bearer ${token[label]}`);
  const post = (label: string, url: string, body: object) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token[label]}`).send(body);

  /** A style with belts White (2 stripes), Blue, Purple and one skill on White · 1. */
  async function style(name: string) {
    const d = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school, name, classTypesOffered: ['Fundamentals'] } });
    const tiers: Record<string, string> = {};
    const belts: Record<string, string> = {};
    for (const [order, belt, stripes] of [[0, 'White', 2], [1, 'Blue', 1], [2, 'Purple', 1]] as const) {
      const r = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: d.id, schoolId: school, order, name: `${name} ${belt}`, primaryColour: '#fff' } });
      belts[belt] = r.id;
      for (let t = 0; t < stripes; t++) {
        tiers[`${belt}${t}`] = (await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: r.id, schoolId: school, order: t, count: t, colour: '#000', name: `${name} ${belt} ${t}` } })).id;
      }
    }
    const skill = (await superuser.skill.create({ data: { id: randomUUID(), disciplineId: d.id, schoolId: school, name: `${name} Armbar` } })).id;
    await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: tiers.White1, skillId: skill } });
    return { id: d.id, belts, tiers, skill };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    school = (await superuser.school.create({ data: { id: randomUUID(), name: 'Delete Dojo', ranksToggle: true } })).id;
    other = (await superuser.school.create({ data: { id: randomUUID(), name: 'Other Delete Dojo', ranksToggle: true } })).id;
    schoolIds.push(school, other);
    await person('owner', 'SCHOOL_OWNER_MANAGER', school);
    await person('coach', 'INSTRUCTOR', school);
    await person('student', 'STUDENT', school);
    await person('otherOwner', 'SCHOOL_OWNER_MANAGER', other);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.skillSignOffLog.deleteMany({ where });
    await superuser.promotionEvent.deleteMany({ where });
    await superuser.studentRankSkillStatus.deleteMany({ where });
    await superuser.studentRank.deleteMany({ where });
    await superuser.instructorBelt.deleteMany({ where });
    await superuser.gradingPermission.deleteMany({ where });
    await superuser.lessonSkill.deleteMany({ where: { lesson: where } });
    await superuser.lesson.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.instructor.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skill: where } });
    await superuser.rankStripeTier.deleteMany({ where });
    await superuser.rank.deleteMany({ where });
    await superuser.skill.deleteMany({ where });
    await superuser.discipline.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('lessons: the owner deletes one; a coach can\'t', async () => {
    const s = await style('Lessons');
    const lesson = await post('coach', `/v1/schools/${school}/curriculum/lessons`, { title: 'Armbar drill', format: 'PRERECORDED', skillIds: [s.skill] });
    expect(lesson.status).toBe(201);
    expect((await del('coach', `/v1/lessons/${lesson.body.id}`)).status).toBe(403);
    expect((await del('otherOwner', `/v1/lessons/${lesson.body.id}`)).status).toBe(404);
    expect((await del('owner', `/v1/lessons/${lesson.body.id}`)).status).toBe(204);
    expect(await superuser.lesson.count({ where: { id: lesson.body.id } })).toBe(0);
  });

  it('skills: deleted when never marked, coming off stripes and lessons; refused once a student was marked or it\'s a lesson\'s only skill', async () => {
    const s = await style('Skills');
    const spare = (await superuser.skill.create({ data: { id: randomUUID(), disciplineId: s.id, schoolId: school, name: 'Spare' } })).id;
    const both = await post('coach', `/v1/schools/${school}/curriculum/lessons`, { title: 'Two skills', format: 'PRERECORDED', skillIds: [s.skill, spare] });
    const only = await post('coach', `/v1/schools/${school}/curriculum/lessons`, { title: 'Only spare', format: 'PRERECORDED', skillIds: [spare] });
    expect((await del('owner', `/v1/skills/${spare}`)).status).toBe(409); // "Only spare" would have no skill
    await del('owner', `/v1/lessons/${only.body.id}`);
    expect((await del('coach', `/v1/skills/${spare}`)).status).toBe(403);
    expect((await del('owner', `/v1/skills/${spare}`)).status).toBe(204);
    expect((await superuser.lessonSkill.findMany({ where: { lessonId: both.body.id } })).map((l) => l.skillId)).toEqual([s.skill]);

    // Marked once (now Learning): kept.
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.student, disciplineId: s.id, schoolId: school, currentRankId: s.belts.White, currentStripeId: s.tiers.White0 },
    });
    expect((await request(app.getHttpServer()).patch(`/v1/students/${id.student}/skills/${s.skill}`).set('Authorization', `Bearer ${token.owner}`)).status).toBe(200);
    const res = await del('owner', `/v1/skills/${s.skill}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/marked/);
  });

  it('belts: an unused one is deleted and the rest close up; one held or in history is kept', async () => {
    const s = await style('Belts');
    expect((await del('coach', `/v1/ranks/${s.belts.Purple}`)).status).toBe(403);
    expect((await del('owner', `/v1/ranks/${s.belts.Blue}`)).status).toBe(204);
    const left = await superuser.rank.findMany({ where: { disciplineId: s.id }, orderBy: { order: 'asc' } });
    expect(left.map((r) => `${r.order}:${r.name}`)).toEqual(['0:Belts White', '1:Belts Purple']);
    expect(await superuser.rankStripeTier.count({ where: { rankId: s.belts.Blue } })).toBe(0);

    // Held now.
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.student, disciplineId: s.id, schoolId: school, currentRankId: s.belts.White, currentStripeId: s.tiers.White0 },
    });
    expect((await del('owner', `/v1/ranks/${s.belts.White}`)).status).toBe(409);
    // In history only: promoted to Purple and back down; White no longer held but in history.
    expect((await post('owner', `/v1/students/${id.student}/ranks/${s.id}/promote`, { targetRungId: s.tiers.Purple0, acknowledgeWithoutSkillSignoff: true })).status).toBe(201);
    const res = await del('owner', `/v1/ranks/${s.belts.White}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/history/);
  });

  it('styles: an unused one goes with its belts, skills and coach permissions, and comes off plans and instructors', async () => {
    const s = await style('Unused');
    await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school, userId: id.coach, disciplineId: s.id } });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000, disciplineIds: [s.id] } });
    const ins = await superuser.instructor.create({ data: { id: randomUUID(), userId: id.coach, schoolId: school, specializations: ['Unused', 'Boxing'], specializationStyleIds: [s.id] } });
    expect((await del('coach', `/v1/disciplines/${s.id}`)).status).toBe(403);
    expect([403, 404]).toContain((await del('otherOwner', `/v1/disciplines/${s.id}`)).status);
    expect((await del('owner', `/v1/disciplines/${s.id}`)).status).toBe(204);
    expect(await superuser.discipline.count({ where: { id: s.id } })).toBe(0);
    expect(await superuser.rank.count({ where: { disciplineId: s.id } })).toBe(0);
    expect(await superuser.skill.count({ where: { disciplineId: s.id } })).toBe(0);
    expect(await superuser.gradingPermission.count({ where: { disciplineId: s.id } })).toBe(0);
    expect((await superuser.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } })).disciplineIds).toEqual([]);
    expect(await superuser.instructor.findUniqueOrThrow({ where: { id: ins.id } })).toMatchObject({ specializationStyleIds: [], specializations: ['Boxing'] });
  });

  it('styles: kept while a student has a rank in it, or a class or lesson uses it', async () => {
    const ranked = await style('Ranked');
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.student, disciplineId: ranked.id, schoolId: school, currentRankId: ranked.belts.White, currentStripeId: ranked.tiers.White0 },
    });
    expect((await del('owner', `/v1/disciplines/${ranked.id}`)).status).toBe(409);

    const taught = await style('Taught');
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school, title: 'Taught class', styles: [{ disciplineId: taught.id, classType: 'Fundamentals' }], startDate: new Date(), endDate: new Date(Date.now() + 3_600_000) },
    });
    expect((await del('owner', `/v1/disciplines/${taught.id}`)).status).toBe(409);
    await superuser.class.delete({ where: { id: cls.id } });

    await post('coach', `/v1/schools/${school}/curriculum/lessons`, { title: 'Taught lesson', format: 'PRERECORDED', skillIds: [taught.skill] });
    const res = await del('owner', `/v1/disciplines/${taught.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Lessons/);
  });
});
