/**
 * Notes in a student's grading history can be edited and hidden; every change
 * is kept (Decision 192). The owner and anyone who may grade that student in
 * that style edit or hide; a hidden note isn't shown to the student or
 * guardian; staff still see it, marked hidden; the change log is the owner's
 * and the database never shows it to the student. Real HTTP.
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

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[history-notes.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('History notes: edit, hide, change log (Decision 192)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appRole = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  let school: { id: string };
  let bjj: { id: string };
  const rungs: Array<{ id: string; rankId: string }> = [];
  let eventId = '';

  async function person(label: string, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT' }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `notes-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Notes',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: school.id } });
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: school.id, branchId: null })) });
  }
  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token[label]}`),
    post: (url: string, body: object) => http().post(url).set('Authorization', `Bearer ${token[label]}`).send(body),
    patch: (url: string, body: object) => http().patch(url).set('Authorization', `Bearer ${token[label]}`).send(body),
  });
  const noteUrl = (event = eventId) => `/v1/students/${id.student}/rank-history/${event}/note?schoolId=${school.id}`;
  const historyAs = async (label: string) =>
    ((await as(label).get(`/v1/students/${id.student}/rank-history?schoolId=${school.id}`)).body.items as Array<{ id: string; note: string | null; noteHiddenAt: string | null }>).find(
      (e) => e.id === eventId,
    )!;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Notes Dojo', ranksToggle: true } });
    schoolIds.push(school.id);
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    for (let t = 0; t < 4; t++) {
      const tier = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `White ${t}` } });
      rungs.push({ id: tier.id, rankId: rank.id });
    }
    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER' }]);
    await person('coach', [{ role: 'INSTRUCTOR' }]);
    await person('voider', [{ role: 'INSTRUCTOR' }]); // may only void history
    await person('student', [{ role: 'STUDENT' }]);
    await person('guardian', []);
    await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: id.coach, disciplineId: bjj.id } });
    await superuser.gradingPermission.create({
      data: { id: randomUUID(), schoolId: school.id, userId: id.voider, disciplineId: bjj.id, canPromote: false, canDowngrade: false, canVoidHistory: true },
    });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: id.guardian, studentId: id.student } });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.student, disciplineId: bjj.id, schoolId: school.id, currentRankId: rungs[0].rankId, currentStripeId: rungs[0].id },
    });
    const promoted = await as('owner').post(`/v1/students/${id.student}/ranks/${bjj.id}/promote`, { acknowledgeWithoutSkillSignoff: true, note: 'Strong guard' });
    expect(promoted.status).toBe(201);
    eventId = promoted.body.promotionEvent.id;
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.promotionEventNoteLog.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: id.guardian } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    for (let attempt = 0; ; attempt++) {
      await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
      try {
        await superuser.user.deleteMany({ where: { id: { in: userIds } } });
        break;
      } catch (err) {
        if (attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await appRole.$disconnect();
    await app.close();
  });

  it('a coach who may grade edits the note; who and when are kept', async () => {
    const res = await as('coach').patch(noteUrl(), { note: '  Strong guard, work on passing  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ note: 'Strong guard, work on passing', noteEditedById: id.coach, noteHiddenAt: null });
    expect(res.body.noteEditedAt).not.toBeNull();
  });

  it('a hidden note isn\'t shown to the student or guardian; staff see it marked hidden', async () => {
    const hidden = await as('coach').patch(noteUrl(), { hidden: true });
    expect(hidden.status).toBe(200);
    expect(hidden.body.noteHiddenAt).not.toBeNull();

    for (const label of ['student', 'guardian']) {
      expect(await historyAs(label)).toMatchObject({ note: null, noteHiddenAt: null });
    }
    const staffView = await historyAs('owner');
    expect(staffView.note).toBe('Strong guard, work on passing');
    expect(staffView.noteHiddenAt).not.toBeNull();

    expect((await as('owner').patch(noteUrl(), { hidden: false })).body.noteHiddenAt).toBeNull();
    expect((await historyAs('student')).note).toBe('Strong guard, work on passing');
  });

  it('the owner reads every change, oldest first; nobody else can', async () => {
    const log = await as('owner').get(`/v1/students/${id.student}/rank-history/${eventId}/note-log?schoolId=${school.id}`);
    expect(log.status).toBe(200);
    expect(log.body.items.map((e: { change: string; changedByName: string }) => `${e.change} by ${e.changedByName}`)).toEqual([
      'EDITED by coach Notes',
      'HIDDEN by coach Notes',
      'SHOWN by owner Notes',
    ]);
    expect(log.body.items[0]).toMatchObject({ oldNote: 'Strong guard', newNote: 'Strong guard, work on passing' });
    for (const label of ['coach', 'student', 'guardian']) {
      expect((await as(label).get(`/v1/students/${id.student}/rank-history/${eventId}/note-log?schoolId=${school.id}`)).status).toBe(403);
    }
  });

  it('only the owner and graders change notes', async () => {
    for (const label of ['voider', 'student', 'guardian']) {
      expect((await as(label).patch(noteUrl(), { note: 'Mine' })).status).toBe(403);
    }
    expect((await superuser.promotionEvent.findUniqueOrThrow({ where: { id: eventId } })).note).toBe('Strong guard, work on passing');
  });

  it('refuses nothing to change, hiding no note, and voided entries', async () => {
    expect((await as('coach').patch(noteUrl(), {})).status).toBe(400);
    expect((await as('coach').patch(noteUrl(), { note: '', hidden: true })).status).toBe(400);
    const cleared = await as('coach').patch(noteUrl(), { note: '' });
    expect(cleared.body.note).toBeNull();
    await superuser.promotionEvent.update({ where: { id: eventId }, data: { voidedAt: new Date(), voidReason: 'test' } });
    expect((await as('coach').patch(noteUrl(), { note: 'After void' })).status).toBe(409);
  });

  it('the database never shows the change log to the student', async () => {
    const seen = await appRole.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${id.student}'`);
      return tx.promotionEventNoteLog.count({ where: { promotionEventId: eventId } });
    });
    expect(seen).toBe(0);
    expect(await superuser.promotionEventNoteLog.count({ where: { promotionEventId: eventId } })).toBe(4);
  });
});
