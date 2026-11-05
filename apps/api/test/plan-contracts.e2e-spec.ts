import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';

/**
 * Decision 316 item 6 — contracts on plans: the owner writes the contract and
 * its terms on a plan, the member (a Guardian for a child) signs it in the app
 * just before buying, a purchase needs a fresh signature of the current
 * version, and cancelling a Subscription before the signed minimum term ends
 * puts the signed early-exit fee on the member's balance. Stripe is stubbed
 * for the cancel calls; everything else runs against a real Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[plan-contracts.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;

describeIfDb('Contracts on plans (Decision 316 item 6)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let owner: { id: string; email: string };
  let tokenOwner: string;
  let tokenStaff: string;
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const periodEnd = new Date(Math.floor((Date.now() + 20 * DAY) / 1000) * 1000);

  const sign = (user: { id: string; email: string }, grants: Array<Record<string, unknown>>) => jwt.sign({ sub: user.id, email: user.email, grants });

  async function mkUser(label: string, dateOfBirth = new Date('1990-01-01')) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `plan-contracts-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Contract',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkStudent(label: string, schoolId = school.id, dateOfBirth?: Date) {
    const user = await mkUser(label, dateOfBirth);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    return { user, token: sign(user, [{ role: 'STUDENT', franchiseId: null, schoolId, branchId: null }]) };
  }

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setContract = (planId: string, body: Record<string, unknown>, token = tokenOwner) =>
    http().put(`/v1/membership-plans/${planId}/contract`).set(auth(token)).send(body);
  const signContract = (planId: string, token: string, body: Record<string, unknown> = {}) =>
    http()
      .post(`/v1/membership-plans/${planId}/contract/sign`)
      .set(auth(token))
      .send({ signerFullName: 'Pat Member', signatureText: 'Pat Member', contractVersion: 1, ...body });
  const purchase = (planId: string, token: string, body: Record<string, unknown> = {}) =>
    http().post(`/v1/membership-plans/${planId}/purchase`).set(auth(token)).send(body);

  async function mkPlan(schoolId: string, body: Record<string, unknown>) {
    return superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId, title: `Plan ${randomUUID().slice(0, 6)}`, price: 4000, currency: 'GBP', ...body } as never,
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    const stripeCancel = jest.fn().mockResolvedValue({ cancel_at: Math.floor(periodEnd.getTime() / 1000), items: { data: [] } });
    jest.spyOn(app.get(StripeClientService), 'scopedClient').mockReturnValue({ subscriptions: { update: stripeCancel } } as never);

    // A Cash School: a contract plan can be bought end to end without Stripe.
    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Contracts School', defaultCurrency: 'GBP' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Contracts School', defaultCurrency: 'GBP' } });
    schoolIds.push(school.id, otherSchool.id);
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_fixture' },
    });
    owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    tokenOwner = sign(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    const staff = await mkUser('staff');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id } });
    tokenStaff = sign(staff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.balanceEntry.deleteMany({ where });
    await superuser.chargeAllocation.deleteMany({ where });
    await superuser.charge.deleteMany({ where });
    await superuser.planContractSignature.deleteMany({ where });
    await superuser.transaction.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('the owner writes the contract', () => {
    it('sets a contract with a minimum term and fee on a Subscription; every change is a new version; removing clears it', async () => {
      const plan = await mkPlan(school.id, { type: 'SUBSCRIPTION' });
      const set = await setContract(plan.id, { body: '  12 months, then monthly.  ', minimumTermMonths: 12, earlyExitFee: 5000 });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ contractBody: '12 months, then monthly.', contractMinimumTermMonths: 12, contractEarlyExitFee: 5000, contractVersion: 1 });
      // Saving the same terms again changes nothing.
      expect((await setContract(plan.id, { body: '12 months, then monthly.', minimumTermMonths: 12, earlyExitFee: 5000 })).body.contractVersion).toBe(1);
      expect((await setContract(plan.id, { body: '12 months, then monthly.', minimumTermMonths: 6, earlyExitFee: 5000 })).body.contractVersion).toBe(2);
      const removed = await setContract(plan.id, { body: null });
      expect(removed.body).toMatchObject({ contractBody: null, contractMinimumTermMonths: null, contractEarlyExitFee: null, contractVersion: null });
    });

    it('a minimum term or fee is for a Subscription only; a fee needs a term; a Friend Pass has no contract', async () => {
      const pack = await mkPlan(school.id, { type: 'CLASS_PACK', classesIncluded: 10 });
      expect((await setContract(pack.id, { body: 'Terms', minimumTermMonths: 3 })).status).toBe(400);
      expect((await setContract(pack.id, { body: 'Terms' })).status).toBe(200);
      const sub = await mkPlan(school.id, { type: 'SUBSCRIPTION' });
      expect((await setContract(sub.id, { body: 'Terms', earlyExitFee: 1000 })).status).toBe(400);
      const friend = await mkPlan(school.id, { type: 'FRIEND_PASS', price: 0, classesIncluded: 1 });
      expect((await setContract(friend.id, { body: 'Terms' })).status).toBe(400);
    });

    it('only the owner sets it: Branch Staff, a Student and another School are refused', async () => {
      const plan = await mkPlan(school.id, { type: 'SUBSCRIPTION' });
      expect((await setContract(plan.id, { body: 'Terms' }, tokenStaff)).status).toBe(403);
      const { token } = await mkStudent('setter');
      expect([403, 404]).toContain((await setContract(plan.id, { body: 'Terms' }, token)).status);
      const outsider = await mkUser('outsider-owner');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: outsider.id, schoolId: otherSchool.id } });
      const tokenOutsider = sign(outsider, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: otherSchool.id, branchId: null }]);
      expect((await setContract(plan.id, { body: 'Terms' }, tokenOutsider)).status).toBe(404);
    });

    it("a plan type change can't leave a minimum term on a non-Subscription plan", async () => {
      const plan = await mkPlan(school.id, { type: 'SUBSCRIPTION' });
      await setContract(plan.id, { body: 'Terms', minimumTermMonths: 12 });
      const res = await http().patch(`/v1/membership-plans/${plan.id}`).set(auth(tokenOwner)).send({ type: 'CLASS_PACK', classesIncluded: 5 });
      expect(res.status).toBe(400);
    });
  });

  describe('the member signs, then buys', () => {
    it('reads the contract, signs its current version with a copy of the text and its hash, and buys with that signature once', async () => {
      const plan = await mkPlan(school.id, { type: 'CLASS_PACK', classesIncluded: 10, expiryDurationDays: 90 });
      await setContract(plan.id, { body: 'Ten classes within 90 days. No refunds.' });
      const { user, token } = await mkStudent('buyer');

      const read = await http().get(`/v1/membership-plans/${plan.id}/contract`).set(auth(token));
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ body: 'Ten classes within 90 days. No refunds.', version: 1, minimumTermMonths: null, currency: 'GBP' });

      // No signature: refused before any order is made.
      expect((await purchase(plan.id, token)).status).toBe(400);
      expect(await superuser.transaction.count({ where: { studentId: user.id } })).toBe(0);

      const signed = await signContract(plan.id, token);
      expect(signed.status).toBe(200);
      const row = await superuser.planContractSignature.findUniqueOrThrow({ where: { id: signed.body.id } });
      expect(row).toMatchObject({ studentId: user.id, signedById: user.id, contractBody: 'Ten classes within 90 days. No refunds.', contractVersion: 1, usedAt: null });
      expect(row.contractSha256).toMatch(/^[0-9a-f]{64}$/);

      const bought = await purchase(plan.id, token, { contractSignatureId: signed.body.id });
      expect(bought.status).toBe(201);
      expect(bought.body.outcome).toBe('pending_confirmation');
      const used = await superuser.planContractSignature.findUniqueOrThrow({ where: { id: signed.body.id } });
      expect(used.usedAt).not.toBeNull();
      expect(used.transactionId).toBe(bought.body.transactionId);

      // The owner sees it on the Student; the plan's later edits don't change it.
      await setContract(plan.id, { body: 'New wording.' });
      const list = await http().get(`/v1/schools/${school.id}/students/${user.id}/plan-contracts`).set(auth(tokenOwner));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ contractBody: 'Ten classes within 90 days. No refunds.', contractVersion: 1, used: true });
    });

    it('a signature is for one purchase, of the version signed, by the member who signed it', async () => {
      const plan = await mkPlan(school.id, { type: 'WEEKLY_PASS', expiryDurationDays: 7 });
      await setContract(plan.id, { body: 'Week terms' });
      const a = await mkStudent('first');
      const b = await mkStudent('second');
      const sig = await signContract(plan.id, a.token);
      // Someone else's signature.
      expect((await purchase(plan.id, b.token, { contractSignatureId: sig.body.id })).status).toBe(400);
      // A signature of an older version.
      await setContract(plan.id, { body: 'Week terms, changed' });
      expect((await purchase(plan.id, a.token, { contractSignatureId: sig.body.id })).status).toBe(409);
      // Signing an old version is refused too.
      expect((await signContract(plan.id, a.token, { contractVersion: 1 })).status).toBe(409);
      const fresh = await signContract(plan.id, a.token, { contractVersion: 2 });
      expect((await purchase(plan.id, a.token, { contractSignatureId: fresh.body.id })).status).toBe(201);
    });

    it('a Guardian signs for their child; a child signing for themselves is refused', async () => {
      const plan = await mkPlan(school.id, { type: 'CLASS_PACK', classesIncluded: 5 });
      await setContract(plan.id, { body: 'Kids terms' });
      const child = await mkStudent('child', school.id, new Date(Date.now() - 10 * 365 * DAY));
      expect((await signContract(plan.id, child.token)).status).toBe(403);
      const guardian = await mkUser('guardian');
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: child.user.id } });
      const tokenGuardian = sign(guardian, []);
      const signed = await signContract(plan.id, tokenGuardian, { studentId: child.user.id });
      expect(signed.status).toBe(200);
      expect(signed.body).toMatchObject({ studentId: child.user.id, signedById: guardian.id });
      const bought = await purchase(plan.id, tokenGuardian, { studentId: child.user.id, contractSignatureId: signed.body.id });
      expect(bought.status).toBe(201);
    });

    it("another School's member can't read or sign the contract, and a drawn signature must be this plan's upload", async () => {
      const plan = await mkPlan(school.id, { type: 'CLASS_PACK', classesIncluded: 5 });
      await setContract(plan.id, { body: 'Private terms' });
      const outsider = await mkStudent('elsewhere', otherSchool.id);
      expect((await http().get(`/v1/membership-plans/${plan.id}/contract`).set(auth(outsider.token))).status).toBe(404);
      expect((await signContract(plan.id, outsider.token)).status).toBe(404);
      const member = await mkStudent('drawn');
      const res = await signContract(plan.id, member.token, { signatureImageKey: `plan-contract-signatures/${otherSchool.id}/${plan.id}/${member.user.id}/x.png` });
      expect(res.status).toBe(400);
      // Staff can't read a Student's signed contracts, nor another Student.
      expect((await http().get(`/v1/schools/${school.id}/students/${member.user.id}/plan-contracts`).set(auth(tokenStaff))).status).toBe(403);
      expect((await http().get(`/v1/schools/${school.id}/students/${member.user.id}/plan-contracts`).set(auth(outsider.token))).status).toBe(403);
    });

    it("a plan with a contract can't be sold at the desk", async () => {
      const plan = await mkPlan(school.id, { type: 'CLASS_PACK', classesIncluded: 5 });
      await setContract(plan.id, { body: 'Desk terms' });
      const { user } = await mkStudent('desk');
      const res = await http().post(`/v1/schools/${school.id}/students/${user.id}/memberships/sell`).set(auth(tokenOwner)).send({ membershipPlanId: plan.id, paymentMethod: 'CASH' });
      expect(res.status).toBe(400);
    });
  });

  describe('cancelling early', () => {
    /** A Subscription bought with a signed contract, as the webhook would have left it. */
    async function mkContractSubscription(studentId: string, startDate: Date, terms: { minimumTermMonths: number | null; earlyExitFee: number | null }) {
      const plan = await mkPlan(school.id, { type: 'SUBSCRIPTION', contractBody: 'Twelve months', contractVersion: 1, contractMinimumTermMonths: terms.minimumTermMonths, contractEarlyExitFee: terms.earlyExitFee });
      const membership = await superuser.membership.create({
        data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: school.id, frequency: 'RECURRING', startDate, stripeSubscriptionId: `sub_${randomUUID()}` },
      });
      const account = await superuser.paymentAccount.findUniqueOrThrow({ where: { schoolId: school.id } });
      const order = await superuser.transaction.create({
        data: { id: randomUUID(), schoolId: school.id, studentId, paymentAccountId: account.id, membershipPlanId: plan.id, membershipId: membership.id, amount: 4000, currency: 'GBP', status: 'SUCCESSFUL', paymentMethod: 'STRIPE' },
      });
      await superuser.planContractSignature.create({
        data: {
          id: randomUUID(), schoolId: school.id, membershipPlanId: plan.id, studentId, signedById: studentId, signerFullName: 'Pat', signatureText: 'Pat',
          planTitle: plan.title, planType: 'SUBSCRIPTION', contractBody: 'Twelve months', minimumTermMonths: terms.minimumTermMonths, earlyExitFee: terms.earlyExitFee,
          currency: 'GBP', contractVersion: 1, contractSha256: 'x'.repeat(64), usedAt: new Date(), transactionId: order.id,
        },
      });
      return membership;
    }
    const cancel = (membershipId: string, token: string) => http().post(`/v1/memberships/${membershipId}/cancel`).set(auth(token)).send({});

    it('the member sees the term and fee, and cancelling before the term ends puts the signed fee on their balance, once', async () => {
      const { user, token } = await mkStudent('leaver');
      const m = await mkContractSubscription(user.id, new Date(Date.now() - 30 * DAY), { minimumTermMonths: 12, earlyExitFee: 5000 });
      const mine = await http().get('/v1/memberships/me').set(auth(token));
      const row = mine.body.items.find((r: { id: string }) => r.id === m.id);
      expect(row.contract).toMatchObject({ earlyExitFee: 5000, currency: 'GBP' });

      expect((await cancel(m.id, token)).status).toBe(201);
      const charges = await superuser.charge.findMany({ where: { studentId: user.id } });
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({ unitAmount: 5000, currency: 'GBP', schoolId: school.id });
      expect(charges[0].contractSignatureId).not.toBeNull();
      // Asking twice changes nothing.
      await cancel(m.id, token);
      expect(await superuser.charge.count({ where: { studentId: user.id } })).toBe(1);
    });

    it('no fee once the term is served, and none when the owner cancels for the member', async () => {
      const served = await mkStudent('served');
      const old = await mkContractSubscription(served.user.id, new Date(Date.now() - 400 * DAY), { minimumTermMonths: 12, earlyExitFee: 5000 });
      expect((await cancel(old.id, served.token)).status).toBe(201);
      expect(await superuser.charge.count({ where: { studentId: served.user.id } })).toBe(0);

      const byOwner = await mkStudent('owner-cancelled');
      const m = await mkContractSubscription(byOwner.user.id, new Date(Date.now() - 30 * DAY), { minimumTermMonths: 12, earlyExitFee: 5000 });
      expect((await cancel(m.id, tokenOwner)).status).toBe(201);
      expect(await superuser.charge.count({ where: { studentId: byOwner.user.id } })).toBe(0);
    });
  });
});
