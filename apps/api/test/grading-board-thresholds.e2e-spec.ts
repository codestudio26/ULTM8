/**
 * Grading Board columns per style (Decisions 75, 136, 181): 33% / 66% by
 * default; changed by the owner or a coach with "Change board %" for the
 * style; used by the board, the student's readiness and the board move.
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
  console.warn('[grading-board-thresholds.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Grading Board columns per style (Decisions 75, 136, 181)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let bjj: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  let coach: { id: string };
  let ana: { id: string };

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `board-thresholds-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Thresholds',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  const http = () => request(app.getHttpServer());
  const setThresholds = (who: string, body: object) => http().put(`/v1/disciplines/${bjj.id}/board-thresholds`).set('Authorization', `Bearer ${token[who]}`).send(body);
  const board = () => http().get(`/v1/schools/${school.id}/grading-board?disciplineId=${bjj.id}`).set('Authorization', `Bearer ${token.owner}`);
  const anaColumn = async () => (await board()).body.items.find((i: { studentId: string }) => i.studentId === ana.id).eligibility.boardColumn;
  const allow = (canChangeBoardThresholds: boolean) =>
    superuser.gradingPermission.upsert({
      where: { userId_disciplineId: { userId: coach.id, disciplineId: bjj.id } },
      create: { id: randomUUID(), schoolId: school.id, userId: coach.id, disciplineId: bjj.id, canChangeBoardThresholds },
      update: { canChangeBoardThresholds },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Board Thresholds School', ranksToggle: true } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
    const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    for (let t = 0; t < 2; t++) {
      const tier = await superuser.rankStripeTier.create({
        data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `White ${t}`, stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], classesRequired: 10 },
      });
      rung[`White ${t}`] = { id: tier.id, rankId: rank.id };
    }

    const owner = await mkUser('owner');
    coach = await mkUser('coach');
    ana = await mkUser('ana');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: ana.id, schoolId: school.id },
      ],
    });
    // 7 of 10 classes: 70%.
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: ana.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: rung['White 0'].rankId, currentStripeId: rung['White 0'].id, classesAttendedTowardCheckpoint: 7 },
    });
    token.owner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    token.coach = jwt.sign({ sub: coach.id, email: 'coach', grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });
    token.ana = jwt.sign({ sub: ana.id, email: 'ana', grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a style starts at 33% / 66%', async () => {
    const res = await http().get(`/v1/disciplines/${bjj.id}`).set('Authorization', `Bearer ${token.owner}`);
    expect(res.body).toMatchObject({ boardGettingThere: 33, boardReadyToGrade: 66 });
    expect(await anaColumn()).toBe('READY_TO_GRADE'); // 70% ≥ 66
  });

  it('the owner changes them; the board and the student\'s readiness follow', async () => {
    const res = await setThresholds('owner', { gettingThere: 50, readyToGrade: 90 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ boardGettingThere: 50, boardReadyToGrade: 90 });
    expect(await anaColumn()).toBe('GETTING_THERE'); // 70% is now below 90

    const elig = await http().get(`/v1/students/${ana.id}/eligibility?schoolId=${school.id}`).set('Authorization', `Bearer ${token.owner}`);
    expect(elig.body.items[0].eligibility.boardColumn).toBe('GETTING_THERE');
  });

  it('moving to a column uses the style\'s own %', async () => {
    const res = await http()
      .post(`/v1/students/${ana.id}/ranks/${bjj.id}/board-move`)
      .set('Authorization', `Bearer ${token.owner}`)
      .send({ column: 'READY_TO_GRADE' });
    expect(res.status).toBe(201);
    const sr = await superuser.studentRank.findFirstOrThrow({ where: { studentId: ana.id } });
    expect(sr.classesAttendedTowardCheckpoint).toBe(9); // 90% of 10
    expect(await anaColumn()).toBe('READY_TO_GRADE');
  });

  it('values must be whole percentages, Getting There below Ready to Grade', async () => {
    expect((await setThresholds('owner', { gettingThere: 60, readyToGrade: 50 })).status).toBe(400);
    expect((await setThresholds('owner', { gettingThere: 50, readyToGrade: 50 })).status).toBe(400);
    expect((await setThresholds('owner', { gettingThere: 0, readyToGrade: 50 })).status).toBe(400);
    expect((await setThresholds('owner', { gettingThere: 50, readyToGrade: 100 })).status).toBe(400);
    expect((await setThresholds('owner', { gettingThere: 33.5, readyToGrade: 66 })).status).toBe(400);
  });

  it('a coach needs "Change board %" for the style; a student can\'t', async () => {
    await allow(false);
    const refused = await setThresholds('coach', { gettingThere: 40, readyToGrade: 80 });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toContain('Change board %');

    await allow(true);
    const ok = await setThresholds('coach', { gettingThere: 40, readyToGrade: 80 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ boardGettingThere: 40, boardReadyToGrade: 80 });

    expect((await setThresholds('ana', { gettingThere: 10, readyToGrade: 20 })).status).toBe(403);
  });
});
