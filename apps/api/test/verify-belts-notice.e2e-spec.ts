/**
 * Belts waiting to be verified, for the notice at login (Decisions 137 item
 * 4, 189): the owner sees every enrolled student's; a coach or Branch Staff
 * member sees only the styles where they may verify and the students of
 * their own branches; anyone else gets an empty list; another School's
 * owner gets nothing. Real HTTP.
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
  console.warn('[verify-belts-notice.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Belts waiting to be verified (Decision 189)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};
  let school: { id: string };
  let other: { id: string };
  const style: Record<string, { id: string; rankId: string; tierId: string }> = {};

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `verify-notice-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Notice',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    return u;
  }
  async function signAs(label: string) {
    const grants = await superuser.roleGrant.findMany({ where: { userId: id[label], revokedAt: null } });
    token[label] = jwt.sign({ sub: id[label], email: `${label}@example.test`, grants: grants.map((g) => ({ role: g.role, franchiseId: g.franchiseId, schoolId: g.schoolId, branchId: g.branchId })) });
  }
  async function student(label: string, branchId: string, styles: Array<{ name: string; verified?: boolean }>) {
    await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: id[label], schoolId: school.id } });
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: id[label], branchId } });
    for (const s of styles) {
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: id[label], disciplineId: style[s.name].id, schoolId: school.id,
          currentRankId: style[s.name].rankId, currentStripeId: style[s.name].tierId,
          verificationStatus: s.verified ? 'VERIFIED' : 'UNVERIFIED',
        },
      });
    }
  }
  const list = (label: string, schoolId = school.id) =>
    request(app.getHttpServer()).get(`/v1/schools/${schoolId}/rank-verifications`).set('Authorization', `Bearer ${token[label]}`);
  const names = (res: request.Response) => (res.body.items as Array<{ firstName: string; disciplineName: string }>).map((i) => `${i.firstName}/${i.disciplineName}`).sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Notice Dojo', ranksToggle: true } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Dojo', ranksToggle: true } });
    schoolIds.push(school.id, other.id);
    const north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    const south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    for (const name of ['BJJ', 'Judo']) {
      const d = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name } });
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: d.id, schoolId: school.id, order: 0, name: 'Blue', primaryColour: '#0000FF' } });
      const tier = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: 0, count: 0, colour: '#000000', name: 'Blue' } });
      style[name] = { id: d.id, rankId: rank.id, tierId: tier.id };
    }

    await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.owner, schoolId: school.id } });
    await mkUser('otherOwner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.otherOwner, schoolId: other.id } });
    // A North coach who may verify BJJ, and grade Judo without verifying.
    await mkUser('coach');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: id.coach, schoolId: school.id, branchId: north.id } });
    await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: id.coach, disciplineId: style.BJJ.id } });
    await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: id.coach, disciplineId: style.Judo.id, canVerifyRanks: false } });
    // North Branch Staff with no grading permission.
    await mkUser('staff');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: id.staff, schoolId: school.id, branchId: north.id } });

    await student('Ana', north.id, [{ name: 'BJJ' }, { name: 'Judo' }]);
    await student('Ben', south.id, [{ name: 'BJJ' }]);
    await student('Cy', north.id, [{ name: 'BJJ', verified: true }]);
    await mkUser('Dee'); // declared, then left the School
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: id.Dee, schoolId: school.id, revokedAt: new Date() } });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.Dee, disciplineId: style.BJJ.id, schoolId: school.id, currentRankId: style.BJJ.rankId, currentStripeId: style.BJJ.tierId },
    });
    for (const label of ['owner', 'otherOwner', 'coach', 'staff', 'Ana']) await signAs(label);
  });

  afterAll(async () => {
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner sees every current student\'s unverified belt, with names and styles', async () => {
    const res = await list('owner');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Ana/BJJ', 'Ana/Judo', 'Ben/BJJ']);
    expect(res.body.items[0]).toMatchObject({ surname: 'Notice', verificationStatus: 'UNVERIFIED' });
  });

  it('a coach sees only the styles they may verify, for their own branch\'s students', async () => {
    const res = await list('coach');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Ana/BJJ']);
  });

  it('staff without grading permission get an empty list; a student and another School\'s owner get nothing', async () => {
    const staff = await list('staff');
    expect(staff.status).toBe(200);
    expect(staff.body.items).toEqual([]);
    expect((await list('Ana')).status).toBe(403);
    expect([403, 404]).toContain((await list('otherOwner')).status);
  });
});
