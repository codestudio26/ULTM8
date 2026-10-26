/**
 * Curriculum review fixes (Decision 324), real HTTP: clearing a lesson's
 * fields (C1), archived lessons kept from students on every route (C3),
 * video uploads not set up (C4), blank text refused (C6, C15), a playlist
 * that still loads after its student left a School (C14), adding a lesson to
 * a playlist twice (C16), no new comments at a closed School (C17) and the
 * duration cap (C18). C5's video states are unit-tested in
 * cloudflare-stream.service.spec.ts.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[curriculum-review-fixes.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Curriculum review fixes (Decision 324)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  let school: { id: string };
  let other: { id: string };
  let skillId: string;
  let otherSkillId: string;

  async function person(label: string, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT'; schoolId: string }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `cfix-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Fixes',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId } });
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })) });
  }
  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token[label]}`),
    post: (url: string, body: object = {}) => http().post(url).set('Authorization', `Bearer ${token[label]}`).send(body),
    patch: (url: string, body: object) => http().patch(url).set('Authorization', `Bearer ${token[label]}`).send(body),
  });
  const newLesson = async (title: string, extra: object = {}, sid = school.id, skill = skillId) => {
    const res = await as('owner').post(`/v1/schools/${sid}/curriculum/lessons`, { title, format: 'PRERECORDED', skillIds: [skill], free: true, ...extra });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Fixes Dojo' } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Fixes Dojo' } });
    schoolIds.push(school.id, other.id);
    const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    skillId = (await superuser.skill.create({ data: { id: randomUUID(), disciplineId: style.id, schoolId: school.id, name: 'Armbar' } })).id;
    const otherStyle = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: other.id, name: 'Judo' } });
    otherSkillId = (await superuser.skill.create({ data: { id: randomUUID(), disciplineId: otherStyle.id, schoolId: other.id, name: 'Hip throw' } })).id;
    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }, { role: 'SCHOOL_OWNER_MANAGER', schoolId: other.id }]);
    await person('coach', [{ role: 'INSTRUCTOR', schoolId: school.id }]);
    await person('student', [{ role: 'STUDENT', schoolId: school.id }]);
    await person('leaver', [{ role: 'STUDENT', schoolId: school.id }, { role: 'STUDENT', schoolId: other.id }]);
  });

  afterAll(async () => {
    await superuser.comment.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.favorite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.playlist.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.lessonSkill.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
    await superuser.lessonContent.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
    await superuser.lesson.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.skill.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('C1: null clears description, duration and instructor', async () => {
    const lessonId = await newLesson('Clear me', { description: 'Old steps', durationSeconds: 300, instructorId: id.coach });
    const res = await as('owner').patch(`/v1/lessons/${lessonId}`, { description: null, durationSeconds: null, instructorId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ description: null, durationSeconds: null, instructorId: null });
    // Leaving a field out still keeps it.
    const kept = await as('owner').patch(`/v1/lessons/${lessonId}`, { title: 'Cleared' });
    expect(kept.body).toMatchObject({ title: 'Cleared', description: null });
  });

  it('C6, C18: a blank title and a duration over 24 hours are refused; the title is trimmed', async () => {
    for (const title of ['', '   ']) {
      expect((await as('owner').post(`/v1/schools/${school.id}/curriculum/lessons`, { title, format: 'PRERECORDED', skillIds: [skillId] })).status).toBe(400);
    }
    const lessonId = await newLesson('  Spaced  ');
    expect((await as('owner').get(`/v1/lessons/${lessonId}`)).body.title).toBe('Spaced');
    expect((await as('owner').patch(`/v1/lessons/${lessonId}`, { title: '  ' })).status).toBe(400);
    expect((await as('owner').patch(`/v1/lessons/${lessonId}`, { durationSeconds: 86_401 })).status).toBe(400);
    expect((await as('owner').patch(`/v1/lessons/${lessonId}`, { durationSeconds: 86_400 })).status).toBe(200);
  });

  it('C3: an archived lesson is for staff only, on every route', async () => {
    const lessonId = await newLesson('Archived soon', { description: 'Secret steps' });
    expect((await as('student').post(`/v1/schools/${school.id}/curriculum/lessons/${lessonId}/favorite`)).status).toBe(201);
    const playlist = await as('student').post('/v1/curriculum/playlists', { name: 'Mine' });
    expect((await as('student').post(`/v1/curriculum/playlists/${playlist.body.id}/items`, { lessonId })).status).toBe(201);
    expect((await as('owner').post(`/v1/lessons/${lessonId}/archive`)).status).toBe(201);

    expect((await as('student').get(`/v1/lessons/${lessonId}`)).status).toBe(404);
    const bySkill = await as('student').get(`/v1/skills/${skillId}/lessons`);
    expect(bySkill.body.items.map((l: { id: string }) => l.id)).not.toContain(lessonId);
    const staffList = await as('student').get(`/v1/schools/${school.id}/curriculum/lessons?includeArchived=true`);
    expect(staffList.body.items.map((l: { id: string }) => l.id)).not.toContain(lessonId);
    const favourites = await as('student').get(`/v1/schools/${school.id}/curriculum/favorites`);
    expect(favourites.body.items.map((f: { lessonId: string }) => f.lessonId)).not.toContain(lessonId);
    const items = await as('student').get(`/v1/curriculum/playlists/${playlist.body.id}/items`);
    expect(items.status).toBe(200);
    expect(items.body.items).toEqual([expect.objectContaining({ lessonId, available: false, lessonTitle: '', locked: true })]);

    // Staff still see it.
    expect((await as('owner').get(`/v1/lessons/${lessonId}`)).body.archivedAt).not.toBeNull();
    expect((await as('coach').get(`/v1/skills/${skillId}/lessons`)).body.items.map((l: { id: string }) => l.id)).toContain(lessonId);

    // Unarchiving brings the favourite and the playlist entry back.
    expect((await as('owner').post(`/v1/lessons/${lessonId}/unarchive`)).status).toBe(201);
    const back = await as('student').get(`/v1/schools/${school.id}/curriculum/favorites`);
    expect(back.body.items.map((f: { lessonId: string }) => f.lessonId)).toContain(lessonId);
    const itemsBack = await as('student').get(`/v1/curriculum/playlists/${playlist.body.id}/items`);
    expect(itemsBack.body.items[0]).toMatchObject({ available: true, lessonTitle: 'Archived soon', locked: false });
  });

  it('C4: video upload says it is not set up, and the status route says so too', async () => {
    const lessonId = await newLesson('Needs video');
    const res = await as('owner').post(`/v1/schools/${school.id}/curriculum/lessons/${lessonId}/video-upload-url`);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).toContain("Video uploads aren't set up yet");
    expect((await as('owner').get(`/v1/lessons/${lessonId}`)).body.captionStatus).toBe('PENDING');
    const status = await as('coach').get(`/v1/schools/${school.id}/curriculum/video-uploads`);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ enabled: false });
  });

  it('C15: blank comments and playlist names are refused', async () => {
    const lessonId = await newLesson('Talk about it');
    for (const body of ['', '   ']) {
      expect((await as('student').post(`/v1/schools/${school.id}/curriculum/lessons/${lessonId}/comments`, { body })).status).toBe(400);
      expect((await as('student').post('/v1/curriculum/playlists', { name: body })).status).toBe(400);
    }
    const playlist = await as('student').post('/v1/curriculum/playlists', { name: ' Drills ' });
    expect(playlist.body.name).toBe('Drills');
    expect((await as('student').patch(`/v1/curriculum/playlists/${playlist.body.id}`, { name: ' ' })).status).toBe(400);
  });

  it('C16: adding a lesson to a playlist twice changes nothing', async () => {
    const lessonId = await newLesson('Twice');
    const playlist = await as('student').post('/v1/curriculum/playlists', { name: 'Twice' });
    const first = await as('student').post(`/v1/curriculum/playlists/${playlist.body.id}/items`, { lessonId });
    const second = await as('student').post(`/v1/curriculum/playlists/${playlist.body.id}/items`, { lessonId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect((await as('student').get(`/v1/curriculum/playlists/${playlist.body.id}/items`)).body.items).toHaveLength(1);
  });

  it('C14: a playlist still loads after its student left one of its Schools', async () => {
    const here = await newLesson('From the old School');
    const there = await newLesson('From the other School', {}, other.id, otherSkillId);
    const playlist = await as('leaver').post('/v1/curriculum/playlists', { name: 'Mixed' });
    for (const lessonId of [here, there]) {
      expect((await as('leaver').post(`/v1/curriculum/playlists/${playlist.body.id}/items`, { lessonId })).status).toBe(201);
    }
    await superuser.roleGrant.updateMany({ where: { userId: id.leaver, schoolId: school.id }, data: { revokedAt: new Date() } });

    const items = await as('leaver').get(`/v1/curriculum/playlists/${playlist.body.id}/items`);
    expect(items.status).toBe(200);
    expect(items.body.items).toEqual([
      expect.objectContaining({ lessonId: here, available: false, lessonTitle: '' }),
      expect.objectContaining({ lessonId: there, available: true, lessonTitle: 'From the other School' }),
    ]);
    // The gone lesson can still be removed, and reordering still works.
    const reorder = await as('leaver').patch(`/v1/curriculum/playlists/${playlist.body.id}`, { name: 'Still mine' });
    expect(reorder.status).toBe(200);
    const order = await http()
      .put(`/v1/curriculum/playlists/${playlist.body.id}/items/order`)
      .set('Authorization', `Bearer ${token.leaver}`)
      .send({ itemIds: [items.body.items[1].id, items.body.items[0].id] });
    expect(order.status).toBe(200);
    const removed = await http().delete(`/v1/curriculum/playlists/${playlist.body.id}/items/${items.body.items[0].id}`).set('Authorization', `Bearer ${token.leaver}`);
    expect(removed.status).toBe(204);
  });

  it('C17: a closed School takes no new comments, but favourites still work', async () => {
    const lessonId = await newLesson('Closing time');
    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
    try {
      expect((await as('student').post(`/v1/schools/${school.id}/curriculum/lessons/${lessonId}/comments`, { body: 'Hello?' })).status).toBe(403);
      expect((await as('student').post(`/v1/schools/${school.id}/curriculum/lessons/${lessonId}/favorite`)).status).toBe(201);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
    }
  });
});
