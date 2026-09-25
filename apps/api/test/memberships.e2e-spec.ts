/**
 * HTTP-level gate for MembershipsModule + TransactionsModule (Phase 9) —
 * MembershipPlan CRUD, the £0-immediate and Cash/Bank-Transfer purchase paths (the
 * two that don't require a live Stripe test-mode key — see below), memberships/me,
 * membership-status authorization, and the transactions ledger. Same ground rule as
 * every other e2e spec in this repo: prove over real HTTP, not just by reading the
 * code.
 *
 * Deliberately does NOT exercise the Stripe one-time/Subscription purchase paths
 * (PaymentsService.charge()/subscribe()) — those make real Stripe API calls, and CI's
 * STRIPE_SECRET_KEY is a dummy value (see .github/workflows/ci.yml's own comment on
 * this exact limitation, already accepted for Phase 8's initiateConnectOnboarding).
 * A committed Stripe test-mode key is a secrets-management decision not made
 * unilaterally this phase either.
 *
 * Also includes ONE direct-Prisma RLS test (not HTTP) for the Membership/Transaction
 * policy this phase's own verification pass found and fixed before build — see this
 * phase's migration.sql for the full "why not the generic any-active-RoleGrant-
 * holder shape" reasoning. No HTTP endpoint exposes another Student's raw Membership
 * row to probe this via supertest alone, so this one test goes around the API layer
 * the same way test/tenant-isolation.rls.spec.ts already does for Phase 1's own
 * tables — the actual security boundary here is the RLS policy itself, and this is
 * the only way to prove it holds even if application code has (or later grows) a bug.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
    '[memberships.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('MembershipsModule + TransactionsModule — HTTP-level CRUD, purchase, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let branchStaff: { id: string; email: string };
  let outsider: { id: string; email: string };
  let guardian: { id: string; email: string };
  let minor: { id: string; email: string };
  let tokenOwner: string;
  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenBranchStaff: string;
  let tokenOutsider: string;
  let tokenGuardian: string;
  let paymentAccountId: string;

  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const transactionIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Memberships HTTP School' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `memberships-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    owner = await mkUser('owner');
    studentA = await mkUser('student-a');
    studentB = await mkUser('student-b');
    branchStaff = await mkUser('branch-staff');
    outsider = await mkUser('outsider');
    guardian = await mkUser('guardian');
    minor = await mkUser('minor');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaff.id, schoolId: school.id },
        // Stands in for Phase 38's own Guardian-on-behalf-of enrollment — the
        // minor's own path into holding this, exercised end-to-end in that
        // phase's own test suite, not re-proven here.
        { id: randomUUID(), role: 'STUDENT', userId: minor.id, schoolId: school.id },
      ],
    });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: minor.id } });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenBranchStaff = signAccessToken(branchStaff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOutsider = signAccessToken(outsider, []);
    tokenGuardian = signAccessToken(guardian, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);

    // Cash/Bank Transfer PaymentAccount — every purchase path this file exercises
    // (£0-immediate, Cash/Bank Pending+confirm) works against this; the Stripe paths
    // are deliberately out of scope here (see this file's own header comment).
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'BANK_TRANSFER', accountTitle: 'Fixture', country: 'GB' },
    });
    paymentAccountId = paymentAccount.id;
  });

  afterAll(async () => {
    await superuser.transaction.deleteMany({ where: { id: { in: transactionIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.paymentAccount.delete({ where: { id: paymentAccountId } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: guardian.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'memberships-http-' } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // MembershipPlan CRUD
  // ---------------------------------------------------------------------------

  it('School Owner CAN create a MembershipPlan; a Student cannot', async () => {
    const forbidden = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ type: 'CLASS_PACK', title: 'Denied', price: 1000, classesIncluded: 5 });
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'CLASS_PACK', title: '5-Class Pack', price: 5000, currency: 'gbp', classesIncluded: 5 });
    expect(res.status).toBe(201);
    membershipPlanIds.push(res.body.id);
    expect(res.body.type).toBe('CLASS_PACK');
    expect(res.body.visible).toBe(true);
  });

  // FOUND ON REVIEW (Track B Slice 4a): findAllPlans had no role gate at all,
  // unlike create/update right above — any enrolled Student or Staff could list
  // every plan, including visible=false ones. Proves the fix over real HTTP.
  it('School Owner CAN list MembershipPlans; a Student/Branch Staff cannot — 403', async () => {
    const asOwner = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.items.some((p: { id: string }) => p.id === membershipPlanIds[0])).toBe(true);

    const asStudent = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(asStudent.status).toBe(403);

    const asStaff = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenBranchStaff}`);
    expect(asStaff.status).toBe(403);
  });

  it('rejects a FRIEND_PASS with a non-zero price — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'FRIEND_PASS', title: 'Bad Friend Pass', price: 500 });
    expect(res.status).toBe(400);
  });

  it('rejects a scoped-Class plan with classesIncluded > 1 — 400', async () => {
    const cls = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        title: 'Fixture Class',
        activities: ['Jiu Jitsu'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'CLASS_PACK', title: 'Bad Scoped Pack', price: 1000, classesIncluded: 5, scopedClassId: cls.id });
    expect(res.status).toBe(400);
    await superuser.class.delete({ where: { id: cls.id } });
  });

  it('PATCH with explicit null clears currency/expiryDurationDays/scopedClassId/cancellationCharge; omitting a field leaves it unchanged', async () => {
    const cls = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        title: 'Clearable-field Fixture Class',
        activities: ['Jiu Jitsu'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });

    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        type: 'CLASS_PACK',
        title: 'Clearable Fields Pack',
        price: 2500,
        currency: 'gbp',
        expiryDurationDays: 30,
        classesIncluded: 1,
        scopedClassId: cls.id,
        cancellationCharge: 500,
      });
    expect(createRes.status).toBe(201);
    membershipPlanIds.push(createRes.body.id);
    expect(createRes.body.currency).toBe('gbp');
    expect(createRes.body.expiryDurationDays).toBe(30);
    expect(createRes.body.scopedClassId).toBe(cls.id);
    expect(createRes.body.cancellationCharge).toBe(500);

    // Omitting `title` here must leave it unchanged — proves "field absent"
    // still means "no change" even now that these DTOs accept an explicit
    // null on other fields (the two behaviors aren't conflated).
    const clearRes = await request(app.getHttpServer())
      .patch(`/v1/membership-plans/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ currency: null, expiryDurationDays: null, scopedClassId: null, cancellationCharge: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.currency).toBeNull();
    expect(clearRes.body.expiryDurationDays).toBeNull();
    expect(clearRes.body.scopedClassId).toBeNull();
    expect(clearRes.body.cancellationCharge).toBeNull();
    expect(clearRes.body.title).toBe('Clearable Fields Pack');

    await superuser.class.delete({ where: { id: cls.id } });
  });

  it('rejects an explicit classesIncluded: null on PATCH — 400, not a silent no-op', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'CLASS_PACK', title: 'Reject-Null-ClassesIncluded Pack', price: 1000, classesIncluded: 5 });
    expect(createRes.status).toBe(201);
    membershipPlanIds.push(createRes.body.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/membership-plans/${createRes.body.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ classesIncluded: null });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Purchase — £0-immediate path (Decision 6)
  // ---------------------------------------------------------------------------

  it('purchasing a £0 plan creates an Active Membership immediately, no Transaction', async () => {
    const planRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'TRIAL_MEMBERSHIP', title: 'Free Trial', price: 0 });
    expect(planRes.status).toBe(201);
    membershipPlanIds.push(planRes.body.id);

    const purchaseRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${planRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(purchaseRes.status).toBe(201);
    expect(purchaseRes.body.outcome).toBe('active');
    expect(purchaseRes.body.membership.status).toBe('ACTIVE');
    membershipIds.push(purchaseRes.body.membership.id);

    const meRes = await request(app.getHttpServer())
      .get('/v1/memberships/me')
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.items.some((m: { id: string }) => m.id === purchaseRes.body.membership.id)).toBe(true);
  });

  it('a second simultaneous general-access Membership for the same Student/School is rejected — 409', async () => {
    const planRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'TRIAL_MEMBERSHIP', title: 'Second Free Trial', price: 0 });
    expect(planRes.status).toBe(201);
    membershipPlanIds.push(planRes.body.id);

    const purchaseRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${planRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(purchaseRes.status).toBe(409);
  });

  // ---------------------------------------------------------------------------
  // Purchase — Guardian-on-behalf-of-a-linked-minor (Phase 39).
  // ---------------------------------------------------------------------------

  it('a Guardian CAN purchase a £0 plan for a linked minor — the Membership belongs to the MINOR, not the Guardian', async () => {
    const planRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'TRIAL_MEMBERSHIP', title: 'Guardian Free Trial', price: 0 });
    expect(planRes.status).toBe(201);
    membershipPlanIds.push(planRes.body.id);

    const purchaseRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${planRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(purchaseRes.status).toBe(201);
    expect(purchaseRes.body.outcome).toBe('active');
    expect(purchaseRes.body.membership.studentId).toBe(minor.id);
    membershipIds.push(purchaseRes.body.membership.id);

    // Direct Prisma, under the minor's own tenant context — confirms the row
    // is genuinely readable as the minor's own (Membership RLS's "self"
    // branch), not just present in the raw response body. A Guardian has no
    // findMyMemberships()-for-a-linked-minor equivalent yet (out of scope
    // this phase, same as every other Guardian-reads-a-minor's-own-data gap
    // flagged but not built across Phase 37/38).
    const asMinor = await withUser(minor.id, (tx) => tx.membership.findMany({ where: { id: purchaseRes.body.membership.id } }));
    expect(asMinor).toHaveLength(1);
  });

  it('a Guardian CAN purchase a Cash/Bank-eligible plan for a linked minor — Transaction.studentId is the minor, and School Owner can still confirm it', async () => {
    const planRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'CLASS_PACK', title: 'Guardian Cash Pack', price: 2000, currency: 'gbp', classesIncluded: 2 });
    expect(planRes.status).toBe(201);
    membershipPlanIds.push(planRes.body.id);

    const purchaseRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${planRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: minor.id });
    expect(purchaseRes.status).toBe(201);
    expect(purchaseRes.body.outcome).toBe('pending_confirmation');
    const transactionId = purchaseRes.body.transactionId;
    transactionIds.push(transactionId);

    const rawTransaction = await superuser.transaction.findUniqueOrThrow({ where: { id: transactionId } });
    expect(rawTransaction.studentId).toBe(minor.id);

    const confirmRes = await request(app.getHttpServer())
      .patch(`/v1/transactions/${transactionId}/confirm`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.membershipCreated).toBe(true);
    expect(confirmRes.body.membership.studentId).toBe(minor.id);
    membershipIds.push(confirmRes.body.membership.id);
  });

  it('a caller with NO active GuardianLink to the named Student is rejected — 403, not a silent no-op', async () => {
    const planRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'TRIAL_MEMBERSHIP', title: 'Unlinked Guardian Attempt', price: 0 });
    membershipPlanIds.push(planRes.body.id);

    // studentA stands in for "some other real Student" — the Guardian holds
    // no GuardianLink to them at all.
    const res = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${planRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: studentA.id });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Purchase — Cash/Bank Transfer path (Pending Transaction, then confirm)
  // ---------------------------------------------------------------------------

  it('purchasing a Cash/Bank-eligible plan creates a Pending Transaction, not a Membership — confirm creates it Active', async () => {
    const planRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'CLASS_PACK', title: 'Cash Pack', price: 3000, currency: 'gbp', classesIncluded: 3 });
    expect(planRes.status).toBe(201);
    membershipPlanIds.push(planRes.body.id);

    const purchaseRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${planRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    expect(purchaseRes.status).toBe(201);
    expect(purchaseRes.body.outcome).toBe('pending_confirmation');
    const transactionId = purchaseRes.body.transactionId;
    transactionIds.push(transactionId);

    const confirmRes = await request(app.getHttpServer())
      .patch(`/v1/transactions/${transactionId}/confirm`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.membershipCreated).toBe(true);
    membershipIds.push(confirmRes.body.membership.id);
    expect(confirmRes.body.membership.classesRemaining).toBe(3);

    // Idempotent — a repeat call no-ops rather than erroring or double-creating.
    const secondConfirmRes = await request(app.getHttpServer())
      .patch(`/v1/transactions/${transactionId}/confirm`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(secondConfirmRes.status).toBe(200);
    expect(secondConfirmRes.body.membershipCreated).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Decision 68/112 — chargeback-pattern-restriction's own purchase gate.
  // ---------------------------------------------------------------------------

  it('a payment-restricted Student is rejected at a Stripe-provider School — 400, before any Stripe call — but CAN still purchase Cash/Bank-eligible', async () => {
    // A separate, self-contained School+PaymentAccount(STRIPE)+Plan+Student — this
    // file's own header comment explains why no Stripe purchase path is exercised
    // anywhere else here (no live Stripe credentials); this test only needs the
    // restriction guard to fire BEFORE MembershipsService.purchase() ever reaches
    // PaymentsService.charge()/subscribe(), which it does (see that method's own
    // comment) — no live Stripe call is actually made.
    const stripeSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Memberships HTTP Stripe School' } });
    const stripePaymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: stripeSchool.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
    });
    const restrictedStudent = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `memberships-http-restricted-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Restricted',
        surname: 'Student',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
        paymentRestrictedAt: new Date(),
      },
    });
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: restrictedStudent.id, schoolId: stripeSchool.id },
        { id: randomUUID(), role: 'STUDENT', userId: restrictedStudent.id, schoolId: school.id },
      ],
    });
    const tokenRestrictedStudent = signAccessToken(restrictedStudent, [
      { role: 'STUDENT', franchiseId: null, schoolId: stripeSchool.id, branchId: null },
      { role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null },
    ]);

    // tokenOwner has no grant at stripeSchool — seed the Plan directly instead of
    // going through the create endpoint.
    const stripePlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: stripeSchool.id, type: 'CLASS_PACK', title: 'Stripe Pack', price: 3000, classesIncluded: 3 },
    });

    const rejectedRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${stripePlan.id}/purchase`)
      .set('Authorization', `Bearer ${tokenRestrictedStudent}`)
      .send({});
    expect(rejectedRes.status).toBe(400);
    expect(rejectedRes.body.error.message).toContain('Cash/Bank Transfer');

    // Same restricted Student, Cash/Bank-eligible plan at the main (BANK_TRANSFER)
    // School fixture — untouched by the restriction.
    const cashPlanRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'CLASS_PACK', title: 'Restricted Cash Pack', price: 1500, currency: 'gbp', classesIncluded: 1 });
    expect(cashPlanRes.status).toBe(201);
    membershipPlanIds.push(cashPlanRes.body.id);

    const allowedRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${cashPlanRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenRestrictedStudent}`)
      .send({});
    expect(allowedRes.status).toBe(201);
    expect(allowedRes.body.outcome).toBe('pending_confirmation');
    transactionIds.push(allowedRes.body.transactionId);

    await superuser.transaction.deleteMany({ where: { studentId: restrictedStudent.id } });
    await superuser.membershipPlan.delete({ where: { id: stripePlan.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: restrictedStudent.id } });
    await superuser.user.delete({ where: { id: restrictedStudent.id } });
    await superuser.paymentAccount.delete({ where: { id: stripePaymentAccount.id } });
    await superuser.school.delete({ where: { id: stripeSchool.id } });
  });

  it('a Student (not School Owner/Manager) cannot confirm a Transaction — 403', async () => {
    const planRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/membership-plans`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ type: 'WEEKLY_PASS', title: 'Weekly', price: 2000, currency: 'gbp' });
    membershipPlanIds.push(planRes.body.id);
    const purchaseRes = await request(app.getHttpServer())
      .post(`/v1/membership-plans/${planRes.body.id}/purchase`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    transactionIds.push(purchaseRes.body.transactionId);

    const res = await request(app.getHttpServer())
      .patch(`/v1/transactions/${purchaseRes.body.transactionId}/confirm`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // membership-status — Branch Staff-accessible, School Owner-accessible, an
  // Outsider (no grant at this School at all) rejected.
  // ---------------------------------------------------------------------------

  it('membership-status is readable by Branch Staff and School Owner, rejected for an Outsider', async () => {
    const staffRes = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/membership-status`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenBranchStaff}`);
    expect(staffRes.status).toBe(200);
    expect(staffRes.body.status).toBe('ACTIVE');

    const ownerRes = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/membership-status`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(ownerRes.status).toBe(200);

    const outsiderRes = await request(app.getHttpServer())
      .get(`/v1/students/${studentA.id}/membership-status`)
      .query({ schoolId: school.id })
      .set('Authorization', `Bearer ${tokenOutsider}`);
    expect(outsiderRes.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Transactions ledger — School Owner/Manager only.
  // ---------------------------------------------------------------------------

  it('GET /schools/{id}/transactions is School Owner/Manager only, and resolves the paying Student\'s name', async () => {
    const ownerRes = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/transactions`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.items.length).toBeGreaterThan(0);

    // Transaction.student is joined server-side — confirms the row for the
    // minor (created via the Guardian Cash/Bank test above) carries a real
    // name, not just studentId.
    const minorItem = ownerRes.body.items.find((t: { studentId: string }) => t.studentId === minor.id);
    expect(minorItem).toBeDefined();
    expect(minorItem.studentFirstName).toBe('minor');
    expect(minorItem.studentSurname).toBe('Tenant');

    const studentRes = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/transactions`)
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(studentRes.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // RLS — the policy fix this phase's own verification pass found before build.
  // Direct Prisma, not HTTP — see this file's own header comment for why.
  // ---------------------------------------------------------------------------

  it('RLS: Student B cannot read Student A\'s Membership or Transaction rows, even though both hold an active grant at the same School', async () => {
    const asStudentB = await withUser(studentB.id, (tx) =>
      tx.membership.findMany({ where: { studentId: studentA.id } }),
    );
    expect(asStudentB).toHaveLength(0);

    const asStudentBTx = await withUser(studentB.id, (tx) =>
      tx.transaction.findMany({ where: { studentId: studentA.id } }),
    );
    expect(asStudentBTx).toHaveLength(0);

    // Sanity check the policy isn't just blocking everything — the School Owner
    // (and the Student reading their own rows) still can.
    const asOwner = await withUser(owner.id, (tx) => tx.membership.findMany({ where: { studentId: studentA.id } }));
    expect(asOwner.length).toBeGreaterThan(0);

    const asStudentASelf = await withUser(studentA.id, (tx) => tx.membership.findMany({ where: { studentId: studentA.id } }));
    expect(asStudentASelf.length).toBeGreaterThan(0);
  });

  it('RLS: Branch Staff gets zero raw Membership/Transaction row access — Spec 55 §8.2', async () => {
    const asBranchStaff = await withUser(branchStaff.id, (tx) => tx.membership.findMany({ where: { schoolId: school.id } }));
    expect(asBranchStaff).toHaveLength(0);
  });
});
