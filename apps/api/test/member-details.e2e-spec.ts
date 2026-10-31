/**
 * Decision 315 items 4 and 5 (v1.3 backlog 5.1, 5.2) over real HTTP and
 * Postgres/RLS: a student's join date at each School, and their secondary
 * phone/email and emergency contact.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[member-details.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

type Grant = { role: 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'STUDENT'; schoolId: string };

/** YYYY-MM-DD, `days` from today (UTC). */
const dayFromToday = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describeIfDb('Member details: join date and contacts (Decision 315 items 4, 5)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tag = `member-details-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let school: string;
  let other: string;

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const profileUrl = (schoolId: string, who: string) => `/v1/schools/${schoolId}/students/${ids[who]}/profile`;
  const joinDateOf = async (schoolId: string, studentId: string) =>
    (await superuser.studentJoinDate.findUnique({ where: { schoolId_studentId: { schoolId, studentId } } }))?.joinedOn.toISOString().slice(0, 10) ?? null;

  async function person(label: string, grants: Grant[], extra: { dateOfBirth?: Date } = {}) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `${tag}-${label}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Member',
        passcodeHash: 'x',
        dateOfBirth: extra.dateOfBirth ?? new Date('1985-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    ids[label] = u.id;
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
    jest.spyOn(NotificationDeliveryService.prototype, 'sendEmail').mockResolvedValue(undefined);

    school = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Dojo` } })).id;
    other = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Other Dojo` } })).id;
    schoolIds.push(school, other);
    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school }]);
    await person('otherOwner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: other }]);
    await person('student', [{ role: 'STUDENT', schoolId: school }]);
    await person('both', [
      { role: 'STUDENT', schoolId: school },
      { role: 'STUDENT', schoolId: other },
    ]);
    await person('guardian', []);
    await person('child', [{ role: 'STUDENT', schoolId: school }], { dateOfBirth: new Date('2016-05-05') });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: ids.guardian, studentId: ids.child } });
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
    await superuser.user.deleteMany({ where: { id: { in: all } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Join date (item 4)
  // ---------------------------------------------------------------------------

  it('enrolling makes the join date: per School, in the School timezone, kept when they come back', async () => {
    const tzSchool = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Kiritimati Dojo`, timezone: 'Pacific/Kiritimati' } })).id;
    schoolIds.push(tzSchool);
    // 12:00 UTC is already the next day at UTC+14.
    const first = await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: ids.both, schoolId: tzSchool, grantedAt: new Date('2026-01-01T12:00:00Z') },
    });
    expect(await joinDateOf(tzSchool, ids.both)).toBe('2026-01-02');
    // Leaving and coming back keeps the day they first joined.
    await superuser.roleGrant.update({ where: { id: first.id }, data: { revokedAt: new Date() } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: ids.both, schoolId: tzSchool } });
    expect(await joinDateOf(tzSchool, ids.both)).toBe('2026-01-02');
    // A School with an unknown timezone falls back to UTC.
    const oddSchool = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Odd Dojo`, timezone: 'Not/AZone' } })).id;
    schoolIds.push(oddSchool);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: ids.both, schoolId: oddSchool, grantedAt: new Date('2026-01-01T23:30:00Z') } });
    expect(await joinDateOf(oddSchool, ids.both)).toBe('2026-01-01');
    // A staff role makes none.
    expect(await joinDateOf(school, ids.owner)).toBeNull();
  });

  it('the roster and the profile show the join date; staff can set an earlier one', async () => {
    const today = await joinDateOf(school, ids.student);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const roster = await http().get(`/v1/schools/${school}/students`).set(as('owner'));
    expect(roster.status).toBe(200);
    expect(roster.body.items.find((r: { id: string }) => r.id === ids.student).joinedOn).toBe(today);

    const set = await http().patch(profileUrl(school, 'student')).set(as('owner')).send({ joinedOn: '2019-09-01' });
    expect(set.status).toBe(200);
    expect(set.body.joinedOn).toBe('2019-09-01');
    expect((await http().get(profileUrl(school, 'student')).set(as('owner'))).body.joinedOn).toBe('2019-09-01');
    const row = await superuser.studentJoinDate.findUniqueOrThrow({ where: { schoolId_studentId: { schoolId: school, studentId: ids.student } } });
    expect(row.setById).toBe(ids.owner);

    const all = await http().get(`/v1/schools/${school}/students?status=ALL`).set(as('owner'));
    expect(all.body.items.find((r: { id: string }) => r.id === ids.student).joinedOn).toBe('2019-09-01');
  });

  it('a join date in the future, or not a real date, is refused and nothing in the request is saved', async () => {
    const future = await http().patch(profileUrl(school, 'student')).set(as('owner')).send({ joinedOn: dayFromToday(2), firstName: 'NotSaved' });
    expect(future.status).toBe(400);
    expect(JSON.stringify(future.body)).toMatch(/future/);
    const notReal = await http().patch(profileUrl(school, 'student')).set(as('owner')).send({ joinedOn: '2021-02-30' });
    expect(notReal.status).toBe(400);
    const badFormat = await http().patch(profileUrl(school, 'student')).set(as('owner')).send({ joinedOn: '01/02/2021' });
    expect(badFormat.status).toBe(400);
    expect((await superuser.user.findUniqueOrThrow({ where: { id: ids.student } })).firstName).toBe('student');
    expect(await joinDateOf(school, ids.student)).toBe('2019-09-01');
  });

  it('each School has its own join date; another School can neither read nor change this one', async () => {
    await http().patch(profileUrl(school, 'both')).set(as('owner')).send({ joinedOn: '2020-01-01' }).expect(200);
    const otherDate = await joinDateOf(other, ids.both);
    expect(otherDate).not.toBe('2020-01-01');
    expect((await http().get(profileUrl(other, 'both')).set(as('otherOwner'))).body.joinedOn).toBe(otherDate);

    const crossRead = await http().get(profileUrl(school, 'student')).set(as('otherOwner'));
    expect([403, 404]).toContain(crossRead.status);
    const crossWrite = await http().patch(profileUrl(school, 'student')).set(as('otherOwner')).send({ joinedOn: '2010-01-01' });
    expect([403, 404]).toContain(crossWrite.status);
    // The student themselves isn't staff.
    expect((await http().patch(profileUrl(school, 'student')).set(as('student')).send({ joinedOn: '2010-01-01' })).status).toBe(403);
    expect(await joinDateOf(school, ids.student)).toBe('2019-09-01');
  });

  it('the app connection has no access to StudentJoinDate (jobs connection only)', async () => {
    const appClient = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
    try {
      await expect(appClient.studentJoinDate.findMany({ take: 1 })).rejects.toThrow();
    } finally {
      await appClient.$disconnect();
    }
  });

  // ---------------------------------------------------------------------------
  // Contacts (item 5)
  // ---------------------------------------------------------------------------

  it('staff set, read back and clear the secondary phone/email and the emergency contact', async () => {
    const contacts = {
      secondaryPhone: '+44 7700 900123',
      secondaryEmail: '  Second@Example.TEST ',
      emergencyContactName: 'Maria Lopez',
      emergencyContactPhone: '+44 7700 900456',
      emergencyContactRelationship: 'Mother',
    };
    const res = await http().patch(profileUrl(school, 'student')).set(as('owner')).send(contacts);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...contacts, secondaryEmail: 'second@example.test' });
    expect((await http().get(profileUrl(school, 'student')).set(as('owner'))).body).toMatchObject({ emergencyContactName: 'Maria Lopez' });
    // Not a login: the account's own email and phone are untouched.
    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: ids.student } });
    expect(persisted.email).toBe(`${tag}-student@example.test`);

    const cleared = await http().patch(profileUrl(school, 'student')).set(as('owner')).send({ secondaryPhone: '', emergencyContactRelationship: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ secondaryPhone: null, emergencyContactRelationship: null, emergencyContactName: 'Maria Lopez' });

    expect((await http().patch(profileUrl(school, 'student')).set(as('owner')).send({ secondaryEmail: 'not-an-email' })).status).toBe(400);
    expect((await http().patch(profileUrl(school, 'student')).set(as('owner')).send({ emergencyContactName: 'x'.repeat(101) })).status).toBe(400);
  });

  it('a member sees and edits their own contacts in the app (PATCH /users/me)', async () => {
    const res = await http().patch('/v1/users/me').set(as('both')).send({ secondaryEmail: 'me2@example.test', emergencyContactName: 'Partner' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ secondaryEmail: 'me2@example.test', emergencyContactName: 'Partner' });
    expect((await http().get('/v1/users/me').set(as('both'))).body).toMatchObject({ secondaryEmail: 'me2@example.test', emergencyContactName: 'Partner', secondaryPhone: null });
  });

  it("a Guardian-managed child can't change their own contacts; staff can", async () => {
    const self = await http().patch('/v1/users/me').set(as('child')).send({ emergencyContactName: 'Me' });
    expect(self.status).toBe(403);
    // Other fields still follow the existing rules.
    expect((await http().patch('/v1/users/me').set(as('child')).send({ kimonoSize: 'M0' })).status).toBe(200);
    const staff = await http().patch(profileUrl(school, 'child')).set(as('owner')).send({ emergencyContactName: 'Aunt Jo', emergencyContactRelationship: 'Aunt' });
    expect(staff.status).toBe(200);
    expect(staff.body).toMatchObject({ emergencyContactName: 'Aunt Jo' });
  });

  // ---------------------------------------------------------------------------
  // Add student
  // ---------------------------------------------------------------------------

  it('Add manually takes a join date and contacts; a future join date is refused before an account is made', async () => {
    const email = `${tag}-added@example.test`;
    const future = await http()
      .post(`/v1/schools/${school}/students/add-manually`)
      .set(as('owner'))
      .send({ firstName: 'Fut', surname: 'Ure', email, dateOfBirth: '1990-01-01', joinedOn: dayFromToday(2) });
    expect(future.status).toBe(400);
    expect(await superuser.user.findUnique({ where: { email } })).toBeNull();

    const added = await http()
      .post(`/v1/schools/${school}/students/add-manually`)
      .set(as('owner'))
      .send({ firstName: 'Ada', surname: 'Added', email, dateOfBirth: '1990-01-01', joinedOn: '2018-04-05', secondaryPhone: '07700 900789', emergencyContactName: 'Bo', secondaryEmail: '' });
    expect(added.status).toBe(201);
    expect(await joinDateOf(school, added.body.id)).toBe('2018-04-05');
    const user = await superuser.user.findUniqueOrThrow({ where: { id: added.body.id } });
    expect([user.secondaryPhone, user.emergencyContactName, user.secondaryEmail]).toEqual(['07700 900789', 'Bo', null]);

    // Without one, it's the day they were added.
    const plain = await http()
      .post(`/v1/schools/${school}/students/add-manually`)
      .set(as('owner'))
      .send({ firstName: 'Pat', surname: 'Plain', email: `${tag}-plain@example.test`, dateOfBirth: '1990-01-01' });
    expect(plain.status).toBe(201);
    const [today] = await superuser.$queryRaw<Array<{ d: string }>>`SELECT "school_local_date"(${school}, (now() AT TIME ZONE 'UTC')::timestamp)::text AS d`;
    expect(await joinDateOf(school, plain.body.id)).toBe(today.d);
  });

  it("a child's join date: set at once for a new Guardian, and when an existing Guardian accepts the invite", async () => {
    const created = await http()
      .post(`/v1/schools/${school}/students/add-child-manually`)
      .set(as('owner'))
      .send({
        child: { firstName: 'Kit', surname: 'New', dateOfBirth: '2016-03-04' },
        guardian: { firstName: 'Gwen', surname: 'New', email: `${tag}-newguardian@example.test` },
        joinedOn: '2022-02-02',
      });
    expect(created.status).toBe(201);
    expect(created.body.outcome).toBe('GUARDIAN_CREATED');
    expect(await joinDateOf(school, created.body.studentId)).toBe('2022-02-02');

    const invited = await http()
      .post(`/v1/schools/${school}/students/add-child-manually`)
      .set(as('owner'))
      .send({
        child: { firstName: 'Lee', surname: 'Invited', dateOfBirth: '2017-03-04' },
        guardian: { firstName: 'guardian', surname: 'Member', email: `${tag}-guardian@example.test` },
        joinedOn: '2023-03-03',
      });
    expect(invited.status).toBe(201);
    expect(invited.body.outcome).toBe('GUARDIAN_INVITED');
    const accepted = await http().post(`/v1/child-invites/${invited.body.inviteId}/accept`).set(as('guardian'));
    expect(accepted.status).toBe(201);
    expect(await joinDateOf(school, accepted.body.studentId)).toBe('2023-03-03');

    const future = await http()
      .post(`/v1/schools/${school}/students/add-child-manually`)
      .set(as('owner'))
      .send({
        child: { firstName: 'Zed', surname: 'Later', dateOfBirth: '2017-03-04' },
        guardian: { firstName: 'guardian', surname: 'Member', email: `${tag}-guardian@example.test` },
        joinedOn: dayFromToday(2),
      });
    expect(future.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Erasure
  // ---------------------------------------------------------------------------

  it('erasing an account erases its contacts and join dates with it', async () => {
    await person('leaver', [{ role: 'STUDENT', schoolId: school }]);
    await http().patch(profileUrl(school, 'leaver')).set(as('owner')).send({ emergencyContactName: 'Someone', secondaryEmail: 'leaver2@example.test' }).expect(200);
    expect(await joinDateOf(school, ids.leaver)).not.toBeNull();
    await superuser.roleGrant.deleteMany({ where: { userId: ids.leaver } });
    await superuser.user.delete({ where: { id: ids.leaver } });
    expect(await superuser.studentJoinDate.count({ where: { studentId: ids.leaver } })).toBe(0);
    expect(await superuser.user.count({ where: { secondaryEmail: 'leaver2@example.test' } })).toBe(0);
  });
});
