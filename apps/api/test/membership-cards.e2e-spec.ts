/**
 * Membership cards (backlog 3.11, Decision 398): the School, photo, name,
 * personal check-in code and the memberships in effect now. No QR code.
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

describeIfDb('Membership cards', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const card = (who: string, schoolId: string, studentId: string) =>
    http().get(`/v1/schools/${schoolId}/students/${studentId}/membership-card`).set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Card School', logoUrl: 'https://example.test/logo.png' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Card Other School' } });
    for (const label of ['ana', 'ben', 'coach', 'outsider']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `card-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label === 'ana' ? 'Ana' : label,
          surname: 'Card',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
          profilePhotoUrl: label === 'ana' ? 'https://example.test/ana.jpg' : null,
        },
      });
    }
    const grants: Array<[string, 'STUDENT' | 'INSTRUCTOR', string]> = [
      ['ana', 'STUDENT', school.id],
      ['ana', 'STUDENT', otherSchool.id],
      ['ben', 'STUDENT', school.id],
      ['coach', 'INSTRUCTOR', school.id],
      ['outsider', 'STUDENT', otherSchool.id],
    ];
    await superuser.roleGrant.createMany({ data: grants.map(([who, role, schoolId]) => ({ id: randomUUID(), role, userId: users[who].id, schoolId })) });
    for (const who of Object.keys(users)) {
      tokens[who] = jwt.sign({
        sub: users[who].id,
        email: users[who].email,
        grants: grants.filter((g) => g[0] === who).map(([, role, schoolId]) => ({ role, franchiseId: null, schoolId, branchId: null })),
      });
    }
    const plan = (type: 'SUBSCRIPTION' | 'CLASS_PACK', title: string) =>
      superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type, title, price: 5000 } });
    const unlimited = await plan('SUBSCRIPTION', 'Unlimited');
    const pack = await plan('CLASS_PACK', '10 classes');
    const old = await plan('SUBSCRIPTION', 'Old plan');
    const expiry = new Date(Date.now() + 30 * 86_400_000);
    await superuser.membership.createMany({
      data: [
        { id: randomUUID(), studentId: users.ana.id, membershipPlanId: unlimited.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', expiryDate: expiry },
        { id: randomUUID(), studentId: users.ana.id, membershipPlanId: pack.id, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 4 },
        { id: randomUUID(), studentId: users.ana.id, membershipPlanId: pack.id, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 0 },
        { id: randomUUID(), studentId: users.ana.id, membershipPlanId: old.id, schoolId: school.id, status: 'EXPIRED', frequency: 'RECURRING' },
      ],
    });
  });

  afterAll(async () => {
    const schoolIds = [school.id, otherSchool.id];
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentCheckInCode.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a student gets one card per School, with their code and only the memberships in effect now', async () => {
    const res = await http().get('/v1/membership-cards/me').set('Authorization', `Bearer ${tokens.ana}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { schoolName: string }) => c.schoolName).sort()).toEqual(['Card Other School', 'Card School']);
    const here = res.body.items.find((c: { schoolId: string }) => c.schoolId === school.id);
    const code = await http().get(`/v1/schools/${school.id}/students/${users.ana.id}/check-in-code`).set('Authorization', `Bearer ${tokens.ana}`);
    expect(here).toMatchObject({
      schoolName: 'Card School',
      schoolLogoUrl: 'https://example.test/logo.png',
      studentId: users.ana.id,
      firstName: 'Ana',
      surname: 'Card',
      photoUrl: 'https://example.test/ana.jpg',
      checkInCode: code.body.code,
    });
    expect(here.memberships).toEqual([
      expect.objectContaining({ title: 'Unlimited', type: 'SUBSCRIPTION', classesRemaining: null }),
      expect.objectContaining({ title: '10 classes', type: 'CLASS_PACK', classesRemaining: 4, expiryDate: null }),
    ]);
    // A card never carries the QR token.
    expect(JSON.stringify(res.body)).not.toMatch(/qr|token/i);
    const there = res.body.items.find((c: { schoolId: string }) => c.schoolId === otherSchool.id);
    expect(there.memberships).toEqual([]);
  });

  it('staff who cover the student can print it; other students and other Schools cannot', async () => {
    const res = await card('coach', school.id, users.ana.id);
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Ana');
    expect((await card('ben', school.id, users.ana.id)).status).toBe(403);
    expect((await card('outsider', school.id, users.ana.id)).status).toBe(403);
    // Not a Student here.
    expect((await card('coach', school.id, users.outsider.id)).status).toBe(404);
  });
});
