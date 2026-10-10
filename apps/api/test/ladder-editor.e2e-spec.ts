/**
 * Ladder editor support (Decisions 152, 180): rungs keep their identity (and
 * their students) when reordered within a belt, a rung students hold can't be
 * removed, belts can be reordered, and the owner can see who holds each rung.
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
  console.warn('[ladder-editor.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Ladder editor (Decisions 152, 180)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let bjj: { id: string };
  const belt: Record<string, string> = {};
  const rung: Record<string, string> = {};
  const userIds: string[] = [];
  let ownerToken: string;
  let coachToken: string;
  let sam: { id: string };

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `ladder-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Ladder',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  const http = () => request(app.getHttpServer());
  const tiersOf = async (rankId: string) =>
    superuser.rankStripeTier.findMany({ where: { rankId }, orderBy: { order: 'asc' }, select: { id: true, order: true, name: true } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Ladder School', ranksToggle: true } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
    for (const [name, order] of [['White', 0], ['Blue', 1], ['Purple', 2]] as const) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      belt[name] = rank.id;
      for (let t = 0; t < 3; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name} ${t}`, stripeSegments: t > 0 ? [{ count: t, colour: '#000000' }] : [], classesRequired: 10 },
        });
        rung[`${name} ${t}`] = tier.id;
      }
    }

    const owner = await mkUser('owner');
    const coach = await mkUser('coach');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id },
      ],
    });
    ownerToken = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    coachToken = jwt.sign({ sub: coach.id, email: coach.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });

    sam = await mkUser('Sam');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: sam.id, schoolId: school.id } });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: sam.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: belt.Blue, currentStripeId: rung['Blue 1'] },
    });
  });

  afterAll(async () => {
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  const tierBody = (id: string | undefined, order: number, count: number, name: string) => ({ ...(id ? { id } : {}), order, count, colour: '#000000', name });

  it('reorders stripes within a belt by id: each rung keeps its id and its students', async () => {
    const res = await http()
      .patch(`/v1/ranks/${belt.Blue}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ stripeTiers: [tierBody(rung['Blue 1'], 0, 1, 'Blue 1'), tierBody(rung['Blue 0'], 1, 0, 'Blue 0'), tierBody(rung['Blue 2'], 2, 2, 'Blue 2')] });
    expect(res.status).toBe(200);
    expect(await tiersOf(belt.Blue)).toEqual([
      { id: rung['Blue 1'], order: 0, name: 'Blue 1' },
      { id: rung['Blue 0'], order: 1, name: 'Blue 0' },
      { id: rung['Blue 2'], order: 2, name: 'Blue 2' },
    ]);
    const sr = await superuser.studentRank.findFirstOrThrow({ where: { studentId: sam.id } });
    expect(sr.currentStripeId).toBe(rung['Blue 1']);
  });

  it('a rung students hold can\'t be removed; one nobody holds can (Decision 152)', async () => {
    const held = await http()
      .patch(`/v1/ranks/${belt.Blue}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ stripeTiers: [tierBody(rung['Blue 0'], 0, 0, 'Blue 0'), tierBody(rung['Blue 2'], 1, 2, 'Blue 2')] });
    expect(held.status).toBe(409);
    expect(held.body.error.message).toContain('Sam Ladder');
    expect((await tiersOf(belt.Blue)).map((t) => t.id)).toContain(rung['Blue 1']);

    const free = await http()
      .patch(`/v1/ranks/${belt.Blue}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ stripeTiers: [tierBody(rung['Blue 1'], 0, 1, 'Blue 1'), tierBody(rung['Blue 0'], 1, 0, 'Blue 0'), tierBody(undefined, 2, 3, 'Blue 3')] });
    expect(free.status).toBe(200);
    const after = await tiersOf(belt.Blue);
    expect(after.map((t) => t.name)).toEqual(['Blue 1', 'Blue 0', 'Blue 3']);
    expect(after.map((t) => t.id)).not.toContain(rung['Blue 2']);
    rung['Blue 3'] = after[2].id;
  });

  it('without ids (older clients), removing the position a student holds is refused too', async () => {
    // Sam holds Blue 1, now at position 0. Keep only position 0: nobody holds the rest.
    const trim = await http()
      .patch(`/v1/ranks/${belt.Blue}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ stripeTiers: [{ order: 0, count: 1, colour: '#000000' }, { order: 1, count: 2, colour: '#000000' }] });
    expect(trim.status).toBe(200);
    const [first, second] = await tiersOf(belt.Blue);
    expect(first.id).toBe(rung['Blue 1']);
    await superuser.studentRank.updateMany({ where: { studentId: sam.id }, data: { currentStripeId: second.id } });

    const refused = await http()
      .patch(`/v1/ranks/${belt.Blue}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ stripeTiers: [{ order: 0, count: 1, colour: '#000000' }] });
    expect(refused.status).toBe(409);
    expect(await tiersOf(belt.Blue)).toHaveLength(2);
    rung['Blue held'] = second.id;
  });

  it('a rung can\'t move to another belt, and a new belt takes no rung ids', async () => {
    const foreign = await http()
      .patch(`/v1/ranks/${belt.Blue}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ stripeTiers: [tierBody(rung['Purple 0'], 0, 0, 'Purple 0')] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.message).toContain('within their own belt');

    const create = await http()
      .post(`/v1/styles/${bjj.id}/ranks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ order: 3, name: 'Brown', primaryColour: '#8B4513', stripeTiers: [tierBody(rung['Purple 0'], 0, 0, 'Brown 0')] });
    expect(create.status).toBe(400);
  });

  it('reorders belts: every belt once; students keep their rung', async () => {
    const before = await superuser.studentRank.findFirstOrThrow({ where: { studentId: sam.id } });
    const res = await http()
      .put(`/v1/styles/${bjj.id}/ranks/order`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ rankIds: [belt.White, belt.Purple, belt.Blue] });
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: string }) => r.id)).toEqual([belt.White, belt.Purple, belt.Blue]);
    const orders = await superuser.rank.findMany({ where: { disciplineId: bjj.id }, orderBy: { order: 'asc' }, select: { id: true } });
    expect(orders.map((r) => r.id)).toEqual([belt.White, belt.Purple, belt.Blue]);
    const after = await superuser.studentRank.findFirstOrThrow({ where: { studentId: sam.id } });
    expect(after.currentStripeId).toBe(before.currentStripeId);

    const missing = await http().put(`/v1/styles/${bjj.id}/ranks/order`).set('Authorization', `Bearer ${ownerToken}`).send({ rankIds: [belt.White, belt.Blue] });
    expect(missing.status).toBe(400);
    const coach = await http().put(`/v1/styles/${bjj.id}/ranks/order`).set('Authorization', `Bearer ${coachToken}`).send({ rankIds: [belt.White, belt.Blue, belt.Purple] });
    expect(coach.status).toBe(403);
  });

  it('the owner sees who holds each rung; staff can\'t', async () => {
    const res = await http().get(`/v1/styles/${bjj.id}/rung-holders`).set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ rungId: rung['Blue held'], students: [{ studentId: sam.id, firstName: 'Sam', surname: 'Ladder' }] }]);
    const coach = await http().get(`/v1/styles/${bjj.id}/rung-holders`).set('Authorization', `Bearer ${coachToken}`);
    expect(coach.status).toBe(403);
  });
});
