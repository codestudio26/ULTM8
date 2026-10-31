import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';
import { StepUpService } from '../src/auth/step-up.service';
import { TenantLifecyclePurgeProcessor } from '../src/jobs/tenant-lifecycle-purge.processor';
import { EntityOffboardingPurgeProcessor } from '../src/jobs/entity-offboarding-purge.processor';

/**
 * Decision 315 item 10 — medical information at sign-up: optional per School
 * (off by default), explicit consent from the member (the Guardian for a
 * child), seen only by the owner and Branch Staff with "See medical
 * information" for their own branches' students, never on a member-facing
 * endpoint, erased with the account and with the School. Decision 419 item 1:
 * the member (the Guardian for a child) sees that it is shared and can
 * withdraw consent, which deletes it; it is deleted when they leave the School.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[medical-info.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const ACCESS = {
  classes: false,
  bookings: true,
  students: true,
  cancelClasses: true,
  staffList: false,
  inviteCoaches: false,
  disciplines: false,
  checkInRules: false,
  exportStudents: false,
  freezeMemberships: false,
  attendanceStats: false,
  memberFiles: false,
  importData: false,
  seeMedicalInfo: false,
};

const ASTHMA = 'Asthma: inhaler in the kit bag.';
const ALLERGY = 'Peanut allergy (EpiPen).';

describeIfDb('Medical information (Decision 315 item 10)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let schoolA: { id: string };
  let schoolB: { id: string };
  let branch1: { id: string };
  let branch2: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const extraUserIds: string[] = [];
  const extraSchoolIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const join = (who: string, schoolId: string, body: Record<string, unknown>) => http().post(`/v1/schools/${schoolId}/join`).set(as(who)).send(body);
  const read = (who: string, studentId: string, schoolId = schoolA.id) => http().get(`/v1/schools/${schoolId}/students/${studentId}/medical-info`).set(as(who));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    jest.spyOn(app.get(NotificationDeliveryService), 'sendEmail').mockResolvedValue(undefined);

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Medical School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Medical School B' } });
    branch1 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'One' } });
    branch2 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Two' } });
    const people: Array<[string, Array<[Role, string, string | null]>, string]> = [
      ['owner', [['SCHOOL_OWNER_MANAGER', schoolA.id, null]], '1980-01-01'],
      ['staffOn', [['BRANCH_STAFF', schoolA.id, branch1.id]], '1985-01-01'],
      ['staffOff', [['BRANCH_STAFF', schoolA.id, branch1.id]], '1985-01-01'],
      ['staffOther', [['BRANCH_STAFF', schoolA.id, branch2.id]], '1985-01-01'],
      ['coach', [['INSTRUCTOR', schoolA.id, branch1.id]], '1985-01-01'],
      ['ownerB', [['SCHOOL_OWNER_MANAGER', schoolB.id, null]], '1980-01-01'],
      ['adult', [], '1995-01-01'],
      ['plain', [], '1995-01-01'],
      ['parent', [], '1985-01-01'],
      ['kid', [], '2016-01-01'],
    ];
    for (const [who, grants, dob] of people) {
      users[who] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `medical-${who}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: who[0].toUpperCase() + who.slice(1),
          surname: 'Med',
          passcodeHash: 'x',
          dateOfBirth: new Date(dob),
          phoneVerifiedAt: new Date(),
        },
      });
      for (const [role, schoolId, branchId] of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[who].id, schoolId, branchId } });
      tokens[who] = jwt.sign({
        sub: users[who].id,
        email: users[who].email,
        grants: grants.map(([role, schoolId, branchId]) => ({ role, franchiseId: null, schoolId, branchId })),
      });
    }
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id } });
    for (const who of ['staffOn', 'staffOther']) {
      await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: schoolA.id, userId: users[who].id, canSeeMedicalInfo: true } });
    }
  });

  afterAll(async () => {
    for (const id of [schoolA.id, schoolB.id]) {
      const where = { schoolId: id };
      const made = await superuser.signUp.findMany({ where: { ...where, userId: { not: null } }, select: { userId: true } });
      extraUserIds.push(...made.map((m) => m.userId as string));
      await superuser.studentMedicalInfo.deleteMany({ where });
      await superuser.signUp.deleteMany({ where });
      await superuser.frontDeskSession.deleteMany({ where });
      await superuser.studentHomeBranch.deleteMany({ where });
      await superuser.staffPermission.deleteMany({ where });
      await superuser.staffActivity.deleteMany({ where });
      await superuser.roleGrant.deleteMany({ where });
      await superuser.branch.deleteMany({ where });
    }
    await superuser.consentRecord.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: extraUserIds } } });
    await superuser.user.deleteMany({ where: { id: { in: [...extraUserIds, ...Object.values(users).map((u) => u.id)] } } });
    await superuser.waiver.deleteMany({ where: { schoolId: { in: extraSchoolIds } } });
    await superuser.studentMedicalInfo.deleteMany({ where: { schoolId: { in: extraSchoolIds } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id, ...extraSchoolIds] } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('the School setting', () => {
    it('is off by default; only the owner turns it on', async () => {
      const before = await http().get(`/v1/schools/${schoolA.id}`).set(as('owner'));
      expect(before.status).toBe(200);
      expect(before.body.medicalInfoEnabled).toBe(false);
      expect((await http().patch(`/v1/schools/${schoolA.id}`).set(as('staffOn')).send({ medicalInfoEnabled: true })).status).toBe(403);
      const on = await http().patch(`/v1/schools/${schoolA.id}`).set(as('owner')).send({ medicalInfoEnabled: true });
      expect(on.status).toBe(200);
      expect(on.body.medicalInfoEnabled).toBe(true);
      // The student app sees only whether joining asks for it.
      const academy = await http().get(`/v1/academies/${schoolA.id}`).set(as('adult'));
      expect(academy.status).toBe(200);
      expect(academy.body.medicalInfoEnabled).toBe(true);
    });

    it("a School that doesn't ask refuses medical information, and joins without it as before", async () => {
      const refused = await join('plain', schoolB.id, { medicalInfo: ASTHMA, medicalConsent: true });
      expect(refused.status).toBe(400);
      expect(refused.body.error.message).toBe("This School doesn't ask for medical information.");
      expect(await superuser.roleGrant.count({ where: { userId: users.plain.id, schoolId: schoolB.id } })).toBe(0);
      expect((await join('plain', schoolB.id, {})).status).toBe(201);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: users.plain.id } })).toBe(0);
    });
  });

  describe('consent', () => {
    it('without consent nothing is stored and the member does not join; with it, the member is recorded as consenting', async () => {
      const noConsent = await join('adult', schoolA.id, { branchId: branch1.id, medicalInfo: ASTHMA });
      expect(noConsent.status).toBe(400);
      expect(noConsent.body.error.message).toMatch(/kept only with consent/);
      expect(await superuser.roleGrant.count({ where: { userId: users.adult.id, schoolId: schoolA.id } })).toBe(0);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: users.adult.id } })).toBe(0);
      expect((await join('adult', schoolA.id, { branchId: branch1.id, medicalInfo: ASTHMA, medicalConsent: false })).status).toBe(400);

      const tooLong = await join('adult', schoolA.id, { branchId: branch1.id, medicalInfo: 'x'.repeat(2001), medicalConsent: true });
      expect(tooLong.status).toBe(400);

      const ok = await join('adult', schoolA.id, { branchId: branch1.id, medicalInfo: `  ${ASTHMA}  `, medicalConsent: true });
      expect(ok.status).toBe(201);
      const row = await superuser.studentMedicalInfo.findUniqueOrThrow({ where: { schoolId_studentId: { schoolId: schoolA.id, studentId: users.adult.id } } });
      expect(row).toMatchObject({ body: ASTHMA, consentedById: users.adult.id, consentedByGuardian: false });
      expect(row.consentedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it("a child's is given by their Guardian, never by the child", async () => {
      const bySelf = await join('kid', schoolA.id, { branchId: branch1.id, medicalInfo: ALLERGY, medicalConsent: true });
      expect(bySelf.status).toBe(403);
      expect(bySelf.body.error.message).toBe("A child's medical information is given by their Guardian.");
      expect(await superuser.roleGrant.count({ where: { userId: users.kid.id, schoolId: schoolA.id } })).toBe(0);

      // Nor anyone under 18 joining on their own, and an unknown date of birth
      // must be added first (it counts as under 18).
      for (const [label, dob] of [['teen', new Date('2012-06-01')], ['nodob', null]] as const) {
        const u = await superuser.user.create({
          data: { id: randomUUID(), email: `medical-${label}-${randomUUID()}@example.test`, firstName: label, surname: 'Med', passcodeHash: 'x', dateOfBirth: dob },
        });
        extraUserIds.push(u.id);
        tokens[label] = jwt.sign({ sub: u.id, email: u.email, grants: [] });
        const res = await join(label, schoolA.id, { branchId: branch1.id, medicalInfo: ALLERGY, medicalConsent: true });
        expect(res.status).toBe(403);
        expect(res.body.error.message).toBe(
          label === 'teen' ? "A child's medical information is given by their Guardian." : 'Add your date of birth to your profile before giving medical information.',
        );
        expect(await superuser.roleGrant.count({ where: { userId: u.id } })).toBe(0);
      }

      const byGuardian = await join('parent', schoolA.id, { studentId: users.kid.id, branchId: branch1.id, medicalInfo: ALLERGY, medicalConsent: true });
      expect(byGuardian.status).toBe(201);
      const row = await superuser.studentMedicalInfo.findUniqueOrThrow({ where: { schoolId_studentId: { schoolId: schoolA.id, studentId: users.kid.id } } });
      expect(row).toMatchObject({ body: ALLERGY, consentedById: users.parent.id, consentedByGuardian: true });
    });

    it('staff enrolling someone cannot give it for them', async () => {
      const res = await join('owner', schoolA.id, { studentId: users.plain.id, branchId: branch1.id, medicalInfo: ASTHMA, medicalConsent: true });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('Only the member, or the Guardian for a child, can give medical information.');
      expect(await superuser.roleGrant.count({ where: { userId: users.plain.id, schoolId: schoolA.id } })).toBe(0);
    });
  });

  describe('who sees it', () => {
    it('the owner, and Branch Staff with the switch for their own branches; nobody else', async () => {
      const owner = await read('owner', users.kid.id);
      expect(owner.status).toBe(200);
      expect(owner.body.medicalInfo).toMatchObject({ body: ALLERGY, consentedByName: 'Parent Med', consentedByGuardian: true });
      expect((await read('staffOn', users.adult.id)).body.medicalInfo.body).toBe(ASTHMA);

      const off = await read('staffOff', users.adult.id);
      expect(off.status).toBe(403);
      expect(off.body.error.message).toBe("The School owner hasn't let you see medical information.");
      // Switch on, but the student's home branch isn't theirs.
      expect((await read('staffOther', users.adult.id)).status).toBe(403);
      // Coaches never.
      expect((await read('coach', users.adult.id)).status).toBe(403);
      // A student with none.
      expect((await read('owner', users.staffOff.id)).body).toEqual({ medicalInfo: null });
    });

    it('the switch is on the Access page, off by default, and logged when changed', async () => {
      const me = await http().get(`/v1/schools/${schoolA.id}/staff/me/access`).set(as('staffOff'));
      expect(me.body.access.seeMedicalInfo).toBe(false);
      const put = await http().put(`/v1/schools/${schoolA.id}/staff/${users.staffOff.id}/access`).set(as('owner')).send({ ...ACCESS, seeMedicalInfo: true });
      expect(put.status).toBe(200);
      expect((await read('staffOff', users.adult.id)).status).toBe(200);
      const logged = await superuser.staffActivity.findFirstOrThrow({ where: { schoolId: schoolA.id, targetUserId: users.staffOff.id, action: 'ACCESS_CHANGED' } });
      expect(logged.details).toEqual({ changes: [{ switch: 'seeMedicalInfo', on: true }] });
      await http().put(`/v1/schools/${schoolA.id}/staff/${users.staffOff.id}/access`).set(as('owner')).send(ACCESS);
      expect((await read('staffOff', users.adult.id)).status).toBe(403);
    });

    it("never crosses Schools: another School's owner reads nothing", async () => {
      expect((await read('ownerB', users.adult.id)).status).toBe(403);
      const ownSchool = await read('ownerB', users.adult.id, schoolB.id);
      expect(ownSchool.status).toBe(200);
      expect(ownSchool.body).toEqual({ medicalInfo: null });
    });
  });

  describe('member-facing endpoints never show it', () => {
    it('the member and the Guardian are refused the staff read, and their own reads carry no medical text', async () => {
      expect((await read('adult', users.adult.id)).status).toBe(403);
      expect((await read('parent', users.kid.id)).status).toBe(403);
      for (const [who, path] of [
        ['adult', '/v1/users/me'],
        ['adult', `/v1/academies/${schoolA.id}`],
        ['adult', `/v1/schools/${schoolA.id}`],
        ['adult', '/v1/student-notes/me'],
        ['parent', '/v1/guardians/me/minors'],
        ['parent', `/v1/student-notes/me?studentId=${users.kid.id}`],
        // Decision 419 item 1: the member sees that it is shared, never the text.
        ['adult', `/v1/students/${users.adult.id}/medical-info`],
        ['parent', `/v1/students/${users.kid.id}/medical-info`],
      ] as const) {
        const res = await http().get(path).set(as(who));
        expect(res.status).toBeLessThan(500);
        expect(JSON.stringify(res.body)).not.toMatch(/Asthma|Peanut/);
      }
    });

    it('the app connection cannot read the table at all', async () => {
      await expect(
        superuser.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL ROLE ultm8_app');
          return tx.$queryRawUnsafe('SELECT body FROM "StudentMedicalInfo" LIMIT 1');
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('the front-desk tablet', () => {
    let tablet: string;
    beforeAll(async () => {
      const res = await http().post(`/v1/schools/${schoolA.id}/front-desk/sessions`).set(as('staffOn')).send({ branchId: branch1.id });
      expect(res.status).toBe(201);
      tablet = res.body.sessionToken;
    });
    const send = (body: Record<string, unknown>) => http().post('/v1/front-desk/kiosk/sign-ups').set('Authorization', `Bearer ${tablet}`).send(body);
    const adult = (over: Record<string, unknown> = {}) => ({
      kind: 'MEMBER',
      firstName: 'Tara',
      surname: 'Tablet',
      dateOfBirth: '1992-03-04',
      email: `medical-tablet-${randomUUID()}@example.test`,
      ...over,
    });

    it('asks only when the School does, needs consent, keeps it off the staff list, and moves it to the member on approval', async () => {
      const info = await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${tablet}`);
      expect(info.body.medicalInfoOn).toBe(true);

      const noConsent = await send(adult({ medicalInfo: ASTHMA }));
      expect(noConsent.status).toBe(400);
      const body = adult({ medicalInfo: ASTHMA, medicalConsent: true });
      const sent = await send(body);
      expect(sent.status).toBe(201);
      const waiting = await superuser.signUp.findUniqueOrThrow({ where: { id: sent.body.id } });
      expect(waiting.medicalInfo).toBe(ASTHMA);
      expect(waiting.medicalConsentAt).not.toBeNull();

      const list = await http().get(`/v1/schools/${schoolA.id}/sign-ups`).set(as('owner'));
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toMatch(/Asthma/);

      const approved = await http().post(`/v1/schools/${schoolA.id}/sign-ups/${sent.body.id}/approve`).set(as('owner')).send({});
      expect(approved.status).toBe(200);
      const member = await superuser.user.findUniqueOrThrow({ where: { email: body.email } });
      extraUserIds.push(member.id);
      const row = await superuser.studentMedicalInfo.findUniqueOrThrow({ where: { schoolId_studentId: { schoolId: schoolA.id, studentId: member.id } } });
      expect(row).toMatchObject({ body: ASTHMA, consentedById: member.id, consentedByGuardian: false, consentedAt: waiting.medicalConsentAt });
      expect(await superuser.signUp.findUniqueOrThrow({ where: { id: sent.body.id } })).toMatchObject({ medicalInfo: null, medicalConsentAt: null });
      expect(JSON.stringify(approved.body)).not.toMatch(/Asthma/);
    });

    it('an existing account gets it only by accepting the invite; declining drops it', async () => {
      const someone = await superuser.user.create({
        data: { id: randomUUID(), email: `medical-invited-${randomUUID()}@example.test`, firstName: 'Ivy', surname: 'Med', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') },
      });
      extraUserIds.push(someone.id);
      tokens.invited = jwt.sign({ sub: someone.id, email: someone.email, grants: [] });

      const first = await send(adult({ email: someone.email, medicalInfo: ASTHMA, medicalConsent: true }));
      expect((await http().post(`/v1/schools/${schoolA.id}/sign-ups/${first.body.id}/approve`).set(as('owner')).send({})).body.invited).toBe(true);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: someone.id } })).toBe(0);
      expect((await http().post(`/v1/sign-ups/invites/${first.body.id}/decline`).set(as('invited')).send()).status).toBeLessThan(300);
      expect(await superuser.signUp.findUniqueOrThrow({ where: { id: first.body.id } })).toMatchObject({ status: 'DECLINED', medicalInfo: null, medicalConsentAt: null });

      const second = await send(adult({ email: someone.email, medicalInfo: ALLERGY, medicalConsent: true }));
      await http().post(`/v1/schools/${schoolA.id}/sign-ups/${second.body.id}/approve`).set(as('owner')).send({});
      const accepted = await http().post(`/v1/sign-ups/invites/${second.body.id}/accept`).set(as('invited')).send({});
      expect(accepted.status).toBeLessThan(300);
      const row = await superuser.studentMedicalInfo.findUniqueOrThrow({ where: { schoolId_studentId: { schoolId: schoolA.id, studentId: someone.id } } });
      expect(row).toMatchObject({ body: ALLERGY, consentedById: someone.id, consentedByGuardian: false });
      expect((await superuser.signUp.findUniqueOrThrow({ where: { id: second.body.id } })).medicalInfo).toBeNull();
    });

    it("refuses it once the School stops asking", async () => {
      // A tablet sends at most 5 sign-ups a minute: start a fresh one.
      tablet = (await http().post(`/v1/schools/${schoolA.id}/front-desk/sessions`).set(as('staffOn')).send({ branchId: branch1.id })).body.sessionToken;
      await superuser.school.update({ where: { id: schoolA.id }, data: { medicalInfoEnabled: false } });
      try {
        expect((await http().get('/v1/front-desk/kiosk/session').set('Authorization', `Bearer ${tablet}`)).body.medicalInfoOn).toBe(false);
        expect((await send(adult({ medicalInfo: ASTHMA, medicalConsent: true }))).status).toBe(400);
        // An empty box is no medical information.
        expect((await send(adult({ medicalInfo: '   ' }))).status).toBe(201);
      } finally {
        await superuser.school.update({ where: { id: schoolA.id }, data: { medicalInfoEnabled: true } });
      }
    });
  });

  describe('withdrawing consent (Decision 419 item 1)', () => {
    const shared = (who: string, studentId: string) => http().get(`/v1/students/${studentId}/medical-info`).set(as(who));
    const withdraw = (who: string, studentId: string, schoolId = schoolA.id) => http().delete(`/v1/schools/${schoolId}/students/${studentId}/medical-info`).set(as(who));

    it('an adult member sees which Schools hold it (never the text) and withdraws it; staff then see none', async () => {
      // A front-desk sign-up at School B still waiting for them to accept counts too.
      const invite = await superuser.signUp.create({
        data: {
          schoolId: schoolB.id,
          kind: 'MEMBER',
          status: 'INVITED',
          userId: users.adult.id,
          firstName: 'Adult',
          surname: 'Med',
          dateOfBirth: new Date('1995-01-01'),
          email: users.adult.email,
          medicalInfo: ALLERGY,
          medicalConsentAt: new Date('2026-10-01T10:00:00Z'),
        },
      });

      const list = await shared('adult', users.adult.id);
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([
        { schoolId: schoolA.id, schoolName: 'Medical School A', consentedAt: expect.any(String), consentedByGuardian: false, awaitingAcceptance: false },
        { schoolId: schoolB.id, schoolName: 'Medical School B', consentedAt: '2026-10-01T10:00:00.000Z', consentedByGuardian: false, awaitingAcceptance: true },
      ]);
      expect(JSON.stringify(list.body)).not.toMatch(/Asthma|Peanut/);

      // Withdrawing at School B clears the waiting sign-up's text only.
      expect((await withdraw('adult', users.adult.id, schoolB.id)).status).toBe(204);
      expect(await superuser.signUp.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ status: 'INVITED', medicalInfo: null, medicalConsentAt: null });
      expect((await read('owner', users.adult.id)).body.medicalInfo.body).toBe(ASTHMA);

      const res = await withdraw('adult', users.adult.id);
      expect(res.status).toBe(204);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: users.adult.id } })).toBe(0);
      expect((await read('owner', users.adult.id)).body).toEqual({ medicalInfo: null });
      expect((await read('staffOn', users.adult.id)).body).toEqual({ medicalInfo: null });
      expect((await shared('adult', users.adult.id)).body).toEqual({ items: [] });
      // Still a member: withdrawing consent doesn't end the enrolment.
      expect(await superuser.roleGrant.count({ where: { userId: users.adult.id, schoolId: schoolA.id, role: 'STUDENT', revokedAt: null } })).toBe(1);
      // Nothing left to withdraw.
      expect((await withdraw('adult', users.adult.id)).status).toBe(404);
      await superuser.signUp.delete({ where: { id: invite.id } });
    });

    it("a Guardian sees and withdraws their child's; the child never can", async () => {
      const list = await shared('parent', users.kid.id);
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([
        { schoolId: schoolA.id, schoolName: 'Medical School A', consentedAt: expect.any(String), consentedByGuardian: true, awaitingAcceptance: false },
      ]);

      const kidList = await shared('kid', users.kid.id);
      expect(kidList.status).toBe(403);
      expect(kidList.body.error.message).toBe("A child's medical information is managed by their Guardian.");
      expect((await withdraw('kid', users.kid.id)).status).toBe(403);
      // Nor anyone under 18 by date of birth, Guardian-linked or not.
      const teen = await superuser.user.create({
        data: { id: randomUUID(), email: `medical-teen2-${randomUUID()}@example.test`, firstName: 'Teen', surname: 'Med', passcodeHash: 'x', dateOfBirth: new Date('2012-06-01') },
      });
      extraUserIds.push(teen.id);
      await superuser.studentMedicalInfo.create({ data: { id: randomUUID(), schoolId: schoolB.id, studentId: teen.id, body: ALLERGY, consentedAt: new Date() } });
      tokens.teen2 = jwt.sign({ sub: teen.id, email: teen.email, grants: [] });
      expect((await withdraw('teen2', teen.id, schoolB.id)).status).toBe(403);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: teen.id } })).toBe(1);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: users.kid.id } })).toBe(1);

      const res = await withdraw('parent', users.kid.id);
      expect(res.status).toBe(204);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: users.kid.id } })).toBe(0);
      expect((await read('owner', users.kid.id)).body).toEqual({ medicalInfo: null });
      expect((await shared('parent', users.kid.id)).body).toEqual({ items: [] });

      // Given again for the erasure tests below.
      await superuser.studentMedicalInfo.create({
        data: { id: randomUUID(), schoolId: schoolA.id, studentId: users.kid.id, body: ALLERGY, consentedById: users.parent.id, consentedByGuardian: true, consentedAt: new Date() },
      });
    });

    it("nobody else sees or withdraws it: other members, other Guardians, staff, another School's owner", async () => {
      const someone = await superuser.user.create({
        data: { id: randomUUID(), email: `medical-cross-${randomUUID()}@example.test`, firstName: 'Cross', surname: 'Med', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') },
      });
      extraUserIds.push(someone.id);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: someone.id, schoolId: schoolA.id } });
      await superuser.studentMedicalInfo.create({ data: { id: randomUUID(), schoolId: schoolA.id, studentId: someone.id, body: ASTHMA, consentedById: someone.id, consentedAt: new Date() } });

      for (const who of ['plain', 'parent', 'owner', 'staffOn', 'coach', 'ownerB']) {
        const list = await shared(who, someone.id);
        expect([who, list.status]).toEqual([who, 403]);
        expect([who, (await withdraw(who, someone.id)).status]).toEqual([who, 403]);
      }
      // A Guardian for another child, not this one.
      expect((await shared('parent', users.adult.id)).status).toBe(403);
      expect((await withdraw('ownerB', someone.id, schoolB.id)).status).toBe(403);
      // Withdrawing at another School leaves this School's alone.
      expect((await withdraw('adult', users.adult.id, schoolB.id)).status).toBe(404);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: someone.id } })).toBe(1);
    });
  });

  describe('leaving the School (Decision 419 item 1)', () => {
    it("is deleted when the owner removes the student, at that School only", async () => {
      const leaver = await superuser.user.create({
        data: { id: randomUUID(), email: `medical-leaver-${randomUUID()}@example.test`, firstName: 'Leaver', surname: 'Med', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') },
      });
      extraUserIds.push(leaver.id);
      const grantA = await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: leaver.id, schoolId: schoolA.id } });
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: leaver.id, schoolId: schoolB.id } });
      for (const schoolId of [schoolA.id, schoolB.id]) {
        await superuser.studentMedicalInfo.create({ data: { id: randomUUID(), schoolId, studentId: leaver.id, body: ASTHMA, consentedById: leaver.id, consentedAt: new Date() } });
      }

      const res = await http().delete(`/v1/users/${leaver.id}/role-grants/${grantA.id}`).set(as('owner'));
      expect(res.status).toBe(200);
      expect(await superuser.studentMedicalInfo.count({ where: { schoolId: schoolA.id, studentId: leaver.id } })).toBe(0);
      expect((await read('owner', leaver.id)).body).toEqual({ medicalInfo: null });
      // Still a Student at School B, which keeps theirs.
      expect(await superuser.studentMedicalInfo.count({ where: { schoolId: schoolB.id, studentId: leaver.id } })).toBe(1);
    });

    it('the daily sweep deletes it for anyone no longer a Student there, and keeps current students\'', async () => {
      const drifter = await superuser.user.create({
        data: { id: randomUUID(), email: `medical-drifter-${randomUUID()}@example.test`, firstName: 'Drifter', surname: 'Med', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') },
      });
      extraUserIds.push(drifter.id);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: drifter.id, schoolId: schoolA.id, revokedAt: new Date() } });
      await superuser.studentMedicalInfo.create({ data: { id: randomUUID(), schoolId: schoolA.id, studentId: drifter.id, body: ASTHMA, consentedById: drifter.id, consentedAt: new Date() } });
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: users.kid.id } })).toBe(1);

      await app.get(EntityOffboardingPurgeProcessor).process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);

      expect(await superuser.studentMedicalInfo.count({ where: { studentId: drifter.id } })).toBe(0);
      // The child is still a Student at School A.
      expect(await superuser.studentMedicalInfo.count({ where: { schoolId: schoolA.id, studentId: users.kid.id } })).toBe(1);
    });
  });

  describe('erasure', () => {
    it("goes when a Guardian withdraws a child's baseline consent", async () => {
      const consent = await superuser.consentRecord.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id, tier: 'BASELINE', policyVersion: 'v1' } });
      jest.spyOn(app.get(StepUpService), 'assertVerified').mockImplementation(() => undefined);
      const res = await http().patch(`/v1/guardians/me/consent/${consent.id}/withdraw`).set(as('parent')).send({});
      expect(res.status).toBe(200);
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: users.kid.id } })).toBe(0);
    });

    it("goes with the member's account", async () => {
      const gone = await superuser.user.create({
        data: { id: randomUUID(), email: `medical-gone-${randomUUID()}@example.test`, firstName: 'Gone', surname: 'Med', passcodeHash: 'x' },
      });
      await superuser.studentMedicalInfo.create({ data: { id: randomUUID(), schoolId: schoolA.id, studentId: gone.id, body: ASTHMA, consentedById: gone.id, consentedAt: new Date() } });
      await superuser.user.delete({ where: { id: gone.id } });
      expect(await superuser.studentMedicalInfo.count({ where: { studentId: gone.id } })).toBe(0);
    });

    it('goes with the School, even when a closed School is kept (anonymised) for its waivers', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const closed = await superuser.school.create({ data: { id: randomUUID(), name: 'Medical closed', archivedAt: past, purgeAt: past, medicalInfoEnabled: true } });
      extraSchoolIds.push(closed.id);
      await superuser.waiver.create({ data: { id: randomUUID(), schoolId: closed.id, title: 'Waiver', body: 'Terms' } });
      await superuser.studentMedicalInfo.create({ data: { id: randomUUID(), schoolId: closed.id, studentId: users.plain.id, body: ASTHMA, consentedById: users.plain.id, consentedAt: new Date() } });
      await superuser.signUp.create({
        data: { schoolId: closed.id, kind: 'MEMBER', firstName: 'S', surname: 'U', dateOfBirth: new Date('1990-01-01'), email: `medical-su-${randomUUID()}@example.test`, medicalInfo: ALLERGY, medicalConsentAt: new Date() },
      });

      await app.get(TenantLifecyclePurgeProcessor).process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);

      expect((await superuser.school.findUniqueOrThrow({ where: { id: closed.id } })).name).toBe('[Closed School]');
      expect(await superuser.studentMedicalInfo.count({ where: { schoolId: closed.id } })).toBe(0);
      expect(await superuser.signUp.count({ where: { schoolId: closed.id, medicalInfo: { not: null } } })).toBe(0);
      await superuser.signUp.deleteMany({ where: { schoolId: closed.id } });
    });
  });
});
