/**
 * A staff member given a role again starts with today's permissions
 * (Decision 193): removing an Instructor or Branch Staff role clears that
 * person's grading permissions and "Can invite coaches" at the School, once
 * they hold no such role there any more. Real HTTP.
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
  console.warn('[staff-regrant.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Re-granted staff start fresh (Decision 193)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  let school: { id: string };
  let north: { id: string };
  let south: { id: string };
  let bjj: { id: string };
  let ownerToken = '';

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `regrant-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Regrant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }
  const grant = (userId: string, role: 'INSTRUCTOR' | 'BRANCH_STAFF', branchId: string) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId: school.id, branchId } });
  const canGrade = (userId: string) =>
    superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId, disciplineId: bjj.id, canPromote: true } });
  const canInvite = (userId: string) =>
    superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId, canInviteCoaches: true } });
  const revoke = (userId: string, grantId: string) =>
    request(app.getHttpServer()).delete(`/v1/users/${userId}/role-grants/${grantId}`).set('Authorization', `Bearer ${ownerToken}`);
  const gradingRows = (userId: string) => superuser.gradingPermission.count({ where: { userId, schoolId: school.id } });
  const mayInvite = async (userId: string) =>
    (await superuser.staffPermission.findUnique({ where: { schoolId_userId: { schoolId: school.id, userId } } }))?.canInviteCoaches ?? false;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Regrant Dojo', ranksToggle: true } });
    schoolIds.push(school.id);
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    const owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    ownerToken = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
  });

  afterAll(async () => {
    await superuser.gradingPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a coach keeps their grading permissions while they still coach at another branch, and loses them with the last role', async () => {
    const coach = await mkUser('coach');
    const atNorth = await grant(coach.id, 'INSTRUCTOR', north.id);
    const atSouth = await grant(coach.id, 'INSTRUCTOR', south.id);
    await canGrade(coach.id);

    expect((await revoke(coach.id, atNorth.id)).status).toBe(200);
    expect(await gradingRows(coach.id)).toBe(1);
    expect((await revoke(coach.id, atSouth.id)).status).toBe(200);
    expect(await gradingRows(coach.id)).toBe(0);
  });

  it('Branch Staff given the role again start with no grading permissions and can\'t invite coaches', async () => {
    const staff = await mkUser('staff');
    const first = await grant(staff.id, 'BRANCH_STAFF', north.id);
    await canGrade(staff.id);
    await canInvite(staff.id);

    expect((await revoke(staff.id, first.id)).status).toBe(200);
    expect(await gradingRows(staff.id)).toBe(0);
    expect(await mayInvite(staff.id)).toBe(false);

    const again = await request(app.getHttpServer())
      .post(`/v1/users/${staff.id}/role-grants`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'BRANCH_STAFF', schoolId: school.id, branchId: north.id });
    expect(again.status).toBe(201);
    expect(await gradingRows(staff.id)).toBe(0);
    expect(await mayInvite(staff.id)).toBe(false);
  });

  it('losing only the Branch Staff role takes "Can invite coaches" but keeps grading while they still coach', async () => {
    const both = await mkUser('both');
    await grant(both.id, 'INSTRUCTOR', south.id);
    const asStaff = await grant(both.id, 'BRANCH_STAFF', north.id);
    await canGrade(both.id);
    await canInvite(both.id);

    expect((await revoke(both.id, asStaff.id)).status).toBe(200);
    expect(await mayInvite(both.id)).toBe(false);
    expect(await gradingRows(both.id)).toBe(1);
  });
});
