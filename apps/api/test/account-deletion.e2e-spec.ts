/**
 * "Delete my account" (Decision 427 item 5; the product owner's six rules of
 * 6 Nov 2026). Asking needs a step-up proof; the main owner of an open School
 * can't ask; the account (and each child with no other parent and no login of
 * their own) is locked at once; signing in again within 30 days cancels; after
 * 30 days the account-erasure job anonymises it in place ("Erased User"),
 * keeping payments, waivers and grading history linked but unnamed, ends every
 * role and family link, and tells the School's owners. The permanent log holds
 * ids and dates only, and no app role can read it.
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
import { StripeClientService } from '../src/payments/stripe-client.service';
import { AccountErasureProcessor } from '../src/jobs/account-erasure.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { assertAccountNotClosing } from '../src/account-deletion/account-closing';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[account-deletion.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 3_600_000;
const TAG = `del-${randomUUID().slice(0, 8)}`;
const PASSCODE = '424242';
const MINOR_DOMAIN = 'guardian-managed.ultm8.internal';

type U = { id: string; email: string; token: string };

describeIfDb('Delete my account', () => {
  let app: INestApplication;
  let processor: AccountErasureProcessor;
  let prismaJobs: PrismaJobsService;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appRole = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jobsRole = new PrismaClient({ datasourceUrl: DATABASE_URL_JOBS });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const school = { id: randomUUID() };
  const closedSchool = { id: randomUUID() };
  let owner: U;
  let passcodeHash: string;
  let paymentAccountId: string;
  let subscriptionPlanId: string;
  const stripeUpdate = jest.fn();
  let stripeSpy: jest.SpyInstance;

  const http = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const sign = (id: string, email: string) => jwt.sign({ sub: id, email, grants: [] });

  async function person(label: string, opts: { email?: string; studentAt?: string[]; ownerAt?: string; mainOwner?: boolean } = {}): Promise<U> {
    const id = randomUUID();
    const email = opts.email ?? `${TAG}-${label}-${randomUUID().slice(0, 6)}@example.test`;
    await superuser.user.create({
      data: {
        id,
        email,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        phoneVerifiedAt: new Date(),
        firstName: label,
        surname: 'Member',
        passcodeHash,
        dateOfBirth: new Date('1990-05-05'),
        address: '1 High Street',
        emergencyContactName: 'Someone',
      },
    });
    for (const schoolId of opts.studentAt ?? []) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: id, schoolId } });
    }
    if (opts.ownerAt) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id, schoolId: opts.ownerAt, isMainOwner: opts.mainOwner ?? false } });
    }
    return { id, email, token: sign(id, email) };
  }

  async function child(label: string, parents: U[], ownLogin = false): Promise<U> {
    const c = await person(label, { email: ownLogin ? undefined : `minor+${randomUUID()}@${MINOR_DOMAIN}`, studentAt: [school.id] });
    for (const p of parents) await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: p.id, studentId: c.id } });
    return c;
  }

  async function stepUp(u: U): Promise<string> {
    const res = await http().post('/v1/auth/step-up/verify').set(auth(u)).send({ passcode: PASSCODE });
    expect(res.status).toBe(201);
    return res.body.stepUpToken as string;
  }

  async function requestDeletion(u: U) {
    const token = await stepUp(u);
    return http().post('/v1/users/me/deletion').set(auth(u)).set('x-step-up-token', token);
  }

  /** Moves a pending deletion's 30 days into the past. */
  const makeDue = (ids: string[]) => superuser.user.updateMany({ where: { id: { in: ids } }, data: { deletionDueAt: new Date(Date.now() - 1000) } });

  const logOf = (userId: string) => superuser.accountErasureLog.findMany({ where: { userId }, orderBy: { at: 'asc' }, select: { event: true, requestedById: true } });

  beforeAll(async () => {
    passcodeHash = await bcrypt.hash(PASSCODE, 4);
    stripeSpy = jest.spyOn(StripeClientService.prototype, 'scopedClient').mockReturnValue({ subscriptions: { update: stripeUpdate } } as never);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    processor = moduleRef.get(AccountErasureProcessor);
    prismaJobs = moduleRef.get(PrismaJobsService);

    await superuser.school.create({ data: { id: school.id, name: `${TAG} Dojo`, timezone: 'UTC' } });
    await superuser.school.create({ data: { id: closedSchool.id, name: `${TAG} Closed`, timezone: 'UTC', archivedAt: new Date() } });
    paymentAccountId = (
      await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeAccountReady: true, stripeConnectedAccountId: 'acct_fixture' } })
    ).id;
    subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000 } })).id;
    owner = await person('owner', { ownerAt: school.id, mainOwner: true });
  });

  beforeEach(() => {
    stripeUpdate.mockReset();
    stripeUpdate.mockResolvedValue({ cancel_at: Math.floor((Date.now() + 20 * DAY) / 1000), items: { data: [] } });
  });

  afterAll(async () => {
    stripeSpy.mockRestore();
    const users = (
      await superuser.user.findMany({ where: { OR: [{ email: { contains: TAG } }, { surname: 'Member' }, { email: { startsWith: 'erased+' } }] }, select: { id: true } })
    ).map((u) => u.id);
    const minors = (await superuser.guardianLink.findMany({ where: { guardianId: { in: users } }, select: { studentId: true } })).map((l) => l.studentId);
    const everyone = [...new Set([...users, ...minors])];
    await superuser.accountErasureLog.deleteMany({ where: { userId: { in: everyone } } });
    await superuser.notification.deleteMany({ where: { userId: { in: everyone } } });
    for (const id of [school.id, closedSchool.id]) {
      await superuser.waiverSignature.deleteMany({ where: { schoolId: id } });
      await superuser.waiver.deleteMany({ where: { schoolId: id } });
      await superuser.transaction.deleteMany({ where: { schoolId: id } });
      await superuser.recurringCharge.deleteMany({ where: { schoolId: id } });
      await superuser.waitlistEntry.deleteMany({ where: { schoolId: id } });
      await superuser.booking.deleteMany({ where: { schoolId: id } });
      await superuser.class.deleteMany({ where: { schoolId: id } });
      await superuser.studentNote.deleteMany({ where: { schoolId: id } });
      await superuser.memberFile.deleteMany({ where: { schoolId: id } });
      await superuser.customMemberFieldValue.deleteMany({ where: { schoolId: id } });
      await superuser.customMemberField.deleteMany({ where: { schoolId: id } });
      await superuser.studentTag.deleteMany({ where: { schoolId: id } });
      await superuser.schoolTag.deleteMany({ where: { schoolId: id } });
      await superuser.studentCustomStatus.deleteMany({ where: { schoolId: id } });
      await superuser.customMemberStatus.deleteMany({ where: { schoolId: id } });
      await superuser.dataImportRow.deleteMany({ where: { import: { schoolId: id } } });
      await superuser.dataImport.deleteMany({ where: { schoolId: id } });
      await superuser.childInvite.deleteMany({ where: { schoolId: id } });
      await superuser.coachInvite.deleteMany({ where: { schoolId: id } });
      await superuser.notification.deleteMany({ where: { schoolId: id } });
      await superuser.membership.deleteMany({ where: { schoolId: id } });
      await superuser.membershipPlan.deleteMany({ where: { schoolId: id } });
      await superuser.studentMedicalInfo.deleteMany({ where: { schoolId: id } });
      await superuser.studentJoinDate.deleteMany({ where: { schoolId: id } });
      await superuser.staffActivity.deleteMany({ where: { schoolId: id } });
      await superuser.staffPermission.deleteMany({ where: { schoolId: id } });
      await superuser.instructor.deleteMany({ where: { schoolId: id } });
      await superuser.paymentAccount.deleteMany({ where: { schoolId: id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: id } });
    }
    await superuser.consentRecord.deleteMany({ where: { OR: [{ guardianId: { in: everyone } }, { studentId: { in: everyone } }] } });
    await superuser.guardianLink.deleteMany({ where: { OR: [{ guardianId: { in: everyone } }, { studentId: { in: everyone } }] } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: everyone } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: everyone } } });
    await superuser.user.deleteMany({ where: { id: { in: everyone } } });
    await superuser.school.deleteMany({ where: { id: { in: [school.id, closedSchool.id] } } });
    await app?.close();
    await Promise.all([superuser.$disconnect(), appRole.$disconnect(), jobsRole.$disconnect()]);
  });

  it('asking needs a fresh step-up proof', async () => {
    const m = await person('nostepup', { studentAt: [school.id] });
    const res = await http().post('/v1/users/me/deletion').set(auth(m));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await superuser.user.findUniqueOrThrow({ where: { id: m.id } })).deletionRequestedAt).toBeNull();
  });

  it("the main owner of an open School can't ask; a co-owner, or the main owner of a closed School, can", async () => {
    const preview = await http().get('/v1/users/me/deletion').set(auth(owner));
    expect(preview.status).toBe(200);
    expect(preview.body.blockedBy).toEqual([{ kind: 'SCHOOL', id: school.id, name: `${TAG} Dojo` }]);
    const refused = await requestDeletion(owner);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('MAIN_OWNER_MUST_HAND_OVER');
    expect((await superuser.user.findUniqueOrThrow({ where: { id: owner.id } })).deletionRequestedAt).toBeNull();

    const coOwner = await person('coowner', { ownerAt: school.id });
    expect((await http().get('/v1/users/me/deletion').set(auth(coOwner))).body.blockedBy).toEqual([]);
    const closedOwner = await person('closedowner', { ownerAt: closedSchool.id, mainOwner: true });
    expect((await http().get('/v1/users/me/deletion').set(auth(closedOwner))).body.blockedBy).toEqual([]);
    expect((await requestDeletion(closedOwner)).status).toBe(200);
  });

  it('locks the account at once, stops its Subscriptions, and signing in again cancels it', async () => {
    const m = await person('locked', { studentAt: [school.id] });
    const sub = await superuser.membership.create({
      data: { id: randomUUID(), studentId: m.id, schoolId: school.id, membershipPlanId: subscriptionPlanId, status: 'ACTIVE', frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}` },
    });
    const recurring = await superuser.recurringCharge.create({
      data: { id: randomUUID(), schoolId: school.id, studentId: m.id, description: 'Locker', unitAmount: 1000, currency: 'GBP', frequency: 'MONTHLY', firstDate: new Date(), nextDate: new Date() },
    });
    const login = await http().post('/v1/auth/login').send({ email: m.email, passcode: PASSCODE });
    expect(login.status).toBe(201);
    expect(login.body.deletionCancelled).toBeUndefined();
    const session = { ...m, token: login.body.accessToken as string };

    const res = await requestDeletion(session);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: true, graceDays: 30, blockedBy: [], childrenDeleted: [], childrenKept: [] });
    const due = new Date(res.body.dueAt).getTime() - new Date(res.body.requestedAt).getTime();
    expect(due).toBe(30 * DAY);
    expect(stripeUpdate).toHaveBeenCalledWith(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    expect((await superuser.membership.findUniqueOrThrow({ where: { id: sub.id } })).cancelAt).not.toBeNull();
    expect(await superuser.recurringCharge.findUniqueOrThrow({ where: { id: recurring.id } })).toMatchObject({ stoppedReason: 'STUDENT_LEFT' });

    // Locked: every session refused, the refresh token revoked.
    const blocked = await http().get('/v1/users/me').set(auth(session));
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect((await http().post('/v1/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401);
    // Bookings, check-ins and purchases made for them are refused too.
    await expect(assertAccountNotClosing(prismaJobs, m.id)).rejects.toMatchObject({ response: { code: 'ACCOUNT_CLOSING' } });
    expect(await logOf(m.id)).toEqual([{ event: 'REQUESTED', requestedById: m.id }]);

    // Signing in again within the 30 days cancels.
    const back = await http().post('/v1/auth/login').send({ email: m.email, passcode: PASSCODE });
    expect(back.status).toBe(201);
    expect(back.body.deletionCancelled).toBe(true);
    expect(await superuser.user.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ deletionRequestedAt: null, deletionDueAt: null, deletionRequestedById: null, erasedAt: null });
    expect((await http().get('/v1/users/me').set({ Authorization: `Bearer ${back.body.accessToken}` })).status).toBe(200);
    expect((await logOf(m.id)).map((l) => l.event)).toEqual(['REQUESTED', 'CANCELLED']);
    await expect(assertAccountNotClosing(prismaJobs, m.id)).resolves.toBeUndefined();
  });

  it("names the children deleted with a parent: not one with another parent, nor one with their own login; the parent's sign-in brings them back", async () => {
    const parent = await person('parent');
    const coParent = await person('coparent');
    const only = await child('onlyme', [parent]);
    const shared = await child('shared', [parent, coParent]);
    const grown = await child('ownlogin', [parent], true);

    const preview = await http().get('/v1/users/me/deletion').set(auth(parent));
    expect(preview.body.childrenDeleted).toEqual([{ studentId: only.id, firstName: 'onlyme', surname: 'Member' }]);
    expect(preview.body.childrenKept).toEqual(
      expect.arrayContaining([
        { studentId: shared.id, firstName: 'shared', surname: 'Member', reason: 'OTHER_PARENT' },
        { studentId: grown.id, firstName: 'ownlogin', surname: 'Member', reason: 'OWN_LOGIN' },
      ]),
    );

    const childSub = await superuser.membership.create({
      data: { id: randomUUID(), studentId: only.id, schoolId: school.id, membershipPlanId: subscriptionPlanId, status: 'ACTIVE', frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}` },
    });
    const res = await requestDeletion(parent);
    expect(res.status).toBe(200);
    expect(res.body.childrenDeleted).toEqual([{ studentId: only.id, firstName: 'onlyme', surname: 'Member' }]);
    // The child's own Subscription stops too.
    expect(stripeUpdate).toHaveBeenCalledWith(childSub.stripeSubscriptionId, { cancel_at_period_end: true });
    expect((await superuser.membership.findUniqueOrThrow({ where: { id: childSub.id } })).cancelledById).toBe(parent.id);
    expect((await superuser.user.findUniqueOrThrow({ where: { id: only.id } })).deletionRequestedById).toBe(parent.id);
    expect((await superuser.user.findUniqueOrThrow({ where: { id: shared.id } })).deletionRequestedAt).toBeNull();
    expect((await superuser.user.findUniqueOrThrow({ where: { id: grown.id } })).deletionRequestedAt).toBeNull();
    expect(await logOf(only.id)).toEqual([{ event: 'REQUESTED', requestedById: parent.id }]);
    // A parent whose own deletion is pending doesn't count as the child's other parent.
    expect((await http().get('/v1/users/me/deletion').set(auth(coParent))).body.childrenDeleted).toEqual([{ studentId: shared.id, firstName: 'shared', surname: 'Member' }]);

    const back = await http().post('/v1/auth/login').send({ email: parent.email, passcode: PASSCODE });
    expect(back.body.deletionCancelled).toBe(true);
    expect((await superuser.user.findUniqueOrThrow({ where: { id: only.id } })).deletionRequestedAt).toBeNull();
    expect((await logOf(only.id)).map((l) => l.event)).toEqual(['REQUESTED', 'CANCELLED']);
  });

  it('after 30 days the job anonymises the member and their only child, keeps the records unnamed, ends roles and links, and tells the School', async () => {
    const parent = await person('erasee', { studentAt: [school.id] });
    const coParent = await person('stays');
    const only = await child('gone', [parent]);
    const shared = await child('kept', [parent, coParent]);
    await superuser.studentMedicalInfo.create({ data: { id: randomUUID(), schoolId: school.id, studentId: parent.id, body: 'Asthma', consentedAt: new Date() } });
    const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Text' } });
    const own = await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: waiver.id, studentId: parent.id, signedById: parent.id, schoolId: school.id, status: 'SIGNED', signerFullName: 'erasee Member', signatureText: 'erasee Member', signedDate: new Date() },
    });
    const forChild = await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: waiver.id, studentId: shared.id, signedById: parent.id, schoolId: school.id, status: 'SIGNED', signerFullName: 'erasee Member', signatureText: 'erasee Member', signedDate: new Date() },
    });
    const byCoParent = await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: waiver.id, studentId: only.id, signedById: coParent.id, schoolId: school.id, status: 'SIGNED', signerFullName: 'stays Member', signatureText: 'stays Member', signedDate: new Date() },
    });
    const tx = await superuser.transaction.create({
      data: { id: randomUUID(), schoolId: school.id, studentId: parent.id, paymentAccountId, amount: 5000, status: 'SUCCESSFUL', paymentMethod: 'STRIPE' },
    });

    expect((await requestDeletion(parent)).status).toBe(200);
    // Not due yet: the job and the function leave it alone.
    expect((await processor.sweep()).erased).not.toContain(parent.id);
    const early = await jobsRole.$queryRaw<Array<{ erased: boolean }>>`SELECT erased FROM "erase_due_account"(${parent.id}, ${'x'})`;
    expect(early[0].erased).toBe(false);

    await makeDue([parent.id, only.id]);
    const result = await processor.sweep();
    expect(result.erased).toEqual(expect.arrayContaining([parent.id, only.id]));

    const erased = await superuser.user.findUniqueOrThrow({ where: { id: parent.id } });
    expect(erased).toMatchObject({
      firstName: 'Erased',
      surname: 'User',
      email: `erased+${parent.id}@erased.ultm8.internal`,
      phone: null,
      dateOfBirth: null,
      address: null,
      emergencyContactName: null,
      profilePhotoUrl: null,
    });
    expect(erased.erasedAt).not.toBeNull();
    expect(await bcrypt.compare(PASSCODE, erased.passcodeHash)).toBe(false);
    expect((await superuser.user.findUniqueOrThrow({ where: { id: only.id } })).firstName).toBe('Erased');
    // The child with another parent stays, without this parent's link.
    expect((await superuser.user.findUniqueOrThrow({ where: { id: shared.id } })).firstName).toBe('kept');
    expect((await superuser.guardianLink.findFirstOrThrow({ where: { guardianId: parent.id, studentId: shared.id } })).revokedAt).not.toBeNull();
    expect((await superuser.guardianLink.findFirstOrThrow({ where: { guardianId: coParent.id, studentId: shared.id } })).revokedAt).toBeNull();
    // Roles end; medical notes go; records stay, linked but unnamed.
    expect(await superuser.roleGrant.count({ where: { userId: { in: [parent.id, only.id] }, revokedAt: null } })).toBe(0);
    expect(await superuser.studentMedicalInfo.count({ where: { studentId: parent.id } })).toBe(0);
    expect(await superuser.transaction.findUniqueOrThrow({ where: { id: tx.id } })).toMatchObject({ studentId: parent.id, amount: 5000 });
    expect(await superuser.waiverSignature.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ signerFullName: 'Erased User', signatureText: 'Erased User', status: 'SIGNED' });
    expect((await superuser.waiverSignature.findUniqueOrThrow({ where: { id: forChild.id } })).signerFullName).toBe('Erased User');
    expect((await superuser.waiverSignature.findUniqueOrThrow({ where: { id: byCoParent.id } })).signerFullName).toBe('stays Member');
    expect((await logOf(parent.id)).map((l) => l.event)).toEqual(['REQUESTED', 'ERASED']);

    // They can't sign in again.
    expect((await http().post('/v1/auth/login').send({ email: parent.email, passcode: PASSCODE })).status).toBe(401);
    // A second run changes nothing.
    expect((await processor.sweep()).erased).not.toContain(parent.id);

    // The School's owner is told, without a name.
    let notice: { title: string; body: string } | null = null;
    for (let i = 0; i < 50 && !notice; i++) {
      notice = await superuser.notification.findFirst({ where: { userId: owner.id, type: 'MEMBER_LEFT' }, select: { title: true, body: true } });
      if (!notice) await new Promise((r) => setTimeout(r, 200));
    }
    expect(notice).toEqual({
      title: 'A member left',
      body: 'A member deleted their ULTM8 account and left your School. Their details have been removed. Their payments, waivers and belt history stay with your School under "Erased User".',
    });
  });

  it('at the end, gives up their bookings and waitlist places (no fee, no notice) and clears the rest of their personal data', async () => {
    const m = await person('Zelda', { studentAt: [school.id] });
    const fullName = 'Zelda Member';
    const at = (h: number) => new Date(Date.now() + h * 3_600_000);
    const pack = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Ten', price: 9000, classesIncluded: 10 } });
    const credits = await superuser.membership.create({
      data: { id: randomUUID(), studentId: m.id, schoolId: school.id, membershipPlanId: pack.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 4 },
    });
    const future = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Erasure future', startDate: at(72), endDate: at(73) } });
    const full = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Erasure full', startDate: at(80), endDate: at(81) } });
    const past = await superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Erasure past', startDate: at(-30), endDate: at(-29) } });
    const upcoming = await superuser.booking.create({ data: { id: randomUUID(), studentId: m.id, classId: future.id, schoolId: school.id, sourceMembershipId: credits.id, creditUsed: true } });
    const attended = await superuser.booking.create({ data: { id: randomUUID(), studentId: m.id, classId: past.id, schoolId: school.id, status: 'COMPLETED', checkInMethod: 'STAFF_LOGGED' } });
    const waiting = await superuser.waitlistEntry.create({ data: { id: randomUUID(), studentId: m.id, classId: full.id, schoolId: school.id, position: 1 } });

    await superuser.studentNote.create({ data: { id: randomUUID(), schoolId: school.id, studentId: m.id, body: 'Knee injury' } });
    const field = await superuser.customMemberField.create({ data: { id: randomUUID(), schoolId: school.id, name: 'T-shirt', type: 'TEXT', position: 0 } });
    await superuser.customMemberFieldValue.create({ data: { fieldId: field.id, schoolId: school.id, studentId: m.id, value: 'XL' } });
    const tag = await superuser.schoolTag.create({ data: { id: randomUUID(), schoolId: school.id, name: `${TAG}-tag` } });
    await superuser.studentTag.create({ data: { tagId: tag.id, schoolId: school.id, studentId: m.id } });
    const status = await superuser.customMemberStatus.create({ data: { id: randomUUID(), schoolId: school.id, name: 'VIP' } });
    await superuser.studentCustomStatus.create({ data: { schoolId: school.id, statusId: status.id, studentId: m.id } });
    const imp = await superuser.dataImport.create({ data: { id: randomUUID(), schoolId: school.id, kind: 'MEMBERS', totalRows: 1 } });
    await superuser.dataImportRow.create({ data: { importId: imp.id, rowNumber: 1, outcome: 'CREATED', studentId: m.id, phone: '+15550001111' } });
    await superuser.childInvite.create({ data: { id: randomUUID(), schoolId: school.id, guardianId: m.id, childFirstName: 'Kid', childSurname: 'Member', childDateOfBirth: new Date('2018-01-01') } });
    await superuser.coachInvite.create({ data: { id: randomUUID(), schoolId: school.id, email: m.email, tokenHash: randomUUID(), expiresAt: at(48) } });
    const file = await superuser.memberFile.create({
      data: { id: randomUUID(), schoolId: school.id, studentId: m.id, fileName: 'id.pdf', contentType: 'application/pdf', sizeBytes: 10, objectKey: `member-files/${randomUUID()}.pdf` },
    });
    const activity = await superuser.staffActivity.create({
      data: { id: randomUUID(), schoolId: school.id, actorId: owner.id, targetUserId: m.id, action: 'GUARDIAN_REMOVED', details: { studentName: fullName, guardianName: 'owner Member' } },
    });
    const staffNotice = await superuser.notification.create({
      data: { id: randomUUID(), userId: owner.id, schoolId: school.id, title: 'Member absent', body: `${fullName} hasn't checked in for 3 weeks.` },
    });
    const unrelated = await superuser.notification.create({ data: { id: randomUUID(), userId: owner.id, title: 'Note', body: `${fullName} elsewhere` } });
    const deleteObject = jest.spyOn(R2ClientService.prototype, 'deleteObject').mockResolvedValue(undefined);

    expect((await requestDeletion(m)).status).toBe(200);
    // Nothing is given up while the deletion can still be cancelled.
    expect((await superuser.booking.findUniqueOrThrow({ where: { id: upcoming.id } })).status).toBe('UPCOMING');
    await makeDue([m.id]);
    expect((await processor.sweep()).erased).toContain(m.id);

    // Places: cancelled with the staff-cancel credit rule, no fee, no notice to them.
    expect(await superuser.booking.findUniqueOrThrow({ where: { id: upcoming.id } })).toMatchObject({ status: 'CANCELLED', refundResolution: 'REFUNDED', resolvedById: m.id });
    expect((await superuser.membership.findUniqueOrThrow({ where: { id: credits.id } })).classesRemaining).toBe(5);
    expect((await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe('CANCELLED');
    expect(await superuser.notification.count({ where: { userId: m.id } })).toBe(0);
    // Attendance history stays, linked to "Erased User".
    expect(await superuser.booking.findUniqueOrThrow({ where: { id: attended.id } })).toMatchObject({ status: 'COMPLETED', studentId: m.id });

    // The rest of their personal data.
    expect(await superuser.studentNote.count({ where: { studentId: m.id } })).toBe(0);
    expect(await superuser.customMemberFieldValue.count({ where: { studentId: m.id } })).toBe(0);
    expect(await superuser.studentTag.count({ where: { studentId: m.id } })).toBe(0);
    expect(await superuser.studentCustomStatus.count({ where: { studentId: m.id } })).toBe(0);
    expect(await superuser.dataImportRow.count({ where: { studentId: m.id } })).toBe(0);
    expect(await superuser.childInvite.count({ where: { guardianId: m.id } })).toBe(0);
    expect(await superuser.coachInvite.count({ where: { email: m.email } })).toBe(0);
    expect(deleteObject).toHaveBeenCalledWith(file.objectKey);
    expect(await superuser.memberFile.count({ where: { id: file.id } })).toBe(0);
    expect((await superuser.staffActivity.findUniqueOrThrow({ where: { id: activity.id } })).details).toEqual({ studentName: 'Erased User', guardianName: 'owner Member' });
    expect((await superuser.notification.findUniqueOrThrow({ where: { id: staffNotice.id } })).body).toBe("Erased User hasn't checked in for 3 weeks.");
    // A notice from no School of theirs is left alone.
    expect((await superuser.notification.findUniqueOrThrow({ where: { id: unrelated.id } })).body).toBe(`${fullName} elsewhere`);
    deleteObject.mockRestore();
  });

  it("round 6 P-1: an erased coach's coach profile loses its phone, bio and photo (the file too) and is archived, so members no longer see it", async () => {
    const coach = await person('Coachy', { studentAt: [school.id] });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id } });
    const photoUrl = `${process.env.R2_PUBLIC_BASE_URL}/instructors/${randomUUID()}.jpg`;
    const profilePhotoUrl = `${process.env.R2_PUBLIC_BASE_URL}/users/${randomUUID()}.jpg`;
    await superuser.user.update({ where: { id: coach.id }, data: { profilePhotoUrl } });
    const profile = await superuser.instructor.create({
      data: { id: randomUUID(), schoolId: school.id, userId: coach.id, phone: '+447911123987', bio: 'Coachy trains in Leeds.', photoUrl },
    });
    // Another coach at the School is left alone.
    const other = await person('Stays', { studentAt: [school.id] });
    const otherProfile = await superuser.instructor.create({ data: { id: randomUUID(), schoolId: school.id, userId: other.id, phone: '+447911000111', bio: 'Stays here.' } });
    const member = await person('Watcher', { studentAt: [school.id] });
    const listFor = async (u: U) => (await http().get(`/v1/schools/${school.id}/instructors`).set(auth(u))).body.items as Array<{ id: string }>;
    expect((await listFor(member)).map((i) => i.id)).toContain(profile.id);
    const deletePhoto = jest.spyOn(R2ClientService.prototype, 'deletePublicPhotoByUrl').mockResolvedValue(true);

    expect((await requestDeletion(coach)).status).toBe(200);
    await makeDue([coach.id]);
    expect((await processor.sweep()).erased).toContain(coach.id);

    const after = await superuser.instructor.findUniqueOrThrow({ where: { id: profile.id } });
    expect(after).toMatchObject({ phone: null, bio: null, photoUrl: null });
    expect(after.archivedAt).not.toBeNull();
    expect(after.purgeAt!.getTime()).toBeGreaterThan(Date.now() + 89 * DAY);
    expect(deletePhoto).toHaveBeenCalledWith(photoUrl);
    expect(deletePhoto).toHaveBeenCalledWith(profilePhotoUrl);
    expect(await superuser.instructor.findUniqueOrThrow({ where: { id: otherProfile.id } })).toMatchObject({ phone: '+447911000111', bio: 'Stays here.', archivedAt: null });

    // Members no longer see it in the list; the profile itself names nobody.
    const list = await listFor(member);
    expect(list.map((i) => i.id)).not.toContain(profile.id);
    expect(list.map((i) => i.id)).toContain(otherProfile.id);
    const one = await http().get(`/v1/instructors/${profile.id}`).set(auth(member));
    expect(JSON.stringify(one.body)).not.toMatch(/Coachy|123987|instructors\//);
    deletePhoto.mockRestore();
  });

  it("round 6 P-4: an erased staff member's School display name and work phone are cleared, and the phone leaves the staff activity log", async () => {
    const staff = await person('Wesley', { studentAt: [school.id] });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id } });
    const set = await http()
      .patch(`/v1/schools/${school.id}/staff/${staff.id}/details`)
      .set(auth(owner))
      .send({ displayName: 'Wes the Desk', workPhone: '+447911123654' });
    expect(set.status).toBe(200);
    const line = await superuser.staffActivity.findFirstOrThrow({ where: { schoolId: school.id, targetUserId: staff.id, action: 'DETAILS_CHANGED' } });
    expect(line.details).toEqual({ displayName: 'Wes the Desk', workPhone: '+447911123654' });
    // A "details changed" line about someone else keeps its phone.
    const otherLine = await superuser.staffActivity.create({
      data: { id: randomUUID(), schoolId: school.id, actorId: owner.id, targetUserId: owner.id, action: 'DETAILS_CHANGED', details: { workPhone: '+447911000222' } },
    });

    expect((await requestDeletion(staff)).status).toBe(200);
    await makeDue([staff.id]);
    expect((await processor.sweep()).erased).toContain(staff.id);

    expect(await superuser.staffPermission.findUniqueOrThrow({ where: { schoolId_userId: { schoolId: school.id, userId: staff.id } } })).toMatchObject({ displayName: null, workPhone: null });
    expect((await superuser.staffActivity.findUniqueOrThrow({ where: { id: line.id } })).details).toEqual({ displayName: 'Erased User' });
    expect((await superuser.staffActivity.findUniqueOrThrow({ where: { id: otherLine.id } })).details).toEqual({ workPhone: '+447911000222' });
    for (const path of ['staff', 'staff/activity']) {
      const res = await http().get(`/v1/schools/${school.id}/${path}`).set(auth(owner));
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/123654|Wes the Desk|Wesley/);
    }
  });

  it('keeps a child who got another parent before the 30 days were over', async () => {
    const parent = await person('leaver');
    const kid = await child('rescued', [parent]);
    expect((await requestDeletion(parent)).body.childrenDeleted).toHaveLength(1);
    const newParent = await person('newparent');
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: newParent.id, studentId: kid.id } });
    await makeDue([parent.id, kid.id]);
    const result = await processor.sweep();
    expect(result.erased).toContain(parent.id);
    expect(result.kept).toContain(kid.id);
    expect(await superuser.user.findUniqueOrThrow({ where: { id: kid.id } })).toMatchObject({ firstName: 'rescued', deletionRequestedAt: null, erasedAt: null });
    expect((await logOf(kid.id)).map((l) => l.event)).toEqual(['REQUESTED', 'KEPT']);
  });

  it('the log is write-only for the jobs role and unreadable by the app role; the app role cannot run the erasure', async () => {
    await expect(appRole.accountErasureLog.findMany()).rejects.toThrow();
    await expect(jobsRole.accountErasureLog.findMany()).rejects.toThrow();
    await expect(appRole.$queryRaw`SELECT erased FROM "erase_due_account"(${randomUUID()}, ${'x'})`).rejects.toThrow();
  });
});
