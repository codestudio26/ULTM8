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
      await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_fixture' } })
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
      await superuser.membership.deleteMany({ where: { schoolId: id } });
      await superuser.membershipPlan.deleteMany({ where: { schoolId: id } });
      await superuser.studentMedicalInfo.deleteMany({ where: { schoolId: id } });
      await superuser.studentJoinDate.deleteMany({ where: { schoolId: id } });
      await superuser.staffActivity.deleteMany({ where: { schoolId: id } });
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
