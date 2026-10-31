/**
 * Merge duplicate members (Decision 315 item 13). Two Student records at the
 * same School are the same person: the duplicate's records at this School
 * move to the kept record and the duplicate stops being a Student there. The
 * duplicate's account (login) and everything they have at another School are
 * never changed. Owner only; refused whenever moving would break a rule.
 *
 * Every table member-merge-tables.ts lists gets a row for the duplicate here,
 * and each is checked after the merge.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma, PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';
import { MERGE_TABLES, type MergeTable } from '../src/member-merge/member-merge-tables';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[member-merge.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';
type Grant = [Role, string, string | null];

/** Tables cleaned up after the spec, children first. */
const CLEANUP_TABLES = [
  'StaffActivity',
  'RosterMember',
  'Roster',
  'StudentAbsenceAlert',
  'ChargeRefund',
  'ChargeAllocation',
  'BalanceEntry',
  'Charge',
  'RecurringCharge',
  'PromotionFeeRequest',
  'RankCorrectionRequest',
  'TrainingLog',
  'SkillSignOffLog',
  'PromotionEventNoteLog',
  'PromotionEvent',
  'StudentRankSkillStatus',
  'StudentRank',
  'MembershipFreeze',
  'PackRecharge',
  'WaitlistEntry',
  'Transaction',
  'Booking',
  'Membership',
  'MembershipPlan',
  'PaymentAccount',
  'WaiverSignature',
  'Waiver',
  'StudentNote',
  'MemberFile',
  'ChildInvite',
  'SignUp',
  'Favorite',
  'WatchHistory',
  'Lesson',
  'StudentTag',
  'SchoolTag',
  'StudentHomeBranch',
  'StudentCheckInCode',
  'StudentJoinDate',
  'Class',
  'RankStripeTier',
  'Skill',
  'Rank',
  'Discipline',
  'RoleGrant',
  'Branch',
];

describeIfDb('Merge duplicate members (Decision 315 item 13)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const r2 = { isConfigured: () => true };

  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const schoolIds = [schoolA, schoolB];
  const users: Record<string, { id: string; email: string; passcodeHash: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`),
    post: (path: string) => http().post(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const mergePath = (keptId: string, school = schoolA) => `/v1/schools/${school}/students/${keptId}/merge`;
  const preview = (who: string, keptId: string, duplicateId: string, school = schoolA) =>
    as(who).get(`${mergePath(keptId, school)}/preview?duplicateId=${duplicateId}`);
  const merge = (who: string, keptId: string, duplicateId: string, school = schoolA) => as(who).post(mergePath(keptId, school)).send({ duplicateId });

  let invoice = 1;
  let phone = 0;
  async function mkUser(label: string, grants: Grant[], dateOfBirth = '1990-01-01') {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `merge-${label}-${randomUUID()}@example.test`,
        phone: `+1555${String(Date.now() % 1_000_000).padStart(6, '0')}${String(phone++).padStart(4, '0')}`,
        firstName: label,
        surname: 'Merge',
        passcodeHash: `hash-${label}`,
        dateOfBirth: new Date(dateOfBirth),
        phoneVerifiedAt: new Date(),
      },
    });
    for (const [role, sid, branchId] of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label].id, schoolId: sid, branchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' } });
    }
    tokens[label] = jwt.sign({
      sub: users[label].id,
      email: users[label].email,
      grants: grants.map(([role, sid, branchId]) => ({ role, franchiseId: null, schoolId: sid, branchId })),
    });
    return users[label];
  }

  /** The School's catalogue the student rows hang off. */
  const cat = {} as Record<string, string>;
  async function mkCatalogue(school: string, p: string) {
    const id = (k: string) => (cat[`${p}${k}`] = randomUUID());
    await superuser.paymentAccount.create({ data: { id: id('account'), schoolId: school, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
    await superuser.membershipPlan.createMany({
      data: [
        { id: id('unlimited'), schoolId: school, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
        { id: id('pack'), schoolId: school, type: 'CLASS_PACK', title: 'Ten classes', price: 9000 },
      ],
    });
    await superuser.discipline.createMany({
      data: [
        { id: id('bjj'), schoolId: school, name: 'BJJ' },
        { id: id('judo'), schoolId: school, name: 'Judo' },
      ],
    });
    for (const style of ['bjj', 'judo']) {
      await superuser.rank.create({ data: { id: id(`${style}White`), disciplineId: cat[`${p}${style}`], schoolId: school, order: 1, name: 'White', primaryColour: '#fff' } });
      await superuser.rankStripeTier.create({
        data: { id: id(`${style}Tier`), rankId: cat[`${p}${style}White`], schoolId: school, order: 0, count: 0, colour: '#fff', name: 'White' },
      });
      await superuser.skill.create({ data: { id: id(`${style}Skill`), disciplineId: cat[`${p}${style}`], schoolId: school, name: 'Shrimp' } });
    }
    const day = (n: number) => new Date(Date.now() + n * 86_400_000);
    await superuser.class.createMany({
      data: [
        { id: id('class1'), schoolId: school, title: 'Fundamentals', startDate: day(3), endDate: new Date(day(3).getTime() + 3_600_000) },
        { id: id('class2'), schoolId: school, title: 'Advanced', startDate: day(4), endDate: new Date(day(4).getTime() + 3_600_000) },
        { id: id('class3'), schoolId: school, title: 'Open mat', startDate: day(5), endDate: new Date(day(5).getTime() + 3_600_000) },
      ],
    });
    await superuser.lesson.createMany({
      data: [
        { id: id('lesson1'), schoolId: school, title: 'Guard', format: 'PRERECORDED' },
        { id: id('lesson2'), schoolId: school, title: 'Pass', format: 'PRERECORDED' },
      ],
    });
    await superuser.schoolTag.createMany({
      data: [
        { id: id('tag1'), schoolId: school, name: 'Competitor' },
        { id: id('tag2'), schoolId: school, name: 'Morning' },
      ],
    });
    await superuser.waiver.createMany({
      data: [1, 2, 3, 4, 5, 6].map((n) => ({ id: id(`waiver${n}`), schoolId: school, title: `Waiver ${n}`, body: `Text ${n}` })),
    });
    await superuser.roster.createMany({
      data: [
        { id: id('roster1'), schoolId: school, name: 'Comp team' },
        { id: id('roster2'), schoolId: school, name: 'Kids' },
      ],
    });
  }

  /** One row in every merged table for `studentId` at `school`, as the student's own. */
  async function seedEverything(studentId: string, school: string, p: string, guardianId: string) {
    const c = (k: string) => cat[`${p}${k}`];
    const membershipId = randomUUID();
    await superuser.membership.create({
      data: { id: membershipId, studentId, schoolId: school, membershipPlanId: c('pack'), frequency: 'ONE_TIME', status: 'ACTIVE', classesRemaining: 5 },
    });
    await superuser.membershipFreeze.create({
      data: { id: randomUUID(), membershipId, schoolId: school, studentId, startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000), status: 'APPROVED' },
    });
    await superuser.packRecharge.create({
      data: {
        id: randomUUID(),
        schoolId: school,
        studentId,
        membershipPlanId: c('pack'),
        requestedById: users.ownerA.id,
        checkInMethod: 'PERSONAL_CODE',
        expiresAt: new Date(Date.now() - 86_400_000),
        completedAt: new Date(Date.now() - 86_400_000),
      },
    });
    const transactionId = randomUUID();
    await superuser.transaction.create({
      data: { id: transactionId, schoolId: school, studentId, paymentAccountId: c('account'), amount: 9000, status: 'SUCCESSFUL', paymentMethod: 'CASH', membershipId },
    });
    await superuser.booking.create({ data: { id: randomUUID(), studentId, classId: c('class1'), schoolId: school, sourceMembershipId: membershipId } });
    await superuser.waitlistEntry.create({ data: { id: randomUUID(), studentId, classId: c('class2'), schoolId: school, position: 1 } });
    const studentRankId = randomUUID();
    await superuser.studentRank.create({
      data: { id: studentRankId, studentId, disciplineId: c('bjj'), schoolId: school, currentRankId: c('bjjWhite'), currentStripeId: c('bjjTier') },
    });
    await superuser.studentRankSkillStatus.create({ data: { id: randomUUID(), studentRankId, schoolId: school, studentId, skillId: c('bjjSkill') } });
    const promotionEventId = randomUUID();
    await superuser.promotionEvent.create({ data: { id: promotionEventId, studentRankId, schoolId: school, studentId, type: 'PROMOTION', toRankId: c('bjjWhite') } });
    await superuser.promotionEventNoteLog.create({ data: { id: randomUUID(), promotionEventId, schoolId: school, studentId, change: 'EDITED' } });
    await superuser.skillSignOffLog.create({
      data: { id: randomUUID(), studentRankId, schoolId: school, studentId, skillId: c('bjjSkill'), fromStatus: 'NOT_STARTED', toStatus: 'LEARNING' },
    });
    await superuser.trainingLog.create({ data: { id: randomUUID(), schoolId: school, studentId, disciplineId: c('bjj'), minutes: 60, source: 'LOGGED', trainedAt: new Date() } });
    await superuser.rankCorrectionRequest.create({
      data: {
        id: randomUUID(),
        schoolId: school,
        studentId,
        disciplineId: c('bjj'),
        fromRankId: c('bjjWhite'),
        requestedRankId: c('bjjWhite'),
        requestedStripeTierId: c('bjjTier'),
        note: 'Please check',
      },
    });
    const feeRequestId = randomUUID();
    await superuser.promotionFeeRequest.create({
      data: { id: feeRequestId, schoolId: school, studentId, disciplineId: c('bjj'), toRungId: c('bjjTier'), toRungName: 'White', amountMinor: 1000, promotionWaits: false },
    });
    const charge = (extra: Partial<Prisma.ChargeUncheckedCreateInput> = {}) => ({
      id: randomUUID(),
      schoolId: school,
      studentId,
      invoiceNumber: invoice++,
      description: 'Gi',
      unitAmount: 1000,
      taxRateBasisPoints: 0,
      taxInclusive: false,
      netAmount: 1000,
      taxAmount: 0,
      grossAmount: 1000,
      currency: 'GBP',
      dueDate: new Date(),
      ...extra,
    });
    const chargeId = randomUUID();
    await superuser.charge.create({ data: { ...charge(), id: chargeId } });
    // A promotion-fee charge: its request moves first (Charge_promotion_fee_same_owner).
    await superuser.charge.create({ data: charge({ promotionFeeRequestId: feeRequestId }) });
    await superuser.chargeAllocation.create({ data: { id: randomUUID(), schoolId: school, studentId, chargeId, transactionId, amount: 1000 } });
    await superuser.balanceEntry.create({ data: { id: randomUUID(), schoolId: school, studentId, kind: 'CHARGE', amount: 1000, currency: 'GBP', chargeId } });
    await superuser.chargeRefund.create({ data: { id: randomUUID(), schoolId: school, studentId, transactionId, kind: 'MONEY_BACK', amount: 100, currency: 'GBP' } });
    await superuser.recurringCharge.create({
      data: { id: randomUUID(), schoolId: school, studentId, description: 'Locker', unitAmount: 500, currency: 'GBP', frequency: 'MONTHLY', firstDate: new Date() },
    });
    await superuser.studentNote.create({ data: { id: randomUUID(), schoolId: school, studentId, body: 'Prefers mornings' } });
    await superuser.memberFile.create({
      data: { id: randomUUID(), schoolId: school, studentId, fileName: 'id.pdf', contentType: 'application/pdf', sizeBytes: 10, objectKey: `member-files/${school}/${studentId}/${randomUUID()}.pdf` },
    });
    await superuser.childInvite.create({
      data: { id: randomUUID(), schoolId: school, guardianId, studentId, childFirstName: 'Kid', childSurname: 'Merge', childDateOfBirth: new Date('2015-01-01'), status: 'ACCEPTED' },
    });
    await superuser.signUp.create({
      data: { id: randomUUID(), schoolId: school, userId: studentId, kind: 'MEMBER', firstName: 'Sign', surname: 'Up', dateOfBirth: new Date('1990-01-01'), email: `su-${randomUUID()}@example.test`, status: 'APPROVED' },
    });
    await superuser.favorite.createMany({
      data: [
        { id: randomUUID(), studentId, lessonId: c('lesson1'), schoolId: school },
        { id: randomUUID(), studentId, lessonId: c('lesson2'), schoolId: school },
      ],
    });
    await superuser.watchHistory.create({ data: { id: randomUUID(), studentId, lessonId: c('lesson1'), schoolId: school } });
    await superuser.studentTag.createMany({
      data: [
        { tagId: c('tag1'), schoolId: school, studentId },
        { tagId: c('tag2'), schoolId: school, studentId },
      ],
    });
    await superuser.rosterMember.createMany({
      data: [
        { rosterId: c('roster1'), schoolId: school, studentId },
        { rosterId: c('roster2'), schoolId: school, studentId },
      ],
    });
    await superuser.studentAbsenceAlert.create({ data: { schoolId: school, studentId, absentSince: new Date('2026-01-01') } });
  }

  const signed = (waiverId: string, studentId: string, school: string, extra: Partial<Prisma.WaiverSignatureUncheckedCreateInput> = {}) => ({
    id: randomUUID(),
    waiverId,
    studentId,
    schoolId: school,
    signedById: studentId,
    signerFullName: 'Signer',
    signatureText: 'Signer',
    signedDate: new Date(),
    status: 'SIGNED' as const,
    ...extra,
  });
  const unsigned = (waiverId: string, studentId: string, school: string) => ({
    id: randomUUID(),
    waiverId,
    studentId,
    schoolId: school,
    signedById: null,
    signerFullName: null,
    signatureText: null,
    signedDate: null,
    status: 'UNSIGNED' as const,
  });

  /** Rows `studentId` has at `school`, per merged table. */
  async function countsOf(studentId: string, school: string): Promise<Record<MergeTable, number>> {
    const out = {} as Record<MergeTable, number>;
    for (const table of MERGE_TABLES) {
      const column = table === 'SignUp' ? '"userId"' : '"studentId"';
      const [row] = await superuser.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM "${table}" WHERE "schoolId" = $1 AND ${column} = $2`,
        school,
        studentId,
      );
      out[table] = Number(row.n);
    }
    return out;
  }

  const sig: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ClientService)
      .useValue(r2)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.createMany({ data: [{ id: schoolA, name: 'Merge School A' }, { id: schoolB, name: 'Merge School B' }] });
    await superuser.branch.createMany({
      data: [
        { id: branchA1, schoolId: schoolA, name: 'A1' },
        { id: branchA2, schoolId: schoolA, name: 'A2' },
      ],
    });
    await mkUser('ownerA', [['SCHOOL_OWNER_MANAGER', schoolA, null]]);
    await mkUser('staffA', [['BRANCH_STAFF', schoolA, branchA1]]);
    await mkUser('ownerB', [['SCHOOL_OWNER_MANAGER', schoolB, null]]);
    // The pair that is merged: Kate is kept, Dan is the duplicate. Dan is
    // also a Student at School B, whose records must not move.
    await mkUser('kate', [['STUDENT', schoolA, null]]);
    await mkUser('dan', [['STUDENT', schoolA, null], ['STUDENT', schoolB, null]]);
    await mkUser('guardian', []);
    await mkUser('guardian2', []);
    await mkUser('onlyB', [['STUDENT', schoolB, null]]);
    // A pair with every blocker.
    await mkUser('xena', [['STUDENT', schoolA, null]]);
    await mkUser('yuri', [['STUDENT', schoolA, null]], '2014-05-05');
    // Two children of the same Guardian (allowed), and one of another Guardian.
    await mkUser('kidA', [['STUDENT', schoolA, null]], '2015-02-02');
    await mkUser('kidB', [['STUDENT', schoolA, null]], '2015-02-02');
    await mkUser('kidC', [['STUDENT', schoolA, null]], '2015-02-02');

    await mkCatalogue(schoolA, 'A');
    await mkCatalogue(schoolB, 'B');

    await seedEverything(users.dan.id, schoolA, 'A', users.guardian.id);
    await seedEverything(users.dan.id, schoolB, 'B', users.guardian.id);

    // Kate already has: an unlimited membership, the same favourite lesson and
    // tag as Dan, a later join date, her own check-in code and home branch.
    const kateMembership = randomUUID();
    await superuser.membership.create({
      data: { id: kateMembership, studentId: users.kate.id, schoolId: schoolA, membershipPlanId: cat.Aunlimited, frequency: 'RECURRING', status: 'ACTIVE' },
    });
    await superuser.booking.create({ data: { id: randomUUID(), studentId: users.kate.id, classId: cat.Aclass3, schoolId: schoolA, sourceMembershipId: kateMembership } });
    await superuser.favorite.create({ data: { id: randomUUID(), studentId: users.kate.id, lessonId: cat.Alesson1, schoolId: schoolA } });
    await superuser.studentTag.create({ data: { tagId: cat.Atag1, schoolId: schoolA, studentId: users.kate.id } });
    await superuser.rosterMember.create({ data: { rosterId: cat.Aroster1, schoolId: schoolA, studentId: users.kate.id } });
    await superuser.studentJoinDate.updateMany({ where: { schoolId: schoolA, studentId: users.kate.id }, data: { joinedOn: new Date('2024-06-01') } });
    await superuser.studentJoinDate.updateMany({ where: { schoolId: schoolA, studentId: users.dan.id }, data: { joinedOn: new Date('2021-03-15') } });
    await superuser.studentCheckInCode.createMany({
      data: [
        { id: randomUUID(), schoolId: schoolA, studentId: users.kate.id, code: '1111' },
        { id: randomUUID(), schoolId: schoolA, studentId: users.dan.id, code: '2222' },
      ],
    });
    await superuser.studentHomeBranch.createMany({
      data: [
        { id: randomUUID(), schoolId: schoolA, studentId: users.kate.id, branchId: branchA1 },
        { id: randomUUID(), schoolId: schoolA, studentId: users.dan.id, branchId: branchA2 },
      ],
    });

    // Waiver signatures, one case per waiver:
    // 1 only Dan signed; 2 Dan signed, Kate's is unsigned; 3 Dan's is
    // unsigned, Kate signed; 4 both signed; 5 Dan's expired, Kate signed;
    // 6 Dan's signed by his Guardian.
    const rec = <T extends { id: string }>(key: string, r: T) => {
      sig[key] = r.id;
      return r;
    };
    const rows: Prisma.WaiverSignatureCreateManyInput[] = [
      rec('w1Dan', signed(cat.Awaiver1, users.dan.id, schoolA)),
      rec('w2Dan', signed(cat.Awaiver2, users.dan.id, schoolA)),
      rec('w2Kate', unsigned(cat.Awaiver2, users.kate.id, schoolA)),
      rec('w3Dan', unsigned(cat.Awaiver3, users.dan.id, schoolA)),
      rec('w3Kate', signed(cat.Awaiver3, users.kate.id, schoolA)),
      rec('w4Dan', signed(cat.Awaiver4, users.dan.id, schoolA)),
      rec('w4Kate', signed(cat.Awaiver4, users.kate.id, schoolA)),
      rec('w5Dan', signed(cat.Awaiver5, users.dan.id, schoolA, { status: 'EXPIRED' })),
      rec('w5Kate', signed(cat.Awaiver5, users.kate.id, schoolA)),
      rec('w6Dan', signed(cat.Awaiver6, users.dan.id, schoolA, { signedById: users.guardian.id })),
      rec('bDan', signed(cat.Bwaiver1, users.dan.id, schoolB)),
    ];
    await superuser.waiverSignature.createMany({ data: rows });

    // Xena and Yuri: every reason not to merge at once.
    const xenaUnlimited = randomUUID();
    const yuriUnlimited = randomUUID();
    await superuser.membership.createMany({
      data: [
        { id: xenaUnlimited, studentId: users.xena.id, schoolId: schoolA, membershipPlanId: cat.Aunlimited, frequency: 'RECURRING', status: 'ACTIVE' },
        { id: yuriUnlimited, studentId: users.yuri.id, schoolId: schoolA, membershipPlanId: cat.Aunlimited, frequency: 'RECURRING', status: 'ACTIVE', stripeSubscriptionId: `sub_${randomUUID()}` },
      ],
    });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.guardian.id, studentId: users.yuri.id } });
    await superuser.transaction.create({
      data: { id: randomUUID(), schoolId: schoolA, studentId: users.xena.id, paymentAccountId: cat.Aaccount, amount: 100, status: 'PENDING', paymentMethod: 'STRIPE' },
    });
    await superuser.packRecharge.create({
      data: { id: randomUUID(), schoolId: schoolA, studentId: users.yuri.id, membershipPlanId: cat.Apack, requestedById: users.ownerA.id, checkInMethod: 'PERSONAL_CODE', expiresAt: new Date(Date.now() + 3_600_000) },
    });
    for (const [who, membershipId] of [['xena', xenaUnlimited], ['yuri', yuriUnlimited]] as const) {
      await superuser.studentRank.create({ data: { id: randomUUID(), studentId: users[who].id, disciplineId: cat.Ajudo, schoolId: schoolA, currentRankId: cat.AjudoWhite } });
      await superuser.rankCorrectionRequest.create({
        data: { id: randomUUID(), schoolId: schoolA, studentId: users[who].id, disciplineId: cat.Ajudo, fromRankId: cat.AjudoWhite, requestedRankId: cat.AjudoWhite, requestedStripeTierId: cat.AjudoTier, note: 'x' },
      });
      await superuser.booking.create({ data: { id: randomUUID(), studentId: users[who].id, classId: cat.Aclass1, schoolId: schoolA, sourceMembershipId: membershipId } });
      await superuser.waitlistEntry.create({ data: { id: randomUUID(), studentId: users[who].id, classId: cat.Aclass2, schoolId: schoolA, position: who === 'xena' ? 2 : 3 } });
    }
    await superuser.signUp.create({
      data: { id: randomUUID(), schoolId: schoolA, userId: users.yuri.id, kind: 'MEMBER', firstName: 'Y', surname: 'U', dateOfBirth: new Date('2014-05-05'), email: `su-${randomUUID()}@example.test`, status: 'PENDING' },
    });
    await superuser.childInvite.create({
      data: { id: randomUUID(), schoolId: schoolA, guardianId: users.guardian.id, studentId: users.yuri.id, childFirstName: 'Y', childSurname: 'U', childDateOfBirth: new Date('2014-05-05'), status: 'PENDING' },
    });

    await superuser.guardianLink.createMany({
      data: [
        { id: randomUUID(), guardianId: users.guardian.id, studentId: users.kidA.id },
        { id: randomUUID(), guardianId: users.guardian.id, studentId: users.kidB.id },
        { id: randomUUID(), guardianId: users.guardian2.id, studentId: users.kidC.id },
      ],
    });
  });

  afterAll(async () => {
    for (const table of CLEANUP_TABLES) {
      await superuser.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "schoolId" = ANY($1::text[])`, schoolIds);
    }
    const ids = Object.values(users).map((u) => u.id);
    await superuser.guardianLink.deleteMany({ where: { studentId: { in: ids } } });
    await superuser.user.deleteMany({ where: { id: { in: ids } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('only the School owner may preview or merge: Branch Staff, a student and another School’s owner are refused', async () => {
    expect((await preview('staffA', users.kate.id, users.dan.id)).status).toBe(403);
    expect((await merge('staffA', users.kate.id, users.dan.id)).status).toBe(403);
    expect((await preview('kate', users.kate.id, users.dan.id)).status).toBe(403);
    // Cross-tenant: School B's owner, through School A's path and through their own.
    expect((await preview('ownerB', users.kate.id, users.dan.id)).status).toBe(403);
    expect((await merge('ownerB', users.kate.id, users.dan.id)).status).toBe(403);
    const viaB = await merge('ownerB', users.onlyB.id, users.kate.id, schoolB);
    expect(viaB.status).toBe(404);
    expect(viaB.body.error.message).toBe('This person is not a Student at this School.');
  });

  it("refuses the same person twice, and anyone who isn't a current Student at this School", async () => {
    const same = await preview('ownerA', users.kate.id, users.kate.id);
    expect(same.status).toBe(400);
    expect(same.body.error.message).toBe('Choose two different students.');
    // A Student at School B only can't be merged into School A's member, either way round.
    expect((await preview('ownerA', users.kate.id, users.onlyB.id)).status).toBe(404);
    expect((await merge('ownerA', users.onlyB.id, users.kate.id)).status).toBe(404);
    expect((await merge('ownerA', users.kate.id, users.ownerA.id)).status).toBe(404);
  });

  it('the preview lists every reason not to merge, and the merge is then refused with nothing changed', async () => {
    const res = await preview('ownerA', users.xena.id, users.yuri.id);
    expect(res.status).toBe(200);
    expect(res.body.kept).toEqual({ id: users.xena.id, name: 'xena Merge' });
    expect(res.body.duplicate).toEqual({ id: users.yuri.id, name: 'yuri Merge' });
    const codes = res.body.blockers.map((b: { code: string }) => b.code).sort();
    expect(codes).toEqual(
      [
        'BOTH_UNLIMITED_MEMBERSHIPS',
        'DUPLICATE_HAS_SUBSCRIPTION',
        'GUARDIANS_DIFFER',
        'OPEN_PACK_RECHARGE',
        'OPEN_SIGN_UP',
        'PENDING_CARD_PAYMENT',
        'PENDING_CHILD_INVITE',
        'SAME_CLASS_BOOKED',
        'SAME_CLASS_WAITLIST',
        'SAME_STYLE_CORRECTION',
        'SAME_STYLE_RANK',
      ].sort(),
    );
    expect(res.body.blockers.find((b: { code: string }) => b.code === 'SAME_STYLE_RANK').details).toEqual(['Judo']);
    expect(res.body.blockers.find((b: { code: string }) => b.code === 'SAME_CLASS_BOOKED').details).toEqual(['Fundamentals']);

    const before = await countsOf(users.yuri.id, schoolA);
    const refused = await merge('ownerA', users.xena.id, users.yuri.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('MERGE_BLOCKED');
    expect(await countsOf(users.yuri.id, schoolA)).toEqual(before);
    expect(await superuser.roleGrant.count({ where: { userId: users.yuri.id, schoolId: schoolA, role: 'STUDENT', revokedAt: null } })).toBe(1);
  });

  it("Guardian-managed children merge only when their Guardians are the same", async () => {
    const other = await preview('ownerA', users.kidA.id, users.kidC.id);
    expect(other.body.blockers.map((b: { code: string }) => b.code)).toEqual(['GUARDIANS_DIFFER']);
    expect((await merge('ownerA', users.kidA.id, users.kidC.id)).status).toBe(409);
    // An adult and a Guardian-managed child are never the same record.
    expect((await preview('ownerA', users.kate.id, users.kidA.id)).body.blockers.map((b: { code: string }) => b.code)).toEqual(['GUARDIANS_DIFFER']);

    const same = await merge('ownerA', users.kidA.id, users.kidB.id);
    expect(same.status).toBe(201);
    // The Guardian links are the person's, not the School's: untouched.
    expect(await superuser.guardianLink.count({ where: { studentId: users.kidB.id, revokedAt: null } })).toBe(1);
  });

  it("the preview counts the duplicate's rows at this School, in every table, and changes nothing", async () => {
    const before = await countsOf(users.dan.id, schoolA);
    const res = await preview('ownerA', users.kate.id, users.dan.id);
    expect(res.status).toBe(200);
    expect(res.body.blockers).toEqual([]);
    expect(res.body.records).toEqual(before);
    // Every table has something to move, so the merge below checks them all.
    for (const table of MERGE_TABLES) expect([table, before[table]]).toEqual([table, expect.any(Number)]);
    expect(Object.entries(before).filter(([, n]) => n === 0)).toEqual([]);
    expect(await countsOf(users.dan.id, schoolA)).toEqual(before);
  });

  it("moves every record of the duplicate's at this School to the kept member, and only those", async () => {
    const danBefore = await countsOf(users.dan.id, schoolA);
    const kateBefore = await countsOf(users.kate.id, schoolA);
    const danAtB = await countsOf(users.dan.id, schoolB);
    const danUser = await superuser.user.findUniqueOrThrow({ where: { id: users.dan.id } });

    const res = await merge('ownerA', users.kate.id, users.dan.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ keptStudentId: users.kate.id, duplicateStudentId: users.dan.id, waiverSignaturesLeft: 1 });

    const danAfter = await countsOf(users.dan.id, schoolA);
    const kateAfter = await countsOf(users.kate.id, schoolA);
    // Moved as they are.
    for (const table of [
      'Membership',
      'MembershipFreeze',
      'PackRecharge',
      'Transaction',
      'Booking',
      'WaitlistEntry',
      'StudentRank',
      'StudentRankSkillStatus',
      'PromotionEvent',
      'PromotionEventNoteLog',
      'SkillSignOffLog',
      'TrainingLog',
      'RankCorrectionRequest',
      'PromotionFeeRequest',
      'Charge',
      'ChargeAllocation',
      'BalanceEntry',
      'ChargeRefund',
      'RecurringCharge',
      'StudentNote',
      'MemberFile',
      'ChildInvite',
      'SignUp',
      'WatchHistory',
    ] as const) {
      expect([table, danAfter[table], kateAfter[table]]).toEqual([table, 0, kateBefore[table] + danBefore[table]]);
      expect(res.body.records[table]).toBe(danBefore[table]);
    }
    // One per member and lesson / tag: Dan's copy of what Kate already has goes.
    expect([danAfter.Favorite, kateAfter.Favorite]).toEqual([0, 2]);
    expect([danAfter.StudentTag, kateAfter.StudentTag]).toEqual([0, 2]);
    expect([danAfter.RosterMember, kateAfter.RosterMember]).toEqual([0, 2]);
    expect([danAfter.StudentAbsenceAlert, kateAfter.StudentAbsenceAlert]).toEqual([0, 1]);
    // One per member at the School: Kate's stays, Dan's goes.
    for (const table of ['StudentHomeBranch', 'StudentCheckInCode', 'StudentJoinDate'] as const) {
      expect([table, danAfter[table], kateAfter[table]]).toEqual([table, 0, 1]);
    }
    expect((await superuser.studentCheckInCode.findFirstOrThrow({ where: { schoolId: schoolA, studentId: users.kate.id } })).code).toBe('1111');
    expect((await superuser.studentHomeBranch.findFirstOrThrow({ where: { schoolId: schoolA, studentId: users.kate.id } })).branchId).toBe(branchA1);
    // The earliest join date is kept.
    expect((await superuser.studentJoinDate.findFirstOrThrow({ where: { schoolId: schoolA, studentId: users.kate.id } })).joinedOn.toISOString().slice(0, 10)).toBe('2021-03-15');

    // Waiver signatures.
    const row = (id: string) => superuser.waiverSignature.findUnique({ where: { id } });
    expect(await row(sig.w1Dan)).toMatchObject({ studentId: users.kate.id, signedById: users.kate.id, signerFullName: 'Signer', status: 'SIGNED' });
    expect(await row(sig.w2Kate)).toBeNull(); // Kate's unsigned assignment gives way to Dan's signature
    expect(await row(sig.w2Dan)).toMatchObject({ studentId: users.kate.id, status: 'SIGNED' });
    expect(await row(sig.w3Dan)).toBeNull(); // Dan's unsigned assignment: Kate has signed
    expect(await row(sig.w3Kate)).toMatchObject({ studentId: users.kate.id, status: 'SIGNED' });
    expect(await row(sig.w4Dan)).toMatchObject({ studentId: users.dan.id, signedById: users.dan.id, status: 'SIGNED' }); // both signed: Dan's stays his
    expect(await row(sig.w4Kate)).toMatchObject({ studentId: users.kate.id });
    expect(await row(sig.w5Dan)).toMatchObject({ studentId: users.kate.id, status: 'EXPIRED' });
    expect(await row(sig.w6Dan)).toMatchObject({ studentId: users.kate.id, signedById: users.guardian.id });
    expect(res.body.records.WaiverSignature).toBe(4);
    // No signed signature was deleted.
    expect(await superuser.waiverSignature.count({ where: { schoolId: schoolA, studentId: { in: [users.kate.id, users.dan.id] }, signedDate: { not: null } } })).toBe(8);

    // Dan is no longer a Student at School A; still one at School B.
    expect(await superuser.roleGrant.count({ where: { userId: users.dan.id, schoolId: schoolA, role: 'STUDENT', revokedAt: null } })).toBe(0);
    expect(await superuser.roleGrant.count({ where: { userId: users.dan.id, schoolId: schoolB, role: 'STUDENT', revokedAt: null } })).toBe(1);
    // Nothing of Dan's at School B moved, and his account is unchanged.
    expect(await countsOf(users.dan.id, schoolB)).toEqual(danAtB);
    expect(await countsOf(users.kate.id, schoolB)).toEqual(Object.fromEntries(MERGE_TABLES.map((t) => [t, 0])));
    expect(await superuser.waiverSignature.findUnique({ where: { id: sig.bDan } })).toMatchObject({ studentId: users.dan.id });
    // rolesChangedAt is stamped by the RoleGrant trigger (Decision 361), so
    // Dan's signed-in sessions drop School A on their next request.
    const { rolesChangedAt, ...danUserAfter } = await superuser.user.findUniqueOrThrow({ where: { id: users.dan.id } });
    const { rolesChangedAt: rolesChangedBefore, ...danUserBefore } = danUser;
    expect(danUserAfter).toEqual(danUserBefore);
    expect(rolesChangedAt!.getTime()).toBeGreaterThan(rolesChangedBefore?.getTime() ?? 0);

    // The Staff page's activity log has the merge.
    const log = await superuser.staffActivity.findFirstOrThrow({ where: { schoolId: schoolA, action: 'MEMBERS_MERGED', targetUserId: users.kate.id } });
    expect(log.actorId).toBe(users.ownerA.id);
    expect(log.details).toMatchObject({ keptName: 'kate Merge', duplicateId: users.dan.id, duplicateName: 'dan Merge', waiverSignaturesLeft: 1 });
    const activity = await as('ownerA').get(`/v1/schools/${schoolA}/staff/activity`);
    expect(activity.status).toBe(200);
    expect(activity.body.items.some((e: { action: string; targetName: string }) => e.action === 'MEMBERS_MERGED' && e.targetName === 'kate Merge')).toBe(true);
  });

  it('a merged duplicate cannot be merged again (no longer a Student here)', async () => {
    const again = await merge('ownerA', users.kate.id, users.dan.id);
    expect(again.status).toBe(404);
    expect((await merge('ownerA', users.dan.id, users.kate.id)).status).toBe(404);
  });
});
