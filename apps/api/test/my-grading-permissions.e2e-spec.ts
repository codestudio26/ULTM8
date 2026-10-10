/**
 * A coach's own grading permissions (Decision 184): what the coach's screens
 * use to show only the styles and actions they may use. Real HTTP.
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
  console.warn('[my-grading-permissions.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('My grading permissions (Decision 184)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  let school: { id: string };
  let bjj: { id: string };
  let judo: { id: string };

  async function person(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT', schoolId: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `my-perms-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Perms',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: u.id, schoolId } });
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
    return u;
  }
  const mine = (who: string, schoolId = school.id) =>
    request(app.getHttpServer()).get(`/v1/schools/${schoolId}/grading-permissions/me`).set('Authorization', `Bearer ${token[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'My Perms School', ranksToggle: true } });
    const other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Perms School', ranksToggle: true } });
    schoolIds.push(school.id, other.id);
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    await person('owner', 'SCHOOL_OWNER_MANAGER', school.id);
    const coach = await person('coach', 'INSTRUCTOR', school.id);
    const peer = await person('peer', 'INSTRUCTOR', school.id);
    await person('student', 'STUDENT', school.id);
    await person('outsider', 'INSTRUCTOR', other.id);
    await superuser.gradingPermission.createMany({
      data: [
        { id: randomUUID(), schoolId: school.id, userId: coach.id, disciplineId: bjj.id, canDowngrade: false, canChangeBoardThresholds: false },
        { id: randomUUID(), schoolId: school.id, userId: peer.id, disciplineId: judo.id },
      ],
    });
  });

  afterAll(async () => {
    await superuser.gradingPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner may do everything', async () => {
    const res = await mine('owner');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isOwner: true, items: [] });
  });

  it('a coach sees only their own styles and toggles', async () => {
    const res = await mine('coach');
    expect(res.status).toBe(200);
    expect(res.body.isOwner).toBe(false);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ disciplineId: bjj.id, canPromote: true, canDowngrade: false, canChangeBoardThresholds: false });
  });

  it('students and other Schools\' coaches are refused', async () => {
    expect((await mine('student')).status).toBe(403);
    expect((await mine('outsider')).status).toBe(403);
    expect((await mine('coach', 'not-a-uuid')).status).toBe(400);
  });
});
