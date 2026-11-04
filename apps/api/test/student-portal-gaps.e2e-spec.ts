/**
 * Student portal review follow-ups (Decision 428):
 * - M1: GET /guardians/me/minors/:studentId/waivers lists a child's waivers
 *   with whether each is signed, and a parent signs one with studentId.
 * - M4: GET /classes/:id/ticket-plans names a one-off Class's own ticket.
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

describeIfDb('Student portal follow-ups (Decision 428)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schools: Record<string, { id: string }> = {};
  const users: Record<string, { id: string; email: string | null }> = {};
  const tokens: Record<string, string> = {};
  const waivers: Record<string, string> = {};
  const plans: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const get = (who: string, path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`);

  const makeUser = async (label: string, dob: string) => {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `spg-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Gaps',
        passcodeHash: 'x',
        dateOfBirth: new Date(dob),
        phoneVerifiedAt: new Date(),
      },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schools.kids = await superuser.school.create({ data: { id: randomUUID(), name: 'Kids Dojo' } });
    schools.other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Dojo' } });
    await makeUser('parent', '1985-01-01');
    await makeUser('child', '2016-01-01');
    await makeUser('stranger', '1990-01-01');
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.child.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: users.child.id, schoolId: schools.kids.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: users.stranger.id, schoolId: schools.other.id } });
    tokens.parent = jwt.sign({ sub: users.parent.id, email: users.parent.email, grants: [] });
    tokens.stranger = jwt.sign({
      sub: users.stranger.id,
      email: users.stranger.email,
      grants: [{ role: 'STUDENT', franchiseId: null, schoolId: schools.other.id, branchId: null }],
    });

    for (const [key, schoolId, title, archived] of [
      ['liability', schools.kids.id, 'Liability', false],
      ['photo', schools.kids.id, 'Photo consent', false],
      ['retired', schools.kids.id, 'Old waiver', true],
      ['elsewhere', schools.other.id, 'Other waiver', false],
    ] as const) {
      waivers[key] = (
        await superuser.waiver.create({ data: { id: randomUUID(), schoolId, title, body: `${title} text`, archivedAt: archived ? new Date() : null } })
      ).id;
    }

    const start = new Date(Date.now() + 2 * 86_400_000);
    classes.seminar = (
      await superuser.class.create({
        data: { id: randomUUID(), schoolId: schools.kids.id, title: 'Seminar', startDate: start, endDate: new Date(start.getTime() + 3_600_000) },
      })
    ).id;
    for (const [key, data] of [
      ['ticket', { title: 'Seminar ticket', scopedClassId: classes.seminar }],
      ['hidden', { title: 'Hidden ticket', scopedClassId: classes.seminar, visible: false }],
      ['general', { title: 'General pack' }],
    ] as const) {
      plans[key] = (
        await superuser.membershipPlan.create({
          data: { id: randomUUID(), schoolId: schools.kids.id, type: 'CLASS_PACK', price: 2000, classesIncluded: 1, ...data },
        })
      ).id;
    }
  });

  afterAll(async () => {
    const schoolIds = Object.values(schools).map((s) => s.id);
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiver.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: users.parent.id } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it("M1: lists the child's current waivers at the child's Schools, unsigned", async () => {
    const res = await get('parent', `/v1/guardians/me/minors/${users.child.id}/waivers`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((w: { id: string }) => w.id).sort()).toEqual([waivers.liability, waivers.photo].sort());
    expect(res.body.items[0]).toMatchObject({ schoolId: schools.kids.id, schoolName: 'Kids Dojo', signedDate: null, version: 1 });
  });

  it("M1: the parent signs for the child, and the list shows it signed", async () => {
    const sign = await http()
      .post(`/v1/waivers/${waivers.liability}/sign`)
      .set('Authorization', `Bearer ${tokens.parent}`)
      .send({ studentId: users.child.id, signerFullName: 'parent Gaps', signatureText: 'parent Gaps', waiverVersion: 1 });
    expect(sign.status).toBe(201);
    expect(sign.body).toMatchObject({ studentId: users.child.id, signedById: users.parent.id });

    const res = await get('parent', `/v1/guardians/me/minors/${users.child.id}/waivers`);
    const liability = res.body.items.find((w: { id: string }) => w.id === waivers.liability);
    const photo = res.body.items.find((w: { id: string }) => w.id === waivers.photo);
    expect(liability.signedDate).toEqual(expect.any(String));
    expect(photo.signedDate).toBeNull();
  });

  it("M1: someone who isn't the child's parent is refused", async () => {
    const res = await get('stranger', `/v1/guardians/me/minors/${users.child.id}/waivers`);
    expect(res.status).toBe(403);
  });

  it("M4: names the one-off Class's own ticket on sale, for the parent asking for the child", async () => {
    const res = await get('parent', `/v1/classes/${classes.seminar}/ticket-plans?studentId=${users.child.id}`);
    expect(res.status).toBe(200);
    expect(res.body.planIds).toEqual([plans.ticket]);
  });

  it("M4: a Student of another School finds nothing, and a stranger can't ask for the child", async () => {
    const own = await get('stranger', `/v1/classes/${classes.seminar}/ticket-plans`);
    expect(own.status).toBe(200);
    expect(own.body.planIds).toEqual([]);
    const child = await get('stranger', `/v1/classes/${classes.seminar}/ticket-plans?studentId=${users.child.id}`);
    expect(child.status).toBe(403);
  });
});
