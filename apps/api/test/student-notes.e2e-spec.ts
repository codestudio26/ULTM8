/**
 * Staff notes on a student (backlog 3.10; Decision 315 item 8, Decision 400):
 * any staff who cover the student add and read notes; only the author or an
 * owner edits or deletes one; "Show to member" notes reach the student, or a
 * child's Guardian; nobody else sees any.
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
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

type Role = 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT';

describeIfDb('Student notes', () => {
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
  const notesOf = (studentId: string) => `/v1/schools/${schoolId}/students/${studentId}/notes`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.createMany({ data: [{ id: schoolId, name: 'Notes School' }, { id: otherSchoolId, name: 'Notes Other School' }] });
    const grants: Record<string, Array<[Role, string]>> = {
      owner: [['SCHOOL_OWNER_MANAGER', schoolId]],
      coach: [['INSTRUCTOR', schoolId]],
      coach2: [['INSTRUCTOR', schoolId]],
      ana: [['STUDENT', schoolId]],
      kid: [['STUDENT', schoolId]],
      parent: [],
      ben: [['STUDENT', schoolId]],
      outsider: [['INSTRUCTOR', otherSchoolId]],
    };
    for (const [label, list] of Object.entries(grants)) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `notes-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Notes',
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
    await superuser.studentNote.deleteMany({ where: { schoolId } });
    await superuser.frontDeskSession.deleteMany({ where: { schoolId } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolId, otherSchoolId] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a coach adds notes; staff see them all, newest first, with who wrote them', async () => {
    const staffOnly = await as('coach').post(notesOf(users.ana.id)).send({ body: '  Working on her guard retention.  ' });
    expect(staffOnly.status).toBe(201);
    expect(staffOnly.body).toMatchObject({ body: 'Working on her guard retention.', showToMember: false, authorName: 'coach Notes', canEdit: true });
    const shown = await as('owner').post(notesOf(users.ana.id)).send({ body: 'Great work at the open mat!', showToMember: true });
    expect(shown.status).toBe(201);

    const list = await as('coach2').get(notesOf(users.ana.id));
    expect(list.status).toBe(200);
    expect(list.body.items.map((n: { body: string }) => n.body)).toEqual(['Great work at the open mat!', 'Working on her guard retention.']);
    // Another coach reads them but may change neither.
    expect(list.body.items.every((n: { canEdit: boolean }) => !n.canEdit)).toBe(true);
    expect((await as('coach').post(notesOf(users.ana.id)).send({ body: '   ' })).status).toBe(400);
  });

  it('only the author or an owner edits or deletes a note', async () => {
    const note = (await as('coach').post(notesOf(users.ana.id)).send({ body: 'Draft' })).body;
    const path = `${notesOf(users.ana.id)}/${note.id}`;
    const refused = await as('coach2').patch(path).send({ body: 'Changed' });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain("Only the note's author or a School owner can change it.");
    expect((await as('coach2').delete(path)).status).toBe(403);

    const edited = await as('coach').patch(path).send({ body: 'Final', showToMember: true });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ body: 'Final', showToMember: true });
    expect(edited.body.editedAt).not.toBeNull();
    expect((await as('owner').patch(path).send({ showToMember: false })).body.showToMember).toBe(false);
    expect((await as('owner').delete(path)).status).toBe(204);
    expect((await as('coach').patch(path).send({ body: 'Back?' })).status).toBe(404);
  });

  it('the student sees only the notes shown to them; another student and other Schools see nothing', async () => {
    const mine = await as('ana').get('/v1/student-notes/me');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toEqual([expect.objectContaining({ body: 'Great work at the open mat!', schoolName: 'Notes School', authorName: 'owner Notes' })]);
    expect((await as('ben').get('/v1/student-notes/me')).body.items).toEqual([]);
    // Students and outside staff can't read the staff list of notes.
    expect((await as('ana').get(notesOf(users.ana.id))).status).toBe(403);
    expect((await as('outsider').get(notesOf(users.ana.id))).status).toBe(403);
    expect((await as('ben').get(`/v1/student-notes/me?studentId=${users.ana.id}`)).status).toBe(403);
  });

  it("a child's shown notes go to their Guardian", async () => {
    await as('coach').post(notesOf(users.kid.id)).send({ body: 'Ready for the next stripe soon.', showToMember: true });
    await as('coach').post(notesOf(users.kid.id)).send({ body: 'Talk to the parent about late pick-ups.' });
    const forParent = await as('parent').get(`/v1/student-notes/me?studentId=${users.kid.id}`);
    expect(forParent.status).toBe(200);
    expect(forParent.body.items.map((n: { body: string }) => n.body)).toEqual(['Ready for the next stripe soon.']);
  });

  it('a former student no longer sees the notes of a School they left', async () => {
    await superuser.roleGrant.updateMany({ where: { userId: users.ben.id, schoolId }, data: { revokedAt: new Date() } });
    await superuser.studentNote.create({ data: { id: randomUUID(), schoolId, studentId: users.ben.id, authorId: users.owner.id, body: 'Shown', showToMember: true } });
    expect((await as('ben').get('/v1/student-notes/me')).body.items).toEqual([]);
  });

  it('the front-desk tablet shows the member their notes only after their own QR, never when found by name', async () => {
    const session = (await as('owner').post(`/v1/schools/${schoolId}/front-desk/sessions`).send({})).body as { sessionToken: string };
    const now = Date.now();
    const window = { startsFrom: new Date(now - 3_600_000).toISOString(), startsTo: new Date(now + 3_600_000).toISOString() };
    const card = (query: Record<string, string>) =>
      http().get(`/v1/front-desk/kiosk/students/${users.ana.id}/card`).query(query).set('Authorization', `Bearer ${session.sessionToken}`);

    const byName = await card(window);
    expect(byName.status).toBe(200);
    expect(byName.body.memberNotes).toEqual([]);

    const qr = (await as('ana').get('/v1/attendance/my-qr-token')).body.token;
    const lookup = await http().post('/v1/front-desk/kiosk/qr-lookups').set('Authorization', `Bearer ${session.sessionToken}`).send({ studentToken: qr });
    expect(lookup.status).toBe(200);
    const byQr = await card({ ...window, lookupToken: lookup.body.lookupToken });
    expect(byQr.body.memberNotes).toEqual(['Great work at the open mat!']);
    // Someone else's lookup doesn't unlock this card.
    const kidCard = await http()
      .get(`/v1/front-desk/kiosk/students/${users.kid.id}/card`)
      .query({ ...window, lookupToken: lookup.body.lookupToken })
      .set('Authorization', `Bearer ${session.sessionToken}`);
    expect(kidCard.body.memberNotes).toEqual([]);
  });
});
