/**
 * Backlog 3.13 (Decisions 286, 299) over real HTTP: a student asks for their
 * belt to be corrected, to any rung on that style's ladder, with a note. The
 * owner, or a coach with "Verify ranks" for the style who covers the
 * student's branch, approves it (the student moves, with a RANK_CORRECTION
 * history entry) or rejects it (nothing changes). Students never change
 * their own rank.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[rank-corrections.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Belt correction requests (backlog 3.13)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};
  let school: { id: string };
  let other: { id: string };
  let bjj: string;
  /** White (plain, 1 stripe) then Blue (plain). */
  const rung: Record<string, { rankId: string; tierId: string }> = {};

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `rank-corr-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Corr',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
  }
  async function signAs(label: string) {
    const grants = await superuser.roleGrant.findMany({ where: { userId: id[label], revokedAt: null } });
    token[label] = jwt.sign({ sub: id[label], email: `${label}@example.test`, grants: grants.map((g) => ({ role: g.role, franchiseId: g.franchiseId, schoolId: g.schoolId, branchId: g.branchId })) });
  }
  const as = (label: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token[label]}`);
    const server = () => request(app.getHttpServer());
    return { get: (p: string) => auth(server().get(p)), post: (p: string) => auth(server().post(p)) };
  };
  const ask = (label: string, to: string, note = 'I was promoted at my old club.') =>
    as(label).post('/v1/rank-corrections').send({ disciplineId: bjj, stripeTierId: rung[to].tierId, note });
  const rankOf = (label: string) => superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: id[label], disciplineId: bjj } } });
  const setRank = (label: string, to: string) =>
    superuser.studentRank.update({ where: { studentId_disciplineId: { studentId: id[label], disciplineId: bjj } }, data: { currentRankId: rung[to].rankId, currentStripeId: rung[to].tierId } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Correction Dojo', ranksToggle: true } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Dojo', ranksToggle: true } });
    schoolIds.push(school.id, other.id);
    const north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    const south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    bjj = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } })).id;
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const blue = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj, schoolId: school.id, order: 1, name: 'Blue', primaryColour: '#0000FF' } });
    const tier = (rankId: string, order: number, name: string) =>
      superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId, schoolId: school.id, order, count: order, colour: '#000000', name } });
    rung.white0 = { rankId: white.id, tierId: (await tier(white.id, 0, 'White')).id };
    rung.white1 = { rankId: white.id, tierId: (await tier(white.id, 1, 'White · 1 Stripe')).id };
    rung.blue0 = { rankId: blue.id, tierId: (await tier(blue.id, 0, 'Blue')).id };

    await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.owner, schoolId: school.id } });
    await mkUser('otherOwner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.otherOwner, schoolId: other.id } });
    // North coaches: one may verify BJJ, one may grade but not verify; a South coach may verify.
    for (const [label, branchId, canVerifyRanks] of [['coach', north.id, true], ['grader', north.id, false], ['southCoach', south.id, true]] as const) {
      await mkUser(label);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: id[label], schoolId: school.id, branchId } });
      await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: id[label], disciplineId: bjj, canVerifyRanks } });
    }
    for (const [label, verified] of [['Ana', true], ['Ben', true], ['Cy', false]] as const) {
      await mkUser(label);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: id[label], schoolId: school.id } });
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: id[label], branchId: north.id } });
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: id[label], disciplineId: bjj, schoolId: school.id,
          currentRankId: rung.white0.rankId, currentStripeId: rung.white0.tierId, verificationStatus: verified ? 'VERIFIED' : 'UNVERIFIED',
        },
      });
    }
    for (const label of ['owner', 'otherOwner', 'coach', 'grader', 'southCoach', 'Ana', 'Ben', 'Cy']) await signAs(label);
  });

  afterAll(async () => {
    await superuser.rankCorrectionRequest.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a student asks for any rung of the ladder, with a note; one waiting request per style', async () => {
    expect((await ask('Ana', 'white0')).body.error.code).toBe('CORRECTION_SAME_RANK');
    expect((await ask('Ana', 'blue0', '   ')).status).toBe(400);
    const wrongTier = await as('Ana').post('/v1/rank-corrections').send({ disciplineId: bjj, stripeTierId: randomUUID(), note: 'x' });
    expect(wrongTier.status).toBe(400);

    const res = await ask('Ana', 'blue0');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'PENDING',
      firstName: 'Ana',
      disciplineName: 'BJJ',
      from: { rankName: 'White', stripeName: 'White' },
      requested: { rankName: 'Blue', stripeName: 'Blue' },
      note: 'I was promoted at my old club.',
    });
    const again = await ask('Ana', 'white1');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CORRECTION_PENDING');
    expect((await as('Ana').get('/v1/rank-corrections/me')).body.items).toHaveLength(1);
    // Their belt hasn't moved.
    expect((await rankOf('Ana')).currentRankId).toBe(rung.white0.rankId);
  });

  it('a belt still waiting to be verified is corrected while verifying instead', async () => {
    const res = await ask('Cy', 'blue0');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CORRECTION_NOT_VERIFIED');
  });

  it('reviewers are the owner and coaches who may verify this style for the student\'s branch', async () => {
    const pending = (label: string) => as(label).get(`/v1/schools/${school.id}/rank-corrections`);
    expect((await pending('owner')).body.items.map((i: { firstName: string }) => i.firstName)).toEqual(['Ana']);
    expect((await pending('coach')).body.items).toHaveLength(1);
    expect((await pending('grader')).body.items).toHaveLength(0);
    expect((await pending('southCoach')).body.items).toHaveLength(0);
    expect((await pending('Ana')).status).toBe(403);
    expect((await as('otherOwner').get(`/v1/schools/${school.id}/rank-corrections`)).status).toBe(403);

    const [item] = (await pending('owner')).body.items;
    expect((await as('grader').post(`/v1/rank-corrections/${item.id}/approve`).send({})).status).toBe(403);
    expect((await as('southCoach').post(`/v1/rank-corrections/${item.id}/approve`).send({})).status).toBe(403);
    expect([403, 404]).toContain((await as('otherOwner').post(`/v1/rank-corrections/${item.id}/approve`).send({})).status);
    // A student can't answer their own.
    expect([403, 404]).toContain((await as('Ana').post(`/v1/rank-corrections/${item.id}/approve`).send({})).status);
  });

  it('approving moves the student, with a RANK_CORRECTION history entry; it can be answered once', async () => {
    const [item] = (await as('coach').get(`/v1/schools/${school.id}/rank-corrections`)).body.items;
    const res = await as('coach').post(`/v1/rank-corrections/${item.id}/approve`).send({ note: 'Checked with their old coach.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', reviewNote: 'Checked with their old coach.' });
    const sr = await rankOf('Ana');
    expect(sr).toMatchObject({ currentRankId: rung.blue0.rankId, currentStripeId: rung.blue0.tierId });
    const event = await superuser.promotionEvent.findFirstOrThrow({ where: { studentId: id.Ana, type: 'RANK_CORRECTION' } });
    expect(event).toMatchObject({
      performedById: id.coach,
      fromRankId: rung.white0.rankId,
      toRankId: rung.blue0.rankId,
      systemNote: "Corrected at the student's request.",
      note: 'Checked with their old coach.',
    });
    const again = await as('owner').post(`/v1/rank-corrections/${item.id}/reject`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CORRECTION_ANSWERED');
    expect((await as('Ana').get('/v1/rank-corrections/me')).body.items[0]).toMatchObject({ status: 'APPROVED' });
    const answered = await as('owner').get(`/v1/schools/${school.id}/rank-corrections?status=ANSWERED&studentId=${id.Ana}`);
    expect(answered.body.items).toHaveLength(1);
  });

  it('rejecting changes nothing, and the student can ask again', async () => {
    const asked = await ask('Ben', 'white1');
    const res = await as('owner').post(`/v1/rank-corrections/${asked.body.id}/reject`).send({ note: '  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', reviewNote: null });
    expect((await rankOf('Ben')).currentStripeId).toBe(rung.white0.tierId);
    expect((await ask('Ben', 'white1')).status).toBe(201);
  });

  it('a request whose student has moved since no longer applies, and waits again', async () => {
    const [item] = (await as('owner').get(`/v1/schools/${school.id}/rank-corrections?studentId=${id.Ben}`)).body.items;
    await setRank('Ben', 'blue0');
    const res = await as('owner').post(`/v1/rank-corrections/${item.id}/approve`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CORRECTION_STALE');
    expect((await superuser.rankCorrectionRequest.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('PENDING');
    expect((await rankOf('Ben')).currentRankId).toBe(rung.blue0.rankId);
    expect((await as('owner').post(`/v1/rank-corrections/${item.id}/reject`).send({})).status).toBe(200);
  });
});
