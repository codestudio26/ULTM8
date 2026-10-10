/**
 * Joining a School from the app, then declaring a current belt (Decisions
 * 137, 147, 209): a non-member sees the School's branch names, joins with a
 * home branch, is offered the School's styles and belts, and declares one per
 * style. A guardian does the same for a linked minor. Real HTTP.
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
  console.warn('[join-declare.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Join a School and declare a belt (Decisions 137, 147, 209)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};
  let school: { id: string };
  let ranksOff: { id: string };
  const branch: Record<string, string> = {};
  const style: Record<string, string> = {};
  const rung: Record<string, { rankId: string; tierId: string }> = {};

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `join-declare-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Joiner',
        passcodeHash: 'x',
        dateOfBirth: new Date(label === 'kid' ? '2016-01-01' : '2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
  }
  async function signAs(label: string) {
    const grants = await superuser.roleGrant.findMany({ where: { userId: id[label], revokedAt: null } });
    token[label] = jwt.sign({
      sub: id[label],
      email: `${label}@example.test`,
      grants: grants.map((g) => ({ role: g.role, franchiseId: g.franchiseId, schoolId: g.schoolId, branchId: g.branchId })),
    });
  }
  const http = () => request(app.getHttpServer());
  const options = (label: string, studentId: string, schoolId = school.id) =>
    http().get(`/v1/students/${studentId}/ranks/declare-options`).query({ schoolId }).set('Authorization', `Bearer ${token[label]}`);
  const declare = (label: string, studentId: string, styleName: string, rungName: string) =>
    http()
      .post(`/v1/students/${studentId}/ranks/${style[styleName]}/declare`)
      .set('Authorization', `Bearer ${token[label]}`)
      .send({ rankId: rung[rungName].rankId, stripeTierId: rung[rungName].tierId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Join Dojo', ranksToggle: true } });
    ranksOff = await superuser.school.create({ data: { id: randomUUID(), name: 'No Ranks Dojo', ranksToggle: false } });
    schoolIds.push(school.id, ranksOff.id);
    for (const name of ['North', 'South']) {
      branch[name] = (await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name } })).id;
    }
    // BJJ: White (plain, 1 stripe), then Blue. Judo: Yellow only.
    const ladders: Array<[string, Array<[string, string, number[]]>]> = [
      ['BJJ', [['White', '#FFFFFF', [0, 1]], ['Blue', '#0000FF', [0]]]],
      ['Judo', [['Yellow', '#FFFF00', [0]]]],
    ];
    for (const [styleName, belts] of ladders) {
      const d = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: styleName } });
      style[styleName] = d.id;
      for (const [order, [beltName, colour, counts]] of belts.entries()) {
        const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: d.id, schoolId: school.id, order, name: beltName, primaryColour: colour } });
        for (const [tierOrder, count] of counts.entries()) {
          const name = count === 0 ? beltName : `${beltName} · ${count} Stripe`;
          const tier = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: tierOrder, count, colour: '#000000', name } });
          rung[name] = { rankId: rank.id, tierId: tier.id };
        }
      }
    }

    await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.owner, schoolId: school.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.owner, schoolId: ranksOff.id } });
    await mkUser('ana'); // an adult who joins herself
    await mkUser('parent');
    await mkUser('kid');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'GUARDIAN', userId: id.parent } });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: id.parent, studentId: id.kid } });
    await mkUser('stranger');
    for (const label of ['ana', 'parent', 'stranger']) await signAs(label);
  });

  afterAll(async () => {
    // Close first: declaring runs the "ready to grade" check, whose background
    // job may still be writing notifications for these users.
    await app.close();
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
  });

  it('a student who has not joined sees the branch names, but may not be offered belts yet', async () => {
    const academy = await http().get(`/v1/academies/${school.id}`).set('Authorization', `Bearer ${token.ana}`);
    expect(academy.status).toBe(200);
    expect(academy.body.branches.map((b: { name: string }) => b.name)).toEqual(['North', 'South']);

    const res = await options('ana', id.ana);
    expect(res.status).toBe(403);
  });

  it('after joining with a home branch, the student is offered every style, lowest belt first', async () => {
    const join = await http().post(`/v1/schools/${school.id}/join`).set('Authorization', `Bearer ${token.ana}`).send({ branchId: branch.North });
    expect(join.status).toBe(201);
    token.ana = join.body.accessToken;

    const res = await options('ana', id.ana);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { disciplineName: string }) => i.disciplineName)).toEqual(['BJJ', 'Judo']);
    const bjj = res.body.items[0];
    expect(bjj.ladder.map((r: { name: string }) => r.name)).toEqual(['White', 'White · 1 Stripe', 'Blue']);
    expect(bjj.ladder[1]).toMatchObject({ id: rung['White · 1 Stripe'].tierId, rankId: rung['White · 1 Stripe'].rankId, beltName: 'White', stripeCount: 1 });
  });

  it('a belt above the first waits for the School to verify it; the plain first belt is verified straight away; a declared style is no longer offered', async () => {
    const above = await declare('ana', id.ana, 'BJJ', 'White · 1 Stripe');
    expect(above.status).toBe(201);
    expect(above.body.studentRank.verificationStatus).toBe('UNVERIFIED');

    const first = await declare('ana', id.ana, 'Judo', 'Yellow');
    expect(first.status).toBe(201);
    expect(first.body.studentRank.verificationStatus).toBe('VERIFIED');

    const res = await options('ana', id.ana);
    expect(res.body.items).toEqual([]);

    const again = await declare('ana', id.ana, 'BJJ', 'Blue');
    expect(again.status).toBe(409);
  });

  it('a guardian joins their child and declares the child\'s belt, reading the belts through the child', async () => {
    const join = await http().post(`/v1/schools/${school.id}/join`).set('Authorization', `Bearer ${token.parent}`).send({ studentId: id.kid, branchId: branch.South });
    expect(join.status).toBe(201);

    const res = await options('parent', id.kid);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { disciplineName: string }) => i.disciplineName)).toEqual(['BJJ', 'Judo']);

    const declared = await declare('parent', id.kid, 'BJJ', 'Blue');
    expect(declared.status).toBe(201);
    expect(declared.body.studentRank.verificationStatus).toBe('UNVERIFIED');
    const home = await superuser.studentHomeBranch.findFirst({ where: { schoolId: school.id, studentId: id.kid } });
    expect(home?.branchId).toBe(branch.South);
  });

  it('someone who is not the student or their guardian is refused', async () => {
    const res = await options('stranger', id.kid);
    expect(res.status).toBe(403);
    const declared = await declare('stranger', id.kid, 'Judo', 'Yellow');
    expect(declared.status).toBe(403);
  });

  it('a School with ranks switched off offers nothing to declare', async () => {
    const join = await http().post(`/v1/schools/${ranksOff.id}/join`).set('Authorization', `Bearer ${token.ana}`);
    expect(join.status).toBe(201);
    token.ana = join.body.accessToken;
    const res = await options('ana', id.ana, ranksOff.id);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
