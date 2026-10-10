/**
 * The student app's grading view (Decisions 132, 142, 155, 161):
 * GET /students/{id}/grading gives the student, and each guardian of theirs,
 * every style they hold a rank in at every School they're a student at, with
 * the names, ladder, progress and skills the app needs. Nobody else may read
 * it, and nothing from another student or a School they've left shows. Real HTTP.
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
  console.warn('[student-grading-overview.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Student app grading view (Decisions 132, 142, 155, 161)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  const school: Record<string, string> = {};
  const style: Record<string, string> = {};
  const rung: Record<string, string> = {};
  let armbar = '';

  async function person(label: string, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT'; schoolId: string; revoked?: boolean }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `overview-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Overview',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    for (const g of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId, revokedAt: g.revoked ? new Date() : null } });
    }
    const live = grants.filter((g) => !g.revoked);
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: live.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })) });
  }

  /** A belt with stripes 0..n-1 in a style, each needing 10 classes and 30 days. */
  async function belt(styleLabel: string, order: number, name: string, colour: string, stripes: number) {
    const s = style[styleLabel];
    const schoolId = (await superuser.discipline.findUniqueOrThrow({ where: { id: s } })).schoolId;
    const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: s, schoolId, order, name, primaryColour: colour } });
    for (let t = 0; t < stripes; t++) {
      const tierName = t === 0 ? name : `${name} · ${t} Stripe${t === 1 ? '' : 's'}`;
      const tier = await superuser.rankStripeTier.create({
        data: { id: randomUUID(), rankId: rank.id, schoolId, order: t, count: t, colour: '#000000', name: tierName, classesRequired: 10, minimumDaysInRank: 30 },
      });
      rung[tierName] = tier.id;
    }
    return rank.id;
  }

  const get = (label: string, studentLabel: string) => request(app.getHttpServer()).get(`/v1/students/${id[studentLabel]}/grading`).set('Authorization', `Bearer ${token[label]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    for (const name of ['Alpha Dojo', 'Beta Dojo', 'Left Dojo']) {
      school[name] = (await superuser.school.create({ data: { id: randomUUID(), name, ranksToggle: true } })).id;
      schoolIds.push(school[name]);
    }
    style.BJJ = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school['Alpha Dojo'], name: 'BJJ' } })).id;
    style.Judo = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school['Beta Dojo'], name: 'Judo' } })).id;
    style.Left = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school['Left Dojo'], name: 'Karate' } })).id;
    const whiteId = await belt('BJJ', 0, 'White Belt', '#FFFFFF', 2);
    await belt('BJJ', 1, 'Blue Belt', '#0000FF', 1);
    await belt('Judo', 0, 'Yellow Belt', '#FFFF00', 1);
    await belt('Judo', 1, 'Orange Belt', '#FFA500', 1);
    await belt('Left', 0, 'Karate White', '#FFFFFF', 1);
    armbar = (await superuser.skill.create({ data: { id: randomUUID(), disciplineId: style.BJJ, schoolId: school['Alpha Dojo'], name: 'Armbar' } })).id;
    await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: rung['White Belt · 1 Stripe'], skillId: armbar } });

    await person('student', [
      { role: 'STUDENT', schoolId: school['Alpha Dojo'] },
      { role: 'STUDENT', schoolId: school['Beta Dojo'] },
      { role: 'STUDENT', schoolId: school['Left Dojo'], revoked: true },
    ]);
    await person('other', [{ role: 'STUDENT', schoolId: school['Alpha Dojo'] }]);
    await person('guardian', []);
    await person('stranger', []);
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: id.guardian, studentId: id.student } });

    const day = (n: number) => new Date(Date.now() - n * 86_400_000);
    const sr = await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: id.student, disciplineId: style.BJJ, schoolId: school['Alpha Dojo'], currentRankId: whiteId,
        currentStripeId: rung['White Belt'], dateOfCurrentRank: day(40), classesAttendedTowardCheckpoint: 10,
      },
    });
    await superuser.studentRankSkillStatus.create({ data: { id: randomUUID(), studentRankId: sr.id, schoolId: school['Alpha Dojo'], studentId: id.student, skillId: armbar, status: 'LEARNING' } });
    const yellow = await superuser.rank.findFirstOrThrow({ where: { disciplineId: style.Judo, order: 0 } });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.student, disciplineId: style.Judo, schoolId: school['Beta Dojo'], currentRankId: yellow.id, currentStripeId: rung['Yellow Belt'], dateOfCurrentRank: day(40), classesAttendedTowardCheckpoint: 10 },
    });
    // Left Dojo: a rank from before they left; it must not show.
    const leftBelt = await superuser.rank.findFirstOrThrow({ where: { disciplineId: style.Left } });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.student, disciplineId: style.Left, schoolId: school['Left Dojo'], currentRankId: leftBelt.id, currentStripeId: rung['Karate White'], dateOfCurrentRank: day(40) },
    });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.other, disciplineId: style.BJJ, schoolId: school['Alpha Dojo'], currentRankId: whiteId, currentStripeId: rung['White Belt'] },
    });
  });

  afterAll(async () => {
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skillId: armbar } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.skill.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: id.guardian } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the student sees each style at each of their Schools, with names, ladder, progress and skills', async () => {
    const res = await get('student', 'student');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { schoolName: string; disciplineName: string }) => `${i.schoolName} / ${i.disciplineName}`)).toEqual(['Alpha Dojo / BJJ', 'Beta Dojo / Judo']);
    const bjj = res.body.items[0];
    expect(bjj.ladder.map((r: { name: string }) => r.name)).toEqual(['White Belt', 'White Belt · 1 Stripe', 'Blue Belt']);
    expect(bjj.ladder[2]).toMatchObject({ beltName: 'Blue Belt', primaryColour: '#0000FF', stripeCount: 0, timeOnly: false });
    expect(bjj.currentStripeId).toBe(rung['White Belt']);
    // Decision 161: progress and readiness are always shown.
    expect(bjj.eligibility).toMatchObject({ hasNext: true, nextRungId: rung['White Belt · 1 Stripe'], classesOk: true, daysOk: true, skillsOk: false, eligible: false });
    expect(bjj.skills).toEqual([{ id: armbar, name: 'Armbar', status: 'LEARNING', required: true }]);
    const judo = res.body.items[1];
    expect(judo.eligibility).toMatchObject({ eligible: true, boardColumn: 'READY_TO_GRADE' });
    expect(judo.skills).toEqual([]);
  });

  it('a guardian sees the same, without holding any role at the Schools', async () => {
    const mine = await get('student', 'student');
    const theirs = await get('guardian', 'student');
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual(mine.body);
  });

  it('nobody else can read it, and the student\'s view shows only their own', async () => {
    expect((await get('stranger', 'student')).status).toBe(403);
    expect((await get('other', 'student')).status).toBe(403);
    expect((await get('guardian', 'other')).status).toBe(403);
    const other = await get('other', 'other');
    expect(other.body.items).toHaveLength(1);
    expect(other.body.items[0]).toMatchObject({ schoolName: 'Alpha Dojo', skills: [{ id: armbar, status: 'NOT_STARTED' }] });
  });

  it('a School the student left is not shown, nor a style with no rank', async () => {
    const res = await get('student', 'student');
    expect(res.body.items.some((i: { schoolId: string }) => i.schoolId === school['Left Dojo'])).toBe(false);
  });
});
