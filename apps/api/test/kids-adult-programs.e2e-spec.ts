/**
 * Backlog 3.20 over real HTTP (Decisions 281, 285, 297, 298): Kids and Adult
 * are two linked styles. From the Kids style's "Ready for Adult from age"
 * (default 16) a kid shows "Ready for Adult program" on the board and can be
 * graded into the Adult style, onto an adult rank above its first belt. Their
 * rank row moves to Adult with its history; sign-offs carry over to Adult
 * skills of the same name; only the class count starts again.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[kids-adult-programs.e2e-spec] Skipped — database / secrets not set.');
}

const yearsAgo = (years: number, days = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - days);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

describeIfDb('Kids and Adult programs (backlog 3.20)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let school: { id: string };
  let kids: { id: string };
  let adult: { id: string };
  let other: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const skill: Record<string, string> = {};
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};

  const as = (who: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token[who]}`);
    const server = () => request(app.getHttpServer());
    return { get: (p: string) => auth(server().get(p)), post: (p: string) => auth(server().post(p)), patch: (p: string) => auth(server().patch(p)), put: (p: string) => auth(server().put(p)) };
  };
  const move = (who: string, student: string, body: object) => as(who).post(`/v1/students/${id[student]}/ranks/${kids.id}/move-to-adult`).send(body);
  const board = (who: string, disciplineId: string) => as(who).get(`/v1/schools/${school.id}/grading-board?disciplineId=${disciplineId}`);

  async function mkUser(label: string, dateOfBirth: Date) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(), email: `kids-adult-${label}-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label, surname: 'Prog', passcodeHash: 'x', dateOfBirth, phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
  }
  async function ladder(disciplineId: string, belts: Array<[string, number]>) {
    for (const [order, [name, stripes]] of belts.entries()) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t <= stripes; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: t ? `${name} ${t}` : name, classesRequired: 3 },
        });
        rung[`${t ? `${name} ${t}` : name}`] = { id: tier.id, rankId: rank.id };
      }
    }
  }
  async function kid(label: string, dateOfBirth: Date, at = 'Grey') {
    await mkUser(label, dateOfBirth);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: id[label], schoolId: school.id } });
    await giveLiveMembership(superuser, school.id, id[label]);
    const sr = await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: id[label], disciplineId: kids.id, schoolId: school.id, currentRankId: rung[at].rankId, currentStripeId: rung[at].id,
        classesAttendedTowardCheckpoint: 5, dateOfCurrentRank: new Date(Date.now() - 90 * 86_400_000),
      },
    });
    return sr;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: `Kids Adult ${randomUUID().slice(0, 6)}`, ranksToggle: true } });
    kids = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ Kids' } });
    adult = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    other = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    await ladder(kids.id, [['Kids White', 0], ['Grey', 0], ['Green', 0]]);
    await ladder(adult.id, [['White', 1], ['Blue', 0], ['Purple', 0]]);
    for (const [disciplineId, name] of [[kids.id, 'Armbar'], [kids.id, 'Kids only'], [adult.id, 'Armbar']] as const) {
      const s = await superuser.skill.create({ data: { id: randomUUID(), disciplineId, schoolId: school.id, name } });
      skill[`${disciplineId === kids.id ? 'kids' : 'adult'} ${name}`] = s.id;
    }

    await mkUser('owner', yearsAgo(40));
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.owner, schoolId: school.id } });
    token.owner = jwt.sign({ sub: id.owner, email: 'o@example.test', grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    // A coach who grades Kids but may not change its settings, and one who may.
    for (const [label, settings] of [['coach', false], ['settingsCoach', true]] as const) {
      await mkUser(label, yearsAgo(30));
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: id[label], schoolId: school.id } });
      await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: id[label], disciplineId: kids.id, canChangeBoardThresholds: settings } });
      token[label] = jwt.sign({ sub: id[label], email: `${label}@example.test`, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });
    }
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    await superuser.promotionEvent.deleteMany({ where });
    await superuser.studentRankSkillStatus.deleteMany({ where });
    await superuser.studentRank.deleteMany({ where });
    await superuser.gradingPermission.deleteMany({ where });
    await superuser.skill.deleteMany({ where });
    await superuser.rankStripeTier.deleteMany({ where });
    await superuser.rank.deleteMany({ where });
    await superuser.discipline.updateMany({ where, data: { adultDisciplineId: null } });
    await superuser.discipline.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner links the Kids style to its Adult style; one level only', async () => {
    expect((await as('owner').patch(`/v1/disciplines/${kids.id}`).send({ adultDisciplineId: kids.id })).status).toBe(400);
    const linked = await as('owner').patch(`/v1/disciplines/${kids.id}`).send({ adultDisciplineId: adult.id });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ adultDisciplineId: adult.id, readyForAdultAge: 16 });
    // Adult can't become a Kids style too, nor link to a Kids style.
    expect((await as('owner').patch(`/v1/disciplines/${adult.id}`).send({ adultDisciplineId: other.id })).status).toBe(400);
    expect((await as('owner').patch(`/v1/disciplines/${other.id}`).send({ adultDisciplineId: kids.id })).status).toBe(400);
    // A coach can't link styles.
    expect((await as('coach').patch(`/v1/disciplines/${kids.id}`).send({ adultDisciplineId: null })).status).toBe(403);
  });

  it('the age is a style setting: the owner or "Change grading settings"', async () => {
    expect((await as('coach').put(`/v1/disciplines/${kids.id}/ready-for-adult-age`).send({ age: 15 })).status).toBe(403);
    expect((await as('settingsCoach').put(`/v1/disciplines/${kids.id}/ready-for-adult-age`).send({ age: 15 })).body.readyForAdultAge).toBe(15);
    expect((await as('owner').put(`/v1/disciplines/${kids.id}/ready-for-adult-age`).send({ age: 16 })).body.readyForAdultAge).toBe(16);
    expect((await as('owner').put(`/v1/disciplines/${other.id}/ready-for-adult-age`).send({ age: 16 })).body.error.code).toBe('ADULT_NOT_LINKED');
  });

  it('the board tags kids who have reached the age', async () => {
    await kid('Ana', yearsAgo(16, 1));
    await kid('Ben', yearsAgo(15));
    const items = (await board('owner', kids.id)).body.items as Array<{ firstName: string; readyForAdult: boolean }>;
    expect(Object.fromEntries(items.map((i) => [i.firstName, i.readyForAdult]))).toEqual({ Ana: true, Ben: false });
    expect(((await board('owner', adult.id)).body.items as unknown[]).length).toBe(0);
  });

  it('too young, a first adult belt, or not linked: refused', async () => {
    expect((await move('coach', 'Ben', { targetRungId: rung.Blue.id })).body.error.code).toBe('ADULT_TOO_YOUNG');
    expect((await move('coach', 'Ana', { targetRungId: rung['White 1'].id })).body.error.code).toBe('ADULT_FIRST_BELT');
    expect((await move('coach', 'Ana', { targetRungId: rung.Green.id })).status).toBe(400);
  });

  it('grading Ana into Adult moves her rank and history; matching sign-offs carry over; classes restart', async () => {
    const sr = await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: id.Ana, disciplineId: kids.id } } });
    for (const s of ['kids Armbar', 'kids Kids only']) {
      await superuser.studentRankSkillStatus.create({ data: { id: randomUUID(), studentRankId: sr.id, schoolId: school.id, studentId: id.Ana, skillId: skill[s], status: 'SIGNED_OFF' } });
    }
    const res = await move('coach', 'Ana', { targetRungId: rung.Blue.id, note: 'Turned 16' });
    expect(res.status).toBe(201);
    const moved = await superuser.studentRank.findUniqueOrThrow({ where: { id: sr.id }, include: { skillStatuses: true } });
    expect(moved).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id, classesAttendedTowardCheckpoint: 0 });
    expect(moved.skillStatuses.filter((s) => s.status === 'SIGNED_OFF').map((s) => s.skillId).sort()).toEqual(
      [skill['kids Armbar'], skill['kids Kids only'], skill['adult Armbar']].sort(),
    );
    const event = await superuser.promotionEvent.findFirstOrThrow({ where: { studentRankId: sr.id } });
    expect(event).toMatchObject({ type: 'PROMOTION', fromStripeTierId: rung.Grey.id, toStripeTierId: rung.Blue.id, systemNote: 'Moved to Adult program.', note: 'Turned 16', performedById: id.coach });
    // She is under Adult now, not Kids.
    expect(((await board('owner', kids.id)).body.items as Array<{ firstName: string }>).map((i) => i.firstName)).toEqual(['Ben']);
    expect(((await board('owner', adult.id)).body.items as Array<{ firstName: string }>).map((i) => i.firstName)).toEqual(['Ana']);
    // A second move has nothing to move.
    expect((await move('coach', 'Ana', { targetRungId: rung.Purple.id })).status).toBe(400);
  });

  it('a kid who already has an Adult rank is refused', async () => {
    await kid('Cy', yearsAgo(17));
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.Cy, disciplineId: adult.id, schoolId: school.id, currentRankId: rung.White.rankId, currentStripeId: rung.White.id },
    });
    expect((await move('owner', 'Cy', { targetRungId: rung.Blue.id })).body.error.code).toBe('ADULT_ALREADY');
  });
});
