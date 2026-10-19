/**
 * HTTP-level gate for Phase 12 (GuardianModule) — minor creation + linking, the
 * two-tier ConsentRecord grant/withdraw flow, the withdrawal-asymmetry rule
 * (baseline cascades RoleGrant revocation; camera-only just clears the stored
 * profile photo), and RLS isolation. Same ground rule as every other e2e spec in
 * this repo: prove over real HTTP, not just by reading the code.
 *
 * Extended for the Guardian consent compliance fixes (Decisions 170–173):
 * append-only consent history, the published privacy notice version, the age
 * checks, the parental-responsibility declaration, School confirmation of links,
 * and erasure once the last baseline consent is withdrawn.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS, JWT_ACCESS_SECRET.
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
    '[guardians.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('GuardianModule — HTTP-level linking, consent, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let guardianA: { id: string; email: string };
  let guardianB: { id: string; email: string };
  let teenGuardian: { id: string; email: string };
  let owner: { id: string; email: string };
  let instructor: { id: string; email: string };
  let tokenGuardianA: string;
  let tokenGuardianB: string;
  let tokenTeenGuardian: string;
  let tokenOwner: string;
  let tokenInstructor: string;

  let school: { id: string };
  let privacyNoticeBefore: { content: string | null; currentVersion: number | null };
  const POLICY_VERSION = 'privacy-statement@1';

  const userIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  const grantConsent = (token: string, studentId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/v1/guardians/me/minors/${studentId}/consent`).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const mkUser = (label: string, dateOfBirth = new Date('1985-01-01')) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `guardians-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth,
          phoneVerifiedAt: new Date(),
        },
      });

    guardianA = await mkUser('guardian-a');
    guardianB = await mkUser('guardian-b');
    teenGuardian = await mkUser('teen-guardian', new Date(Date.now() - 16 * 365 * 24 * 3_600_000));
    owner = await mkUser('owner');
    instructor = await mkUser('instructor');
    userIds.push(guardianA.id, guardianB.id, teenGuardian.id, owner.id, instructor.id);

    const guardianGrant = [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }];
    tokenGuardianA = signAccessToken(guardianA, guardianGrant);
    tokenGuardianB = signAccessToken(guardianB, guardianGrant);
    tokenTeenGuardian = signAccessToken(teenGuardian, guardianGrant);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Guardians HTTP School' } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: instructor.id, schoolId: school.id } });
    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenInstructor = signAccessToken(instructor, [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }]);

    // Start with no published privacy notice; restored in afterAll.
    const doc = await superuser.legalDocument.findUniqueOrThrow({ where: { slug: 'privacy-statement' } });
    privacyNoticeBefore = { content: doc.content, currentVersion: doc.currentVersion };
    await superuser.legalDocument.update({ where: { slug: 'privacy-statement' }, data: { content: null, currentVersion: null } });
  });

  afterAll(async () => {
    const allGuardians = [guardianA.id, guardianB.id, teenGuardian.id];
    await superuser.consentEvent.deleteMany({ where: { guardianId: { in: allGuardians } } });
    await superuser.consentRecord.deleteMany({ where: { guardianId: { in: allGuardians } } });
    await superuser.guardianLinkConfirmationEvent.deleteMany({ where: { guardianLink: { guardianId: { in: allGuardians } } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: allGuardians } } });
    await superuser.guardianLinkConfirmer.deleteMany({ where: { schoolId: school.id } });
    await superuser.transaction.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({
      where: {
        OR: [
          { id: { in: userIds } },
          { email: { contains: 'guardian-managed.ultm8.internal' } },
          { email: { contains: 'erased.ultm8.internal' } },
        ],
      },
    });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.legalDocument.update({ where: { slug: 'privacy-statement' }, data: privacyNoticeBefore });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  let minorId: string;
  let linkIdA: string;
  let baselineConsentId: string;
  let cameraConsentId: string;

  // ---------------------------------------------------------------------------
  // Linking a minor — age checks (Decision 172)
  // ---------------------------------------------------------------------------

  it('a Guardian CAN create + link a new minor, and the link starts unconfirmed', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/guardians/me/minors')
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ firstName: 'Minor', surname: 'Child', dateOfBirth: '2015-06-01', gender: 'other' });
    expect(res.status).toBe(201);
    expect(res.body.studentId).toBeDefined();
    expect(res.body.confirmedAt).toBeNull();
    minorId = res.body.studentId;
    linkIdA = res.body.linkId;
    userIds.push(minorId);

    const listRes = await request(app.getHttpServer()).get('/v1/guardians/me/minors').set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.some((m: { studentId: string; confirmedAt: string | null }) => m.studentId === minorId && m.confirmedAt === null)).toBe(true);
  });

  it('the minor gets a synthetic, unique, E.164-shaped (digits-only) phone/email, and login stays blocked (phoneVerifiedAt null)', async () => {
    const minor = await superuser.user.findUniqueOrThrow({ where: { id: minorId } });
    expect(minor.email).toContain('guardian-managed.ultm8.internal');
    expect(minor.phone).toMatch(/^\+\d+$/); // digits only after '+' — a hex-slice bug once produced letters here
    expect(minor.phoneVerifiedAt).toBeNull();
  });

  it('linking an adult (18+) as a minor is rejected — 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/guardians/me/minors')
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ firstName: 'Grown', surname: 'Up', dateOfBirth: '2000-01-01' });
    expect(res.status).toBe(400);
  });

  it('a date of birth in the future is rejected — 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/guardians/me/minors')
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ firstName: 'Not', surname: 'Born', dateOfBirth: '2999-01-01' });
    expect(res.status).toBe(400);
  });

  it('a Guardian under 18 cannot link a minor — 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/guardians/me/minors')
      .set('Authorization', `Bearer ${tokenTeenGuardian}`)
      .send({ firstName: 'Little', surname: 'Sibling', dateOfBirth: '2018-01-01' });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Consent gates — confirmation, published notice, declaration (171, 172)
  // ---------------------------------------------------------------------------

  it('granting consent for a minor the caller has no link to is rejected — 400', async () => {
    const res = await grantConsent(tokenGuardianB, minorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    expect(res.status).toBe(400);
  });

  it('consent is refused while no School has confirmed the link — 403', async () => {
    const res = await grantConsent(tokenGuardianA, minorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    expect(res.status).toBe(403);
  });

  it('a School sees no link for a minor not enrolled there, and cannot confirm it — 404', async () => {
    const listRes = await request(app.getHttpServer()).get(`/v1/schools/${school.id}/guardian-links`).set('Authorization', `Bearer ${tokenOwner}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(0);

    const confirmRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/guardian-links/${linkIdA}/confirm`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(confirmRes.status).toBe(404);
  });

  it('an Instructor without the right cannot list or confirm links — 403', async () => {
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: minorId, schoolId: school.id } });

    const listRes = await request(app.getHttpServer()).get(`/v1/schools/${school.id}/guardian-links`).set('Authorization', `Bearer ${tokenInstructor}`);
    expect(listRes.status).toBe(403);
    const confirmRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/guardian-links/${linkIdA}/confirm`)
      .set('Authorization', `Bearer ${tokenInstructor}`);
    expect(confirmRes.status).toBe(403);
  });

  it('only the owner manages who may confirm; once given the right, the Instructor sees the pending link and confirms it', async () => {
    const byInstructor = await request(app.getHttpServer())
      .put(`/v1/schools/${school.id}/guardian-link-confirmers/${instructor.id}`)
      .set('Authorization', `Bearer ${tokenInstructor}`);
    expect(byInstructor.status).toBe(403);

    const nonStaff = await request(app.getHttpServer())
      .put(`/v1/schools/${school.id}/guardian-link-confirmers/${guardianB.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(nonStaff.status).toBe(400);

    const give = await request(app.getHttpServer())
      .put(`/v1/schools/${school.id}/guardian-link-confirmers/${instructor.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(give.status).toBe(200);
    const giveAgain = await request(app.getHttpServer())
      .put(`/v1/schools/${school.id}/guardian-link-confirmers/${instructor.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(giveAgain.status).toBe(200);
    expect(giveAgain.body.id).toBe(give.body.id);

    const pending = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/guardian-links?status=pending`)
      .set('Authorization', `Bearer ${tokenInstructor}`);
    expect(pending.status).toBe(200);
    const row = pending.body.items.find((l: { linkId: string }) => l.linkId === linkIdA);
    expect(row).toMatchObject({ studentId: minorId, guardianId: guardianA.id, guardianFirstName: 'guardian-a', confirmedAt: null });

    const confirm = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/guardian-links/${linkIdA}/confirm`)
      .set('Authorization', `Bearer ${tokenInstructor}`);
    expect(confirm.status).toBe(201);
    expect(confirm.body.confirmedById).toBe(instructor.id);
    expect(confirm.body.confirmedSchoolId).toBe(school.id);

    const again = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/guardian-links/${linkIdA}/confirm`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(again.status).toBe(409);

    const confirmed = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/guardian-links?status=confirmed`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(confirmed.body.items.some((l: { linkId: string }) => l.linkId === linkIdA)).toBe(true);
  });

  it('consent is refused while no privacy notice is published — 409', async () => {
    const res = await grantConsent(tokenGuardianA, minorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    expect(res.status).toBe(409);
  });

  it('once a notice is published, consent must name its current version and declare parental responsibility', async () => {
    await superuser.legalDocument.update({ where: { slug: 'privacy-statement' }, data: { content: 'Test privacy notice.', currentVersion: 1 } });

    const legal = await request(app.getHttpServer()).get('/v1/legal/privacy-statement');
    expect(legal.body.currentVersion).toBe(1);

    const stale = await grantConsent(tokenGuardianA, minorId, { tier: 'BASELINE', policyVersion: '2026-09-v1', parentalResponsibilityDeclared: true });
    expect(stale.status).toBe(409);

    const noDeclaration = await grantConsent(tokenGuardianA, minorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: false });
    expect(noDeclaration.status).toBe(400);
    const missingDeclaration = await grantConsent(tokenGuardianA, minorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION });
    expect(missingDeclaration.status).toBe(400);
  });

  it('a Guardian CAN grant both tiers of consent for their own confirmed minor, and each grant is in the history', async () => {
    const baselineRes = await grantConsent(tokenGuardianA, minorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    expect(baselineRes.status).toBe(201);
    expect(baselineRes.body.status).toBe('ACTIVE');
    expect(baselineRes.body.isCurrentPolicyVersion).toBe(true);
    baselineConsentId = baselineRes.body.id;

    const cameraRes = await grantConsent(tokenGuardianA, minorId, { tier: 'CAMERA', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    expect(cameraRes.status).toBe(201);
    cameraConsentId = cameraRes.body.id;

    const listRes = await request(app.getHttpServer()).get('/v1/guardians/me/consent').set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(2);
    expect(listRes.body.items.every((r: { isCurrentPolicyVersion: boolean }) => r.isCurrentPolicyVersion)).toBe(true);

    const events = await request(app.getHttpServer()).get('/v1/guardians/me/consent-events').set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(events.status).toBe(200);
    expect(events.body.items).toHaveLength(2);
    expect(events.body.items.every((e: { type: string; parentalResponsibilityDeclared: boolean; policyVersion: string }) =>
      e.type === 'GRANTED' && e.parentalResponsibilityDeclared && e.policyVersion === POLICY_VERSION)).toBe(true);
  });

  it('a consent given against an older notice is flagged once a new version is published', async () => {
    await superuser.legalDocument.update({ where: { slug: 'privacy-statement' }, data: { currentVersion: 2 } });
    const listRes = await request(app.getHttpServer()).get('/v1/guardians/me/consent').set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(listRes.body.items.every((r: { isCurrentPolicyVersion: boolean }) => r.isCurrentPolicyVersion === false)).toBe(true);
    await superuser.legalDocument.update({ where: { slug: 'privacy-statement' }, data: { currentVersion: 1 } });
  });

  // ---------------------------------------------------------------------------
  // Withdrawal
  // ---------------------------------------------------------------------------

  it('withdrawing CAMERA-tier consent clears the stored profile photo but does NOT touch RoleGrant or account status', async () => {
    await superuser.user.update({ where: { id: minorId }, data: { profilePhotoUrl: 'https://example.test/photo.jpg' } });

    const res = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${cameraConsentId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');

    const minorAfter = await superuser.user.findUniqueOrThrow({ where: { id: minorId } });
    expect(minorAfter.profilePhotoUrl).toBeNull();
    expect(minorAfter.erasedAt).toBeNull();

    const grantAfter = await superuser.roleGrant.findFirst({ where: { userId: minorId, schoolId: school.id } });
    expect(grantAfter!.revokedAt).toBeNull(); // camera-only withdrawal never touches RoleGrant

    const doubleWithdraw = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${cameraConsentId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(doubleWithdraw.status).toBe(409);

    const events = await superuser.consentEvent.findMany({ where: { consentRecordId: cameraConsentId }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['GRANTED', 'WITHDRAWN']);
  });

  it('withdrawing BASELINE while another Guardian still consents keeps the data and revokes only this Guardian\'s link', async () => {
    // Guardian B is a second, confirmed Guardian of the same minor with active baseline consent.
    await superuser.guardianLink.create({
      data: { id: randomUUID(), guardianId: guardianB.id, studentId: minorId, confirmedAt: new Date(), confirmedSchoolId: school.id },
    });
    const bConsent = await grantConsent(tokenGuardianB, minorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    expect(bConsent.status).toBe(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${baselineConsentId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');

    const minorAfter = await superuser.user.findUniqueOrThrow({ where: { id: minorId } });
    expect(minorAfter.erasedAt).toBeNull();
    expect(minorAfter.firstName).toBe('Minor');
    const grantAfter = await superuser.roleGrant.findFirst({ where: { userId: minorId, schoolId: school.id } });
    expect(grantAfter!.revokedAt).toBeNull();
    const linkA = await superuser.guardianLink.findUniqueOrThrow({ where: { id: linkIdA } });
    expect(linkA.revokedAt).not.toBeNull();
  });

  it('withdrawing the LAST baseline consent revokes enrolments and erases the minor, keeping payment and consent records', async () => {
    // Data that must be erased: grading, a booking.
    const discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    const rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, name: 'White Belt', primaryColour: 'white' },
    });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: minorId, disciplineId: discipline.id, schoolId: school.id, currentRankId: rank.id },
    });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Kids', price: 1000 } });
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: minorId, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING' },
    });
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Kids Judo', startDate: new Date(), endDate: new Date(Date.now() + 3_600_000) },
    });
    await superuser.booking.create({
      data: { id: randomUUID(), studentId: minorId, classId: cls.id, schoolId: school.id, sourceMembershipId: membership.id, status: 'COMPLETED' },
    });
    // Data that must be kept: the payment record.
    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB' },
    });
    const transaction = await superuser.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        studentId: minorId,
        paymentAccountId: paymentAccount.id,
        membershipPlanId: plan.id,
        membershipId: membership.id,
        amount: 1000,
        status: 'SUCCESSFUL',
        paymentMethod: 'STRIPE',
      },
    });

    const bConsent = await superuser.consentRecord.findFirstOrThrow({ where: { guardianId: guardianB.id, studentId: minorId, tier: 'BASELINE' } });
    const res = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/consent/${bConsent.id}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianB}`);
    expect(res.status).toBe(200);

    const grantAfter = await superuser.roleGrant.findFirst({ where: { userId: minorId, schoolId: school.id } });
    expect(grantAfter!.revokedAt).not.toBeNull();

    const minorAfter = await superuser.user.findUniqueOrThrow({ where: { id: minorId } });
    expect(minorAfter.erasedAt).not.toBeNull();
    expect(minorAfter.firstName).toBe('[Erased]');
    expect(minorAfter.surname).toBe('[Erased]');
    expect(minorAfter.gender).toBeNull();
    expect(minorAfter.email).toContain('erased.ultm8.internal');
    expect(minorAfter.dateOfBirth.toISOString().slice(0, 10)).toBe('1900-01-01');

    expect(await superuser.studentRank.count({ where: { studentId: minorId } })).toBe(0);
    expect(await superuser.booking.count({ where: { studentId: minorId } })).toBe(0);

    expect(await superuser.transaction.count({ where: { id: transaction.id } })).toBe(1);
    expect(await superuser.membership.count({ where: { id: membership.id } })).toBe(1);
    expect(await superuser.consentRecord.count({ where: { studentId: minorId } })).toBe(3);
    expect(await superuser.consentEvent.count({ where: { studentId: minorId, type: 'WITHDRAWN' } })).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Decision 172 — branch coverage for confirmers, and owner un-confirm
  // ---------------------------------------------------------------------------

  describe('a School with branches', () => {
    let branchedSchool: { id: string };
    let branchNorth: { id: string };
    let branchSouth: { id: string };
    let owner2: { id: string; email: string };
    let staffNorth: { id: string; email: string };
    let tokenOwner2: string;
    let tokenStaffNorth: string;
    const links: Record<'north' | 'south' | 'none', string> = { north: '', south: '', none: '' };

    beforeAll(async () => {
      branchedSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Guardians Branched School' } });
      branchNorth = await superuser.branch.create({ data: { id: randomUUID(), schoolId: branchedSchool.id, name: 'North' } });
      branchSouth = await superuser.branch.create({ data: { id: randomUUID(), schoolId: branchedSchool.id, name: 'South' } });
      const mk = (label: string) =>
        superuser.user.create({
          data: {
            id: randomUUID(),
            email: `guardians-http-${label}-${randomUUID()}@example.test`,
            phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
            firstName: label,
            surname: 'Tenant',
            passcodeHash: 'x',
            dateOfBirth: new Date('1980-01-01'),
            phoneVerifiedAt: new Date(),
          },
        });
      owner2 = await mk('owner2');
      staffNorth = await mk('staff-north');
      userIds.push(owner2.id, staffNorth.id);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner2.id, schoolId: branchedSchool.id } });
      await superuser.roleGrant.create({
        data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staffNorth.id, schoolId: branchedSchool.id, branchId: branchNorth.id },
      });
      await superuser.guardianLinkConfirmer.create({ data: { id: randomUUID(), schoolId: branchedSchool.id, userId: staffNorth.id } });
      tokenOwner2 = signAccessToken(owner2, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: branchedSchool.id, branchId: null }]);
      tokenStaffNorth = signAccessToken(staffNorth, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: branchedSchool.id, branchId: branchNorth.id }]);

      // Three minors of Guardian A, enrolled here: home branch North, South, and none yet.
      for (const key of ['north', 'south', 'none'] as const) {
        const res = await request(app.getHttpServer())
          .post('/v1/guardians/me/minors')
          .set('Authorization', `Bearer ${tokenGuardianA}`)
          .send({ firstName: `Kid-${key}`, surname: 'Branch', dateOfBirth: '2016-03-03' });
        expect(res.status).toBe(201);
        links[key] = res.body.linkId;
        userIds.push(res.body.studentId);
        await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: res.body.studentId, schoolId: branchedSchool.id } });
        if (key !== 'none') {
          await superuser.studentHomeBranch.create({
            data: {
              id: randomUUID(),
              schoolId: branchedSchool.id,
              studentId: res.body.studentId,
              branchId: key === 'north' ? branchNorth.id : branchSouth.id,
            },
          });
        }
      }
    });

    afterAll(async () => {
      await superuser.guardianLinkConfirmationEvent.deleteMany({ where: { schoolId: branchedSchool.id } });
      await superuser.guardianLinkConfirmer.deleteMany({ where: { schoolId: branchedSchool.id } });
      await superuser.studentHomeBranch.deleteMany({ where: { schoolId: branchedSchool.id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: branchedSchool.id } });
      await superuser.guardianLink.updateMany({ where: { confirmedSchoolId: branchedSchool.id }, data: { confirmedSchoolId: null } });
      await superuser.branch.deleteMany({ where: { schoolId: branchedSchool.id } });
      await superuser.school.delete({ where: { id: branchedSchool.id } });
    });

    it('a confirmer sees only minors whose home branch is one of their branches', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/schools/${branchedSchool.id}/guardian-links`)
        .set('Authorization', `Bearer ${tokenStaffNorth}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((l: { linkId: string }) => l.linkId)).toEqual([links.north]);

      const ownerView = await request(app.getHttpServer())
        .get(`/v1/schools/${branchedSchool.id}/guardian-links`)
        .set('Authorization', `Bearer ${tokenOwner2}`);
      expect(ownerView.body.items.map((l: { linkId: string }) => l.linkId).sort()).toEqual([links.north, links.south, links.none].sort());
    });

    it('a confirmer cannot confirm another branch\'s minor, or one with no home branch — 403; the owner can', async () => {
      for (const key of ['south', 'none'] as const) {
        const res = await request(app.getHttpServer())
          .post(`/v1/schools/${branchedSchool.id}/guardian-links/${links[key]}/confirm`)
          .set('Authorization', `Bearer ${tokenStaffNorth}`);
        expect(res.status).toBe(403);
      }
      const own = await request(app.getHttpServer())
        .post(`/v1/schools/${branchedSchool.id}/guardian-links/${links.north}/confirm`)
        .set('Authorization', `Bearer ${tokenStaffNorth}`);
      expect(own.status).toBe(201);
      const byOwner = await request(app.getHttpServer())
        .post(`/v1/schools/${branchedSchool.id}/guardian-links/${links.south}/confirm`)
        .set('Authorization', `Bearer ${tokenOwner2}`);
      expect(byOwner.status).toBe(201);
    });

    it('only the owner of the confirming School can un-confirm; the history keeps both events', async () => {
      const byStaff = await request(app.getHttpServer())
        .post(`/v1/schools/${branchedSchool.id}/guardian-links/${links.north}/unconfirm`)
        .set('Authorization', `Bearer ${tokenStaffNorth}`);
      expect(byStaff.status).toBe(403);

      const byOtherSchoolOwner = await request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/guardian-links/${links.north}/unconfirm`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(byOtherSchoolOwner.status).toBe(404);

      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${branchedSchool.id}/guardian-links/${links.north}/unconfirm`)
        .set('Authorization', `Bearer ${tokenOwner2}`);
      expect(res.status).toBe(201);
      expect(res.body.confirmedAt).toBeNull();

      const again = await request(app.getHttpServer())
        .post(`/v1/schools/${branchedSchool.id}/guardian-links/${links.north}/unconfirm`)
        .set('Authorization', `Bearer ${tokenOwner2}`);
      expect(again.status).toBe(404);

      const events = await superuser.guardianLinkConfirmationEvent.findMany({ where: { guardianLinkId: links.north }, orderBy: { occurredAt: 'asc' } });
      expect(events.map((e) => [e.type, e.actorId])).toEqual([
        ['CONFIRMED', staffNorth.id],
        ['UNCONFIRMED', owner2.id],
      ]);

      // Unconfirmed again, so new consent is blocked.
      const minor = await superuser.guardianLink.findUniqueOrThrow({ where: { id: links.north } });
      const consent = await grantConsent(tokenGuardianA, minor.studentId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
      expect(consent.status).toBe(403);
    });
  });

  it('two Guardians withdrawing baseline consent at the same moment still erase the minor (Decision 173)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/guardians/me/minors')
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ firstName: 'Race', surname: 'Child', dateOfBirth: '2014-02-02' });
    expect(created.status).toBe(201);
    const raceMinorId = created.body.studentId;
    userIds.push(raceMinorId);
    await superuser.guardianLink.update({ where: { id: created.body.linkId }, data: { confirmedAt: new Date(), confirmedSchoolId: school.id } });
    await superuser.guardianLink.create({
      data: { id: randomUUID(), guardianId: guardianB.id, studentId: raceMinorId, confirmedAt: new Date(), confirmedSchoolId: school.id },
    });

    const consentA = await grantConsent(tokenGuardianA, raceMinorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    const consentB = await grantConsent(tokenGuardianB, raceMinorId, { tier: 'BASELINE', policyVersion: POLICY_VERSION, parentalResponsibilityDeclared: true });
    expect([consentA.status, consentB.status]).toEqual([201, 201]);

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer()).patch(`/v1/guardians/me/consent/${consentA.body.id}/withdraw`).set('Authorization', `Bearer ${tokenGuardianA}`),
      request(app.getHttpServer()).patch(`/v1/guardians/me/consent/${consentB.body.id}/withdraw`).set('Authorization', `Bearer ${tokenGuardianB}`),
    ]);
    expect([resA.status, resB.status]).toEqual([200, 200]);

    const raceMinor = await superuser.user.findUniqueOrThrow({ where: { id: raceMinorId } });
    expect(raceMinor.erasedAt).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // RLS — GuardianLink/ConsentRecord are narrow, self-only, no shared-visibility
  // branch at all (Decision 92). Direct Prisma, not HTTP — no HTTP endpoint
  // exposes another Guardian's raw rows to probe this via supertest alone, same
  // reasoning every prior phase's own RLS test documents.
  // ---------------------------------------------------------------------------

  it('RLS: Guardian B cannot read Guardian A\'s GuardianLink, ConsentRecord or ConsentEvent rows', async () => {
    const linksAsB = await withUser(guardianB.id, (tx) => tx.guardianLink.findMany({ where: { guardianId: guardianA.id } }));
    expect(linksAsB).toHaveLength(0);

    const consentAsB = await withUser(guardianB.id, (tx) => tx.consentRecord.findMany({ where: { guardianId: guardianA.id } }));
    expect(consentAsB).toHaveLength(0);

    const eventsAsB = await withUser(guardianB.id, (tx) => tx.consentEvent.findMany({ where: { guardianId: guardianA.id } }));
    expect(eventsAsB).toHaveLength(0);

    const linksAsA = await withUser(guardianA.id, (tx) => tx.guardianLink.findMany({ where: { guardianId: guardianA.id } }));
    expect(linksAsA.length).toBeGreaterThan(0);
  });

  it('RLS: the minor themselves cannot read their own GuardianLink/ConsentRecord rows (Guardian-exclusive per Decision 92)', async () => {
    const linksAsMinor = await withUser(minorId, (tx) => tx.guardianLink.findMany({ where: { studentId: minorId } }));
    expect(linksAsMinor).toHaveLength(0);
  });

  it('DB: consent history is append-only — a Guardian cannot change or delete their own ConsentEvent rows (Decision 170)', async () => {
    await expect(
      withUser(guardianA.id, (tx) => tx.consentEvent.updateMany({ where: { guardianId: guardianA.id }, data: { policyVersion: 'forged' } })),
    ).rejects.toThrow();
    await expect(withUser(guardianA.id, (tx) => tx.consentEvent.deleteMany({ where: { guardianId: guardianA.id } }))).rejects.toThrow();
  });

  it('DB: a Guardian cannot confirm their own link through the app role (Decision 172)', async () => {
    const own = await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardianB.id, studentId: guardianA.id } });
    await expect(
      withUser(guardianB.id, (tx) => tx.guardianLink.updateMany({ where: { id: own.id }, data: { confirmedAt: new Date() } })),
    ).rejects.toThrow();
    await expect(
      withUser(guardianB.id, (tx) =>
        tx.guardianLink.create({ data: { id: randomUUID(), guardianId: guardianB.id, studentId: teenGuardian.id, confirmedAt: new Date() } }),
      ),
    ).rejects.toThrow();
  });
});
