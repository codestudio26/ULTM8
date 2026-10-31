/**
 * Custom member fields and statuses (Decision 315 item 14): each School adds
 * its own member fields (text, number, date, drop-down, yes/no) and its own
 * member statuses (up to 50 characters). Staff-only, like tags: members never
 * see them. A field or status of one School can never reach a student of
 * another, and a student's values and status are erased with the account and
 * with the School.
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
type Field = { id: string; name: string; type: string; options: string[]; position: number; value?: string | null };

/** Texts no other data could contain, to look for in member replies. */
const SECRET = randomUUID().slice(0, 8);
const SECRET_FIELD = `Medical-flag-${SECRET}`;
const SECRET_VALUE = `Owes-fees-${SECRET}`;
const SECRET_STATUS = `On-hold-${SECRET}`;

describeIfDb('Custom member fields and statuses', () => {
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
    put: (path: string) => http().put(path).set('Authorization', `Bearer ${tokens[who]}`),
    patch: (path: string) => http().patch(path).set('Authorization', `Bearer ${tokens[who]}`),
    delete: (path: string) => http().delete(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const fieldsOf = (sid: string) => `/v1/schools/${sid}/custom-member-fields`;
  const statusesOf = (sid: string) => `/v1/schools/${sid}/custom-member-statuses`;
  const valuesOf = (studentId: string, sid = schoolId) => `/v1/schools/${sid}/students/${studentId}/custom-fields`;
  const statusOf = (studentId: string, sid = schoolId) => `/v1/schools/${sid}/students/${studentId}/custom-status`;
  const fields: Record<string, Field> = {};
  const value = (res: request.Response, fieldId: string) => (res.body.fields as Field[]).find((f) => f.id === fieldId)?.value;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.createMany({ data: [{ id: schoolId, name: 'Fields School' }, { id: otherSchoolId, name: 'Fields Other School' }] });
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
          email: `fields-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Fields',
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
    await superuser.customMemberField.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.customMemberStatus.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolId, otherSchoolId] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner adds fields of each type, renames and reorders them; names are unique ignoring case', async () => {
    const make = async (name: string, type: string, options?: string[]) => {
      const res = await as('owner').post(fieldsOf(schoolId)).send({ name, type, ...(options ? { options } : {}) });
      expect(res.status).toBe(201);
      return res.body as Field;
    };
    fields.text = await make(`  ${SECRET_FIELD}  `, 'TEXT');
    expect(fields.text.name).toBe(SECRET_FIELD);
    fields.number = await make('Weight (kg)', 'NUMBER');
    fields.date = await make('First grading', 'DATE');
    fields.dropdown = await make('Gi size', 'DROPDOWN', [' A1 ', 'A2', 'A3']);
    expect(fields.dropdown.options).toEqual(['A1', 'A2', 'A3']);
    fields.yesNo = await make('Has own gloves', 'YES_NO');
    expect([fields.text, fields.number, fields.date, fields.dropdown, fields.yesNo].map((f) => f.position)).toEqual([0, 1, 2, 3, 4]);

    expect((await as('owner').post(fieldsOf(schoolId)).send({ name: 'gi SIZE', type: 'TEXT' })).status).toBe(409);
    expect((await as('owner').post(fieldsOf(schoolId)).send({ name: 'x'.repeat(51), type: 'TEXT' })).status).toBe(400);
    expect((await as('owner').post(fieldsOf(schoolId)).send({ name: '   ', type: 'TEXT' })).status).toBe(400);
    expect((await as('owner').post(fieldsOf(schoolId)).send({ name: 'Colour', type: 'COLOUR' })).status).toBe(400);
    // A drop-down needs its own, distinct choices; nothing else has any.
    expect((await as('owner').post(fieldsOf(schoolId)).send({ name: 'Belt', type: 'DROPDOWN' })).status).toBe(400);
    expect((await as('owner').post(fieldsOf(schoolId)).send({ name: 'Belt', type: 'DROPDOWN', options: ['Red', 'red'] })).status).toBe(400);
    expect((await as('owner').post(fieldsOf(schoolId)).send({ name: 'Notes', type: 'TEXT', options: ['A'] })).status).toBe(400);

    const renamed = await as('owner').patch(`${fieldsOf(schoolId)}/${fields.number.id}`).send({ name: 'Weight' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Weight', type: 'NUMBER' });
    expect((await as('owner').patch(`${fieldsOf(schoolId)}/${fields.number.id}`).send({ name: 'GI size' })).status).toBe(409);
    expect((await as('owner').patch(`${fieldsOf(schoolId)}/${fields.number.id}`).send({ options: ['1'] })).status).toBe(400);

    const order = [fields.yesNo.id, fields.text.id, fields.number.id, fields.date.id, fields.dropdown.id];
    const reordered = await as('owner').put(`${fieldsOf(schoolId)}/order`).send({ fieldIds: order });
    expect(reordered.status).toBe(200);
    expect((reordered.body.items as Field[]).map((f) => f.id)).toEqual(order);
    expect((await as('owner').put(`${fieldsOf(schoolId)}/order`).send({ fieldIds: order.slice(1) })).status).toBe(400);
    expect((await as('owner').put(`${fieldsOf(schoolId)}/order`).send({ fieldIds: [...order.slice(1), order[1]] })).status).toBe(400);

    const list = await as('coach').get(fieldsOf(schoolId));
    expect(list.status).toBe(200);
    expect((list.body.items as Field[]).map((f) => f.id)).toEqual(order);
  });

  it('the owner manages statuses of up to 50 characters', async () => {
    expect((await as('owner').post(statusesOf(schoolId)).send({ name: 'x'.repeat(51) })).status).toBe(400);
    const long = await as('owner').post(statusesOf(schoolId)).send({ name: 'y'.repeat(50) });
    expect(long.status).toBe(201);
    expect((await as('owner').post(statusesOf(schoolId)).send({ name: SECRET_STATUS })).status).toBe(201);
    expect((await as('owner').post(statusesOf(schoolId)).send({ name: 'Paused' })).status).toBe(201);
    expect((await as('owner').post(statusesOf(schoolId)).send({ name: 'PAUSED' })).status).toBe(409);
    const renamed = await as('owner').patch(`${statusesOf(schoolId)}/${long.body.id}`).send({ name: 'Competition squad' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Competition squad', studentCount: 0 });
    expect((await as('owner').patch(`${statusesOf(schoolId)}/${long.body.id}`).send({ name: 'paused' })).status).toBe(409);
    const list = await as('coach').get(statusesOf(schoolId));
    expect((list.body.items as Array<{ name: string }>).map((s) => s.name)).toEqual(['Competition squad', SECRET_STATUS, 'Paused'].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  });

  it("staff set a student's values, checked against each field's type", async () => {
    const before = await as('coach').get(valuesOf(users.ana.id));
    expect(before.status).toBe(200);
    expect(before.body.statusId).toBeNull();
    expect((before.body.fields as Field[]).every((f) => f.value === null)).toBe(true);

    const saved = await as('coach').put(valuesOf(users.ana.id)).send({
      values: [
        { fieldId: fields.text.id, value: `  ${SECRET_VALUE} ` },
        { fieldId: fields.number.id, value: '72.50' },
        { fieldId: fields.date.id, value: '2026-02-28' },
        { fieldId: fields.dropdown.id, value: 'a2' },
        { fieldId: fields.yesNo.id, value: 'true' },
      ],
    });
    expect(saved.status).toBe(200);
    expect(value(saved, fields.text.id)).toBe(SECRET_VALUE);
    expect(value(saved, fields.number.id)).toBe('72.5');
    expect(value(saved, fields.date.id)).toBe('2026-02-28');
    expect(value(saved, fields.dropdown.id)).toBe('A2');
    expect(value(saved, fields.yesNo.id)).toBe('true');

    // A wrong value for its type is refused, and nothing in that request is saved.
    for (const [fieldId, wrong] of [
      [fields.number.id, '12kg'],
      [fields.number.id, '1e5'],
      [fields.date.id, '2026-02-30'],
      [fields.date.id, '28/02/2026'],
      [fields.dropdown.id, 'B1'],
      [fields.yesNo.id, 'maybe'],
      [fields.text.id, 'x'.repeat(501)],
    ]) {
      const res = await as('coach').put(valuesOf(users.ana.id)).send({ values: [{ fieldId: fields.text.id, value: 'changed' }, { fieldId, value: wrong }] });
      expect({ fieldId, wrong, status: res.status }).toEqual({ fieldId, wrong, status: 400 });
    }
    expect(value(await as('coach').get(valuesOf(users.ana.id)), fields.text.id)).toBe(SECRET_VALUE);
    expect((await as('coach').put(valuesOf(users.ana.id)).send({ values: [{ fieldId: randomUUID(), value: '1' }] })).status).toBe(404);
    expect((await as('coach').put(valuesOf(users.ana.id)).send({ values: [{ fieldId: fields.text.id, value: 'a' }, { fieldId: fields.text.id, value: 'b' }] })).status).toBe(400);

    // Null or empty clears a value.
    const cleared = await as('coach').put(valuesOf(users.ana.id)).send({ values: [{ fieldId: fields.yesNo.id, value: null }, { fieldId: fields.date.id, value: '  ' }] });
    expect(value(cleared, fields.yesNo.id)).toBeNull();
    expect(value(cleared, fields.date.id)).toBeNull();
    expect(value(cleared, fields.number.id)).toBe('72.5');
  });

  it("changing a drop-down's choices keeps a choice whose case changed and clears one that went", async () => {
    await as('owner').put(valuesOf(users.kid.id)).send({ values: [{ fieldId: fields.dropdown.id, value: 'A3' }] });
    const changed = await as('owner').patch(`${fieldsOf(schoolId)}/${fields.dropdown.id}`).send({ options: ['a2', 'A4'] });
    expect(changed.status).toBe(200);
    expect(changed.body.options).toEqual(['a2', 'A4']);
    expect(value(await as('owner').get(valuesOf(users.ana.id)), fields.dropdown.id)).toBe('a2');
    expect(value(await as('owner').get(valuesOf(users.kid.id)), fields.dropdown.id)).toBeNull();
  });

  it('the Students list filters by a field value: a choice, yes/no, number or date exactly, text by contains', async () => {
    await as('owner').put(valuesOf(users.ana.id)).send({ values: [{ fieldId: fields.yesNo.id, value: 'true' }, { fieldId: fields.date.id, value: '2026-01-01' }] });
    await as('owner').put(valuesOf(users.kid.id)).send({
      values: [
        { fieldId: fields.text.id, value: 'owes nothing' },
        { fieldId: fields.number.id, value: '72.5' },
        { fieldId: fields.yesNo.id, value: 'false' },
        { fieldId: fields.date.id, value: '2026-02-28' },
      ],
    });
    const match = async (fieldId: string, value: string, who = 'owner') => {
      const res = await as(who).get(`${fieldsOf(schoolId)}/${fieldId}/students`).query({ value });
      expect(res.status).toBe(200);
      return [...(res.body.studentIds as string[])].sort();
    };
    const both = [users.ana.id, users.kid.id].sort();
    expect(await match(fields.text.id, 'OWES')).toEqual(both);
    expect(await match(fields.text.id, 'fees')).toEqual([users.ana.id]);
    expect(await match(fields.number.id, '72.50')).toEqual(both);
    expect(await match(fields.number.id, '72')).toEqual([]);
    expect(await match(fields.dropdown.id, 'A2')).toEqual([users.ana.id]);
    expect(await match(fields.yesNo.id, 'true')).toEqual([users.ana.id]);
    expect(await match(fields.yesNo.id, 'false')).toEqual([users.kid.id]);
    expect(await match(fields.date.id, '2026-02-28', 'coach')).toEqual([users.kid.id]);

    // A value that can't be the field's is refused, as is no value at all.
    const filter = (fieldId: string) => as('owner').get(`${fieldsOf(schoolId)}/${fieldId}/students`);
    expect((await filter(fields.dropdown.id).query({ value: 'B9' })).status).toBe(400);
    expect((await filter(fields.date.id).query({ value: '2026-2-28' })).status).toBe(400);
    expect((await filter(fields.number.id).query({ value: 'ten' })).status).toBe(400);
    expect((await filter(fields.yesNo.id).query({ value: ' ' })).status).toBe(400);
    expect((await filter(fields.text.id)).status).toBe(400);
    expect((await filter(randomUUID()).query({ value: '1' })).status).toBe(404);
    // Members can't use it.
    expect((await as('ana').get(`${fieldsOf(schoolId)}/${fields.text.id}/students`).query({ value: 'owes' })).status).toBe(403);
  });

  it("staff set a student's status, and the Students list reads each student's status", async () => {
    const statuses = (await as('owner').get(statusesOf(schoolId))).body.items as Array<{ id: string; name: string }>;
    const secret = statuses.find((s) => s.name === SECRET_STATUS)!;
    const paused = statuses.find((s) => s.name === 'Paused')!;
    const set = await as('coach').put(statusOf(users.ana.id)).send({ statusId: secret.id });
    expect(set.status).toBe(200);
    expect(set.body.statusId).toBe(secret.id);
    expect((await as('coach').put(statusOf(users.kid.id)).send({ statusId: paused.id })).status).toBe(200);
    // One status per student: setting another replaces it.
    expect((await as('coach').put(statusOf(users.kid.id)).send({ statusId: secret.id })).body.statusId).toBe(secret.id);
    expect((await as('coach').put(statusOf(users.kid.id)).send({ statusId: randomUUID() })).status).toBe(404);
    expect((await as('coach').put(statusOf(users.kid.id)).send({})).status).toBe(400);

    const assigned = await as('owner').get(`${statusesOf(schoolId)}/students`);
    expect(assigned.status).toBe(200);
    expect(assigned.body.items).toEqual(
      expect.arrayContaining([
        { studentId: users.ana.id, statusId: secret.id },
        { studentId: users.kid.id, statusId: secret.id },
      ]),
    );
    const counts = (await as('owner').get(statusesOf(schoolId))).body.items as Array<{ name: string; studentCount: number }>;
    expect(counts.find((s) => s.name === SECRET_STATUS)?.studentCount).toBe(2);

    // None is fine.
    const none = await as('coach').put(statusOf(users.kid.id)).send({ statusId: null });
    expect(none.status).toBe(200);
    expect(none.body.statusId).toBeNull();
  });

  it('Branch Staff without the Students switch can neither set values nor manage the lists', async () => {
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staff.id, canManageStudents: false } });
    expect((await as('staff').get(valuesOf(users.ana.id))).status).toBe(403);
    expect((await as('staff').put(valuesOf(users.ana.id)).send({ values: [{ fieldId: fields.number.id, value: '1' }] })).status).toBe(403);
    expect((await as('staff').put(statusOf(users.ana.id)).send({ statusId: null })).status).toBe(403);
    expect((await as('staff').post(fieldsOf(schoolId)).send({ name: 'Nope', type: 'TEXT' })).status).toBe(403);
    expect((await as('staff').patch(`${fieldsOf(schoolId)}/${fields.number.id}`).send({ name: 'Nope' })).status).toBe(403);
    expect((await as('staff').delete(`${fieldsOf(schoolId)}/${fields.number.id}`)).status).toBe(403);
    expect((await as('staff').post(statusesOf(schoolId)).send({ name: 'Nope' })).status).toBe(403);
    expect((await as('staff').get(`${statusesOf(schoolId)}/students`)).status).toBe(403);
    expect((await as('staff').get(`${fieldsOf(schoolId)}/${fields.number.id}/students`).query({ value: '72.5' })).status).toBe(403);
    await superuser.staffPermission.updateMany({ where: { schoolId, userId: users.staff.id }, data: { canManageStudents: true } });
    expect((await as('staff').get(valuesOf(users.ana.id))).status).toBe(200);
  });

  it("a School's fields and statuses never reach another School's students", async () => {
    const aStatus = ((await as('owner').get(statusesOf(schoolId))).body.items as Array<{ id: string }>)[0];
    // School B's owner, on School B's own student, with School A's field or status: not found.
    expect((await as('otherOwner').put(valuesOf(users.otherStudent.id, otherSchoolId)).send({ values: [{ fieldId: fields.number.id, value: '1' }] })).status).toBe(404);
    expect((await as('otherOwner').put(statusOf(users.otherStudent.id, otherSchoolId)).send({ statusId: aStatus.id })).status).toBe(404);
    const theirs = await as('otherOwner').get(valuesOf(users.otherStudent.id, otherSchoolId));
    expect(theirs.body).toEqual({ fields: [], statusId: null });
    expect((await as('otherOwner').patch(`${fieldsOf(otherSchoolId)}/${fields.number.id}`).send({ name: 'Mine now' })).status).toBe(404);
    expect((await as('otherOwner').delete(`${fieldsOf(otherSchoolId)}/${fields.number.id}`)).status).toBe(404);
    expect((await as('otherOwner').patch(`${statusesOf(otherSchoolId)}/${aStatus.id}`).send({ name: 'Mine now' })).status).toBe(404);
    expect((await as('otherOwner').delete(`${statusesOf(otherSchoolId)}/${aStatus.id}`)).status).toBe(404);
    expect((await as('otherOwner').get(`${statusesOf(otherSchoolId)}/students`)).body.items).toEqual([]);
    // Nor can School B filter by School A's field, under either School.
    expect((await as('otherOwner').get(`${fieldsOf(otherSchoolId)}/${fields.number.id}/students`).query({ value: '72.5' })).status).toBe(404);
    expect((await as('otherOwner').get(`${fieldsOf(schoolId)}/${fields.number.id}/students`).query({ value: '72.5' })).status).toBe(403);
    expect((await as('owner').get(`${fieldsOf(otherSchoolId)}/${fields.number.id}/students`).query({ value: '72.5' })).status).toBe(403);
    // School A's owner can't reach School B's student or lists.
    expect((await as('owner').put(valuesOf(users.otherStudent.id, schoolId)).send({ values: [{ fieldId: fields.number.id, value: '1' }] })).status).toBe(404);
    expect((await as('owner').get(valuesOf(users.otherStudent.id, otherSchoolId))).status).toBeGreaterThanOrEqual(403);
    expect((await as('owner').get(fieldsOf(otherSchoolId))).status).toBe(403);
    expect((await as('owner').get(statusesOf(otherSchoolId))).status).toBe(403);
    expect((await as('owner').get(`${statusesOf(otherSchoolId)}/students`)).status).toBe(403);
    // And the database itself refuses a row pairing School A's field or status with School B.
    await expect(
      superuser.customMemberFieldValue.create({ data: { fieldId: fields.number.id, schoolId: otherSchoolId, studentId: users.otherStudent.id, value: '1' } }),
    ).rejects.toThrow();
    await expect(superuser.studentCustomStatus.create({ data: { statusId: aStatus.id, schoolId: otherSchoolId, studentId: users.otherStudent.id } })).rejects.toThrow();
    expect(await superuser.customMemberFieldValue.count({ where: { studentId: users.otherStudent.id } })).toBe(0);
    expect(await superuser.studentCustomStatus.count({ where: { studentId: users.otherStudent.id } })).toBe(0);
  });

  it('members never see them: the staff endpoints refuse members, and no member-facing reply carries them', async () => {
    expect(await superuser.customMemberFieldValue.count({ where: { studentId: users.ana.id, value: SECRET_VALUE } })).toBe(1);
    await as('owner').put(statusOf(users.kid.id)).send({
      statusId: ((await as('owner').get(statusesOf(schoolId))).body.items as Array<{ id: string; name: string }>).find((s) => s.name === SECRET_STATUS)!.id,
    });
    await as('owner').put(valuesOf(users.kid.id)).send({ values: [{ fieldId: fields.text.id, value: SECRET_VALUE }] });
    expect((await as('ana').get(valuesOf(users.ana.id))).status).toBe(403);
    expect((await as('ana').get(fieldsOf(schoolId))).status).toBe(403);
    expect((await as('ana').get(statusesOf(schoolId))).status).toBe(403);
    expect((await as('ana').put(valuesOf(users.ana.id)).send({ values: [{ fieldId: fields.text.id, value: 'Self' }] })).status).toBe(403);
    expect((await as('ana').put(statusOf(users.ana.id)).send({ statusId: null })).status).toBe(403);
    expect([403, 404]).toContain((await as('parent').get(valuesOf(users.kid.id))).status);

    // Every GET the app serves that a member or Guardian can call with their own
    // ids: whatever it answers, no field name, value or status appears.
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
        expect({ url, who, leaked: JSON.stringify(res.body ?? '').includes(SECRET) }).toEqual({ url, who, leaked: false });
      }
    }
    expect(answered).toBeGreaterThan(10);
  }, 300_000);

  it("deleting a field deletes its values; deleting a status clears it; a student's values and status go with the account", async () => {
    const temp = (await as('owner').post(fieldsOf(schoolId)).send({ name: 'Short-lived', type: 'TEXT' })).body as Field;
    const tempStatus = (await as('owner').post(statusesOf(schoolId)).send({ name: 'Short-lived' })).body as { id: string };
    await as('owner').put(valuesOf(users.gone.id)).send({ values: [{ fieldId: temp.id, value: 'x' }, { fieldId: fields.number.id, value: '3' }] });
    await as('owner').put(statusOf(users.gone.id)).send({ statusId: tempStatus.id });
    expect(await superuser.customMemberFieldValue.count({ where: { studentId: users.gone.id } })).toBe(2);

    expect((await as('owner').delete(`${fieldsOf(schoolId)}/${temp.id}`)).status).toBe(204);
    expect((await as('owner').delete(`${fieldsOf(schoolId)}/${temp.id}`)).status).toBe(404);
    expect(await superuser.customMemberFieldValue.count({ where: { studentId: users.gone.id } })).toBe(1);
    expect((await as('owner').delete(`${statusesOf(schoolId)}/${tempStatus.id}`)).status).toBe(204);
    expect((await as('owner').get(valuesOf(users.gone.id))).body.statusId).toBeNull();

    const paused = ((await as('owner').get(statusesOf(schoolId))).body.items as Array<{ id: string; name: string }>).find((s) => s.name === 'Paused')!;
    await as('owner').put(statusOf(users.gone.id)).send({ statusId: paused.id });
    // Account erasure removes the User row; the values and status go with it,
    // while the School's lists stay for its other students.
    await superuser.roleGrant.deleteMany({ where: { userId: users.gone.id } });
    await superuser.user.delete({ where: { id: users.gone.id } });
    expect(await superuser.customMemberFieldValue.count({ where: { studentId: users.gone.id } })).toBe(0);
    expect(await superuser.studentCustomStatus.count({ where: { studentId: users.gone.id } })).toBe(0);
    expect(((await as('owner').get(statusesOf(schoolId))).body.items as Array<{ name: string }>).map((s) => s.name)).toContain('Paused');
    delete users.gone;
  });

  it("the School's purge takes its fields, statuses, values and students' statuses", async () => {
    const closingId = randomUUID();
    await superuser.school.create({ data: { id: closingId, name: 'Fields Closing School' } });
    const fieldId = randomUUID();
    const statusId = randomUUID();
    await superuser.customMemberField.create({ data: { id: fieldId, schoolId: closingId, name: 'Belt size', type: 'TEXT', position: 0 } });
    await superuser.customMemberStatus.create({ data: { id: statusId, schoolId: closingId, name: 'Paused' } });
    await superuser.customMemberFieldValue.create({ data: { fieldId, schoolId: closingId, studentId: users.ana.id, value: 'A2' } });
    await superuser.studentCustomStatus.create({ data: { statusId, schoolId: closingId, studentId: users.ana.id } });

    // tenant-lifecycle-purge hard-deletes the School row; everything here cascades with it.
    await superuser.school.delete({ where: { id: closingId } });
    expect(await superuser.customMemberField.count({ where: { schoolId: closingId } })).toBe(0);
    expect(await superuser.customMemberStatus.count({ where: { schoolId: closingId } })).toBe(0);
    expect(await superuser.customMemberFieldValue.count({ where: { schoolId: closingId } })).toBe(0);
    expect(await superuser.studentCustomStatus.count({ where: { schoolId: closingId } })).toBe(0);
    // The student's values at their other School are untouched.
    expect(await superuser.customMemberFieldValue.count({ where: { schoolId, studentId: users.ana.id } })).toBeGreaterThan(0);
  });
});
