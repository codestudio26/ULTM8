/**
 * Decision 435 item 28: the Students list (GET /schools/:id/students) shows a
 * child's photo only with a parent's camera consent, through the same helper
 * as the Grading Board and the front-desk tablet (photosShownFor). An adult's
 * photo always shows. Both the default (active) list and the "all" list.
 * Real HTTP, real Postgres.
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
  console.warn('[students-list-photos.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const EMAIL_TAG = 'students-list-photos-';

describeIfDb("Students list: a child's photo only with a parent's camera consent (Decision 435 item 28)", () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolId = randomUUID();

  async function person(label: string, years: number, photo: string | null, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT'; schoolId: string }>) {
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - years);
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `${EMAIL_TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Photo',
        passcodeHash: 'x',
        dateOfBirth: dob,
        phoneVerifiedAt: new Date(),
        profilePhotoUrl: photo,
      },
    });
    for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId } });
    const token = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })) });
    return { id: u.id, token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await superuser.school.create({ data: { id: schoolId, name: 'Photo School' } });
  });

  afterAll(async () => {
    const users = (await superuser.user.findMany({ where: { email: { startsWith: EMAIL_TAG } }, select: { id: true } })).map((u) => u.id);
    await superuser.consentRecord.deleteMany({ where: { studentId: { in: users } } });
    await superuser.guardianLink.deleteMany({ where: { studentId: { in: users } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: users } } });
    await superuser.user.deleteMany({ where: { id: { in: users } } });
    await superuser.school.deleteMany({ where: { id: schoolId } });
    await superuser.$disconnect();
    await app.close();
  });

  it('hides a child’s photo until a parent gives camera consent, in the active and the all lists', async () => {
    const owner = await person('owner', 40, null, [{ role: 'SCHOOL_OWNER_MANAGER', schoolId }]);
    const adult = await person('adult', 30, 'https://img.example.test/adult.jpg', [{ role: 'STUDENT', schoolId }]);
    const kid = await person('kid', 10, 'https://img.example.test/kid.jpg', [{ role: 'STUDENT', schoolId }]);
    const parent = await person('parent', 42, null, []);
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: kid.id } });

    const photos = async (status?: string) => {
      const res = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolId}/students${status ? `?status=${status}` : ''}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      const items = res.body.items as Array<{ id: string; profilePhotoUrl: string | null }>;
      return { adult: items.find((i) => i.id === adult.id)?.profilePhotoUrl, kid: items.find((i) => i.id === kid.id)?.profilePhotoUrl };
    };

    for (const status of [undefined, 'ALL']) {
      expect(await photos(status)).toEqual({ adult: 'https://img.example.test/adult.jpg', kid: null });
    }
    await superuser.consentRecord.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: kid.id, tier: 'CAMERA', policyVersion: 'v1' } });
    for (const status of [undefined, 'ALL']) {
      expect(await photos(status)).toEqual({ adult: 'https://img.example.test/adult.jpg', kid: 'https://img.example.test/kid.jpg' });
    }
    // Withdrawn: hidden again.
    await superuser.consentRecord.updateMany({ where: { studentId: kid.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } });
    expect((await photos()).kid).toBeNull();
  });
});
