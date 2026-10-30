/**
 * Decision 417 (stress test round 4 Q1): a School with more than 500 current
 * Students moves to 6-digit check-in codes and its shorter member and staff
 * codes are replaced; settings can't take it back to 4. A front-desk tablet
 * locks after 10 wrong member codes in a row until a staff code is typed.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { LargeSchoolCheckInCodesProcessor } from '../src/jobs/large-school-check-in-codes.processor';
import { FRONT_DESK_MAX_WRONG_MEMBER_CODES } from '../src/front-desk/front-desk-sessions.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Large Schools: 6-digit codes and the tablet lock (Decision 417)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let big: { id: string };
  let small: { id: string };
  let branch: { id: string };
  const owner = { id: randomUUID(), email: `large-owner-${randomUUID()}@example.test` };
  const coach = { id: randomUUID(), email: `large-coach-${randomUUID()}@example.test` };
  const studentIds: string[] = [];
  let ownerToken: string;
  let smallOwnerToken: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) => http().post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    put: (url: string, body: object) => http().put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  function makeUser(id: string, email: string, label: string) {
    return {
      id,
      email,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: label,
      surname: 'Large',
      passcodeHash: 'x',
      dateOfBirth: new Date('2000-01-01'),
      phoneVerifiedAt: new Date(),
    };
  }

  /** 4-digit codes as they were before the School grew: one per Student, and the owner's and coach's own. */
  async function seedShortCodes() {
    await superuser.studentCheckInCode.deleteMany({ where: { schoolId: big.id } });
    await superuser.staffKioskCode.deleteMany({ where: { schoolId: big.id } });
    await superuser.studentCheckInCode.createMany({
      data: studentIds.map((studentId, i) => ({ id: randomUUID(), schoolId: big.id, studentId, code: String(i).padStart(4, '0') })),
    });
    await superuser.staffKioskCode.createMany({
      data: [
        { id: randomUUID(), schoolId: big.id, userId: owner.id, code: '9998' },
        { id: randomUUID(), schoolId: big.id, userId: coach.id, code: '9999' },
      ],
    });
    await superuser.school.update({ where: { id: big.id }, data: { checkInCodeDigits: 4 } });
  }

  async function codes(schoolId: string) {
    const [students, staff] = await Promise.all([
      superuser.studentCheckInCode.findMany({ where: { schoolId } }),
      superuser.staffKioskCode.findMany({ where: { schoolId } }),
    ]);
    return [...students.map((c) => c.code), ...staff.map((c) => c.code)];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    big = await superuser.school.create({ data: { id: randomUUID(), name: 'Big School' } });
    small = await superuser.school.create({ data: { id: randomUUID(), name: 'Small School' } });
    branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: small.id, name: 'Centro' } });
    await superuser.user.createMany({ data: [makeUser(owner.id, owner.email, 'Olga'), makeUser(coach.id, coach.email, 'Cid')] });
    for (let i = 0; i < 501; i++) studentIds.push(randomUUID());
    await superuser.user.createMany({ data: studentIds.map((id, i) => makeUser(id, `large-s${i}-${randomUUID()}@example.test`, `S${i}`)) });
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: big.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: big.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: small.id },
        ...studentIds.map((userId) => ({ id: randomUUID(), role: 'STUDENT' as const, userId, schoolId: big.id })),
        // The first ten are also at the small School.
        ...studentIds.slice(0, 10).map((userId) => ({ id: randomUUID(), role: 'STUDENT' as const, userId, schoolId: small.id })),
      ],
    });
    ownerToken = jwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: big.id, branchId: null }],
    });
    smallOwnerToken = jwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: small.id, branchId: null }],
    });
  });

  afterAll(async () => {
    const schoolIds = [big.id, small.id];
    await superuser.frontDeskSession.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffKioskCode.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentCheckInCode.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: [owner.id, coach.id, ...studentIds] } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a code given out at a School past 500 Students moves it to 6 digits and replaces every shorter code', async () => {
    await seedShortCodes();
    const oldCoachCode = '9999';
    const res = await as(ownerToken).post(`/v1/schools/${big.id}/students/${studentIds[0]}/check-in-code`);
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^\d{6}$/);

    expect((await superuser.school.findUniqueOrThrow({ where: { id: big.id } })).checkInCodeDigits).toBe(6);
    const all = await codes(big.id);
    expect(all).toHaveLength(503);
    expect(all.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(all).size).toBe(all.length);

    // The old ones stop working at the desk.
    const old = await as(ownerToken).post(`/v1/schools/${big.id}/front-desk/code-lookups`, { code: '0001' });
    expect(old.status).toBe(404);
    const staffCode = await superuser.staffKioskCode.findUniqueOrThrow({ where: { schoolId_userId: { schoolId: big.id, userId: coach.id } } });
    expect(staffCode.code).not.toBe(oldCoachCode);
    expect(staffCode.code).toMatch(/^\d{6}$/);
  });

  it('the 15-minute sweep moves a large School on its own, and leaves a small one alone', async () => {
    await seedShortCodes();
    await superuser.studentCheckInCode.create({ data: { id: randomUUID(), schoolId: small.id, studentId: studentIds[0], code: '1234' } });
    const result = await app.get(LargeSchoolCheckInCodesProcessor).process({} as never);
    expect(result.replaced).toBeGreaterThanOrEqual(503);

    expect((await superuser.school.findUniqueOrThrow({ where: { id: big.id } })).checkInCodeDigits).toBe(6);
    expect((await codes(big.id)).every((c) => c.length === 6)).toBe(true);
    expect((await superuser.school.findUniqueOrThrow({ where: { id: small.id } })).checkInCodeDigits).toBe(4);
    expect(await codes(small.id)).toEqual(['1234']);

    // Run again: nothing left to replace at the large School.
    const before = await codes(big.id);
    await app.get(LargeSchoolCheckInCodesProcessor).process({} as never);
    expect((await codes(big.id)).sort()).toEqual(before.sort());
  });

  it("a large School's settings can't go back to 4 digits; a small School's can", async () => {
    await superuser.school.update({ where: { id: big.id }, data: { checkInCodeDigits: 6 } });
    const rules = await as(ownerToken).get(`/v1/schools/${big.id}/check-in-rules`);
    expect(rules.status).toBe(200);
    expect(rules.body.codeDigits).toBe(6);

    const refused = await as(ownerToken).put(`/v1/schools/${big.id}/check-in-rules`, { ...rules.body, codeDigits: 4 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('CHECK_IN_CODE_DIGITS_LOCKED');
    const refusedSchool = await as(ownerToken).patch(`/v1/schools/${big.id}`, { checkInCodeDigits: 4 });
    expect(refusedSchool.status).toBe(400);
    expect(refusedSchool.body.error.code).toBe('CHECK_IN_CODE_DIGITS_LOCKED');
    expect((await superuser.school.findUniqueOrThrow({ where: { id: big.id } })).checkInCodeDigits).toBe(6);

    // Saving the other rules as they are still works.
    expect((await as(ownerToken).put(`/v1/schools/${big.id}/check-in-rules`, { ...rules.body, opensMinutesBeforeStart: 20 })).status).toBe(200);

    // A small School on 6 digits keeps its older 4-digit codes when a new one is given out.
    await superuser.school.update({ where: { id: small.id }, data: { checkInCodeDigits: 6 } });
    await superuser.studentCheckInCode.upsert({
      where: { schoolId_studentId: { schoolId: small.id, studentId: studentIds[2] } },
      create: { id: randomUUID(), schoolId: small.id, studentId: studentIds[2], code: '4321' },
      update: { code: '4321' },
    });
    const fresh = await as(smallOwnerToken).post(`/v1/schools/${small.id}/students/${studentIds[3]}/check-in-code`);
    expect(fresh.body.code).toMatch(/^\d{6}$/);
    expect((await superuser.studentCheckInCode.findUniqueOrThrow({ where: { schoolId_studentId: { schoolId: small.id, studentId: studentIds[2] } } })).code).toBe('4321');
    const smallRules = await as(smallOwnerToken).get(`/v1/schools/${small.id}/check-in-rules`);
    expect((await as(smallOwnerToken).put(`/v1/schools/${small.id}/check-in-rules`, { ...smallRules.body, codeDigits: 4 })).status).toBe(200);
  });

  describe('the tablet lock', () => {
    let session: { sessionId: string; sessionToken: string };
    let ownerCode: string;
    let realCode: string;

    const kiosk = () => as(session.sessionToken);
    const lookup = (code: string) => kiosk().post('/v1/front-desk/kiosk/code-lookups', { code });

    beforeAll(async () => {
      ownerCode = (await as(smallOwnerToken).get(`/v1/schools/${small.id}/front-desk/my-code`)).body.code;
      realCode = (await as(smallOwnerToken).get(`/v1/schools/${small.id}/students/${studentIds[1]}/check-in-code`)).body.code;
    });

    beforeEach(async () => {
      const res = await as(smallOwnerToken).post(`/v1/schools/${small.id}/front-desk/sessions`, { branchId: branch.id });
      expect(res.status).toBe(201);
      session = res.body;
    });

    async function wrongCode(): Promise<string> {
      const taken = new Set(await codes(small.id));
      let code = realCode;
      while (taken.has(code) || code.length !== realCode.length) code = String(Math.floor(Math.random() * 10 ** realCode.length)).padStart(realCode.length, '0');
      return code;
    }

    it('a right member code starts the count again', async () => {
      for (let i = 0; i < 3; i++) expect((await lookup(await wrongCode())).status).toBe(404);
      expect((await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: session.sessionId } })).wrongMemberCodeCount).toBe(3);
      expect((await lookup(realCode)).status).toBe(200);
      expect((await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: session.sessionId } })).wrongMemberCodeCount).toBe(0);
    });

    it(`${FRONT_DESK_MAX_WRONG_MEMBER_CODES} wrong member codes in a row lock the tablet until a staff code`, async () => {
      expect((await lookup(await wrongCode())).status).toBe(404);
      // Past the per-minute limit, as if eight more wrong codes came over the last minutes.
      await superuser.frontDeskSession.update({ where: { id: session.sessionId }, data: { wrongMemberCodeCount: FRONT_DESK_MAX_WRONG_MEMBER_CODES - 1 } });
      const tenth = await lookup(await wrongCode());
      expect(tenth.status).toBe(423);
      expect(tenth.body.error.code).toBe('FRONT_DESK_LOCKED');
      expect((await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: session.sessionId } })).lockedAt).not.toBeNull();

      // Locked: even a right member code, a name search or today's Classes are refused.
      for (const res of [await lookup(realCode), await kiosk().get('/v1/front-desk/kiosk/students?search=S1'), await kiosk().get('/v1/front-desk/kiosk/today')]) {
        expect(res.status).toBe(423);
        expect(res.body.error.code).toBe('FRONT_DESK_LOCKED');
      }
      const info = await kiosk().get('/v1/front-desk/kiosk/session');
      expect(info.status).toBe(200);
      expect(info.body.locked).toBe(true);

      // A wrong staff code counts towards ending the session, as on the exit screen.
      const wrongStaff = await kiosk().post('/v1/front-desk/kiosk/resume', { staffCode: await wrongCode() });
      expect(wrongStaff.status).toBe(403);
      expect((await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: session.sessionId } })).wrongCodeCount).toBe(1);

      const resumed = await kiosk().post('/v1/front-desk/kiosk/resume', { staffCode: ownerCode });
      expect(resumed.status).toBe(200);
      expect(resumed.body).toEqual({ resumedBy: 'Olga' });
      const row = await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: session.sessionId } });
      expect(row).toMatchObject({ lockedAt: null, wrongMemberCodeCount: 0, endedAt: null });
      expect((await kiosk().get('/v1/front-desk/kiosk/session')).body.locked).toBe(false);
      expect((await lookup(realCode)).status).toBe(200);
    });

    it('a locked tablet can still be left with a staff code', async () => {
      await superuser.frontDeskSession.update({ where: { id: session.sessionId }, data: { lockedAt: new Date(), wrongMemberCodeCount: FRONT_DESK_MAX_WRONG_MEMBER_CODES } });
      const res = await kiosk().post('/v1/front-desk/kiosk/unlock', { staffCode: ownerCode });
      expect(res.status).toBe(200);
      expect((await kiosk().get('/v1/front-desk/kiosk/session')).status).toBe(401);
    });
  });
});
