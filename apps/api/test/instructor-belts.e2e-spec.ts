/**
 * Instructors' own belts (Decisions 108, 188): the instructor chooses a belt
 * per style from the School's ladder; it is unverified until the School
 * Owner verifies or corrects it, and changing it makes it unverified again.
 * Only instructors declare; only the owner verifies; the database refuses an
 * instructor verifying themselves. Real HTTP.
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
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[instructor-belts.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Instructors\' own belts (Decision 188)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appRole = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  let school: { id: string };
  let other: { id: string };
  const belt: Record<string, { disciplineId: string; rankId: string; tierId: string }> = {};

  async function person(label: string, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF' | 'STUDENT'; schoolId: string; revoked?: boolean }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `belts-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Belts',
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
    token[label] = jwt.sign({
      sub: u.id,
      email: u.email,
      grants: grants.filter((g) => !g.revoked).map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })),
    });
  }
  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token[label]}`),
    put: (url: string, body: object) => http().put(url).set('Authorization', `Bearer ${token[label]}`).send(body),
    post: (url: string, body: object = {}) => http().post(url).set('Authorization', `Bearer ${token[label]}`).send(body),
  });
  const declare = (label: string, b: { disciplineId: string; rankId: string; tierId: string }, schoolId = school.id) =>
    as(label).put(`/v1/schools/${schoolId}/instructor-belts/me/${b.disciplineId}`, { rankId: b.rankId, stripeTierId: b.tierId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Belts Dojo', ranksToggle: true } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Belts Dojo', ranksToggle: true } });
    schoolIds.push(school.id, other.id);
    for (const [style, schoolId] of [['BJJ', school.id], ['Judo', school.id], ['OtherBJJ', other.id]] as const) {
      const d = await superuser.discipline.create({ data: { id: randomUUID(), schoolId, name: style } });
      for (const [order, name] of ['Blue', 'Purple'].entries()) {
        const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: d.id, schoolId, order, name, primaryColour: '#0000FF' } });
        for (let t = 0; t < 2; t++) {
          const tier = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: rank.id, schoolId, order: t, count: t, colour: '#000000', name: `${name} ${t}` } });
          belt[`${style} ${name} ${t}`] = { disciplineId: d.id, rankId: rank.id, tierId: tier.id };
        }
      }
    }
    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    await person('otherOwner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: other.id }]);
    await person('coach', [{ role: 'INSTRUCTOR', schoolId: school.id }]);
    await person('quiet', [{ role: 'INSTRUCTOR', schoolId: school.id }]); // hasn't chosen yet
    await person('staff', [{ role: 'BRANCH_STAFF', schoolId: school.id }]);
    await person('student', [{ role: 'STUDENT', schoolId: school.id }]);
    await person('former', [{ role: 'INSTRUCTOR', schoolId: school.id, revoked: true }]);
  });

  afterAll(async () => {
    await superuser.instructorBelt.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await appRole.$disconnect();
    await app.close();
  });

  it('an instructor chooses a belt per style; it is unverified and listed as theirs', async () => {
    const bjj = await declare('coach', belt['BJJ Blue 1']);
    expect(bjj.status).toBe(200);
    expect(bjj.body).toMatchObject({ disciplineName: 'BJJ', beltName: 'Blue 1', verificationStatus: 'UNVERIFIED', verifiedAt: null, firstName: 'coach' });
    expect((await declare('coach', belt['Judo Purple 0'])).status).toBe(200);
    const mine = await as('coach').get(`/v1/schools/${school.id}/instructor-belts/me`);
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((b: { disciplineName: string; beltName: string }) => `${b.disciplineName}: ${b.beltName}`)).toEqual(['BJJ: Blue 1', 'Judo: Purple 0']);
  });

  it('the owner sees every instructor\'s belts and who hasn\'t chosen, then verifies one', async () => {
    const all = await as('owner').get(`/v1/schools/${school.id}/instructor-belts`);
    expect(all.status).toBe(200);
    expect(all.body.instructors.map((i: { firstName: string }) => i.firstName)).toEqual(['coach', 'quiet']);
    expect(all.body.items.filter((b: { userId: string }) => b.userId === id.coach)).toHaveLength(2);

    const verified = await as('owner').post(`/v1/schools/${school.id}/instructor-belts/${id.coach}/${belt['BJJ Blue 1'].disciplineId}/verify`);
    expect(verified.status).toBe(201);
    expect(verified.body).toMatchObject({ verificationStatus: 'VERIFIED', beltName: 'Blue 1' });
    expect(verified.body.verifiedAt).not.toBeNull();
    expect((await as('owner').post(`/v1/schools/${school.id}/instructor-belts/${id.coach}/${belt['BJJ Blue 1'].disciplineId}/verify`)).status).toBe(409);
  });

  it('choosing the same belt keeps it verified; choosing another makes it unverified again', async () => {
    expect((await declare('coach', belt['BJJ Blue 1'])).body.verificationStatus).toBe('VERIFIED');
    const changed = await declare('coach', belt['BJJ Purple 1']);
    expect(changed.body).toMatchObject({ beltName: 'Purple 1', verificationStatus: 'UNVERIFIED', verifiedAt: null });
  });

  it('the owner can correct it while verifying', async () => {
    const res = await as('owner').post(`/v1/schools/${school.id}/instructor-belts/${id.coach}/${belt['BJJ Blue 0'].disciplineId}/verify`, {
      rankId: belt['BJJ Blue 0'].rankId,
      stripeTierId: belt['BJJ Blue 0'].tierId,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ beltName: 'Blue 0', verificationStatus: 'VERIFIED' });
    const half = await as('owner').post(`/v1/schools/${school.id}/instructor-belts/${id.coach}/${belt['BJJ Blue 0'].disciplineId}/verify`, { rankId: belt['BJJ Blue 0'].rankId });
    expect(half.status).toBe(400);
  });

  it('a belt must be one of that style\'s; another style\'s or another School\'s is refused', async () => {
    const wrongStyle = await as('coach').put(`/v1/schools/${school.id}/instructor-belts/me/${belt['BJJ Blue 0'].disciplineId}`, {
      rankId: belt['Judo Blue 0'].rankId,
      stripeTierId: belt['Judo Blue 0'].tierId,
    });
    expect(wrongStyle.status).toBe(400);
    expect((await declare('coach', belt['OtherBJJ Blue 0'])).status).toBe(404);
  });

  it('only instructors declare; only the owner lists and verifies', async () => {
    for (const label of ['staff', 'student', 'former', 'owner']) {
      expect((await declare(label, belt['BJJ Blue 0'])).status).toBe(403);
    }
    expect((await as('coach').get(`/v1/schools/${school.id}/instructor-belts`)).status).toBe(403);
    expect((await as('coach').post(`/v1/schools/${school.id}/instructor-belts/${id.coach}/${belt['Judo Purple 0'].disciplineId}/verify`)).status).toBe(403);
    expect((await as('otherOwner').get(`/v1/schools/${school.id}/instructor-belts`)).status).toBe(403);
    expect((await as('otherOwner').post(`/v1/schools/${school.id}/instructor-belts/${id.coach}/${belt['Judo Purple 0'].disciplineId}/verify`)).status).toBe(403);
  });

  it('the database refuses an instructor verifying their own belt, or writing someone else\'s', async () => {
    const asCoach = <T>(fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>) =>
      appRole.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${id.coach}'`);
        return fn(tx);
      });
    const judo = belt['Judo Purple 0'].disciplineId;
    await expect(
      asCoach((tx) => tx.instructorBelt.update({ where: { userId_disciplineId: { userId: id.coach, disciplineId: judo } }, data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() } })),
    ).rejects.toThrow();
    await expect(
      asCoach((tx) =>
        tx.instructorBelt.create({
          data: { id: randomUUID(), schoolId: school.id, userId: id.quiet, disciplineId: judo, rankId: belt['Judo Blue 0'].rankId, stripeTierId: belt['Judo Blue 0'].tierId },
        }),
      ),
    ).rejects.toThrow();
    const row = await superuser.instructorBelt.findUniqueOrThrow({ where: { userId_disciplineId: { userId: id.coach, disciplineId: judo } } });
    expect(row.verificationStatus).toBe('UNVERIFIED');
  });
});
