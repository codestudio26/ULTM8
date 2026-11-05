import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter, isNulCharacterError } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

/**
 * Decision 434 (round-5 text, search and identity): name search ignores case,
 * accents and spelling variants (TXT-1); the tablet's initial is a whole
 * letter (TXT-7); a NUL character is a 400 (TXT-4); "Has only one name"
 * (TXT-8); one waiting sign-up per email, held by the database (TXT-9); and a
 * walk-in's contacts reach a new account on approval (TXT-10).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[text-identity.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Text, search and identity (Decision 434)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let school: { id: string };
  let branch: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const students: Record<string, string> = {};
  let tablet: string;

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const phone = () => `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`;

  async function person(firstName: string, surname: string, email = `txt-${randomUUID()}@example.test`) {
    return superuser.user.create({
      data: { id: randomUUID(), email, phone: phone(), firstName, surname, passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), phoneVerifiedAt: new Date() },
    });
  }

  async function startTablet() {
    const res = await http().post(`/v1/schools/${school.id}/front-desk/sessions`).set(as('staff')).send({ branchId: branch.id });
    expect(res.status).toBe(201);
    return res.body.sessionToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    jest.spyOn(app.get(NotificationDeliveryService), 'sendEmail').mockResolvedValue(undefined as never);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Text School', visitorPeriodDays: 7 } });
    branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Dubai' } });
    for (const [who, role, branchId] of [
      ['owner', 'SCHOOL_OWNER_MANAGER', null],
      ['staff', 'BRANCH_STAFF', null],
    ] as Array<[string, Role, string | null]>) {
      const user = await person(who, 'Desk');
      users[who] = user;
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId: role === 'BRANCH_STAFF' ? branch.id : branchId } });
      tokens[who] = jwt.sign({
        sub: user.id,
        email: user.email,
        grants: [{ role, franchiseId: null, schoolId: school.id, branchId: role === 'BRANCH_STAFF' ? branch.id : branchId }],
      });
    }
    const roster: Array<[string, string, string]> = [
      ['fatima', 'فاطمة', 'المنصوري'],
      ['joao', 'João', 'Conceição'],
      // Stored decomposed (NFD), as pasted from a Mac.
      ['bjorn', 'Björn', 'Krüger-Weiß'],
      ['shota', '翔太', '佐藤'],
      ['sharma', 'Rahul', 'शर्मा'],
      ['khan', 'Aarav', 'ख़ान'],
      ['mononym', 'Venkataraghavan', ''],
    ];
    for (const [key, first, last] of roster) {
      const user = await person(first, last);
      students[key] = user.id;
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
      await superuser.studentHomeBranch.create({ data: { schoolId: school.id, studentId: user.id, branchId: branch.id } });
    }
    tablet = await startTablet();
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    const made = await superuser.signUp.findMany({ where: { ...where, userId: { not: null } }, select: { userId: true } });
    const roleUsers = await superuser.roleGrant.findMany({ where, select: { userId: true } });
    await superuser.signUp.deleteMany({ where });
    await superuser.frontDeskSession.deleteMany({ where });
    await superuser.staffKioskCode.deleteMany({ where });
    await superuser.studentHomeBranch.deleteMany({ where });
    await superuser.studentJoinDate?.deleteMany?.({ where }).catch(() => undefined);
    await superuser.staffPermission.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    const ids = [...new Set([...made.map((m) => m.userId as string), ...roleUsers.map((r) => r.userId), ...Object.values(students), ...Object.values(users).map((u) => u.id)])];
    await superuser.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    await superuser.school.deleteMany({ where: { id: school.id } }).catch(() => undefined);
    await superuser.$disconnect();
    await app.close();
  });

  describe('name search (TXT-1)', () => {
    const search = async (q: string) => {
      const res = await http().get(`/v1/schools/${school.id}/students`).query({ search: q }).set(as('owner'));
      expect(res.status).toBe(200);
      return (res.body.items as Array<{ id: string }>).map((s) => s.id);
    };

    it('finds Arabic spelling variants, unaccented Portuguese, NFD names and Japanese family-name-first', async () => {
      expect(await search('فاطمه')).toEqual([students.fatima]);
      expect(await search('المنصورى')).toEqual([students.fatima]);
      expect(await search('Joao Conceicao')).toEqual([students.joao]);
      expect(await search('Krüger-Weiß')).toEqual([students.bjorn]);
      expect(await search('KRUGER WEISS')).toEqual([students.bjorn]);
      expect(await search('佐藤 翔太')).toEqual([students.shota]);
      expect(await search('佐藤　翔太')).toEqual([students.shota]);
      expect(await search('佐藤翔太')).toEqual([students.shota]);
    });

    it('keeps Hindi names that differ by a virama or nukta apart', async () => {
      expect(await search('शरमा')).toEqual([]);
      expect(await search('खान')).toEqual([]);
      expect(await search('शर्मा')).toEqual([students.sharma]);
    });

    it('the tablet search folds the same way, and shows whole first letters (TXT-7)', async () => {
      const res = await http().get('/v1/front-desk/kiosk/students').query({ search: 'aarav' }).set('Authorization', `Bearer ${tablet}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([expect.objectContaining({ id: students.khan, surnameInitial: 'ख़ा' })]);
      const one = await http().get('/v1/front-desk/kiosk/students').query({ search: 'venkata' }).set('Authorization', `Bearer ${tablet}`);
      expect(one.body.items).toEqual([expect.objectContaining({ id: students.mononym, surnameInitial: '' })]);
      const ar = await http().get('/v1/front-desk/kiosk/students').query({ search: 'فـاطمة' }).set('Authorization', `Bearer ${tablet}`);
      expect(ar.body.items.map((s: { id: string }) => s.id)).toEqual([students.fatima]);
    });
  });

  describe('NUL characters (TXT-4)', () => {
    it('are refused with 400 INVALID_CHARACTER in a body, a query or a path, before anything is written', async () => {
      const body = await http().post(`/v1/schools/${school.id}/closures`).set(as('owner')).send({ startDate: '2027-03-01', endDate: '2027-03-01', reason: 'Eid \u0000' });
      expect(body.status).toBe(400);
      expect(body.body.error.code).toBe('INVALID_CHARACTER');
      expect(await superuser.closure.count({ where: { schoolId: school.id } })).toBe(0);
      const query = await http().get(`/v1/schools/${school.id}/students`).query({ search: 'a\u0000b' }).set(as('owner'));
      expect(query.status).toBe(400);
      expect(query.body.error.code).toBe('INVALID_CHARACTER');
      const nested = await http()
        .patch(`/v1/schools/${school.id}/students/${students.joao}/profile`)
        .set(as('owner'))
        .send({ emergencyContactName: 'Ana\u0000' });
      expect(nested.status).toBe(400);
    });

    it("Postgres's own refusal (22021) is a 400 too, as a backstop", async () => {
      const err = await superuser.school.update({ where: { id: school.id }, data: { name: 'Text\u0000School' } }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).not.toBeNull();
      expect(isNulCharacterError(err)).toBe(true);
    });
  });

  describe('"Has only one name" (TXT-8)', () => {
    const add = (body: Record<string, unknown>) =>
      http()
        .post(`/v1/schools/${school.id}/students/add-manually`)
        .set(as('owner'))
        .send({ firstName: 'Suriya', email: `txt-one-${randomUUID()}@example.test`, dateOfBirth: '1990-05-05', branchId: branch.id, ...body });

    it('a blank surname is refused without the tick, and saved empty with it', async () => {
      const blank = await add({ surname: '' });
      expect(blank.status).toBe(400);
      expect(blank.body.error.message).toContain("Surname can't be blank.");
      const both = await add({ surname: 'S', hasOnlyOneName: true });
      expect(both.status).toBe(400);
      expect(both.body.error.message).toContain('Leave the surname empty for someone who has only one name.');
      const ok = await add({ surname: '', hasOnlyOneName: true });
      expect(ok.status).toBe(201);
      expect((await superuser.user.findUniqueOrThrow({ where: { id: ok.body.id } })).surname).toBe('');
    });

    it('staff can turn an existing placeholder surname into one name, but not blank it by accident', async () => {
      const id = students.joao;
      const accidental = await http().patch(`/v1/schools/${school.id}/students/${id}/profile`).set(as('owner')).send({ surname: ' ' });
      expect(accidental.status).toBe(400);
      const ticked = await http().patch(`/v1/schools/${school.id}/students/${id}/profile`).set(as('owner')).send({ surname: '', hasOnlyOneName: true });
      expect(ticked.status).toBe(200);
      expect((await superuser.user.findUniqueOrThrow({ where: { id } })).surname).toBe('');
      await superuser.user.update({ where: { id }, data: { surname: 'Conceição' } });
    });

    it('the tablet sign-up takes the tick too', async () => {
      const res = await http()
        .post('/v1/front-desk/kiosk/sign-ups')
        .set('Authorization', `Bearer ${tablet}`)
        .send({ kind: 'MEMBER', firstName: 'Suriya', surname: '', hasOnlyOneName: true, dateOfBirth: '1990-05-05', email: `txt-kiosk-${randomUUID()}@example.test` });
      expect(res.status).toBe(201);
      expect((await superuser.signUp.findUniqueOrThrow({ where: { id: res.body.id } })).surname).toBe('');
    });
  });

  describe('sign-ups (TXT-9, TXT-10)', () => {
    it('sends at the same moment leave one waiting sign-up; the others are 409 SIGN_UP_WAITING', async () => {
      tablet = await startTablet();
      const email = `txt-race-${randomUUID()}@example.test`;
      const body = { kind: 'MEMBER', firstName: 'Ore', surname: 'Adebayo', dateOfBirth: '1992-02-02', email };
      const results = await Promise.all([0, 1, 2, 3].map(() => http().post('/v1/front-desk/kiosk/sign-ups').set('Authorization', `Bearer ${tablet}`).send(body)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('SIGN_UP_WAITING');
      expect(await superuser.signUp.count({ where: { schoolId: school.id, email, status: { in: ['PENDING', 'INVITED'] } } })).toBe(1);
      // The database holds the rule even past the service's check.
      const copy = await superuser.signUp
        .create({ data: { schoolId: school.id, kind: 'MEMBER', firstName: 'Ore', surname: 'Adebayo', dateOfBirth: new Date('1992-02-02'), email } })
        .then(
          () => null,
          (e: { code?: string }) => e.code,
        );
      expect(copy).toBe('P2002');
    });

    it("approving a new walk-in copies their phone and emergency contact to the new account; an invited account isn't changed", async () => {
      tablet = await startTablet();
      const email = `txt-walkin-${randomUUID()}@example.test`;
      const sent = await http()
        .post('/v1/front-desk/kiosk/sign-ups')
        .set('Authorization', `Bearer ${tablet}`)
        .send({
          kind: 'MEMBER',
          firstName: 'Abubakar',
          surname: 'Danjuma',
          dateOfBirth: '1988-03-03',
          email,
          phone: '+2348091112233',
          emergencyName: 'Hauwa Danjuma',
          emergencyPhone: '+2348094445566',
          emergencyRelationship: 'Wife',
        });
      expect(sent.status).toBe(201);
      const approved = await http().post(`/v1/schools/${school.id}/sign-ups/${sent.body.id}/approve`).set(as('owner')).send({});
      expect(approved.status).toBe(200);
      expect(approved.body.accountCreated).toBe(true);
      const account = await superuser.user.findUniqueOrThrow({ where: { email } });
      expect(account).toMatchObject({
        phone: null,
        secondaryPhone: '+2348091112233',
        emergencyContactName: 'Hauwa Danjuma',
        emergencyContactPhone: '+2348094445566',
        emergencyContactRelationship: 'Wife',
      });

      // An existing account is invited, and its own details are left alone.
      const existing = await person('Ada', 'Existing');
      const again = await http()
        .post('/v1/front-desk/kiosk/sign-ups')
        .set('Authorization', `Bearer ${tablet}`)
        .send({ kind: 'MEMBER', firstName: 'Ada', surname: 'Existing', dateOfBirth: '1990-01-01', email: existing.email, phone: '+447700900999', emergencyName: 'Someone', emergencyPhone: '+447700900111' });
      expect(again.status).toBe(201);
      const invited = await http().post(`/v1/schools/${school.id}/sign-ups/${again.body.id}/approve`).set(as('owner')).send({});
      expect(invited.body.invited).toBe(true);
      expect(await superuser.user.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ secondaryPhone: null, emergencyContactName: null, emergencyContactPhone: null });
      await superuser.signUp.deleteMany({ where: { userId: existing.id } });
      await superuser.user.delete({ where: { id: existing.id } });
    });
  });
});
