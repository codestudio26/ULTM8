/**
 * `PATCH /schools/{schoolId}/students/{studentId}/profile` — v1.2 backend
 * backlog's Student Detail "Edit" gap: a Staff member editing a Student's own
 * profile on their behalf. Exercised over real HTTP, real Postgres/RLS.
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
  console.warn('[student-profile-update.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Staff-on-behalf-of Student profile update (v1.2 backend backlog)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  const school: Record<string, string> = {};

  async function person(
    label: string,
    grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT'; schoolId: string; revoked?: boolean }>,
  ) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `profile-update-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Original',
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

  const patch = (callerLabel: string, schoolLabel: string, studentLabel: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/v1/schools/${school[schoolLabel]}/students/${id[studentLabel]}/profile`)
      .set('Authorization', `Bearer ${token[callerLabel]}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school['Home Dojo'] = (await superuser.school.create({ data: { id: randomUUID(), name: 'Profile Update Home Dojo' } })).id;
    school['Other Dojo'] = (await superuser.school.create({ data: { id: randomUUID(), name: 'Profile Update Other Dojo' } })).id;
    schoolIds.push(school['Home Dojo'], school['Other Dojo']);

    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school['Home Dojo'] }]);
    await person('otherOwner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school['Other Dojo'] }]);
    await person('student', [{ role: 'STUDENT', schoolId: school['Home Dojo'] }]);
    await person('otherStudent', [{ role: 'STUDENT', schoolId: school['Home Dojo'] }]);
    // Enrolled at Home Dojo in the past, since revoked — must be unreachable.
    await person('formerStudent', [{ role: 'STUDENT', schoolId: school['Home Dojo'], revoked: true }]);
    // A Student only at the OTHER School — not enrolled at Home Dojo at all.
    await person('elsewhereStudent', [{ role: 'STUDENT', schoolId: school['Other Dojo'] }]);
  });

  afterAll(async () => {
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('Staff can update an allowed field on a Student\'s behalf', async () => {
    const res = await patch('owner', 'Home Dojo', 'student', { firstName: 'Updated', address: '123 Mat Street' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: id.student, firstName: 'Updated', address: '123 Mat Street', surname: 'Original' });

    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: id.student } });
    expect(persisted.firstName).toBe('Updated');
    expect(persisted.address).toBe('123 Mat Street');
  });

  it('email and phone changes are rejected with a clear error, not silently dropped or applied', async () => {
    const res = await patch('owner', 'Home Dojo', 'otherStudent', { email: 'hijacked@example.test' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/email/i);

    const phoneRes = await patch('owner', 'Home Dojo', 'otherStudent', { phone: '+15559998888' });
    expect(phoneRes.status).toBe(400);
    expect(JSON.stringify(phoneRes.body)).toMatch(/phone/i);

    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: id.otherStudent } });
    expect(persisted.email).not.toBe('hijacked@example.test');
    expect(persisted.phone).not.toBe('+15559998888');
  });

  it('a Staff member at a DIFFERENT School cannot reach a Student here (cross-tenant isolation)', async () => {
    const res = await patch('otherOwner', 'Home Dojo', 'student', { firstName: 'Should Not Apply' });
    expect([403, 404]).toContain(res.status);

    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: id.student } });
    expect(persisted.firstName).not.toBe('Should Not Apply');
  });

  it('a non-Staff caller (another Student) gets 403', async () => {
    const res = await patch('otherStudent', 'Home Dojo', 'student', { firstName: 'Should Not Apply Either' });
    expect(res.status).toBe(403);

    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: id.student } });
    expect(persisted.firstName).not.toBe('Should Not Apply Either');
  });

  it('a revoked (former) enrollment at this School is not a reachable target', async () => {
    const res = await patch('owner', 'Home Dojo', 'formerStudent', { firstName: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('a Student enrolled only at a different School is not a reachable target here', async () => {
    const res = await patch('owner', 'Home Dojo', 'elsewhereStudent', { firstName: 'Nope' });
    expect(res.status).toBe(404);
  });
});
