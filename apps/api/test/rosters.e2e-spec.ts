/**
 * Rosters (Decision 317 item 6): named lists of members for staff, to take
 * attendance or filter the Students list. Each School manages its own; staff
 * only see the current students they cover; members never see rosters. A
 * roster from one School can never hold a student under another, and the
 * database itself refuses it.
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

type Role = 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF' | 'STUDENT';

/** A roster name no other data could contain, to look for in member replies. */
const SECRET_ROSTER = `Watch-list-${randomUUID().slice(0, 8)}`;

describeIfDb('Rosters (Decision 317 item 6)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  const otherSchoolId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`),
    post: (path: string) => http().post(path).set('Authorization', `Bearer ${tokens[who]}`),
    patch: (path: string) => http().patch(path).set('Authorization', `Bearer ${tokens[who]}`),
    delete: (path: string) => http().delete(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const listOf = (sid: string) => `/v1/schools/${sid}/rosters`;
  const membersOf = (rosterId: string, sid = schoolId) => `/v1/schools/${sid}/rosters/${rosterId}/students`;
  const names = (res: request.Response) => (res.body.items as Array<{ name: string }>).map((r) => r.name);
  const sorted = (ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.createMany({ data: [{ id: schoolId, name: 'Rosters School' }, { id: otherSchoolId, name: 'Rosters Other School' }] });
    await superuser.branch.createMany({ data: [{ id: branchA, schoolId, name: 'Rosters A' }, { id: branchB, schoolId, name: 'Rosters B' }] });
    const grants: Record<string, Array<[Role, string, string | null]>> = {
      owner: [['SCHOOL_OWNER_MANAGER', schoolId, null]],
      coachA: [['INSTRUCTOR', schoolId, branchA]],
      staffA: [['BRANCH_STAFF', schoolId, branchA]],
      ana: [['STUDENT', schoolId, null]],
      ben: [['STUDENT', schoolId, null]],
      kid: [['STUDENT', schoolId, null]],
      parent: [],
      leaver: [['STUDENT', schoolId, null]],
      gone: [['STUDENT', schoolId, null]],
      otherOwner: [['SCHOOL_OWNER_MANAGER', otherSchoolId, null]],
      otherStudent: [['STUDENT', otherSchoolId, null]],
    };
    for (const [label, list] of Object.entries(grants)) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `rosters-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Rosters',
          passcodeHash: 'x',
          dateOfBirth: new Date(label === 'kid' ? '2016-01-01' : '1990-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      for (const [role, sid, branchId] of list) await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label].id, schoolId: sid, branchId } });
      tokens[label] = jwt.sign({
        sub: users[label].id,
        email: users[label].email,
        grants: list.map(([role, sid, branchId]) => ({ role, franchiseId: null, schoolId: sid, branchId })),
      });
    }
    // Ana, the kid, the leaver and gone at Branch A; Ben at Branch B.
    const homes: Array<[string, string]> = [
      ['ana', branchA],
      ['kid', branchA],
      ['leaver', branchA],
      ['gone', branchA],
      ['ben', branchB],
    ];
    for (const [label, branchId] of homes) await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId, studentId: users[label].id, branchId } });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id } });
  });

  afterAll(async () => {
    await superuser.roster.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.branch.deleteMany({ where: { schoolId } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolId, otherSchoolId] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner creates, renames and deletes rosters; names are unique ignoring case', async () => {
    const comp = await as('owner').post(listOf(schoolId)).send({ name: '  Comp   team ' });
    expect(comp.status).toBe(201);
    expect(comp.body).toMatchObject({ name: 'Comp team', memberCount: 0 });
    expect((await as('owner').post(listOf(schoolId)).send({ name: SECRET_ROSTER })).status).toBe(201);
    expect((await as('owner').post(listOf(schoolId)).send({ name: 'COMP TEAM' })).status).toBe(409);
    expect((await as('owner').post(listOf(schoolId)).send({ name: '   ' })).status).toBe(400);
    expect((await as('owner').post(listOf(schoolId)).send({ name: 'x'.repeat(61) })).status).toBe(400);

    const renamed = await as('owner').patch(`${listOf(schoolId)}/${comp.body.id}`).send({ name: 'Competition team' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: comp.body.id, name: 'Competition team' });
    expect((await as('owner').patch(`${listOf(schoolId)}/${comp.body.id}`).send({ name: SECRET_ROSTER.toLowerCase() })).status).toBe(409);

    const temp = (await as('owner').post(listOf(schoolId)).send({ name: 'Temp' })).body;
    expect((await as('owner').delete(`${listOf(schoolId)}/${temp.id}`)).status).toBe(204);
    expect((await as('owner').delete(`${listOf(schoolId)}/${temp.id}`)).status).toBe(404);

    const list = await as('coachA').get(listOf(schoolId));
    expect(list.status).toBe(200);
    expect(names(list)).toEqual(['Competition team', SECRET_ROSTER]);
  });

  it('adds and removes members; staff see and add only the students of their own branches', async () => {
    const comp = (await as('owner').get(listOf(schoolId))).body.items.find((r: { name: string }) => r.name === 'Competition team');
    const added = await as('owner').post(membersOf(comp.id)).send({ studentIds: [users.ana.id, users.ben.id, users.ana.id] });
    expect(added.status).toBe(200);
    expect(sorted(added.body.studentIds)).toEqual(sorted([users.ana.id, users.ben.id]));
    // Adding again is harmless.
    expect((await as('owner').post(membersOf(comp.id)).send({ studentIds: [users.ana.id] })).status).toBe(200);
    // Only current students of this School.
    expect((await as('owner').post(membersOf(comp.id)).send({ studentIds: [users.otherStudent.id] })).status).toBe(404);
    expect((await as('owner').post(membersOf(comp.id)).send({ studentIds: [users.coachA.id] })).status).toBe(404);
    expect((await as('owner').post(membersOf(comp.id)).send({ studentIds: [] })).status).toBe(400);

    // The Branch A coach sees only Ana (Ben is at Branch B), and so does the count.
    expect((await as('coachA').get(membersOf(comp.id))).body.studentIds).toEqual([users.ana.id]);
    const coachList = (await as('coachA').get(listOf(schoolId))).body.items.find((r: { id: string }) => r.id === comp.id);
    expect(coachList.memberCount).toBe(1);
    expect((await as('owner').get(listOf(schoolId))).body.items.find((r: { id: string }) => r.id === comp.id).memberCount).toBe(2);
    // ...and can't add or remove Ben.
    expect((await as('coachA').post(membersOf(comp.id)).send({ studentIds: [users.ben.id] })).status).toBe(403);
    expect((await as('coachA').delete(`${membersOf(comp.id)}/${users.ben.id}`)).status).toBe(403);
    // But can add the kid from their branch.
    expect(sorted((await as('coachA').post(membersOf(comp.id)).send({ studentIds: [users.kid.id] })).body.studentIds)).toEqual(sorted([users.ana.id, users.kid.id]));

    expect((await as('owner').delete(`${membersOf(comp.id)}/${users.ben.id}`)).status).toBe(204);
    expect((await as('owner').delete(`${membersOf(comp.id)}/${users.ben.id}`)).status).toBe(404);
    expect(sorted((await as('owner').get(membersOf(comp.id))).body.studentIds)).toEqual(sorted([users.ana.id, users.kid.id]));
  });

  it('someone who leaves the School drops out of the lists, and can still be taken off', async () => {
    const comp = (await as('owner').get(listOf(schoolId))).body.items.find((r: { name: string }) => r.name === 'Competition team');
    await as('owner').post(membersOf(comp.id)).send({ studentIds: [users.leaver.id] });
    expect((await as('owner').get(membersOf(comp.id))).body.studentIds).toContain(users.leaver.id);
    await superuser.roleGrant.updateMany({ where: { userId: users.leaver.id, schoolId }, data: { revokedAt: new Date() } });
    expect((await as('owner').get(membersOf(comp.id))).body.studentIds).not.toContain(users.leaver.id);
    expect((await as('owner').delete(`${membersOf(comp.id)}/${users.leaver.id}`)).status).toBe(204);
  });

  it('Branch Staff: managing needs the Students switch; reading members needs Students or Bookings', async () => {
    const comp = (await as('owner').get(listOf(schoolId))).body.items.find((r: { name: string }) => r.name === 'Competition team');
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staffA.id, canManageStudents: false, canManageBookings: false } });
    expect((await as('staffA').get(listOf(schoolId))).status).toBe(200);
    expect((await as('staffA').get(membersOf(comp.id))).status).toBe(403);
    expect((await as('staffA').post(listOf(schoolId)).send({ name: 'Nope' })).status).toBe(403);
    expect((await as('staffA').patch(`${listOf(schoolId)}/${comp.id}`).send({ name: 'Nope' })).status).toBe(403);
    expect((await as('staffA').delete(`${listOf(schoolId)}/${comp.id}`)).status).toBe(403);
    expect((await as('staffA').post(membersOf(comp.id)).send({ studentIds: [users.ana.id] })).status).toBe(403);

    // The Bookings switch alone lets them read who's on it (roll call), not change it.
    await superuser.staffPermission.updateMany({ where: { schoolId, userId: users.staffA.id }, data: { canManageBookings: true } });
    expect(sorted((await as('staffA').get(membersOf(comp.id))).body.studentIds)).toEqual(sorted([users.ana.id, users.kid.id]));
    expect((await as('staffA').delete(`${membersOf(comp.id)}/${users.ana.id}`)).status).toBe(403);

    await superuser.staffPermission.updateMany({ where: { schoolId, userId: users.staffA.id }, data: { canManageStudents: true } });
    expect((await as('staffA').delete(`${membersOf(comp.id)}/${users.ana.id}`)).status).toBe(204);
    expect((await as('staffA').post(membersOf(comp.id)).send({ studentIds: [users.ana.id] })).status).toBe(200);
  });

  it("cross-tenant: a roster of one School can never be read, changed or filled from another, and the database refuses it", async () => {
    const aRoster = (await as('owner').get(listOf(schoolId))).body.items[0] as { id: string };
    // School B's owner, under School B, with School A's roster: not found.
    expect((await as('otherOwner').get(membersOf(aRoster.id, otherSchoolId))).status).toBe(404);
    expect((await as('otherOwner').post(membersOf(aRoster.id, otherSchoolId)).send({ studentIds: [users.otherStudent.id] })).status).toBe(404);
    expect((await as('otherOwner').patch(`${listOf(otherSchoolId)}/${aRoster.id}`).send({ name: 'Mine now' })).status).toBe(404);
    expect((await as('otherOwner').delete(`${listOf(otherSchoolId)}/${aRoster.id}`)).status).toBe(404);
    expect((await as('otherOwner').get(listOf(otherSchoolId))).body.items).toEqual([]);
    // School B's owner under School A's id: not staff there.
    expect((await as('otherOwner').get(listOf(schoolId))).status).toBe(403);
    expect((await as('otherOwner').get(membersOf(aRoster.id))).status).toBe(403);
    // School A's owner can't put School B's student on School A's roster.
    expect((await as('owner').post(membersOf(aRoster.id)).send({ studentIds: [users.otherStudent.id] })).status).toBe(404);
    // And the database itself refuses a row pairing School A's roster with School B.
    await expect(superuser.rosterMember.create({ data: { rosterId: aRoster.id, schoolId: otherSchoolId, studentId: users.otherStudent.id } })).rejects.toThrow();
    expect(await superuser.rosterMember.count({ where: { studentId: users.otherStudent.id } })).toBe(0);
    // The app connection has no access to the tables at all.
    const appClient = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
    try {
      await expect(appClient.roster.findMany()).rejects.toThrow();
      await expect(appClient.rosterMember.findMany()).rejects.toThrow();
    } finally {
      await appClient.$disconnect();
    }
  });

  it('members never see rosters: the staff endpoints refuse them, and no member-facing reply carries a roster', async () => {
    const secret = (await as('owner').get(listOf(schoolId))).body.items.find((r: { name: string }) => r.name === SECRET_ROSTER);
    await as('owner').post(membersOf(secret.id)).send({ studentIds: [users.ana.id, users.kid.id] });
    expect((await as('ana').get(listOf(schoolId))).status).toBe(403);
    expect((await as('ana').get(membersOf(secret.id))).status).toBe(403);
    expect((await as('ana').post(listOf(schoolId)).send({ name: 'Mine' })).status).toBe(403);
    expect([403, 404]).toContain((await as('parent').get(membersOf(secret.id))).status);

    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const stack = (app.getHttpAdapter().getInstance() as { _router: { stack: Layer[] } })._router.stack;
    const paths = stack
      .filter((l) => l.route?.methods.get && l.route.path.startsWith('/v1/'))
      .map((l) => l.route!.path)
      .filter((p) => !/payment|stripe|connect|platform-admin|export|kiosk/.test(p))
      .filter((p) => (p.match(/:\w+/g) ?? []).every((param) => [':schoolId', ':studentId', ':id'].includes(param)));
    expect(paths).toEqual(expect.arrayContaining(['/v1/users/me', '/v1/memberships/me', '/v1/bookings/me']));
    let answered = 0;
    for (const [who, studentId] of [
      ['ana', users.ana.id],
      ['parent', users.kid.id],
    ] as const) {
      for (const path of paths) {
        const url = path.replace(':schoolId', schoolId).replace(':studentId', studentId).replace(':id', path.startsWith('/v1/schools/:id') ? schoolId : studentId);
        const res = await as(who).get(url).query({ studentId });
        if (res.status === 200) answered += 1;
        expect({ url, who, leaked: JSON.stringify(res.body ?? '').includes(SECRET_ROSTER) }).toEqual({ url, who, leaked: false });
      }
    }
    expect(answered).toBeGreaterThan(10);
  }, 300_000);

  it("deleting a roster takes everyone off it; a student's place on rosters is erased with the account", async () => {
    const temp = (await as('owner').post(listOf(schoolId)).send({ name: 'Short-lived' })).body as { id: string };
    const secret = (await as('owner').get(listOf(schoolId))).body.items.find((r: { name: string }) => r.name === SECRET_ROSTER);
    await as('owner').post(membersOf(temp.id)).send({ studentIds: [users.gone.id] });
    await as('owner').post(membersOf(secret.id)).send({ studentIds: [users.gone.id] });
    expect(await superuser.rosterMember.count({ where: { studentId: users.gone.id } })).toBe(2);
    expect((await as('owner').delete(`${listOf(schoolId)}/${temp.id}`)).status).toBe(204);
    expect(await superuser.rosterMember.count({ where: { studentId: users.gone.id } })).toBe(1);

    await superuser.studentHomeBranch.deleteMany({ where: { studentId: users.gone.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: users.gone.id } });
    await superuser.user.delete({ where: { id: users.gone.id } });
    expect(await superuser.rosterMember.count({ where: { studentId: users.gone.id } })).toBe(0);
    expect(names(await as('owner').get(listOf(schoolId)))).toContain(SECRET_ROSTER);
    delete users.gone;
  });
});
