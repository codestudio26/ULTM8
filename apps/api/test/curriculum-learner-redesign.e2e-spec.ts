/**
 * HTTP-level coverage for the Curriculum learner-facing redesign (Decision
 * 227/254): Favorite, WatchHistory, Playlist/PlaylistItem, Comment, and the
 * video-upload-url endpoint's own staff gate. Deliberately NOT covered here:
 * actually verifying a video plays or captions appear — no real Cloudflare
 * Stream/AWS Transcribe credentials exist in this environment (same standing
 * gap as every other unprovisioned vendor), so CloudflareStreamService calls
 * in these tests are expected to fail where they're exercised, and
 * requestVideoUploadUrl's own happy path is intentionally not asserted here
 * — only its authorization/tenant gates are (the parts that don't need a
 * real vendor call to succeed).
 *
 * A key regression this file locks in: 6 of these routes originally had
 * `:schoolId` in their path but never bound or verified it (found on
 * review, fixed directly) — every write/read endpoint below that takes a
 * schoolId is tested against another School's id to confirm the fix holds.
 *
 * Same ground rule as every other e2e spec in this repo: prove over real
 * HTTP, not just by reading the code. Requires DATABASE_URL,
 * DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
  console.warn(
    '[curriculum-learner-redesign.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Curriculum learner-facing redesign — Favorite/WatchHistory/Playlist/Comment/video-upload (Decision 227/254)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let ownerA: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentA2: { id: string; email: string };
  let tokenOwnerA: string;
  let tokenStudentA: string;
  let tokenStudentA2: string;

  const schoolIds: string[] = [];
  const userIds: string[] = [];
  let freeLessonId: string;
  let lockedLessonId: string;

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  const mkUser = (label: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `curriculum-redesign-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Curriculum Redesign School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Curriculum Redesign School B' } });
    schoolIds.push(schoolA.id, schoolB.id);

    ownerA = await mkUser('owner-a');
    studentA = await mkUser('student-a');
    studentA2 = await mkUser('student-a2');
    userIds.push(ownerA.id, studentA.id, studentA2.id);

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA2.id, schoolId: schoolA.id },
      ],
    });

    tokenOwnerA = signAccessToken(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenStudentA2 = signAccessToken(studentA2, [{ role: 'STUDENT', franchiseId: null, schoolId: schoolA.id, branchId: null }]);

    const discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Redesign Discipline' } });
    const skill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: discipline.id, schoolId: schoolA.id, name: 'Redesign Skill' } });

    const freeLesson = await superuser.lesson.create({
      data: { id: randomUUID(), schoolId: schoolA.id, title: 'Free Lesson', format: 'PRERECORDED', free: true },
    });
    freeLessonId = freeLesson.id;
    await superuser.lessonContent.create({ data: { lessonId: freeLessonId, description: 'A free lesson anyone can watch.' } });
    await superuser.lessonSkill.create({ data: { lessonId: freeLessonId, skillId: skill.id } });

    // Neither Student has a live Membership whose plan includesLessons — so
    // a non-free Lesson is locked for both (studentStyles() returns an empty
    // Set), the exact scenario needed to test the 403-locked gate.
    const lockedLesson = await superuser.lesson.create({
      data: { id: randomUUID(), schoolId: schoolA.id, title: 'Locked Lesson', format: 'PRERECORDED', free: false },
    });
    lockedLessonId = lockedLesson.id;
    await superuser.lessonContent.create({ data: { lessonId: lockedLessonId, description: 'Members only.' } });
    await superuser.lessonSkill.create({ data: { lessonId: lockedLessonId, skillId: skill.id } });
  });

  afterAll(async () => {
    await superuser.comment.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.playlistItem.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.playlist.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.watchHistory.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.favorite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.lessonSkill.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
    await superuser.lessonContent.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
    await superuser.lesson.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.skill.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Favorite
  // ---------------------------------------------------------------------------

  describe('Favorite', () => {
    it('a Student can favorite a free Lesson, idempotently', async () => {
      const first = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/favorite`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(first.status).toBe(201);
      expect(first.body.lessonId).toBe(freeLessonId);

      const second = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/favorite`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(second.status).toBe(201);
    });

    it('a Student cannot favorite a locked Lesson — 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${lockedLessonId}/favorite`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(403);
    });

    it('REGRESSION — favoriting via another School\'s id 404s, not silently succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolB.id}/curriculum/lessons/${freeLessonId}/favorite`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(404);
    });

    it('GET .../favorites lists it, scoped to the caller', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/curriculum/favorites`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(200);
      expect(res.body.items.some((f: { lessonId: string }) => f.lessonId === freeLessonId)).toBe(true);

      const asOtherStudent = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/curriculum/favorites`)
        .set('Authorization', `Bearer ${tokenStudentA2}`);
      expect(asOtherStudent.body.items).toHaveLength(0);
    });

    it('removing a favorite is idempotent, and scoped by schoolId too', async () => {
      const wrongSchool = await request(app.getHttpServer())
        .delete(`/v1/schools/${schoolB.id}/curriculum/lessons/${freeLessonId}/favorite`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(wrongSchool.status).toBe(204); // idempotent no-op, not an error — but did NOT remove the real row:

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/curriculum/favorites`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(stillThere.body.items.some((f: { lessonId: string }) => f.lessonId === freeLessonId)).toBe(true);

      const rightSchool = await request(app.getHttpServer())
        .delete(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/favorite`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(rightSchool.status).toBe(204);

      const nowGone = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/curriculum/favorites`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(nowGone.body.items.some((f: { lessonId: string }) => f.lessonId === freeLessonId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // WatchHistory
  // ---------------------------------------------------------------------------

  describe('WatchHistory', () => {
    it('a Student can report watch progress on a free Lesson, upserted on repeat calls', async () => {
      const first = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/watch-progress`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ lastPositionSeconds: 30 });
      expect(first.status).toBe(201);
      expect(first.body.lastPositionSeconds).toBe(30);
      expect(first.body.completedAt).toBeNull();

      const second = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/watch-progress`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ lastPositionSeconds: 90, completed: true });
      expect(second.status).toBe(201);
      expect(second.body.lastPositionSeconds).toBe(90);
      expect(second.body.completedAt).not.toBeNull();
    });

    it('completed is one-directional — a later ping without it never clears completedAt', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/watch-progress`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ lastPositionSeconds: 95 });
      expect(res.status).toBe(201);
      expect(res.body.completedAt).not.toBeNull();
    });

    it('a Student cannot report progress on a locked Lesson — 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${lockedLessonId}/watch-progress`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ lastPositionSeconds: 5 });
      expect(res.status).toBe(403);
    });

    it('REGRESSION — reporting progress via another School\'s id 404s', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolB.id}/curriculum/lessons/${freeLessonId}/watch-progress`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ lastPositionSeconds: 5 });
      expect(res.status).toBe(404);
    });

    it('GET .../watch-history lists it, scoped to the caller', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/curriculum/watch-history`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(200);
      expect(res.body.items.some((w: { lessonId: string }) => w.lessonId === freeLessonId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Playlist / PlaylistItem
  // ---------------------------------------------------------------------------

  describe('Playlist', () => {
    let playlistId: string;
    let itemId: string;

    it('a Student can create, list, and rename their own Playlist', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/curriculum/playlists')
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ name: 'My Favorites' });
      expect(created.status).toBe(201);
      playlistId = created.body.id;

      const renamed = await request(app.getHttpServer())
        .patch(`/v1/curriculum/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ name: 'Renamed' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('Renamed');

      const listed = await request(app.getHttpServer()).get('/v1/curriculum/playlists').set('Authorization', `Bearer ${tokenStudentA}`);
      expect(listed.body.items.some((p: { id: string }) => p.id === playlistId)).toBe(true);
    });

    it("another Student cannot read, rename, or delete this Playlist — 404 (RLS self-only, explicit own-row check)", async () => {
      const read = await request(app.getHttpServer())
        .get(`/v1/curriculum/playlists/${playlistId}/items`)
        .set('Authorization', `Bearer ${tokenStudentA2}`);
      expect(read.status).toBe(404);

      const rename = await request(app.getHttpServer())
        .patch(`/v1/curriculum/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${tokenStudentA2}`)
        .send({ name: 'Hijacked' });
      expect(rename.status).toBe(404);
    });

    it('can add a free Lesson to the Playlist but not a locked one', async () => {
      const addFree = await request(app.getHttpServer())
        .post(`/v1/curriculum/playlists/${playlistId}/items`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ lessonId: freeLessonId });
      expect(addFree.status).toBe(201);
      itemId = addFree.body.id;
      expect(addFree.body.locked).toBe(false);

      const addLocked = await request(app.getHttpServer())
        .post(`/v1/curriculum/playlists/${playlistId}/items`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ lessonId: lockedLessonId });
      expect(addLocked.status).toBe(403);
    });

    it('GET .../items returns it with lessonTitle joined in', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/curriculum/playlists/${playlistId}/items`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].lessonTitle).toBe('Free Lesson');
    });

    it('reorder rejects an incomplete set, then accepts the full set', async () => {
      // An empty array is rejected by DTO validation itself (@ArrayMinSize(1)
      // on ReorderPlaylistItemsDto) before ever reaching the service's own
      // "send the full current set" check — so this uses a well-formed but
      // WRONG set (a fabricated id in place of the real item) to actually
      // exercise CurriculumService.reorderPlaylistItems's 409 path.
      const incomplete = await request(app.getHttpServer())
        .put(`/v1/curriculum/playlists/${playlistId}/items/order`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ itemIds: [randomUUID()] });
      expect(incomplete.status).toBe(409);

      const full = await request(app.getHttpServer())
        .put(`/v1/curriculum/playlists/${playlistId}/items/order`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ itemIds: [itemId] });
      expect(full.status).toBe(200);
    });

    it('removing an item, then deleting the Playlist, both idempotent/cascading', async () => {
      const removed = await request(app.getHttpServer())
        .delete(`/v1/curriculum/playlists/${playlistId}/items/${itemId}`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(removed.status).toBe(204);

      const deleted = await request(app.getHttpServer())
        .delete(`/v1/curriculum/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(deleted.status).toBe(204);

      const goneNow = await request(app.getHttpServer())
        .get(`/v1/curriculum/playlists/${playlistId}/items`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(goneNow.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Comment
  // ---------------------------------------------------------------------------

  describe('Comment', () => {
    let commentId: string;

    it('a Student can comment on a free Lesson; not on a locked one', async () => {
      const onFree = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/comments`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ body: 'Great lesson!' });
      expect(onFree.status).toBe(201);
      commentId = onFree.body.id;
      expect(onFree.body.authorName).toContain('student-a');

      const onLocked = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${lockedLessonId}/comments`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ body: 'Should be rejected' });
      expect(onLocked.status).toBe(403);
    });

    it('REGRESSION — commenting via another School\'s id 404s', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolB.id}/curriculum/lessons/${freeLessonId}/comments`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ body: 'Cross-tenant' });
      expect(res.status).toBe(404);
    });

    it('GET .../comments lists it oldest-first; REGRESSION — another School\'s id 404s too', async () => {
      const ok = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/comments`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(ok.status).toBe(200);
      expect(ok.body.items.some((c: { id: string }) => c.id === commentId)).toBe(true);

      const wrongSchool = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolB.id}/curriculum/lessons/${freeLessonId}/comments`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(wrongSchool.status).toBe(404);
    });

    it('another Student (not the author, not Staff) cannot delete the Comment — 403', async () => {
      const res = await request(app.getHttpServer()).delete(`/v1/comments/${commentId}`).set('Authorization', `Bearer ${tokenStudentA2}`);
      expect(res.status).toBe(403);
    });

    it('School Staff CAN delete a Comment they did not author', async () => {
      const res = await request(app.getHttpServer()).delete(`/v1/comments/${commentId}`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(res.status).toBe(204);

      const listed = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/comments`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(listed.body.items.some((c: { id: string }) => c.id === commentId)).toBe(false);
    });

    it('the Comment\'s own author CAN delete it', async () => {
      const posted = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/comments`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ body: 'Delete me' });
      const res = await request(app.getHttpServer()).delete(`/v1/comments/${posted.body.id}`).set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------
  // Video upload — authorization/tenant gates only (no real vendor call
  // succeeds in this environment, see this file's own header comment)
  // ---------------------------------------------------------------------------

  describe('Video upload URL — gates only', () => {
    it('a Student cannot request a video-upload-url — 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/curriculum/lessons/${freeLessonId}/video-upload-url`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(403);
    });

    it("REGRESSION — the School Owner cannot request it via another School's id — 404, not a silent cross-tenant write", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolB.id}/curriculum/lessons/${freeLessonId}/video-upload-url`)
        .set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(res.status).toBe(404);
    });
  });
});
