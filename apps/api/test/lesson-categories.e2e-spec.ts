/**
 * Lesson categories (Decisions 128.15, 191): a list per School with its own
 * order; lessons are ordered within their category, can move between
 * categories, and are listed in that order. Staff write; anyone at the
 * School reads; nothing crosses Schools. Real HTTP.
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
  console.warn('[lesson-categories.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Lesson categories (Decision 191)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appRole = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};
  let school: { id: string };
  let other: { id: string };
  let skillId = '';
  let otherSkillId = '';

  async function person(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT', schoolId: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `cats-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Cats',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: u.id, schoolId } });
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
  }
  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token[label]}`),
    post: (url: string, body: object) => http().post(url).set('Authorization', `Bearer ${token[label]}`).send(body),
    put: (url: string, body: object) => http().put(url).set('Authorization', `Bearer ${token[label]}`).send(body),
    patch: (url: string, body: object) => http().patch(url).set('Authorization', `Bearer ${token[label]}`).send(body),
  });
  const category = async (name: string) => (await as('coach').post(`/v1/schools/${school.id}/curriculum/categories`, { name })).body as { id: string; order: number };
  const lesson = async (title: string, categoryId?: string) =>
    (await as('coach').post(`/v1/schools/${school.id}/curriculum/lessons`, { title, format: 'PRERECORDED', skillIds: [skillId], ...(categoryId ? { categoryId } : {}) })).body as {
      id: string;
      order: number;
      category: string | null;
    };
  const titles = async () =>
    ((await as('student').get(`/v1/schools/${school.id}/curriculum/lessons`)).body.items as Array<{ title: string; category: string | null }>).map(
      (l) => `${l.category ?? '—'}: ${l.title}`,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Categories Dojo' } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Categories Dojo' } });
    schoolIds.push(school.id, other.id);
    for (const [s, set] of [[school.id, (v: string) => (skillId = v)], [other.id, (v: string) => (otherSkillId = v)]] as const) {
      const d = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: s, name: 'BJJ' } });
      set((await superuser.skill.create({ data: { id: randomUUID(), disciplineId: d.id, schoolId: s, name: 'Armbar' } })).id);
    }
    await person('owner', 'SCHOOL_OWNER_MANAGER', school.id);
    await person('coach', 'INSTRUCTOR', school.id);
    await person('student', 'STUDENT', school.id);
    await person('otherOwner', 'SCHOOL_OWNER_MANAGER', other.id);
  });

  afterAll(async () => {
    await superuser.lessonSkill.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
    await superuser.lesson.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.lessonCategory.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.skill.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await appRole.$disconnect();
    await app.close();
  });

  it('staff add categories in order; lessons go to the end of theirs and are listed in order', async () => {
    const subs = await category('Submissions');
    const guard = await category('Guard Work');
    expect([subs.order, guard.order]).toEqual([0, 1]);
    expect((await lesson('Rear Naked Choke', subs.id)).order).toBe(0);
    expect((await lesson('Armbar', subs.id)).order).toBe(1);
    expect((await lesson('Scissor Sweep', guard.id)).category).toBe('Guard Work');
    await lesson('Unsorted Drill');
    expect(await titles()).toEqual(['Submissions: Rear Naked Choke', 'Submissions: Armbar', 'Guard Work: Scissor Sweep', '—: Unsorted Drill']);
  });

  it('reordering categories and lessons; a lesson dropped into another category moves there', async () => {
    const cats = (await as('student').get(`/v1/schools/${school.id}/curriculum/categories`)).body.items as Array<{ id: string; name: string }>;
    const [subs, guard] = cats;
    const reordered = await as('owner').put(`/v1/schools/${school.id}/curriculum/categories/order`, { categoryIds: [guard.id, subs.id] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.items.map((c: { name: string }) => c.name)).toEqual(['Guard Work', 'Submissions']);

    const lessons = (await as('student').get(`/v1/schools/${school.id}/curriculum/lessons`)).body.items as Array<{ id: string; title: string }>;
    const byTitle = (t: string) => lessons.find((l) => l.title === t)!.id;
    // Armbar moves from Submissions to the top of Guard Work.
    const moved = await as('coach').put(`/v1/curriculum/categories/${guard.id}/lessons/order`, { lessonIds: [byTitle('Armbar'), byTitle('Scissor Sweep')] });
    expect(moved.status).toBe(200);
    expect(await titles()).toEqual(['Guard Work: Armbar', 'Guard Work: Scissor Sweep', 'Submissions: Rear Naked Choke', '—: Unsorted Drill']);

    // Leaving out a lesson already in the category is refused, so none is lost.
    expect((await as('coach').put(`/v1/curriculum/categories/${guard.id}/lessons/order`, { lessonIds: [byTitle('Armbar')] })).status).toBe(409);
    expect((await as('owner').put(`/v1/schools/${school.id}/curriculum/categories/order`, { categoryIds: [guard.id] })).status).toBe(400);
  });

  it('a lesson can be moved by editing it, or taken out of its category', async () => {
    const cats = (await as('student').get(`/v1/schools/${school.id}/curriculum/categories`)).body.items as Array<{ id: string; name: string }>;
    const subs = cats.find((c) => c.name === 'Submissions')!;
    const drill = ((await as('student').get(`/v1/schools/${school.id}/curriculum/lessons`)).body.items as Array<{ id: string; title: string }>).find(
      (l) => l.title === 'Unsorted Drill',
    )!;
    const res = await as('coach').patch(`/v1/lessons/${drill.id}`, { categoryId: subs.id });
    expect(res.body).toMatchObject({ category: 'Submissions', categoryId: subs.id, order: 1 });
    const out = await as('coach').patch(`/v1/lessons/${drill.id}`, { categoryId: null });
    expect(out.body).toMatchObject({ category: null, categoryId: null });
  });

  it('names are unique per School and can be changed', async () => {
    expect((await as('coach').post(`/v1/schools/${school.id}/curriculum/categories`, { name: 'guard work' })).status).toBe(409);
    expect((await as('coach').post(`/v1/schools/${school.id}/curriculum/categories`, { name: '  ' })).status).toBe(400);
    const cats = (await as('student').get(`/v1/schools/${school.id}/curriculum/categories`)).body.items as Array<{ id: string; name: string }>;
    const renamed = await as('owner').patch(`/v1/curriculum/categories/${cats[0].id}`, { name: 'Guard' });
    expect(renamed.body.name).toBe('Guard');
  });

  it('students can read but not write; nothing crosses Schools', async () => {
    expect((await as('student').post(`/v1/schools/${school.id}/curriculum/categories`, { name: 'Mine' })).status).toBe(403);
    const cats = (await as('student').get(`/v1/schools/${school.id}/curriculum/categories`)).body.items as Array<{ id: string }>;
    expect((await as('student').patch(`/v1/curriculum/categories/${cats[0].id}`, { name: 'Mine' })).status).toBe(403);
    expect([403, 404]).toContain((await as('otherOwner').get(`/v1/schools/${school.id}/curriculum/categories`)).status);
    expect((await as('otherOwner').patch(`/v1/curriculum/categories/${cats[0].id}`, { name: 'Theirs' })).status).toBe(404);
    // Another School's lesson can't be put in this School's category, nor the other way round.
    const theirs = await as('otherOwner').post(`/v1/schools/${other.id}/curriculum/lessons`, { title: 'Theirs', format: 'PRERECORDED', skillIds: [otherSkillId] });
    expect((await as('coach').put(`/v1/curriculum/categories/${cats[0].id}/lessons/order`, { lessonIds: [theirs.body.id] })).status).toBe(400);
    expect((await as('otherOwner').post(`/v1/schools/${other.id}/curriculum/lessons`, { title: 'X', format: 'PRERECORDED', skillIds: [otherSkillId], categoryId: cats[0].id })).status).toBe(400);
  });

  it('the database refuses a student writing a category directly', async () => {
    await expect(
      appRole.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${id.student}'`);
        return tx.lessonCategory.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Sneaky' } });
      }),
    ).rejects.toThrow();
  });
});
