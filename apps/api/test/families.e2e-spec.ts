/**
 * Decision 429 — families (stress test round 5, FAM-1 to FAM-12 and PRIV-2).
 * A parent who also trains or coaches at the School books as the parent; a
 * Guardian is an adult; a child is added once; a child can't buy on their
 * own; the same child isn't added twice and a second parent is invited
 * instead; a parent's authority ends at 18; a parent can leave or be removed
 * (never the last one); BASELINE consent gates booking and check-in; another
 * School's export leaves out a parent it never dealt with; a shared email is
 * refused clearly; and a person's name and date of birth are locked for staff
 * once shared.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[families.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TAG = `fam429-${randomUUID().slice(0, 8)}`;
const POLICY = '2026-11-v1';
/** The passcode behind every test account, for POST /auth/step-up/verify (Decision 236). */
const PASSCODE = '424242';

type Grant = { role: string; schoolId: string | null };
type U = { id: string; email: string; token: string };

describeIfDb('Families (Decision 429)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const school = { id: randomUUID() };
  const otherSchool = { id: randomUUID() };
  let subscriptionPlanId: string;
  let owner: U;
  let otherOwner: U;
  let passcodeHash: string;

  const http = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const at = (ms: number) => new Date(Date.now() + ms);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const yearsAgo = (years: number, plusDays = 0) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - plusDays * DAY);
  };

  const sign = (id: string, email: string, grants: Grant[]) =>
    jwt.sign({ sub: id, email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })) });

  /** A person with their own login; grants are written to the database and the token. */
  async function person(label: string, dateOfBirth: Date | null, grants: Grant[] = [], extra: Record<string, unknown> = {}): Promise<U> {
    const id = randomUUID();
    const email = `${TAG}-${label}-${randomUUID().slice(0, 6)}@example.test`;
    await superuser.user.create({
      data: {
        id,
        email,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        phoneVerifiedAt: new Date(),
        firstName: label,
        surname: 'Family',
        passcodeHash,
        dateOfBirth,
        ...extra,
      },
    });
    for (const g of grants) {
      if (g.schoolId) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role as 'STUDENT', userId: id, schoolId: g.schoolId } });
    }
    return { id, email, token: sign(id, email, grants) };
  }

  /** A child on a parent's account, enrolled at `schoolIds`, with a subscription at the first. */
  async function child(label: string, parents: U[], opts: { dob?: Date; schoolIds?: string[]; consent?: boolean; grandfathered?: boolean } = {}) {
    const c = await person(label, opts.dob ?? new Date('2016-04-04'), [], { email: `minor+${randomUUID()}@guardian-managed.ultm8.internal` });
    for (const schoolId of opts.schoolIds ?? [school.id]) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: c.id, schoolId } });
    }
    for (const p of parents) {
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: p.id, studentId: c.id, consentGrandfathered: opts.grandfathered ?? false } });
      if (opts.consent !== false) {
        await superuser.consentRecord.create({ data: { id: randomUUID(), guardianId: p.id, studentId: c.id, tier: 'BASELINE', policyVersion: POLICY } });
      }
    }
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: c.id, schoolId: (opts.schoolIds ?? [school.id])[0], membershipPlanId: subscriptionPlanId, frequency: 'RECURRING', status: 'ACTIVE' },
    });
    return c;
  }

  const mkClass = (data: Record<string, unknown> = {}) =>
    superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Kids BJJ', membershipInclusion: true, termsWaiverRequired: false, startDate: at(2 * HOUR), endDate: at(3 * HOUR), ...data },
    });

  beforeAll(async () => {
    passcodeHash = await bcrypt.hash(PASSCODE, 4);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: `${TAG} Dojo`, timezone: 'UTC' } });
    await superuser.school.create({ data: { id: otherSchool.id, name: `${TAG} Gym`, timezone: 'UTC' } });
    subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Kids Unlimited', price: 5000 } })).id;
    owner = await person('owner', new Date('1980-01-01'), [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    otherOwner = await person('other-owner', new Date('1980-01-01'), [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: otherSchool.id }]);
  });

  afterAll(async () => {
    const users = (await superuser.user.findMany({ where: { OR: [{ email: { contains: TAG } }, { firstName: { startsWith: 'fam-' } }] }, select: { id: true } })).map((u) => u.id);
    const minors = (await superuser.guardianLink.findMany({ where: { guardianId: { in: users } }, select: { studentId: true } })).map((l) => l.studentId);
    const everyone = [...new Set([...users, ...minors])];
    for (const id of [school.id, otherSchool.id]) {
      await superuser.waitlistEntry.deleteMany({ where: { schoolId: id } });
      await superuser.booking.deleteMany({ where: { schoolId: id } });
      await superuser.membership.deleteMany({ where: { schoolId: id } });
      await superuser.membershipPlan.deleteMany({ where: { schoolId: id } });
      await superuser.class.deleteMany({ where: { schoolId: id } });
      await superuser.childInvite.deleteMany({ where: { schoolId: id } });
      await superuser.studentExportLog.deleteMany({ where: { schoolId: id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: id } });
    }
    await superuser.notification.deleteMany({ where: { userId: { in: everyone } } });
    await superuser.bookingDelegation.deleteMany({ where: { OR: [{ guardianId: { in: everyone } }, { studentId: { in: everyone } }] } });
    await superuser.consentRecord.deleteMany({ where: { OR: [{ guardianId: { in: everyone } }, { studentId: { in: everyone } }] } });
    await superuser.guardianLink.deleteMany({ where: { OR: [{ guardianId: { in: everyone } }, { studentId: { in: everyone } }] } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: everyone } } });
    await superuser.school.deleteMany({ where: { id: { in: [school.id, otherSchool.id] } } });
    await superuser.user.deleteMany({ where: { id: { in: everyone } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('item 1 (FAM-1): a parent who trains or coaches here books as the parent', () => {
    let memberParent: U;
    let coachParent: U;
    let memberChild: U;
    let coachChild: U;

    beforeAll(async () => {
      memberParent = await person('member-parent', new Date('1985-01-01'), [{ role: 'STUDENT', schoolId: school.id }]);
      coachParent = await person('coach-parent', new Date('1985-01-01'), [{ role: 'INSTRUCTOR', schoolId: school.id }]);
      memberChild = await child('fam-member-child', [memberParent]);
      coachChild = await child('fam-coach-child', [coachParent]);
    });

    it('a parent with their own STUDENT grant books and cancels their child', async () => {
      const cls = await mkClass();
      const booked = await http().post(`/v1/classes/${cls.id}/book`).set(auth(memberParent)).send({ studentId: memberChild.id });
      expect(booked.status).toBe(201);
      expect(booked.body.studentId).toBe(memberChild.id);
      const cancelled = await http().patch(`/v1/bookings/${booked.body.id}/cancel`).set(auth(memberParent)).send({ studentId: memberChild.id });
      expect(cancelled.status).toBe(200);
      expect((await superuser.booking.findUniqueOrThrow({ where: { id: booked.body.id } })).status).not.toBe('UPCOMING');
    });

    it('a parent who coaches here can no longer jump the waitlist: they join it as the parent, then leave it', async () => {
      const filler = await person('filler', new Date('1990-01-01'), [{ role: 'STUDENT', schoolId: school.id }]);
      const cls = await mkClass({ capacity: 1 });
      await superuser.booking.create({ data: { id: randomUUID(), studentId: filler.id, classId: cls.id, schoolId: school.id, status: 'UPCOMING' } });

      const book = await http().post(`/v1/classes/${cls.id}/book`).set(auth(coachParent)).send({ studentId: coachChild.id });
      expect(book.status).toBe(409);
      expect(book.body.error.code).toBe('CLASS_FULL');

      const joined = await http().post(`/v1/classes/${cls.id}/waitlist`).set(auth(coachParent)).send({ studentId: coachChild.id });
      expect(joined.status).toBe(201);
      const memberJoined = await http().post(`/v1/classes/${cls.id}/waitlist`).set(auth(memberParent)).send({ studentId: memberChild.id });
      expect(memberJoined.status).toBe(201);

      // Behind someone already waiting, a coach-parent's booking is a parent's: WAITLIST_FIRST, not a staff booking.
      await superuser.booking.updateMany({ where: { classId: cls.id, studentId: filler.id }, data: { status: 'CANCELLED' } });
      const jump = await http().post(`/v1/classes/${cls.id}/book`).set(auth(coachParent)).send({ studentId: coachChild.id });
      expect(jump.status).toBe(409);

      expect((await http().delete(`/v1/waitlist/${joined.body.id}`).set(auth(coachParent))).status).toBeLessThan(300);
      expect((await http().delete(`/v1/waitlist/${memberJoined.body.id}`).query({ studentId: memberChild.id }).set(auth(memberParent))).status).toBeLessThan(300);
      expect(await superuser.waitlistEntry.count({ where: { classId: cls.id, status: { in: ['WAITING', 'NOTIFIED'] } } })).toBe(0);
    });

    it('a coach-parent claims an offered place for their child', async () => {
      const cls = await mkClass({ capacity: 1 });
      const entry = await superuser.waitlistEntry.create({
        data: { id: randomUUID(), studentId: coachChild.id, classId: cls.id, schoolId: school.id, position: 1, status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: at(HOUR) },
      });
      const claimed = await http().post(`/v1/waitlist/${entry.id}/claim`).set(auth(coachParent)).send({});
      expect(claimed.status).toBe(201);
      expect(claimed.body.studentId).toBe(coachChild.id);
    });

    it('a coach-parent uses Kid Mode for their child', async () => {
      const cls = await mkClass();
      expect((await http().post(`/v1/guardians/me/minors/${coachChild.id}/booking-delegation`).set(auth(coachParent)).send({})).status).toBe(201);
      const minted = await http().post(`/v1/guardians/me/minors/${coachChild.id}/kid-mode-token`).set(auth(coachParent)).send({});
      expect(minted.status).toBe(201);
      const booked = await http().post(`/v1/classes/${cls.id}/book`).set({ Authorization: `Bearer ${minted.body.accessToken}` }).send({ studentId: coachChild.id });
      expect(booked.status).toBe(201);
      expect((await superuser.booking.findUniqueOrThrow({ where: { id: booked.body.id } })).bookedViaKidMode).toBe(true);
    });

    it('an override reason stays staff-only: the coach-parent supplying one books as staff, not as the parent', async () => {
      const cls = await mkClass();
      const res = await http().post(`/v1/classes/${cls.id}/book`).set(auth(memberParent)).send({ studentId: memberChild.id, overrideReason: 'Coach says yes' });
      expect(res.status).toBe(403);
    });
  });

  describe('items 2-4 (FAM-2, FAM-3, FAM-4): adding a child', () => {
    it('refuses a Guardian under 18', async () => {
      const teen = await person('teen', yearsAgo(15), [{ role: 'STUDENT', schoolId: school.id }]);
      const res = await http().post('/v1/guardians/me/minors').set(auth(teen)).send({ firstName: 'fam-baby', surname: 'Family', dateOfBirth: '2024-01-01' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('GUARDIAN_UNDER_18');
    });

    it('checks the child details like the School form does', async () => {
      const parent = await person('checks-parent', new Date('1985-01-01'));
      const blank = await http().post('/v1/guardians/me/minors').set(auth(parent)).send({ firstName: '   ', surname: 'Family', dateOfBirth: '2016-01-01' });
      expect(blank.status).toBe(400);
      const future = await http().post('/v1/guardians/me/minors').set(auth(parent)).send({ firstName: 'fam-x', surname: 'Family', dateOfBirth: isoDay(at(30 * DAY)) });
      expect(future.status).toBe(400);
      const adult = await http().post('/v1/guardians/me/minors').set(auth(parent)).send({ firstName: 'fam-x', surname: 'Family', dateOfBirth: '1990-01-01' });
      expect(adult.status).toBe(400);
      expect(adult.body.error.code).toBe('NOT_A_MINOR');
    });

    it('adds the same child once, however many times the app sends it', async () => {
      const parent = await person('repeat-parent', new Date('1985-01-01'));
      const body = { firstName: ' fam-Twin ', surname: 'Family', dateOfBirth: '2017-02-02', consentPolicyVersion: POLICY };
      const results = await Promise.all(Array.from({ length: 6 }, () => http().post('/v1/guardians/me/minors').set(auth(parent)).send(body)));
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      expect(new Set(results.map((r) => r.body.studentId)).size).toBe(1);
      expect(results.filter((r) => r.body.alreadyAdded).length).toBe(5);
      expect(await superuser.guardianLink.count({ where: { guardianId: parent.id, revokedAt: null } })).toBe(1);
      // A different name is a different child (twins).
      const twin = await http().post('/v1/guardians/me/minors').set(auth(parent)).send({ ...body, firstName: 'fam-Other' });
      expect(twin.status).toBe(201);
      expect(twin.body.studentId).not.toBe(results[0].body.studentId);
    });
  });

  describe('item 5 (FAM-5): a child cannot buy a plan on their own', () => {
    it('refuses a self-registered member under 18', async () => {
      const kid = await person('self-kid', yearsAgo(11), [{ role: 'STUDENT', schoolId: school.id }]);
      const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5 classes', price: 2500, classesIncluded: 5 } });
      const res = await http().post(`/v1/membership-plans/${plan.id}/purchase`).set(auth(kid)).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('UNDER_18_SELF');
    });
  });

  describe('items 6 and 8 (FAM-6, FAM-8): a second parent, and leaving', () => {
    let firstParent: U;
    let secondParent: U;
    let kid: U;

    beforeAll(async () => {
      firstParent = await person('first-parent', new Date('1984-01-01'));
      secondParent = await person('second-parent', new Date('1986-01-01'));
      kid = await child('fam-shared', [firstParent], { dob: new Date('2015-05-05') });
    });

    it('refuses the same child added again by hand, pointing to "Add another Guardian"', async () => {
      const res = await http()
        .post(`/v1/schools/${school.id}/students/add-child-manually`)
        .set(auth(owner))
        .send({ child: { firstName: 'FAM-SHARED', surname: ' family ', dateOfBirth: '2015-05-05' }, guardian: { firstName: 'Second', surname: 'Parent', email: secondParent.email } });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CHILD_ALREADY_HERE');
    });

    it('invites another adult as a parent of the same child, who accepts with consent', async () => {
      const staffParent = await person('staff-no', new Date('1980-01-01'), [{ role: 'INSTRUCTOR', schoolId: school.id }]);
      const guardianBody = { firstName: 'Second', surname: 'Parent', email: secondParent.email };
      expect((await http().post(`/v1/schools/${school.id}/students/${kid.id}/guardians`).set(auth(staffParent)).send(guardianBody)).status).toBe(403);
      const already = await http().post(`/v1/schools/${school.id}/students/${kid.id}/guardians`).set(auth(owner)).send({ ...guardianBody, email: firstParent.email });
      expect(already.status).toBe(409);
      expect(already.body.error.code).toBe('ALREADY_GUARDIAN');

      const invited = await http().post(`/v1/schools/${school.id}/students/${kid.id}/guardians`).set(auth(owner)).send(guardianBody);
      expect(invited.status).toBe(201);
      expect(invited.body).toMatchObject({ outcome: 'GUARDIAN_INVITED', studentId: kid.id });
      expect(await superuser.staffActivity.count({ where: { schoolId: school.id, action: 'GUARDIAN_INVITED', targetUserId: secondParent.id } })).toBe(1);

      const mine = await http().get('/v1/child-invites/me').set(auth(secondParent));
      expect(mine.body.items).toEqual([expect.objectContaining({ id: invited.body.inviteId, addsGuardian: true })]);
      const accepted = await http().post(`/v1/child-invites/${invited.body.inviteId}/accept`).set(auth(secondParent)).send({ consentPolicyVersion: POLICY });
      expect(accepted.status).toBe(201);
      expect(accepted.body.studentId).toBe(kid.id);
      expect(await superuser.guardianLink.count({ where: { studentId: kid.id, revokedAt: null } })).toBe(2);
      expect(await superuser.consentRecord.count({ where: { guardianId: secondParent.id, studentId: kid.id, tier: 'BASELINE', status: 'ACTIVE' } })).toBe(1);

      // Each parent sees the other's consent, without being able to act on it.
      const seen = await http().get(`/v1/guardians/me/minors/${kid.id}/consent`).set(auth(firstParent));
      expect(seen.status).toBe(200);
      expect(seen.body.state).toBe('GIVEN');
      const other = seen.body.guardians.find((g: { guardianId: string }) => g.guardianId === secondParent.id);
      expect(other).toMatchObject({ isMe: false, records: [expect.objectContaining({ id: null, tier: 'BASELINE', status: 'ACTIVE' })] });
    });

    it('a parent removes themselves, but never as the last parent of an enrolled child', async () => {
      expect((await http().delete(`/v1/guardians/me/minors/${kid.id}`).set(auth(secondParent))).status).toBe(204);
      expect(await superuser.guardianLink.count({ where: { studentId: kid.id, revokedAt: null } })).toBe(1);
      expect(await superuser.staffActivity.count({ where: { schoolId: school.id, action: 'GUARDIAN_LEFT', targetUserId: secondParent.id } })).toBe(1);
      // Neither account is closed.
      expect(await superuser.user.count({ where: { id: { in: [secondParent.id, kid.id] } } })).toBe(2);

      const last = await http().delete(`/v1/guardians/me/minors/${kid.id}`).set(auth(firstParent));
      expect(last.status).toBe(409);
      expect(last.body.error.code).toBe('LAST_GUARDIAN');
    });

    it('the owner removes a parent, but not the last one, and only the owner', async () => {
      await superuser.guardianLink.update({ where: { guardianId_studentId: { guardianId: secondParent.id, studentId: kid.id } }, data: { revokedAt: null } });
      const coach = await person('coach-no', new Date('1980-01-01'), [{ role: 'INSTRUCTOR', schoolId: school.id }]);
      expect((await http().delete(`/v1/schools/${school.id}/students/${kid.id}/guardians/${secondParent.id}`).set(auth(coach))).status).toBe(403);
      expect((await http().delete(`/v1/schools/${school.id}/students/${kid.id}/guardians/${secondParent.id}`).set(auth(owner))).status).toBe(204);
      expect(await superuser.staffActivity.count({ where: { schoolId: school.id, action: 'GUARDIAN_REMOVED', targetUserId: secondParent.id } })).toBe(1);
      const last = await http().delete(`/v1/schools/${school.id}/students/${kid.id}/guardians/${firstParent.id}`).set(auth(owner));
      expect(last.status).toBe(409);
      expect(last.body.error.code).toBe('LAST_GUARDIAN');
    });
  });

  describe('item 7 (FAM-7): a parent at 18', () => {
    let parent: U;
    let justAdult: U;
    let longAdult: U;

    beforeAll(async () => {
      parent = await person('adult-parent', new Date('1980-01-01'));
      justAdult = await child('fam-just-adult', [parent], { dob: yearsAgo(18, 5) });
      longAdult = await child('fam-long-adult', [parent], { dob: yearsAgo(18, 40) });
    });

    it('no longer books, gives consent or uses Kid Mode for their child', async () => {
      const cls = await mkClass();
      const book = await http().post(`/v1/classes/${cls.id}/book`).set(auth(parent)).send({ studentId: justAdult.id });
      expect(book.status).toBe(403);
      expect(book.body.error.code).toBe('CHILD_IS_ADULT');
      const consent = await http().post(`/v1/guardians/me/minors/${justAdult.id}/consent`).set(auth(parent)).send({ tier: 'CAMERA', policyVersion: POLICY });
      expect(consent.body.error.code).toBe('CHILD_IS_ADULT');
      const kidMode = await http().post(`/v1/guardians/me/minors/${justAdult.id}/booking-delegation`).set(auth(parent)).send({});
      expect(kidMode.body.error.code).toBe('CHILD_IS_ADULT');
    });

    it('still reads their bookings for 30 days, and is told when that ends', async () => {
      expect((await http().get(`/v1/guardians/me/minors/${justAdult.id}/bookings`).set(auth(parent))).status).toBe(200);
      const late = await http().get(`/v1/guardians/me/minors/${longAdult.id}/bookings`).set(auth(parent));
      expect(late.status).toBe(403);
      expect(late.body.error.code).toBe('CHILD_ADULT_ACCESS_ENDED');

      const minors = await http().get('/v1/guardians/me/minors').set(auth(parent));
      const row = minors.body.items.find((m: { studentId: string }) => m.studentId === justAdult.id);
      expect(row).toMatchObject({ isAdult: true });
      expect(row.parentAccessEndsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('item 9 (FAM-9): BASELINE consent', () => {
    let parent: U;
    let otherParent: U;
    let coach: U;

    beforeAll(async () => {
      parent = await person('consent-parent', new Date('1982-01-01'));
      otherParent = await person('consent-other', new Date('1983-01-01'));
      coach = await person('consent-coach', new Date('1980-01-01'), [{ role: 'INSTRUCTOR', schoolId: school.id }]);
    });

    it('a child without it cannot be booked or checked in; giving it unblocks both', async () => {
      const created = await http().post('/v1/guardians/me/minors').set(auth(parent)).send({ firstName: 'fam-pending', surname: 'Family', dateOfBirth: '2016-06-06' });
      expect(created.status).toBe(201);
      const kidId = created.body.studentId as string;
      expect((await http().get(`/v1/guardians/me/minors/${kidId}/consent`).set(auth(parent))).body.state).toBe('PENDING');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: kidId, schoolId: school.id } });
      await superuser.membership.create({ data: { id: randomUUID(), studentId: kidId, schoolId: school.id, membershipPlanId: subscriptionPlanId, frequency: 'RECURRING', status: 'ACTIVE' } });

      const cls = await mkClass();
      const refused = await http().post(`/v1/classes/${cls.id}/book`).set(auth(parent)).send({ studentId: kidId });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('CONSENT_PENDING');

      const soon = await mkClass({ startDate: at(10 * 60_000), endDate: at(HOUR) });
      await superuser.booking.create({ data: { id: randomUUID(), studentId: kidId, classId: soon.id, schoolId: school.id, status: 'UPCOMING' } });
      const checkIn = await http().post(`/v1/classes/${soon.id}/attendance-scan`).set(auth(coach)).send({ studentId: kidId });
      expect(checkIn.status).toBe(403);
      expect(checkIn.body.error.code).toBe('CONSENT_PENDING');

      const staffView = await http().get(`/v1/schools/${school.id}/students/${kidId}/guardians`).set(auth(owner));
      expect(staffView.body.consent).toBe('PENDING');

      expect((await http().post(`/v1/guardians/me/minors/${kidId}/consent`).set(auth(parent)).send({ tier: 'BASELINE', policyVersion: POLICY })).status).toBe(201);
      expect((await http().post(`/v1/classes/${cls.id}/book`).set(auth(parent)).send({ studentId: kidId })).status).toBe(201);
      expect((await http().post(`/v1/classes/${soon.id}/attendance-scan`).set(auth(coach)).send({ studentId: kidId })).status).toBe(201);
    });

    it('a child added with the consent ticked is ready at once', async () => {
      const created = await http().post('/v1/guardians/me/minors').set(auth(parent)).send({ firstName: 'fam-ready', surname: 'Family', dateOfBirth: '2016-07-07', consentPolicyVersion: POLICY });
      expect(created.status).toBe(201);
      expect((await http().get(`/v1/guardians/me/minors/${created.body.studentId}/consent`).set(auth(parent))).body.state).toBe('GIVEN');
      expect(await superuser.consentRecord.count({ where: { guardianId: parent.id, studentId: created.body.studentId, tier: 'BASELINE', policyVersion: POLICY } })).toBe(1);
    });

    it('a child already on ULTM8 before this rule keeps booking', async () => {
      const kid = await child('fam-grandfathered', [parent], { consent: false, grandfathered: true });
      const cls = await mkClass();
      expect((await http().post(`/v1/classes/${cls.id}/book`).set(auth(parent)).send({ studentId: kid.id })).status).toBe(201);
    });

    it('after a withdrawal the other parent is told, and re-enrolling needs fresh consent', async () => {
      const kid = await child('fam-withdrawn', [parent, otherParent], { consent: false });
      const given = await http().post(`/v1/guardians/me/minors/${kid.id}/consent`).set(auth(parent)).send({ tier: 'BASELINE', policyVersion: POLICY });
      expect(given.status).toBe(201);
      const stepUp = await http().post('/v1/auth/step-up/verify').set(auth(parent)).send({ passcode: PASSCODE });
      expect(stepUp.status).toBe(201);
      const withdrawn = await http().patch(`/v1/guardians/me/consent/${given.body.id}/withdraw`).set(auth(parent)).set('X-Step-Up-Token', stepUp.body.stepUpToken);
      expect(withdrawn.status).toBe(200);

      const rejoin = await http().post(`/v1/schools/${school.id}/join`).set(auth(parent)).send({ studentId: kid.id });
      expect(rejoin.status).toBe(403);
      expect(rejoin.body.error.code).toBe('CONSENT_WITHDRAWN');

      let told = 0;
      for (let i = 0; i < 40 && told === 0; i++) {
        told = await superuser.notification.count({ where: { userId: otherParent.id, title: 'Consent withdrawn' } });
        if (told === 0) await new Promise((r) => setTimeout(r, 250));
      }
      expect(told).toBe(1);
    });
  });

  describe('item 11 (FAM-11): another School\'s export', () => {
    it('lists a parent the School never dealt with by name only', async () => {
      const parent = await person('export-parent', new Date('1980-01-01'), [{ role: 'STUDENT', schoolId: school.id }]);
      const kid = await child('fam-export', [parent], { schoolIds: [school.id, otherSchool.id] });

      const here = await http().get(`/v1/schools/${school.id}/students/export`).set(auth(owner));
      expect(here.status).toBe(200);
      const hereRow = here.body.items.find((r: { id: string }) => r.id === kid.id);
      expect(hereRow.guardians).toEqual([expect.objectContaining({ email: parent.email })]);

      const there = await http().get(`/v1/schools/${otherSchool.id}/students/export`).set(auth(otherOwner));
      expect(there.status).toBe(200);
      const thereRow = there.body.items.find((r: { id: string }) => r.id === kid.id);
      expect(thereRow.guardians).toEqual([{ name: 'export-parent Family', email: null }]);
    });
  });

  describe('item 12 (FAM-12): a family that shares an email', () => {
    it('is told how to carry on, and the shared phone goes in Secondary phone', async () => {
      const existing = await person('shared-email', new Date('1980-01-01'));
      const refused = await http()
        .post(`/v1/schools/${school.id}/students/add-manually`)
        .set(auth(owner))
        .send({ firstName: 'Partner', surname: 'Family', email: existing.email, dateOfBirth: '1982-02-02' });
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('EMAIL_IN_USE');

      const added = await http()
        .post(`/v1/schools/${school.id}/students/add-manually`)
        .set(auth(owner))
        .send({ firstName: 'Partner', surname: 'Family', email: `${TAG}-partner@example.test`, dateOfBirth: '1982-02-02', secondaryPhone: '+447700900123' });
      expect(added.status).toBe(201);
      expect((await superuser.user.findUniqueOrThrow({ where: { email: `${TAG}-partner@example.test` } })).secondaryPhone).toBe('+447700900123');
    });
  });

  describe('item 13 (PRIV-2): name, birth date and gender are locked for staff once shared', () => {
    const patch = (studentId: string, body: Record<string, unknown>) => http().patch(`/v1/schools/${school.id}/students/${studentId}/profile`).set(auth(owner)).send(body);

    it('refuses a change for a child at another School too', async () => {
      const parent = await person('lock-parent', new Date('1980-01-01'), [], { mustChangePasscode: true });
      const kid = await child('fam-lock-two', [parent], { schoolIds: [school.id, otherSchool.id] });
      const res = await patch(kid.id, { firstName: 'Changed' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IDENTITY_SHARED');
      // Sending the same values back is not a change.
      expect((await patch(kid.id, { firstName: 'fam-lock-two', surname: 'Family' })).status).toBe(200);
      // Contacts are not locked.
      expect((await patch(kid.id, { secondaryEmail: `${TAG}-contact@example.test` })).status).toBe(200);
    });

    it('refuses a change for a child whose parent has signed in', async () => {
      const parent = await person('lock-signed-in', new Date('1980-01-01'));
      const kid = await child('fam-lock-signed', [parent]);
      const res = await patch(kid.id, { dateOfBirth: '2016-04-05' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IDENTITY_SHARED');
    });

    it('allows it while the person is this School\'s alone', async () => {
      const parent = await person('lock-new', new Date('1980-01-01'), [], { mustChangePasscode: true });
      const kid = await child('fam-lock-alone', [parent]);
      const res = await patch(kid.id, { firstName: 'Renamed' });
      expect(res.status).toBe(200);
      expect((await superuser.user.findUniqueOrThrow({ where: { id: kid.id } })).firstName).toBe('Renamed');
    });
  });
});
