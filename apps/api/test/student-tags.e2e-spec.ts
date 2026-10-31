/**
 * Tags on students (backlog 5.4; Decision 315 item 7): each School manages its
 * own list; staff can add a new tag while tagging; members never see their
 * tags. A tag from one School can never be put on a student of another, and
 * a student's tags are erased with the account.
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

/** A tag name no other data could contain, to look for in member replies. */
const SECRET_TAG = `Owes-fees-${randomUUID().slice(0, 8)}`;

describeIfDb('Student tags', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  const otherSchoolId = randomUUID();
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`),
    post: (path: string) => http().post(path).set('Authorization', `Bearer ${tokens[who]}`),
    patch: (path: string) => http().patch(path).set('Authorization', `Bearer ${tokens[who]}`),
    delete: (path: string) => http().delete(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const listOf = (sid: string) => `/v1/schools/${sid}/student-tags`;
  const tagsOf = (studentId: string, sid = schoolId) => `/v1/schools/${sid}/students/${studentId}/tags`;
  const names = (res: request.Response) => (res.body.items as Array<{ name: string }>).map((t) => t.name);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.createMany({ data: [{ id: schoolId, name: 'Tags School' }, { id: otherSchoolId, name: 'Tags Other School' }] });
    const grants: Record<string, Array<[Role, string]>> = {
      owner: [['SCHOOL_OWNER_MANAGER', schoolId]],
      coach: [['INSTRUCTOR', schoolId]],
      staff: [['BRANCH_STAFF', schoolId]],
      ana: [['STUDENT', schoolId]],
      kid: [['STUDENT', schoolId]],
      parent: [],
      gone: [['STUDENT', schoolId]],
      otherOwner: [['SCHOOL_OWNER_MANAGER', otherSchoolId]],
      otherStudent: [['STUDENT', otherSchoolId]],
    };
    for (const [label, list] of Object.entries(grants)) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `tags-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tags',
          passcodeHash: 'x',
          dateOfBirth: new Date(label === 'kid' ? '2016-01-01' : '1990-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      for (const [role, sid] of list) await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label].id, schoolId: sid } });
      tokens[label] = jwt.sign({ sub: users[label].id, email: users[label].email, grants: list.map(([role, sid]) => ({ role, franchiseId: null, schoolId: sid, branchId: null })) });
    }
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id } });
  });

  afterAll(async () => {
    await superuser.schoolTag.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolId, otherSchoolId] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it("the owner manages the School's list: add, rename, delete; names are unique ignoring case", async () => {
    const kids = await as('owner').post(listOf(schoolId)).send({ name: '  Kids   team ' });
    expect(kids.status).toBe(201);
    expect(kids.body).toMatchObject({ name: 'Kids team', studentCount: 0 });
    expect((await as('owner').post(listOf(schoolId)).send({ name: 'Competitor' })).status).toBe(201);
    expect((await as('owner').post(listOf(schoolId)).send({ name: 'kids TEAM' })).status).toBe(409);
    expect((await as('owner').post(listOf(schoolId)).send({ name: '   ' })).status).toBe(400);
    expect((await as('owner').post(listOf(schoolId)).send({ name: 'x'.repeat(41) })).status).toBe(400);

    const renamed = await as('owner').patch(`${listOf(schoolId)}/${kids.body.id}`).send({ name: 'Kids squad' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Kids squad');
    // Changing only the case of its own name is fine; taking another tag's name isn't.
    expect((await as('owner').patch(`${listOf(schoolId)}/${kids.body.id}`).send({ name: 'KIDS squad' })).status).toBe(200);
    expect((await as('owner').patch(`${listOf(schoolId)}/${kids.body.id}`).send({ name: 'competitor' })).status).toBe(409);

    const temp = (await as('owner').post(listOf(schoolId)).send({ name: 'Temp' })).body;
    expect((await as('owner').delete(`${listOf(schoolId)}/${temp.id}`)).status).toBe(204);
    expect((await as('owner').delete(`${listOf(schoolId)}/${temp.id}`)).status).toBe(404);

    const list = await as('coach').get(listOf(schoolId));
    expect(list.status).toBe(200);
    expect(names(list)).toEqual(['Competitor', 'KIDS squad']);
  });

  it('staff tag a student from the list or with a new tag typed while tagging, and untag', async () => {
    const competitor = (await as('owner').get(listOf(schoolId))).body.items.find((t: { name: string }) => t.name === 'Competitor');
    const tagged = await as('coach').post(tagsOf(users.ana.id)).send({ tagId: competitor.id });
    expect(tagged.status).toBe(200);
    expect(names(tagged)).toEqual(['Competitor']);
    // Tagging twice is harmless.
    expect(names(await as('coach').post(tagsOf(users.ana.id)).send({ tagId: competitor.id }))).toEqual(['Competitor']);

    // A new tag typed while tagging joins the School's list...
    const typed = await as('coach').post(tagsOf(users.ana.id)).send({ name: SECRET_TAG });
    expect(typed.status).toBe(200);
    expect(names(typed)).toEqual(['Competitor', SECRET_TAG].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    expect(names(await as('owner').get(listOf(schoolId)))).toContain(SECRET_TAG);
    // ...and typing an existing name (any case) reuses it.
    expect(names(await as('owner').post(tagsOf(users.kid.id)).send({ name: SECRET_TAG.toUpperCase() }))).toEqual([SECRET_TAG]);
    expect((await as('owner').post(tagsOf(users.kid.id)).send({})).status).toBe(400);
    expect((await as('owner').post(tagsOf(users.kid.id)).send({ tagId: competitor.id, name: 'Both' })).status).toBe(400);

    expect(names(await as('owner').get(tagsOf(users.ana.id)))).toEqual(expect.arrayContaining(['Competitor', SECRET_TAG]));
    const counts = (await as('owner').get(listOf(schoolId))).body.items as Array<{ name: string; studentCount: number }>;
    expect(counts.find((t) => t.name === SECRET_TAG)?.studentCount).toBe(2);

    // The Students list's tag filter.
    const secret = counts.find((t) => t.name === SECRET_TAG) as unknown as { id: string };
    const filtered = await as('owner').get(`${listOf(schoolId)}/${secret.id}/students`);
    expect(filtered.status).toBe(200);
    expect([...filtered.body.studentIds].sort()).toEqual([users.ana.id, users.kid.id].sort());

    expect((await as('coach').delete(`${tagsOf(users.ana.id)}/${competitor.id}`)).status).toBe(204);
    expect(names(await as('coach').get(tagsOf(users.ana.id)))).toEqual([SECRET_TAG]);
    expect((await as('coach').delete(`${tagsOf(users.ana.id)}/${competitor.id}`)).status).toBe(404);
  });

  it('Branch Staff without the Students switch can neither tag nor manage the list', async () => {
    const competitor = (await as('owner').get(listOf(schoolId))).body.items.find((t: { name: string }) => t.name === 'Competitor');
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staff.id, canManageStudents: false } });
    expect((await as('staff').post(tagsOf(users.ana.id)).send({ tagId: competitor.id })).status).toBe(403);
    expect((await as('staff').get(tagsOf(users.ana.id))).status).toBe(403);
    expect((await as('staff').post(listOf(schoolId)).send({ name: 'Nope' })).status).toBe(403);
    expect((await as('staff').patch(`${listOf(schoolId)}/${competitor.id}`).send({ name: 'Nope' })).status).toBe(403);
    expect((await as('staff').delete(`${listOf(schoolId)}/${competitor.id}`)).status).toBe(403);
    await superuser.staffPermission.updateMany({ where: { schoolId, userId: users.staff.id }, data: { canManageStudents: true } });
    expect((await as('staff').post(tagsOf(users.ana.id)).send({ tagId: competitor.id })).status).toBe(200);
  });

  it("a tag from one School can never be put on another School's student", async () => {
    const aTag = (await as('owner').get(listOf(schoolId))).body.items[0] as { id: string };
    // School B's owner, on School B's own student, with School A's tag: not found.
    const cross = await as('otherOwner').post(tagsOf(users.otherStudent.id, otherSchoolId)).send({ tagId: aTag.id });
    expect(cross.status).toBe(404);
    expect((await as('otherOwner').get(tagsOf(users.otherStudent.id, otherSchoolId))).body.items).toEqual([]);
    expect((await as('otherOwner').get(`${listOf(otherSchoolId)}/${aTag.id}/students`)).status).toBe(404);
    expect((await as('otherOwner').patch(`${listOf(otherSchoolId)}/${aTag.id}`).send({ name: 'Mine now' })).status).toBe(404);
    expect((await as('otherOwner').delete(`${listOf(otherSchoolId)}/${aTag.id}`)).status).toBe(404);
    // School A's owner can't reach School B's student, under either School.
    expect((await as('owner').post(tagsOf(users.otherStudent.id, schoolId)).send({ tagId: aTag.id })).status).toBe(404);
    expect((await as('owner').post(tagsOf(users.otherStudent.id, otherSchoolId)).send({ tagId: aTag.id })).status).toBeGreaterThanOrEqual(403);
    // Nor read School B's list.
    expect((await as('owner').get(listOf(otherSchoolId))).status).toBe(403);
    // And the database itself refuses a row pairing School A's tag with School B.
    await expect(superuser.studentTag.create({ data: { tagId: aTag.id, schoolId: otherSchoolId, studentId: users.otherStudent.id } })).rejects.toThrow();
    expect(await superuser.studentTag.count({ where: { studentId: users.otherStudent.id } })).toBe(0);
  });

  it('members never see their tags: no staff tag endpoint, and no member-facing reply carries them', async () => {
    expect(await superuser.studentTag.count({ where: { studentId: users.ana.id, tag: { name: SECRET_TAG } } })).toBe(1);
    // The staff endpoints refuse the student and the Guardian.
    expect((await as('ana').get(tagsOf(users.ana.id))).status).toBe(403);
    expect((await as('ana').get(listOf(schoolId))).status).toBe(403);
    // The Guardian isn't at the School at all: it isn't even found.
    expect([403, 404]).toContain((await as('parent').get(tagsOf(users.kid.id))).status);
    expect((await as('ana').post(tagsOf(users.ana.id)).send({ name: 'Self-tag' })).status).toBe(403);

    // Every GET the app serves that a member or Guardian can call with their own
    // ids: whatever it answers, the tag never appears.
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const stack = (app.getHttpAdapter().getInstance() as { _router: { stack: Layer[] } })._router.stack;
    const paths = stack
      .filter((l) => l.route?.methods.get && l.route.path.startsWith('/v1/'))
      .map((l) => l.route!.path)
      .filter((p) => !/payment|stripe|connect|platform-admin|export|kiosk/.test(p))
      .filter((p) => (p.match(/:\w+/g) ?? []).every((param) => [':schoolId', ':studentId', ':id'].includes(param)));
    expect(paths).toEqual(expect.arrayContaining(['/v1/users/me', '/v1/student-notes/me', '/v1/memberships/me', '/v1/bookings/me']));
    let answered = 0;
    for (const [who, studentId] of [
      ['ana', users.ana.id],
      ['parent', users.kid.id],
    ] as const) {
      for (const path of paths) {
        const url = path.replace(':schoolId', schoolId).replace(':studentId', studentId).replace(':id', path.startsWith('/v1/schools/:id') ? schoolId : studentId);
        const res = await as(who).get(url).query({ studentId });
        if (res.status === 200) answered += 1;
        expect({ url, who, leaked: JSON.stringify(res.body ?? '').includes(SECRET_TAG) }).toEqual({ url, who, leaked: false });
      }
    }
    expect(answered).toBeGreaterThan(10);
  }, 300_000);

  it("deleting a tag takes it off every student; a student's tags are erased with the account", async () => {
    const temp = (await as('owner').post(listOf(schoolId)).send({ name: 'Short-lived' })).body as { id: string };
    await as('owner').post(tagsOf(users.gone.id)).send({ tagId: temp.id });
    await as('owner').post(tagsOf(users.gone.id)).send({ name: SECRET_TAG });
    expect(await superuser.studentTag.count({ where: { studentId: users.gone.id } })).toBe(2);
    expect((await as('owner').delete(`${listOf(schoolId)}/${temp.id}`)).status).toBe(204);
    expect(await superuser.studentTag.count({ where: { studentId: users.gone.id } })).toBe(1);

    // Account erasure removes the User row; the tags on it go with it (as staff
    // notes do), while the School's list keeps the tag for its other students.
    await superuser.roleGrant.deleteMany({ where: { userId: users.gone.id } });
    await superuser.user.delete({ where: { id: users.gone.id } });
    expect(await superuser.studentTag.count({ where: { studentId: users.gone.id } })).toBe(0);
    expect(names(await as('owner').get(listOf(schoolId)))).toContain(SECRET_TAG);
    delete users.gone;
  });
});
