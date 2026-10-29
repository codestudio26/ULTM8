import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

/**
 * Decision 392 — sign-ups from the front-desk tablet (handover F5): the tablet
 * sends one, staff approve or reject it, an email that already has an account
 * gets an invite it accepts or declines, and a rejected one is kept 30 days.
 * Email sending is stubbed and recorded.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[sign-ups.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;

describeIfDb('Front-desk sign-ups (Decision 392)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let school: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const madeUserIds: string[] = [];
  let tablet: string;
  let tabletB: string;
  const emails: Array<{ to: string; subject: string; body: string }> = [];

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  // A tablet sends at most 5 sign-ups a minute, so Branch A's tablet is
  // restarted (a new session) every few sign-ups here.
  let sentOnTablet = 0;
  const signUp = async (body: Record<string, unknown>, token?: string) => {
    if (!token && ++sentOnTablet > 4) {
      tablet = await startTablet('staffA', branchA.id);
      sentOnTablet = 1;
    }
    return http().post('/v1/front-desk/kiosk/sign-ups').set('Authorization', `Bearer ${token ?? tablet}`).send(body);
  };
  const list = (who: string, view?: string) => http().get(`/v1/schools/${school.id}/sign-ups`).query(view ? { view } : {}).set(as(who));
  const approve = (who: string, id: string, body: Record<string, unknown> = {}) =>
    http().post(`/v1/schools/${school.id}/sign-ups/${id}/approve`).set(as(who)).send(body);
  const reject = (who: string, id: string) => http().post(`/v1/schools/${school.id}/sign-ups/${id}/reject`).set(as(who)).send();

  const adult = (over: Record<string, unknown> = {}) => ({
    kind: 'MEMBER',
    firstName: 'Nina',
    surname: 'New',
    dateOfBirth: '1995-04-02',
    gender: 'FEMALE',
    email: `signup-${randomUUID()}@example.test`,
    phone: '+44 7700 900123',
    heardFrom: 'Instagram',
    emergencyName: 'Pat New',
    emergencyPhone: '+44 7700 900456',
    emergencyRelationship: 'Partner',
    ...over,
  });

  async function startTablet(who: string, branchId: string | null) {
    const res = await http().post(`/v1/schools/${school.id}/front-desk/sessions`).set(as(who)).send(branchId ? { branchId } : {});
    expect(res.status).toBe(201);
    return res.body.sessionToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    jest.spyOn(app.get(NotificationDeliveryService), 'sendEmail').mockImplementation(async (to: string, subject: string, body: string) => {
      emails.push({ to, subject, body });
    });

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Sign-up School', visitorPeriodDays: 7 } });
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Centro' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Norte' } });
    const people: Array<[string, Role | null, string | null]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', null],
      ['staffA', 'BRANCH_STAFF', branchA.id],
      ['staffB', 'BRANCH_STAFF', branchB.id],
      ['coach', 'INSTRUCTOR', branchA.id],
      ['existing', null, null],
      ['member', 'STUDENT', null],
    ];
    for (const [who, role, branchId] of people) {
      const user = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `signup-${who}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: who[0].toUpperCase() + who.slice(1),
          surname: 'Desk',
          passcodeHash: 'x',
          dateOfBirth: new Date('1990-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      users[who] = user;
      if (role) await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId } });
      tokens[who] = jwt.sign({ sub: user.id, email: user.email, grants: role ? [{ role, franchiseId: null, schoolId: school.id, branchId }] : [] });
    }
    await superuser.studentHomeBranch.create({ data: { schoolId: school.id, studentId: users.member.id, branchId: branchA.id } });
    tablet = await startTablet('staffA', branchA.id);
    tabletB = await startTablet('staffB', branchB.id);
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    const created = await superuser.signUp.findMany({ where: { ...where, userId: { not: null } }, select: { userId: true } });
    const ids = [...new Set([...madeUserIds, ...created.map((c) => c.userId as string)])].filter((id) => !Object.values(users).some((u) => u.id === id));
    await superuser.signUp.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.waiverSignature.deleteMany({ where });
    await superuser.frontDeskSession.deleteMany({ where });
    await superuser.staffKioskCode.deleteMany({ where });
    await superuser.studentHomeBranch.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: [...ids, ...Object.values(users).map((u) => u.id)] } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('the tablet', () => {
    it('tells the form whether Visitor is on and which "heard from" choices to show', async () => {
      const info = await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${tablet}`);
      expect(info.body).toMatchObject({ visitorsOn: true, heardFromOptions: null });
    });

    it('sends a sign-up that waits for staff, at the tablet\'s Branch', async () => {
      const body = adult();
      const res = await signUp(body);
      expect(res.status).toBe(201);
      const row = await superuser.signUp.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row).toMatchObject({ status: 'PENDING', branchId: branchA.id, kind: 'MEMBER', email: body.email, emergencyName: 'Pat New', heardFrom: 'Instagram', userId: null });
      // No account is made yet.
      expect(await superuser.user.count({ where: { email: body.email } })).toBe(0);
    });

    it('refuses an under-18, and a second sign-up for the same email while one waits', async () => {
      const kid = await signUp(adult({ dateOfBirth: new Date(Date.now() - 12 * 365 * DAY).toISOString().slice(0, 10) }));
      expect(kid.status).toBe(400);
      expect(kid.body.error.code).toBe('SIGN_UP_UNDER_18');
      const body = adult();
      expect((await signUp(body)).status).toBe(201);
      const again = await signUp({ ...body, firstName: 'Other' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('SIGN_UP_WAITING');
    });

    it('needs a name, date of birth and email; the rest may be blank', async () => {
      expect((await signUp(adult({ email: '' }))).status).toBe(400);
      expect((await signUp(adult({ firstName: ' ' }))).status).toBe(400);
      const res = await signUp(adult({ gender: '', phone: '', heardFrom: '', emergencyName: '', emergencyPhone: '', emergencyRelationship: '' }));
      expect(res.status).toBe(201);
      const row = await superuser.signUp.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row).toMatchObject({ gender: null, phone: null, heardFrom: null, emergencyName: null });
    });

    it('is not reachable with a staff token, only with a tablet session', async () => {
      expect((await http().post('/v1/front-desk/kiosk/sign-ups').set(as('owner')).send(adult())).status).toBe(401);
    });
  });

  describe('staff', () => {
    it('the owner sees every Branch\'s sign-ups; Branch Staff their own; a coach none', async () => {
      const a = (await signUp(adult({ firstName: 'Alpha' }))).body.id;
      const b = (await signUp(adult({ firstName: 'Bravo' }), tabletB)).body.id;
      const ids = (who: string) => list(who).then((r) => (r.body.items as Array<{ id: string }>).map((i) => i.id));
      expect(await ids('owner')).toEqual(expect.arrayContaining([a, b]));
      const mineA = await ids('staffA');
      expect(mineA).toContain(a);
      expect(mineA).not.toContain(b);
      expect((await list('coach')).status).toBe(403);
      expect((await approve('staffA', b)).status).toBe(404);
    });

    it('approving a new email makes the account, enrols it at the tablet\'s Branch and emails a temporary passcode', async () => {
      const body = adult({ firstName: 'Carla', gender: 'FEMALE' });
      const id = (await signUp(body)).body.id;
      const res = await approve('staffA', id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accountCreated: true, invited: false, visitPassGiven: false, emailFailed: false, temporaryPasscode: null });
      const user = await superuser.user.findUniqueOrThrow({ where: { email: body.email } });
      expect(user).toMatchObject({ firstName: 'Carla', surname: 'New', gender: 'FEMALE', mustChangePasscode: true });
      expect(await superuser.roleGrant.count({ where: { userId: user.id, schoolId: school.id, role: 'STUDENT', revokedAt: null } })).toBe(1);
      expect((await superuser.studentHomeBranch.findFirstOrThrow({ where: { studentId: user.id } })).branchId).toBe(branchA.id);
      const row = await superuser.signUp.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'APPROVED', userId: user.id, approvedById: users.staffA.id });
      const mail = emails.find((e) => e.to === body.email)!;
      expect(mail.body).toMatch(/Temporary passcode: \d{6}/);
      // Approving twice does nothing more.
      expect((await approve('owner', id)).status).toBe(409);
    });

    it('a Visitor gets a visit pass on approval', async () => {
      const body = adult({ kind: 'VISITOR', firstName: 'Vera' });
      const id = (await signUp(body)).body.id;
      const res = await approve('owner', id);
      expect(res.body.visitPassGiven).toBe(true);
      const user = await superuser.user.findUniqueOrThrow({ where: { email: body.email } });
      const pass = await superuser.membership.findFirstOrThrow({ where: { studentId: user.id, schoolId: school.id }, include: { membershipPlan: true } });
      expect(pass.membershipPlan.type).toBe('VISIT_PASS');
      expect(pass.giftedById).toBe(users.owner.id);
    });

    it('rejecting sends a polite email with no reason; it is kept 30 days and can still be approved', async () => {
      const body = adult({ firstName: 'Rita' });
      const id = (await signUp(body)).body.id;
      const res = await reject('staffA', id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'REJECTED', rejectedByName: 'StaffA Desk' });
      expect(new Date(res.body.deletesAt).getTime() - new Date(res.body.rejectedAt).getTime()).toBe(30 * DAY);
      const mail = emails.find((e) => e.to === body.email)!;
      expect(mail.body).toMatch(/weren't able to accept your sign-up/);
      expect(mail.body).toMatch(/talk to the front desk/);
      expect((await list('owner')).body.items.map((i: { id: string }) => i.id)).not.toContain(id);
      expect((await list('owner', 'REJECTED')).body.items.map((i: { id: string }) => i.id)).toContain(id);

      const again = await approve('owner', id);
      expect(again.status).toBe(200);
      const row = await superuser.signUp.findUniqueOrThrow({ where: { id } });
      // Who rejected it and who approved it are both kept (Decision 365).
      expect(row).toMatchObject({ status: 'APPROVED', rejectedById: users.staffA.id, approvedById: users.owner.id });
    });

    it('the daily purge deletes a sign-up rejected more than 30 days ago', async () => {
      const id = (await signUp(adult({ firstName: 'Old' }))).body.id;
      await reject('owner', id);
      await superuser.signUp.update({ where: { id }, data: { rejectedAt: new Date(Date.now() - 31 * DAY) } });
      const { EntityOffboardingPurgeProcessor } = await import('../src/jobs/entity-offboarding-purge.processor');
      await app.get(EntityOffboardingPurgeProcessor).process({} as never);
      expect(await superuser.signUp.count({ where: { id } })).toBe(0);
    });

    it('Branch Staff need the students switch', async () => {
      const id = (await signUp(adult({ firstName: 'Switch' }))).body.id;
      await superuser.staffPermission.upsert({
        where: { schoolId_userId: { schoolId: school.id, userId: users.staffA.id } },
        create: { schoolId: school.id, userId: users.staffA.id, canManageStudents: false },
        update: { canManageStudents: false },
      });
      const off = await approve('staffA', id);
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');
      await superuser.staffPermission.deleteMany({ where: { schoolId: school.id, userId: users.staffA.id } });
    });
  });

  describe('an email that already has an account', () => {
    it('approval sends an invite; the account accepts it in the app and is enrolled', async () => {
      const id = (await signUp(adult({ kind: 'VISITOR', email: users.existing.email }))).body.id;
      const pending = (await list('owner')).body.items.find((i: { id: string }) => i.id === id);
      expect(pending.hasAccount).toBe(true);
      const res = await approve('owner', id);
      expect(res.body).toMatchObject({ accountCreated: false, invited: true });
      expect(await superuser.roleGrant.count({ where: { userId: users.existing.id, schoolId: school.id } })).toBe(0);
      expect(emails.find((e) => e.to === users.existing.email)!.body).toMatch(/Open the ULTM8 app/);

      // Nobody else can see or accept it.
      expect((await http().post(`/v1/sign-ups/invites/${id}/accept`).set(as('member')).send({})).status).toBe(404);

      const invites = await http().get('/v1/sign-ups/invites/me').set(as('existing'));
      expect(invites.body.items).toEqual([expect.objectContaining({ id, schoolName: 'Sign-up School', kind: 'VISITOR', branchId: branchA.id, needsBranch: false })]);
      const accepted = await http().post(`/v1/sign-ups/invites/${id}/accept`).set(as('existing')).send({});
      expect(accepted.status).toBe(201);
      expect(accepted.body).toMatchObject({ schoolId: school.id, visitPassGiven: true });
      expect(typeof accepted.body.accessToken).toBe('string');
      expect(await superuser.roleGrant.count({ where: { userId: users.existing.id, schoolId: school.id, role: 'STUDENT', revokedAt: null } })).toBe(1);
      expect((await superuser.signUp.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
      expect((await http().get('/v1/sign-ups/invites/me').set(as('existing'))).body.items).toEqual([]);
    });

    it('the account can decline instead', async () => {
      const someone = await superuser.user.create({
        data: { id: randomUUID(), email: `signup-decliner-${randomUUID()}@example.test`, firstName: 'Dee', surname: 'Cline', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') },
      });
      madeUserIds.push(someone.id);
      tokens.decliner = jwt.sign({ sub: someone.id, email: someone.email, grants: [] });
      const id = (await signUp(adult({ email: someone.email }))).body.id;
      await approve('owner', id);
      expect((await http().post(`/v1/sign-ups/invites/${id}/decline`).set(as('decliner')).send()).status).toBe(204);
      expect((await superuser.signUp.findUniqueOrThrow({ where: { id } })).status).toBe('DECLINED');
      expect(await superuser.roleGrant.count({ where: { userId: someone.id, schoolId: school.id } })).toBe(0);
      expect((await list('owner', 'DONE')).body.items.map((i: { id: string }) => i.id)).toContain(id);
    });

    it('an email that is already a student here is refused', async () => {
      const id = (await signUp(adult({ email: users.member.email }))).body.id;
      const res = await approve('owner', id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SIGN_UP_ALREADY_STUDENT');
    });
  });

  describe('School settings', () => {
    it('Visitor needs a visitor period', async () => {
      await superuser.school.update({ where: { id: school.id }, data: { visitorPeriodDays: null } });
      const res = await signUp(adult({ kind: 'VISITOR' }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VISITOR_PERIOD_NOT_SET');
      expect((await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${tablet}`)).body.visitorsOn).toBe(false);
      await superuser.school.update({ where: { id: school.id }, data: { visitorPeriodDays: 7 } });
    });

    it('the owner edits the "heard from" list; the tablet then accepts only those choices', async () => {
      const bad = await http().patch(`/v1/schools/${school.id}`).set(as('owner')).send({ heardFromOptions: ['Friend', 'friend'] });
      expect(bad.status).toBe(400);
      const res = await http().patch(`/v1/schools/${school.id}`).set(as('owner')).send({ heardFromOptions: ['Friend', 'Flyer', 'Google'] });
      expect(res.status).toBe(200);
      expect(res.body.heardFromOptions).toEqual(['Friend', 'Flyer', 'Google']);
      expect((await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${tablet}`)).body.heardFromOptions).toEqual(['Friend', 'Flyer', 'Google']);
      expect((await signUp(adult({ heardFrom: 'Flyer' }))).status).toBe(201);
      expect((await signUp(adult({ heardFrom: 'Instagram' }))).status).toBe(400);
      // Back to the starting list.
      const reset = await http().patch(`/v1/schools/${school.id}`).set(as('owner')).send({ heardFromOptions: null });
      expect(reset.body.heardFromOptions).toBeNull();
    });
  });
});
