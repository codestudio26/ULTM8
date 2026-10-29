/**
 * Backlog 3.3 / Decision 403 over real HTTP: a new student's app access.
 * An adult added by hand gets a temporary passcode, shown to the owner once,
 * that stops working after 7 days; the owner can make a new one while it is
 * unused, for accounts their own School made only. A child has no login, so
 * the owner names the Guardian: a new Guardian gets the temporary passcode
 * and the child is enrolled; a Guardian with an account accepts an invite in
 * the app (or declines; the owner can withdraw it).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[student-access.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;

describeIfDb('App access for a new student (backlog 3.3, Decision 403)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tag = `student-access-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const tokens: Record<string, string> = {};
  const users: Record<string, { id: string; email: string }> = {};
  let school: string;
  let other: string;
  let sent: Array<{ to: string; subject: string; body: string }> = [];

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const login = (email: string, passcode: string) => http().post('/v1/auth/login').send({ email, passcode });
  const passcodeIn = (body: string) => /Temporary passcode: (\d{6})/.exec(body)?.[1];
  const childBody = (over: Record<string, unknown> = {}) => ({
    child: { firstName: 'Kit', surname: 'Young', dateOfBirth: '2016-03-04', gender: 'FEMALE' },
    guardian: { firstName: 'Gwen', surname: 'Young', email: `${tag}-guardian-${randomUUID().slice(0, 6)}@example.test` },
    ...over,
  });

  async function person(label: string, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'STUDENT'; schoolId: string }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `${tag}-${label}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Access',
        passcodeHash: 'x',
        dateOfBirth: new Date('1985-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    users[label] = { id: u.id, email: u.email };
    for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId } });
    tokens[label] = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })) });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    jest.spyOn(moduleRef.get<Queue>(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'add').mockResolvedValue(undefined as never);
    jest.spyOn(NotificationDeliveryService.prototype, 'sendEmail').mockImplementation(async (to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
    });

    school = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Dojo` } })).id;
    other = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Other Dojo` } })).id;
    schoolIds.push(school, other);
    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school }]);
    await person('staff', [{ role: 'BRANCH_STAFF', schoolId: school }]);
    await person('otherOwner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: other }]);
    await person('guardian', []);
    await person('stranger', []);
  });

  afterAll(async () => {
    const created = await superuser.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const minors = await superuser.guardianLink.findMany({ where: { guardianId: { in: [...userIds, ...created.map((c) => c.id)] } }, select: { studentId: true } });
    const all = [...new Set([...userIds, ...created.map((c) => c.id), ...minors.map((m) => m.studentId)])];
    await superuser.childInvite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.notification.deleteMany({ where: { userId: { in: all } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: all } } });
    await superuser.guardianLink.deleteMany({ where: { OR: [{ guardianId: { in: all } }, { studentId: { in: all } }] } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: all } } });
    await superuser.user.deleteMany({ where: { id: { in: all } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    sent = [];
  });

  it('an adult added by hand: the passcode is shown once, expires after 7 days, and can be replaced while unused', async () => {
    const email = `${tag}-adult@example.test`;
    const added = await http().post(`/v1/schools/${school}/students/add-manually`).set(as('owner')).send({ firstName: 'Ada', surname: 'Grown', email, dateOfBirth: '1990-01-01' });
    expect(added.status).toBe(201);
    const temp: string = added.body.temporaryPasscode;
    expect(temp).toMatch(/^\d{6}$/);
    expect(passcodeIn(sent[0].body)).toBe(temp);
    const expires = new Date(added.body.temporaryPasscodeExpiresAt).getTime();
    expect(Math.abs(expires - (Date.now() + 7 * DAY))).toBeLessThan(60_000);
    const adult = await superuser.user.findUniqueOrThrow({ where: { email } });
    expect(adult.temporaryPasscodeSchoolId).toBe(school);

    expect((await login(email, temp)).body.mustChangePasscode).toBe(true);

    // Expired: refused with its own code.
    await superuser.user.update({ where: { id: adult.id }, data: { temporaryPasscodeExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await login(email, temp);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('TEMPORARY_PASSCODE_EXPIRED');

    const statusUrl = `/v1/schools/${school}/students/${adult.id}/temporary-passcode`;
    expect((await http().get(statusUrl).set(as('owner'))).body).toMatchObject({ available: true, forGuardian: false, accountName: 'Ada Grown', expired: true });
    expect((await http().get(statusUrl).set(as('staff'))).status).toBe(403);
    expect((await http().post(statusUrl).set(as('staff'))).status).toBe(403);
    expect((await http().post(statusUrl).set(as('otherOwner'))).status).toBe(404);

    const renewed = await http().post(statusUrl).set(as('owner'));
    expect(renewed.status).toBe(201);
    expect(renewed.body).toMatchObject({ forGuardian: false, accountName: 'Ada Grown', email });
    expect((await login(email, temp)).status).toBe(401);
    const first = await login(email, renewed.body.temporaryPasscode);
    expect(first.body.mustChangePasscode).toBe(true);

    const changed = await http().post('/v1/auth/passcode-change/first-login').set({ Authorization: `Bearer ${first.body.passcodeChangeToken}` }).send({ newPasscode: '424242' });
    expect(changed.status).toBe(201);
    const after = await superuser.user.findUniqueOrThrow({ where: { id: adult.id } });
    expect([after.mustChangePasscode, after.temporaryPasscodeExpiresAt, after.temporaryPasscodeSchoolId]).toEqual([false, null, null]);
    expect((await http().get(statusUrl).set(as('owner'))).body.available).toBe(false);
    expect((await http().post(statusUrl).set(as('owner'))).status).toBe(409);
  });

  it("another School can't replace a temporary passcode it didn't make", async () => {
    const email = `${tag}-shared@example.test`;
    const added = await http().post(`/v1/schools/${school}/students/add-manually`).set(as('owner')).send({ firstName: 'Sam', surname: 'Shared', email, dateOfBirth: '1991-01-01' });
    expect(added.status).toBe(201);
    // The other School also enrols the same person.
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: added.body.id, schoolId: other } });
    const url = `/v1/schools/${other}/students/${added.body.id}/temporary-passcode`;
    expect((await http().get(url).set(as('otherOwner'))).body.available).toBe(false);
    expect((await http().post(url).set(as('otherOwner'))).status).toBe(409);
    expect(await bcrypt.compare(added.body.temporaryPasscode, (await superuser.user.findUniqueOrThrow({ where: { id: added.body.id } })).passcodeHash)).toBe(true);
  });

  it('a child with a new Guardian: the Guardian gets the temporary passcode, the child is linked and enrolled', async () => {
    const body = childBody();
    const res = await http().post(`/v1/schools/${school}/students/add-child-manually`).set(as('owner')).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ outcome: 'GUARDIAN_CREATED', guardianEmail: body.guardian.email, emailSent: true, inviteId: null });
    expect(passcodeIn(sent[0].body)).toBe(res.body.temporaryPasscode);

    const guardian = await superuser.user.findUniqueOrThrow({ where: { email: body.guardian.email } });
    expect([guardian.mustChangePasscode, guardian.temporaryPasscodeSchoolId]).toEqual([true, school]);
    const link = await superuser.guardianLink.findFirstOrThrow({ where: { guardianId: guardian.id, studentId: res.body.studentId } });
    expect(link.revokedAt).toBeNull();
    expect(await superuser.roleGrant.count({ where: { userId: res.body.studentId, schoolId: school, role: 'STUDENT', revokedAt: null } })).toBe(1);
    // The child itself has no temporary passcode; the Guardian's is the one.
    const status = await http().get(`/v1/schools/${school}/students/${res.body.studentId}/temporary-passcode`).set(as('owner'));
    expect(status.body).toMatchObject({ available: true, forGuardian: true, accountName: 'Gwen Young' });
    expect((await login(body.guardian.email, res.body.temporaryPasscode)).body.mustChangePasscode).toBe(true);

    expect((await http().post(`/v1/schools/${school}/students/add-child-manually`).set(as('staff')).send(childBody())).status).toBe(403);
    const adult = await http().post(`/v1/schools/${school}/students/add-child-manually`).set(as('owner')).send(childBody({ child: { firstName: 'Old', surname: 'Enough', dateOfBirth: '1990-01-01' } }));
    expect(adult.status).toBe(400);
  });

  it('a child whose Guardian has an account: an invite the Guardian accepts in the app', async () => {
    const body = childBody({ guardian: { firstName: 'Gina', surname: 'Access', email: users.guardian.email } });
    const res = await http().post(`/v1/schools/${school}/students/add-child-manually`).set(as('owner')).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ outcome: 'GUARDIAN_INVITED', temporaryPasscode: null, studentId: null });
    expect(sent[0].to).toBe(users.guardian.email);
    // The same child again is refused while the invite is open.
    expect((await http().post(`/v1/schools/${school}/students/add-child-manually`).set(as('owner')).send(body)).status).toBe(409);

    const list = await http().get(`/v1/schools/${school}/child-invites`).set(as('owner'));
    expect(list.body.items).toEqual([expect.objectContaining({ id: res.body.inviteId, childFirstName: 'Kit', guardianEmail: users.guardian.email })]);
    expect((await http().get(`/v1/schools/${school}/child-invites`).set(as('staff'))).status).toBe(403);

    const mine = await http().get('/v1/child-invites/me').set(as('guardian'));
    expect(mine.body.items).toEqual([expect.objectContaining({ id: res.body.inviteId, schoolName: `${tag} Dojo`, childDateOfBirth: '2016-03-04' })]);
    expect((await http().post(`/v1/child-invites/${res.body.inviteId}/accept`).set(as('stranger'))).status).toBe(404);

    const accepted = await http().post(`/v1/child-invites/${res.body.inviteId}/accept`).set(as('guardian'));
    expect(accepted.status).toBe(201);
    const childId = accepted.body.studentId;
    expect(await superuser.guardianLink.count({ where: { guardianId: users.guardian.id, studentId: childId, revokedAt: null } })).toBe(1);
    expect(await superuser.roleGrant.count({ where: { userId: childId, schoolId: school, role: 'STUDENT', revokedAt: null } })).toBe(1);
    expect((await http().post(`/v1/child-invites/${res.body.inviteId}/accept`).set(as('guardian'))).status).toBe(404);
    expect((await http().get('/v1/child-invites/me').set(as('guardian'))).body.items).toEqual([]);

    // The other School invites the same child: accepting uses the child already on the account.
    const again = await http().post(`/v1/schools/${other}/students/add-child-manually`).set(as('otherOwner')).send(body);
    expect(again.body.outcome).toBe('GUARDIAN_INVITED');
    const reused = await http().post(`/v1/child-invites/${again.body.inviteId}/accept`).set(as('guardian'));
    expect(reused.body.studentId).toBe(childId);
    expect(await superuser.guardianLink.count({ where: { guardianId: users.guardian.id, revokedAt: null } })).toBe(1);
  });

  it('the Guardian can decline, and the owner can withdraw an invite not yet answered', async () => {
    const make = async (firstName: string) =>
      (
        await http()
          .post(`/v1/schools/${school}/students/add-child-manually`)
          .set(as('owner'))
          .send(childBody({ child: { firstName, surname: 'Young', dateOfBirth: '2017-05-06' }, guardian: { firstName: 'Gina', surname: 'Access', email: users.guardian.email } }))
      ).body.inviteId as string;
    const declined = await make('Dee');
    expect((await http().post(`/v1/child-invites/${declined}/decline`).set(as('guardian'))).status).toBe(204);
    expect((await superuser.childInvite.findUniqueOrThrow({ where: { id: declined } })).status).toBe('DECLINED');

    const withdrawn = await make('Wes');
    expect((await http().post(`/v1/schools/${school}/child-invites/${withdrawn}/withdraw`).set(as('staff'))).status).toBe(403);
    expect((await http().post(`/v1/schools/${school}/child-invites/${withdrawn}/withdraw`).set(as('owner'))).status).toBe(204);
    expect((await http().post(`/v1/child-invites/${withdrawn}/accept`).set(as('guardian'))).status).toBe(404);
  });
});
