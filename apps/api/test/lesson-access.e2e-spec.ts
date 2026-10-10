/**
 * Who can watch a lesson (Decisions 154, 190, 195): each membership plan ticks
 * the styles it covers and says whether it includes lessons (on by default
 * for priced plans, off for free ones). A student, or their guardian, watches
 * a lesson when a live membership of theirs is on a plan that includes
 * lessons and covers one of the lesson's styles (its skills' styles); a free
 * lesson is open to everyone at the School; staff see all. Real HTTP.
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
  console.warn('[lesson-access.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Lesson access (Decisions 154, 190, 195)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  const style: Record<string, string> = {};
  const skill: Record<string, string> = {};
  const lesson: Record<string, string> = {};
  const plan: Record<string, string> = {};
  let school: { id: string };
  let other: { id: string };

  async function person(label: string, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT'; schoolId?: string }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `access-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Access',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId ?? school.id } });
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId ?? school.id, branchId: null })) });
  }
  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token[label]}`),
    post: (url: string, body: object) => http().post(url).set('Authorization', `Bearer ${token[label]}`).send(body),
    patch: (url: string, body: object) => http().patch(url).set('Authorization', `Bearer ${token[label]}`).send(body),
  });
  const member = (studentLabel: string, planLabel: string, opts: { expired?: boolean } = {}) =>
    superuser.membership.create({
      data: {
        id: randomUUID(), studentId: id[studentLabel], membershipPlanId: plan[planLabel], schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING',
        expiryDate: opts.expired ? new Date(Date.now() - 86_400_000) : null,
      },
    });
  /** "Title: open" or "Title: locked", for the caller's own view. */
  const view = async (label: string, url = `/v1/schools/${school.id}/curriculum/lessons`) => {
    const res = await as(label).get(url);
    expect(res.status).toBe(200);
    return Object.fromEntries((res.body.items as Array<{ title: string; locked: boolean }>).map((l) => [l.title, l.locked ? 'locked' : 'open']));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Access Dojo' } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Access Dojo' } });
    schoolIds.push(school.id, other.id);
    for (const [name, schoolId] of [['BJJ', school.id], ['Judo', school.id], ['Elsewhere', other.id]] as const) {
      style[name] = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId, name } })).id;
      skill[name] = (await superuser.skill.create({ data: { id: randomUUID(), disciplineId: style[name], schoolId, name: `${name} skill` } })).id;
    }
    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER' }]);
    await person('coach', [{ role: 'INSTRUCTOR' }]);
    for (const s of ['paid', 'free', 'expired', 'trial', 'none']) await person(s, [{ role: 'STUDENT' }]);
    await person('guardian', []);
    await person('stranger', []);
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: id.guardian, studentId: id.paid } });

    // Lessons, made by the coach through the API.
    for (const [title, s] of [['Armbar', 'BJJ'], ['Hip throw', 'Judo']] as const) {
      const res = await as('coach').post(`/v1/schools/${school.id}/curriculum/lessons`, { title, description: `${title} step by step`, format: 'PRERECORDED', skillIds: [skill[s]] });
      expect(res.status).toBe(201);
      lesson[title] = res.body.id;
    }
    // Only the owner makes a lesson free.
    const coachFree = await as('coach').post(`/v1/schools/${school.id}/curriculum/lessons`, { title: 'Breakfall', format: 'PRERECORDED', skillIds: [skill.Judo], free: true });
    expect(coachFree.status).toBe(403);
    const free = await as('owner').post(`/v1/schools/${school.id}/curriculum/lessons`, { title: 'Breakfall', format: 'PRERECORDED', skillIds: [skill.Judo], free: true });
    expect(free.status).toBe(201);
    lesson.Breakfall = free.body.id;
  });

  afterAll(async () => {
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.lessonSkill.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
    await superuser.lesson.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.skill.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: id.guardian } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('plans tick their styles; "Includes lessons" is on for priced plans and off for free ones by default', async () => {
    const mk = async (label: string, body: object) => {
      const res = await as('owner').post(`/v1/schools/${school.id}/membership-plans`, body);
      expect(res.status).toBe(201);
      plan[label] = res.body.id;
      return res.body;
    };
    expect(await mk('paid', { type: 'SUBSCRIPTION', title: 'Monthly BJJ', price: 5000, disciplineIds: [style.BJJ] })).toMatchObject({ includesLessons: true, disciplineIds: [style.BJJ] });
    expect(await mk('free', { type: 'FRIEND_PASS', title: 'Friend pass', price: 0, classesIncluded: 1, disciplineIds: [style.BJJ] })).toMatchObject({ includesLessons: false });
    expect(await mk('trial', { type: 'TRIAL_MEMBERSHIP', title: 'Judo trial', price: 0, disciplineIds: [style.Judo], includesLessons: true })).toMatchObject({ includesLessons: true });
    const foreign = await as('owner').post(`/v1/schools/${school.id}/membership-plans`, { type: 'SUBSCRIPTION', title: 'Bad', price: 100, disciplineIds: [style.Elsewhere] });
    expect(foreign.status).toBe(400);

    await member('paid', 'paid');
    await member('free', 'free');
    await member('expired', 'paid', { expired: true });
    await member('trial', 'trial');
  });

  it('students watch the lessons their live memberships cover, and free ones', async () => {
    expect(await view('paid')).toEqual({ Armbar: 'open', 'Hip throw': 'locked', Breakfall: 'open' });
    expect(await view('free')).toEqual({ Armbar: 'locked', 'Hip throw': 'locked', Breakfall: 'open' });
    expect(await view('expired')).toEqual({ Armbar: 'locked', 'Hip throw': 'locked', Breakfall: 'open' });
    expect(await view('trial')).toEqual({ Armbar: 'locked', 'Hip throw': 'open', Breakfall: 'open' });
    expect(await view('none')).toEqual({ Armbar: 'locked', 'Hip throw': 'locked', Breakfall: 'open' });
  });

  it('a locked lesson shows what it is, not its content; staff see everything', async () => {
    const locked = await as('free').get(`/v1/lessons/${lesson.Armbar}`);
    expect(locked.body).toMatchObject({ title: 'Armbar', locked: true, description: null });
    const open = await as('paid').get(`/v1/lessons/${lesson.Armbar}`);
    expect(open.body).toMatchObject({ locked: false, description: 'Armbar step by step' });
    expect(await view('coach')).toEqual({ Armbar: 'open', 'Hip throw': 'open', Breakfall: 'open' });
    expect(await view('owner')).toEqual({ Armbar: 'open', 'Hip throw': 'open', Breakfall: 'open' });
    const bySkill = await as('free').get(`/v1/skills/${skill.BJJ}/lessons`);
    expect(bySkill.body.items[0]).toMatchObject({ title: 'Armbar', locked: true });
  });

  it('a guardian sees their child\'s lessons; nobody else does', async () => {
    const url = `/v1/students/${id.paid}/lessons?schoolId=${school.id}`;
    expect(await view('guardian', url)).toEqual({ Armbar: 'open', 'Hip throw': 'locked', Breakfall: 'open' });
    expect(await view('paid', url)).toEqual({ Armbar: 'open', 'Hip throw': 'locked', Breakfall: 'open' });
    expect((await as('stranger').get(url)).status).toBe(403);
    expect((await as('free').get(url)).status).toBe(403);
  });

  it('turning "Includes lessons" off, or a new style, changes access at once', async () => {
    await as('owner').patch(`/v1/membership-plans/${plan.paid}`, { includesLessons: false });
    expect((await view('paid')).Armbar).toBe('locked');
    await as('owner').patch(`/v1/membership-plans/${plan.paid}`, { includesLessons: true, disciplineIds: [style.BJJ, style.Judo] });
    expect(await view('paid')).toEqual({ Armbar: 'open', 'Hip throw': 'open', Breakfall: 'open' });
    // Only the owner changes "free".
    expect((await as('coach').patch(`/v1/lessons/${lesson.Armbar}`, { free: true })).status).toBe(403);
    expect((await as('owner').patch(`/v1/lessons/${lesson.Armbar}`, { free: true })).body.free).toBe(true);
    expect((await view('none')).Armbar).toBe('open');
  });
});
