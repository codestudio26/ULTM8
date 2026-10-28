/**
 * Decision 380 (handover F1, F2): a locked front-desk tablet. Staff start a
 * session for one Branch; the tablet's token reaches only the
 * /front-desk/kiosk endpoints, which return the short form ("Ana D.") for
 * that Branch; a staff member's own code ends it.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Front desk: locked tablet sessions (Decision 380)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  let planId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const grantIds: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const MIN = 60_000;

  function today() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * MIN - 1);
    return { startsFrom: start.toISOString(), startsTo: end.toISOString() };
  }

  async function classNow(branchId: string | null, title = 'Fundamentals') {
    return superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, branchId, title, membershipInclusion: true, startDate: new Date(Date.now() - 5 * MIN), endDate: new Date(Date.now() + 55 * MIN) },
    });
  }

  async function member(studentId: string) {
    return superuser.membership.create({
      data: { id: randomUUID(), studentId, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
  }

  async function start(who: string, branchId: string | null = branchA.id) {
    const res = await http().post(`/v1/schools/${school.id}/front-desk/sessions`).set('Authorization', `Bearer ${tokens[who]}`).send({ branchId });
    expect(res.status).toBe(201);
    return res.body as { sessionId: string; sessionToken: string; branchId: string | null; expiresAt: string };
  }

  async function codeOf(who: string): Promise<string> {
    const res = await http().get(`/v1/schools/${school.id}/front-desk/my-code`).set('Authorization', `Bearer ${tokens[who]}`);
    expect(res.status).toBe(200);
    return res.body.code;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Kiosk School' } });
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Centro' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Norte' } });
    for (const label of ['owner', 'staffA', 'staffB', 'coach', 'ana', 'bo', 'cy', 'kid', 'mum']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `kiosk-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label[0].toUpperCase() + label.slice(1),
          surname: 'Desk',
          passcodeHash: 'x',
          dateOfBirth: new Date(label === 'kid' ? '2016-01-01' : '2000-01-01'),
          phoneVerifiedAt: new Date(),
          profilePhotoUrl: label === 'kid' || label === 'ana' ? `https://example.test/${label}.jpg` : null,
        },
      });
    }
    const grants: Array<[string, Role, string | null]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', null],
      ['staffA', 'BRANCH_STAFF', branchA.id],
      ['staffB', 'BRANCH_STAFF', branchB.id],
      ['coach', 'INSTRUCTOR', null],
      ['ana', 'STUDENT', null],
      ['bo', 'STUDENT', null],
      ['cy', 'STUDENT', null],
      ['kid', 'STUDENT', null],
    ];
    for (const [who, role, branchId] of grants) {
      const g = await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[who].id, schoolId: school.id, branchId } });
      grantIds[who] = g.id;
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId }] });
    }
    await superuser.studentHomeBranch.createMany({
      data: [
        { id: randomUUID(), schoolId: school.id, studentId: users.ana.id, branchId: branchA.id },
        { id: randomUUID(), schoolId: school.id, studentId: users.bo.id, branchId: branchB.id },
        { id: randomUUID(), schoolId: school.id, studentId: users.kid.id, branchId: branchA.id },
      ],
    });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.mum.id, studentId: users.kid.id } });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    planId = plan.id;
  });

  afterAll(async () => {
    await superuser.frontDeskSession.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffKioskCode.deleteMany({ where: { schoolId: school.id } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('only the owner, or Branch Staff at that Branch, can start one, and it needs a Branch', async () => {
    const noBranch = await http().post(`/v1/schools/${school.id}/front-desk/sessions`).set('Authorization', `Bearer ${tokens.owner}`).send({});
    expect(noBranch.status).toBe(400);
    for (const who of ['staffB', 'coach', 'ana']) {
      const res = await http().post(`/v1/schools/${school.id}/front-desk/sessions`).set('Authorization', `Bearer ${tokens[who]}`).send({ branchId: branchA.id });
      expect(res.status).toBe(403);
    }
    const s = await start('staffA');
    expect(s.branchId).toBe(branchA.id);
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * MIN);
    const row = await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.startedById).toBe(users.staffA.id);
  });

  it('the tablet token reaches only the kiosk endpoints, and a staff token never reaches them', async () => {
    const s = await start('owner');
    const staffRoute = await http().get(`/v1/schools/${school.id}/students`).set('Authorization', `Bearer ${s.sessionToken}`);
    expect(staffRoute.status).toBe(401);
    const startAgain = await http().post(`/v1/schools/${school.id}/front-desk/sessions`).set('Authorization', `Bearer ${s.sessionToken}`).send({ branchId: branchA.id });
    expect(startAgain.status).toBe(401);
    const kioskWithStaff = await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${tokens.owner}`);
    expect(kioskWithStaff.status).toBe(401);
    expect(kioskWithStaff.body.error.code).toBe('FRONT_DESK_SESSION_ENDED');

    const info = await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${s.sessionToken}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ schoolId: school.id, schoolName: 'Kiosk School', branchId: branchA.id, branchName: 'Centro', checkInCodeDigits: 4 });
  });

  it("shows today's Classes at its Branch and the whole School's, and recent check-ins as first name and initial", async () => {
    const here = await classNow(branchA.id, 'Centro class');
    const everywhere = await classNow(null, 'Whole School class');
    const there = await classNow(branchB.id, 'Norte class');
    const m = await member(users.ana.id);
    await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ana.id, classId: here.id, schoolId: school.id, sourceMembershipId: m.id, status: 'COMPLETED' } });
    const s = await start('owner');
    const res = await http().get('/v1/front-desk/kiosk/today').query(today()).set('Authorization', `Bearer ${s.sessionToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.classes.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([here.id, everywhere.id]));
    expect(ids).not.toContain(there.id);
    expect(res.body.classes.find((c: { id: string }) => c.id === here.id)).toMatchObject({ seatsTaken: 1, checkedIn: 1 });
    expect(res.body.recent[0]).toMatchObject({ firstName: 'Ana', surnameInitial: 'D', classTitle: 'Centro class' });
    expect(JSON.stringify(res.body)).not.toContain('"surname"');

    const farAway = await http()
      .get('/v1/front-desk/kiosk/today')
      .query({ startsFrom: new Date(Date.now() - 10 * 24 * 60 * MIN).toISOString(), startsTo: new Date(Date.now() - 9 * 24 * 60 * MIN).toISOString() })
      .set('Authorization', `Bearer ${s.sessionToken}`);
    expect(farAway.status).toBe(400);
  });

  it("name search: this Branch's students and those with no home Branch, short form, a child's photo only with camera consent", async () => {
    const s = await start('owner');
    const res = await http().get('/v1/front-desk/kiosk/students').query({ search: 'desk' }).set('Authorization', `Bearer ${s.sessionToken}`);
    expect(res.status).toBe(200);
    const byName = new Map(res.body.items.map((i: { firstName: string }) => [i.firstName, i]));
    expect([...byName.keys()].sort()).toEqual(['Ana', 'Cy', 'Kid']);
    expect(byName.get('Ana')).toEqual({ id: users.ana.id, firstName: 'Ana', surnameInitial: 'D', profilePhotoUrl: 'https://example.test/ana.jpg' });
    expect((byName.get('Kid') as { profilePhotoUrl: string | null }).profilePhotoUrl).toBeNull();

    await superuser.consentRecord.create({ data: { id: randomUUID(), guardianId: users.mum.id, studentId: users.kid.id, tier: 'CAMERA', policyVersion: 'v1' } });
    const again = await http().get('/v1/front-desk/kiosk/students').query({ search: 'kid' }).set('Authorization', `Bearer ${s.sessionToken}`);
    expect(again.body.items[0].profilePhotoUrl).toBe('https://example.test/kid.jpg');
    await superuser.consentRecord.deleteMany({ where: { studentId: users.kid.id } });

    const short = await http().get('/v1/front-desk/kiosk/students').query({ search: 'a' }).set('Authorization', `Bearer ${s.sessionToken}`);
    expect(short.status).toBe(400);
  });

  it('the welcome card and the check-in work for this Branch, and refuse a Class at another', async () => {
    const here = await classNow(branchA.id, 'Card class');
    const there = await classNow(branchB.id, 'Other branch class');
    await member(users.cy.id);
    const s = await start('owner');
    const card = await http().get(`/v1/front-desk/kiosk/students/${users.cy.id}/card`).query(today()).set('Authorization', `Bearer ${s.sessionToken}`);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ student: { id: users.cy.id, firstName: 'Cy', surnameInitial: 'D' }, membershipStatus: 'ACTIVE', bookings: [] });

    const other = await http().post('/v1/front-desk/kiosk/check-ins').set('Authorization', `Bearer ${s.sessionToken}`).send({ studentId: users.cy.id, classIds: [here.id, there.id] });
    expect(other.status).toBe(200);
    expect(other.body.done).toBe(false);
    expect(other.body.classes.find((c: { classId: string }) => c.classId === there.id)).toMatchObject({ ok: false, code: 'OTHER_BRANCH' });
    // Found by name, a Class not yet booked isn't booked on the tablet (Decision 388).
    expect(other.body.classes.find((c: { classId: string }) => c.classId === here.id)).toMatchObject({ ok: false, code: 'KIOSK_BOOK_FIRST' });
    expect(await superuser.booking.count({ where: { studentId: users.cy.id, classId: here.id } })).toBe(0);

    // Booked (here by staff, as the app would), the same tap checks them in.
    const booked = await http().post(`/v1/classes/${here.id}/book`).set('Authorization', `Bearer ${tokens.owner}`).send({ studentId: users.cy.id });
    expect(booked.status).toBe(201);
    const ok = await http().post('/v1/front-desk/kiosk/check-ins').set('Authorization', `Bearer ${s.sessionToken}`).send({ studentId: users.cy.id, classIds: [here.id] });
    expect(ok.body.done).toBe(true);
    const after = await http().get(`/v1/front-desk/kiosk/students/${users.cy.id}/card`).query(today()).set('Authorization', `Bearer ${s.sessionToken}`);
    expect(after.body.bookings).toEqual([expect.objectContaining({ classId: here.id, status: 'COMPLETED', guests: [] })]);
  });

  it("a QR scanned on the tablet checks in as a scan, and a staff member's own lookup doesn't work there", async () => {
    const cls = await classNow(branchA.id, 'QR class');
    await member(users.ana.id);
    const qr = async () => (await http().get('/v1/attendance/my-qr-token').set('Authorization', `Bearer ${tokens.ana}`)).body.token;
    const s = await start('owner');
    const lookup = await http().post('/v1/front-desk/kiosk/qr-lookups').set('Authorization', `Bearer ${s.sessionToken}`).send({ studentToken: await qr() });
    expect(lookup.status).toBe(200);
    expect(lookup.body.student).toMatchObject({ id: users.ana.id, firstName: 'Ana', surnameInitial: 'D' });

    const staffLookup = await http().post(`/v1/schools/${school.id}/front-desk/qr-lookups`).set('Authorization', `Bearer ${tokens.owner}`).send({ studentToken: await qr() });
    const refused = await http()
      .post('/v1/front-desk/kiosk/check-ins')
      .set('Authorization', `Bearer ${s.sessionToken}`)
      .send({ studentId: users.ana.id, classIds: [cls.id], lookupToken: staffLookup.body.lookupToken });
    expect(refused.status).toBe(400);

    const ok = await http()
      .post('/v1/front-desk/kiosk/check-ins')
      .set('Authorization', `Bearer ${s.sessionToken}`)
      .send({ studentId: users.ana.id, classIds: [cls.id], lookupToken: lookup.body.lookupToken });
    expect(ok.body.done).toBe(true);
    const booking = await superuser.booking.findFirstOrThrow({ where: { studentId: users.ana.id, classId: cls.id } });
    expect(booking.checkInMethod).toBe('INSTRUCTOR_SCAN');
  });

  it('a staff code covering this Branch ends the session; a wrong one or another Branch\'s is refused', async () => {
    const s = await start('owner');
    const codeB = await codeOf('staffB');
    const codeA = await codeOf('staffA');
    expect(codeA).toMatch(/^\d{4}$/);
    expect(await codeOf('staffA')).toBe(codeA);

    let unused = 0;
    while ([codeA, codeB].includes(String(unused).padStart(4, '0'))) unused++;
    const wrong = await http().post('/v1/front-desk/kiosk/unlock').set('Authorization', `Bearer ${s.sessionToken}`).send({ staffCode: String(unused).padStart(4, '0') });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('WRONG_STAFF_CODE');
    const otherBranch = await http().post('/v1/front-desk/kiosk/unlock').set('Authorization', `Bearer ${s.sessionToken}`).send({ staffCode: codeB });
    expect(otherBranch.status).toBe(403);

    const ok = await http().post('/v1/front-desk/kiosk/unlock').set('Authorization', `Bearer ${s.sessionToken}`).send({ staffCode: codeA });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ unlockedBy: 'StaffA' });
    const row = await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.endedById).toBe(users.staffA.id);

    const after = await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${s.sessionToken}`);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('FRONT_DESK_SESSION_ENDED');
  });

  it('staff see live tablets and can end one from their own login', async () => {
    const s = await start('staffA');
    const list = await http().get(`/v1/schools/${school.id}/front-desk/sessions`).set('Authorization', `Bearer ${tokens.owner}`);
    expect(list.status).toBe(200);
    expect(list.body.items.find((i: { id: string }) => i.id === s.sessionId)).toMatchObject({ branchName: 'Centro', startedByName: 'StaffA Desk' });
    const end = await http().post(`/v1/schools/${school.id}/front-desk/sessions/${s.sessionId}/end`).set('Authorization', `Bearer ${tokens.owner}`);
    expect(end.status).toBe(200);
    expect((await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${s.sessionToken}`)).status).toBe(401);
    const again = await http().post(`/v1/schools/${school.id}/front-desk/sessions/${s.sessionId}/end`).set('Authorization', `Bearer ${tokens.owner}`);
    expect(again.status).toBe(404);
  });

  it('a tablet stops working once whoever started it is no longer staff there', async () => {
    const s = await start('staffA');
    await superuser.roleGrant.update({ where: { id: grantIds.staffA }, data: { revokedAt: new Date() } });
    try {
      const res = await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${s.sessionToken}`);
      expect(res.status).toBe(401);
    } finally {
      await superuser.roleGrant.update({ where: { id: grantIds.staffA }, data: { revokedAt: null } });
    }
  });

  it('a new code replaces the old one, and the School can use 6 digits', async () => {
    const old = await codeOf('coach');
    await superuser.school.update({ where: { id: school.id }, data: { checkInCodeDigits: 6 } });
    try {
      const res = await http().post(`/v1/schools/${school.id}/front-desk/my-code`).set('Authorization', `Bearer ${tokens.coach}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toMatch(/^\d{6}$/);
      expect(res.body.code).not.toBe(old);
      expect(await codeOf('coach')).toBe(res.body.code);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { checkInCodeDigits: 4 } });
    }
  });

  it('unlock attempts are limited per session', async () => {
    const s = await start('owner');
    const codes = new Set(await superuser.staffKioskCode.findMany({ where: { schoolId: school.id } }).then((r) => r.map((c) => c.code)));
    let guess = 0;
    const next = () => {
      while (codes.has(String(guess).padStart(4, '0'))) guess++;
      return String(guess++).padStart(4, '0');
    };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await http().post('/v1/front-desk/kiosk/unlock').set('Authorization', `Bearer ${s.sessionToken}`).send({ staffCode: next() })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
    expect(statuses[5]).toBe(429);
  });

  it('ten wrong staff codes end the session (Decision 388)', async () => {
    const s = await start('owner');
    const ownerCode = await codeOf('owner');
    const codes = new Set(await superuser.staffKioskCode.findMany({ where: { schoolId: school.id } }).then((r) => r.map((c) => c.code)));
    let guess = 0;
    const wrongCode = () => {
      while (codes.has(String(guess).padStart(4, '0'))) guess++;
      return String(guess++).padStart(4, '0');
    };
    const unlock = (staffCode: string) => http().post('/v1/front-desk/kiosk/unlock').set('Authorization', `Bearer ${s.sessionToken}`).send({ staffCode });

    expect((await unlock(wrongCode())).status).toBe(403);
    expect((await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: s.sessionId } })).wrongCodeCount).toBe(1);

    // Past the per-minute limit, as if eight more wrong codes came over the last minutes.
    await superuser.frontDeskSession.update({ where: { id: s.sessionId }, data: { wrongCodeCount: 9 } });
    const tenth = await unlock(wrongCode());
    expect(tenth.status).toBe(401);
    expect(tenth.body.error.code).toBe('FRONT_DESK_SESSION_ENDED');
    const row = await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(row.endedAt).not.toBeNull();
    expect(row.endedById).toBeNull();

    // A real code no longer helps: staff start the tablet again.
    expect((await unlock(ownerCode)).status).toBe(401);
    expect((await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${s.sessionToken}`)).status).toBe(401);
  });

  it("a tablet stops working once its Branch is closed (Decision 388)", async () => {
    const closing = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Sul' } });
    const s = await start('owner', closing.id);
    expect((await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${s.sessionToken}`)).status).toBe(200);
    await superuser.branch.update({ where: { id: closing.id }, data: { archivedAt: new Date() } });
    const res = await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${s.sessionToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('FRONT_DESK_SESSION_ENDED');
  });
});
