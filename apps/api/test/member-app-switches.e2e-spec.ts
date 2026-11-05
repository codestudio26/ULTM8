/**
 * Decision 318 item 7: member app switches each School turns on or off.
 * Real HTTP, real Postgres. Each switch is refused by the API itself, not
 * only hidden in the app:
 *
 * - Edit own profile: off at a School where the person is a Student, their
 *   details are refused (language and currency stay theirs); a person who is
 *   staff anywhere is not locked.
 * - Cancel own membership: off, the member and their Guardian are refused;
 *   the owner still cancels.
 * - Add family members: off, a Guardian can't add their child to the School.
 * - Payment history: off, that School's payments leave the member's list and
 *   its receipts are refused to the member.
 * - Grading countdown: null unless on; on, the next grading day (today or
 *   later) and the classes and days still needed.
 * - Only the owner sets them; the four existing features are on by default,
 *   the countdown off.
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
  console.warn('[member-app-switches.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const EMAIL_TAG = 'member-app-switches-';
type Role = 'SCHOOL_OWNER_MANAGER' | 'STUDENT' | 'INSTRUCTOR';

describeIfDb('Member app switches (Decision 318 item 7)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];

  async function person(label: string, grants: Array<{ role: Role; schoolId: string }>, dateOfBirth = new Date('1990-01-01')) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `${EMAIL_TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Switches',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId } });
    const token = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })) });
    return { id: u.id, token };
  }

  async function newSchool(data: Record<string, unknown> = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Switches ${randomUUID()}`, timezone: 'UTC', ...data } });
    schoolIds.push(school.id);
    return school;
  }

  const http = () => request(app.getHttpServer());
  const patchSchool = (token: string, schoolId: string, body: Record<string, unknown>) => http().patch(`/v1/schools/${schoolId}`).set('Authorization', `Bearer ${token}`).send(body);
  const patchMe = (token: string, body: Record<string, unknown>) => http().patch('/v1/users/me').set('Authorization', `Bearer ${token}`).send(body);
  const memberApp = (token: string) => http().get('/v1/member-app/me').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
    const users = (await superuser.user.findMany({ where: { email: { startsWith: EMAIL_TAG } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: users } } });
    await superuser.transaction.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { OR: [{ studentId: { in: users } }, { guardianId: { in: users } }] } });
    await superuser.roleGrant.deleteMany({ where: { OR: [{ userId: { in: users } }, { schoolId: { in: schoolIds } }] } });
    await superuser.user.deleteMany({ where: { id: { in: users } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
  });

  it('only the owner sets them; four are on by default, the countdown off', async () => {
    const school = await newSchool();
    const owner = await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    const student = await person('student', [{ role: 'STUDENT', schoolId: school.id }]);

    const before = await http().get(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${owner.token}`);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      memberAppEditProfile: true,
      memberAppCancelMembership: true,
      memberAppAddFamily: true,
      memberAppPaymentHistory: true,
      memberAppGradingCountdown: false,
      nextGradingDate: null,
    });

    expect((await patchSchool(student.token, school.id, { memberAppEditProfile: false })).status).toBe(403);
    for (const bad of ['2027-02-30', '12/01/2027', 'soon']) expect((await patchSchool(owner.token, school.id, { nextGradingDate: bad })).status).toBe(400);

    const saved = await patchSchool(owner.token, school.id, { memberAppPaymentHistory: false, memberAppGradingCountdown: true, nextGradingDate: '2027-03-01' });
    expect(saved.status).toBe(200);
    expect(saved.body.memberAppPaymentHistory).toBe(false);
    expect(saved.body.memberAppGradingCountdown).toBe(true);
    expect(String(saved.body.nextGradingDate).slice(0, 10)).toBe('2027-03-01');
    const cleared = await patchSchool(owner.token, school.id, { nextGradingDate: null });
    expect(cleared.body.nextGradingDate).toBeNull();
    expect(cleared.body.memberAppGradingCountdown).toBe(true);
  });

  it('edit own profile: off locks a member\'s details, not their language, and not staff', async () => {
    const locked = await newSchool({ memberAppEditProfile: false });
    const open = await newSchool();
    const member = await person('member', [{ role: 'STUDENT', schoolId: locked.id }, { role: 'STUDENT', schoolId: open.id }]);
    const coach = await person('coach', [{ role: 'STUDENT', schoolId: locked.id }, { role: 'INSTRUCTOR', schoolId: open.id }]);
    const elsewhere = await person('elsewhere', [{ role: 'STUDENT', schoolId: open.id }]);

    const refused = await patchMe(member.token, { firstName: 'Renamed' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('Your School keeps your profile up to date. Ask the School to change your details.');
    expect((await patchMe(member.token, { emergencyContactName: 'Someone' })).status).toBe(403);
    expect((await superuser.user.findUniqueOrThrow({ where: { id: member.id } })).firstName).toBe('member');
    expect((await patchMe(member.token, { language: 'pt-BR' })).status).toBe(200);
    expect((await memberApp(member.token)).body.profileLocked).toBe(true);

    expect((await patchMe(coach.token, { firstName: 'Coach' })).status).toBe(200);
    expect((await memberApp(coach.token)).body.profileLocked).toBe(false);
    expect((await patchMe(elsewhere.token, { firstName: 'Free' })).status).toBe(200);

    await superuser.school.update({ where: { id: locked.id }, data: { memberAppEditProfile: true } });
    expect((await patchMe(member.token, { firstName: 'Renamed' })).status).toBe(200);
  });

  it('cancel own membership: off refuses the member and their Guardian, not the owner', async () => {
    const school = await newSchool({ memberAppCancelMembership: false });
    const owner = await person('cancel-owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    const adult = await person('cancel-adult', [{ role: 'STUDENT', schoolId: school.id }]);
    const child = await person('cancel-child', [{ role: 'STUDENT', schoolId: school.id }], new Date('2016-01-01'));
    const parent = await person('cancel-parent', []);
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: child.id } });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000, currency: 'GBP' } });
    // Already set to end, so a cancel that is allowed answers without Stripe.
    const membership = (studentId: string) =>
      superuser.membership.create({
        data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}`, cancelAt: new Date(Date.now() + 86_400_000) },
      });
    const mine = await membership(adult.id);
    const childs = await membership(child.id);
    const cancel = (token: string, id: string, body: Record<string, unknown> = {}) => http().post(`/v1/memberships/${id}/cancel`).set('Authorization', `Bearer ${token}`).send(body);

    const refused = await cancel(adult.token, mine.id);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('This School cancels memberships itself. Ask the School to cancel it for you.');
    expect((await cancel(parent.token, childs.id, { studentId: child.id })).status).toBe(403);
    expect((await cancel(owner.token, mine.id)).status).toBe(201);

    await superuser.school.update({ where: { id: school.id }, data: { memberAppCancelMembership: true } });
    expect((await cancel(adult.token, mine.id)).status).toBe(201);
    expect((await cancel(parent.token, childs.id, { studentId: child.id })).status).toBe(201);
  });

  it('add family members: off refuses a Guardian adding their child; the app sees the switch', async () => {
    const school = await newSchool({ memberAppAddFamily: false });
    const parent = await person('family-parent', [{ role: 'STUDENT', schoolId: school.id }]);
    const child = await person('family-child', [], new Date('2017-06-01'));
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: child.id } });
    const join = () => http().post(`/v1/schools/${school.id}/join`).set('Authorization', `Bearer ${parent.token}`).send({ studentId: child.id });

    const detail = await http().get(`/v1/academies/${school.id}`).set('Authorization', `Bearer ${parent.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.memberAppAddFamily).toBe(false);
    const refused = await join();
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('This School adds family members itself. Ask the School to add your child.');
    expect(await superuser.roleGrant.count({ where: { userId: child.id, schoolId: school.id } })).toBe(0);

    await superuser.school.update({ where: { id: school.id }, data: { memberAppAddFamily: true } });
    expect((await join()).status).toBe(201);
    const settings = await memberApp(parent.token);
    expect(settings.body.schools).toEqual([{ schoolId: school.id, editProfile: true, cancelMembership: true, addFamily: true, paymentHistory: true, gradingCountdown: false }]);
  });

  it('payment history: off hides that School\'s payments and receipts from the member, not from the owner', async () => {
    const hidden = await newSchool({ memberAppPaymentHistory: false });
    const shown = await newSchool();
    const owner = await person('pay-owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: hidden.id }]);
    const member = await person('pay-member', [{ role: 'STUDENT', schoolId: hidden.id }, { role: 'STUDENT', schoolId: shown.id }]);
    const pay = async (schoolId: string) => {
      const account = await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
      const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId, type: 'CLASS_PACK', title: 'Pack', price: 3000, classesIncluded: 5, currency: 'GBP' } });
      return superuser.transaction.create({
        data: { id: randomUUID(), schoolId, studentId: member.id, paymentAccountId: account.id, membershipPlanId: plan.id, amount: 3000, currency: 'GBP', status: 'SUCCESSFUL', paymentMethod: 'CASH' },
      });
    };
    const hiddenTx = await pay(hidden.id);
    const shownTx = await pay(shown.id);

    const list = await http().get('/v1/transactions/me').set('Authorization', `Bearer ${member.token}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((t: { id: string }) => t.id)).toEqual([shownTx.id]);
    expect((await http().get(`/v1/transactions/${hiddenTx.id}/invoice`).set('Authorization', `Bearer ${member.token}`)).status).toBe(404);
    expect((await http().get(`/v1/transactions/${shownTx.id}/invoice`).set('Authorization', `Bearer ${member.token}`)).status).toBe(200);
    const ownerList = await http().get(`/v1/schools/${hidden.id}/transactions`).set('Authorization', `Bearer ${owner.token}`);
    expect(ownerList.body.items.map((t: { id: string }) => t.id)).toContain(hiddenTx.id);
    expect((await http().get(`/v1/transactions/${hiddenTx.id}/invoice`).set('Authorization', `Bearer ${owner.token}`)).status).toBe(200);

    await superuser.school.update({ where: { id: hidden.id }, data: { memberAppPaymentHistory: true } });
    const all = await http().get('/v1/transactions/me').set('Authorization', `Bearer ${member.token}`);
    expect(all.body.items.map((t: { id: string }) => t.id).sort()).toEqual([hiddenTx.id, shownTx.id].sort());
  });

  it('grading countdown: null when off; on, the next grading day and the classes and days still needed', async () => {
    const school = await newSchool({ ranksToggle: true });
    const owner = await person('grading-owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    const student = await person('grading-student', [{ role: 'STUDENT', schoolId: school.id }]);
    const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: style.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const blue = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: style.id, schoolId: school.id, order: 1, name: 'Blue', primaryColour: '#0000FF' } });
    const whiteTier = await superuser.rankStripeTier.create({
      data: { id: randomUUID(), rankId: white.id, schoolId: school.id, order: 0, count: 0, colour: '#000000', name: 'White', classesRequired: 10, minimumDaysInRank: 30 },
    });
    await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: blue.id, schoolId: school.id, order: 0, count: 0, colour: '#000000', name: 'Blue', classesRequired: 10, minimumDaysInRank: 30 } });
    await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: student.id, disciplineId: style.id, schoolId: school.id, currentRankId: white.id, currentStripeId: whiteTier.id,
        dateOfCurrentRank: new Date(Date.now() - 10 * 86_400_000), classesAttendedTowardCheckpoint: 4,
      },
    });
    const grading = () => http().get(`/v1/students/${student.id}/grading`).set('Authorization', `Bearer ${student.token}`);
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

    const off = await grading();
    expect(off.status).toBe(200);
    expect(off.body.items).toHaveLength(1);
    expect(off.body.items[0].countdown).toBeNull();

    await patchSchool(owner.token, school.id, { memberAppGradingCountdown: true, nextGradingDate: day(23) });
    const on = (await grading()).body.items[0];
    expect(on.countdown).toEqual({
      nextGradingDate: day(23),
      daysUntilGrading: 23,
      classesToGo: on.eligibility.requiredClasses - on.eligibility.countedClasses,
      daysToGo: on.eligibility.requiredDays - on.eligibility.elapsedDays,
    });
    expect(on.countdown.classesToGo).toBeGreaterThan(0);
    expect(on.countdown.daysToGo).toBeGreaterThan(0);

    // A grading day that has passed no longer shows; the student's own countdown does.
    await patchSchool(owner.token, school.id, { nextGradingDate: day(-2) });
    const past = (await grading()).body.items[0].countdown;
    expect(past.nextGradingDate).toBeNull();
    expect(past.daysUntilGrading).toBeNull();
    expect(past.classesToGo).toBeGreaterThan(0);
  });
});
