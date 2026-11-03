/**
 * Merge duplicate members, same-style belts (Decision 422 item 8). When both
 * records have a belt in the same style, the merge no longer refuses: the
 * higher current belt is kept (by the ladder's own order: belt, then stripe),
 * the kept member's when both are on the same rung. The other belt's history
 * moves onto the kept belt, marked with the record it came from; only the
 * other StudentRank row is deleted. Skill sign-offs and classes toward the
 * next rung are combined on the same rung. A waiting promotion fee or a
 * pending belt correction for the belt that isn't kept is closed (an accepted
 * fee stops the merge). Kids and Adult programs are separate styles. Nothing
 * at another School changes.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[member-merge-belts.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

type Role = 'SCHOOL_OWNER_MANAGER' | 'STUDENT';
type Grant = [Role, string];
type SkillStatus = 'NOT_STARTED' | 'LEARNING' | 'SIGNED_OFF';

/** Tables cleaned up after the spec, children first. */
const CLEANUP_TABLES = [
  'StaffActivity',
  'PromotionFeeRequest',
  'RankCorrectionRequest',
  'SkillSignOffLog',
  'PromotionEvent',
  'StudentRankSkillStatus',
  'StudentRank',
  'StudentJoinDate',
  'RankStripeTier',
  'Skill',
  'Rank',
  'Discipline',
  'RoleGrant',
];

describeIfDb('Merge duplicate members: same-style belts (Decision 422 item 8)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const schoolIds = [schoolA, schoolB];
  const users: Record<string, { id: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`),
    post: (path: string) => http().post(path).set('Authorization', `Bearer ${tokens[who]}`),
    patch: (path: string) => http().patch(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const mergePath = (keptId: string, school = schoolA) => `/v1/schools/${school}/students/${keptId}/merge`;
  const preview = (keptId: string, duplicateId: string) => as('ownerA').get(`${mergePath(keptId)}/preview?duplicateId=${duplicateId}`);
  const merge = (keptId: string, duplicateId: string) => as('ownerA').post(mergePath(keptId)).send({ duplicateId });

  let phone = 0;
  async function mkUser(label: string, grants: Grant[]) {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `mergebelt-${label}-${randomUUID()}@example.test`,
        phone: `+1556${String(Date.now() % 1_000_000).padStart(6, '0')}${String(phone++).padStart(4, '0')}`,
        firstName: label,
        surname: 'Belt',
        passcodeHash: `hash-${label}`,
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    for (const [role, sid] of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label].id, schoolId: sid, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' } });
    }
    tokens[label] = jwt.sign({
      sub: users[label].id,
      email: `${label}@example.test`,
      grants: grants.map(([role, sid]) => ({ role, franchiseId: null, schoolId: sid, branchId: null })),
    });
    return users[label];
  }

  /** Ids of the catalogue: `${school}${style}${rung}` for rungs, `${school}${style}` for styles. */
  const cat: Record<string, string> = {};
  /** The belt ladder of one style: White (plain, 1 stripe, 2 stripes), then Blue (plain, 1 stripe). */
  async function mkStyle(school: string, p: string, style: string, name: string, extra: { adultDisciplineId?: string } = {}) {
    const disciplineId = (cat[`${p}${style}`] = randomUUID());
    await superuser.discipline.create({ data: { id: disciplineId, schoolId: school, name, ...extra } });
    const belts = [
      ['White', 0, ['White Belt', 'White Belt · 1 Stripe', 'White Belt · 2 Stripes']],
      ['Blue', 1, ['Blue Belt', 'Blue Belt · 1 Stripe']],
    ] as const;
    for (const [belt, order, tiers] of belts) {
      const rankId = (cat[`${p}${style}${belt}`] = randomUUID());
      await superuser.rank.create({ data: { id: rankId, disciplineId, schoolId: school, order, name: `${belt} Belt`, primaryColour: '#fff' } });
      for (const [i, tierName] of tiers.entries()) {
        await superuser.rankStripeTier.create({
          data: { id: (cat[`${p}${style}${belt}${i}`] = randomUUID()), rankId, schoolId: school, order: i, count: i, colour: '#fff', name: tierName },
        });
      }
    }
    for (const skill of ['s1', 's2', 's3']) {
      await superuser.skill.create({ data: { id: (cat[`${p}${style}${skill}`] = randomUUID()), disciplineId, schoolId: school, name: skill } });
    }
  }

  /** A belt for `studentId` at rung `belt`+`tier`, with one history entry
   * and one sign-off log line; `statuses` are its current sign-offs. */
  async function mkBelt(
    studentId: string,
    school: string,
    p: string,
    style: string,
    belt: 'White' | 'Blue',
    tier: number,
    opts: { promotedOn?: string; classes?: number; byType?: Record<string, number>; statuses?: Partial<Record<'s1' | 's2' | 's3', SkillStatus>> } = {},
  ) {
    const id = randomUUID();
    const rankId = cat[`${p}${style}${belt}`];
    const stripeId = cat[`${p}${style}${belt}${tier}`];
    const promotedOn = new Date(opts.promotedOn ?? '2025-01-01');
    await superuser.studentRank.create({
      data: {
        id,
        studentId,
        schoolId: school,
        disciplineId: cat[`${p}${style}`],
        currentRankId: rankId,
        currentStripeId: stripeId,
        dateOfCurrentRank: promotedOn,
        classesAttendedTowardCheckpoint: opts.classes ?? 0,
        classesAttendedByType: opts.byType ?? {},
      },
    });
    const eventId = randomUUID();
    await superuser.promotionEvent.create({
      data: { id: eventId, studentRankId: id, schoolId: school, studentId, type: 'PROMOTION', toRankId: rankId, toStripeTierId: stripeId, effectiveDate: promotedOn },
    });
    await superuser.skillSignOffLog.create({
      data: { id: randomUUID(), studentRankId: id, schoolId: school, studentId, skillId: cat[`${p}${style}s1`], fromStatus: 'NOT_STARTED', toStatus: 'LEARNING' },
    });
    for (const [skill, status] of Object.entries(opts.statuses ?? {})) {
      await superuser.studentRankSkillStatus.create({ data: { id: randomUUID(), studentRankId: id, schoolId: school, studentId, skillId: cat[`${p}${style}${skill}`], status } });
    }
    return { id, eventId };
  }

  const waitingFee = (studentId: string, style: string, fromRung: string, status: 'PENDING' | 'ACCEPTED' = 'PENDING') =>
    superuser.promotionFeeRequest.create({
      data: {
        id: randomUUID(),
        schoolId: schoolA,
        studentId,
        disciplineId: cat[`A${style}`],
        toRungId: cat[`A${style}Blue0`],
        toRungName: 'Blue Belt',
        expectedCurrentRungId: cat[fromRung],
        amountMinor: 2500,
        promotionWaits: true,
        status,
        ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
      },
    });
  const correction = (studentId: string, style: string, fromBelt: string, fromTier: string) =>
    superuser.rankCorrectionRequest.create({
      data: {
        id: randomUUID(),
        schoolId: schoolA,
        studentId,
        disciplineId: cat[`A${style}`],
        fromRankId: cat[fromBelt],
        fromStripeTierId: cat[fromTier],
        requestedRankId: cat[`A${style}Blue`],
        requestedStripeTierId: cat[`A${style}Blue1`],
        note: 'My belt is wrong',
      },
    });

  const beltsOf = (studentId: string, school = schoolA) =>
    superuser.studentRank.findMany({ where: { studentId, schoolId: school }, orderBy: { disciplineId: 'asc' } });
  const eventsOn = (studentRankId: string) => superuser.promotionEvent.findMany({ where: { studentRankId }, orderBy: { effectiveDate: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ClientService)
      .useValue({ isConfigured: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.createMany({ data: [{ id: schoolA, name: 'Merge Belts A', ranksToggle: true }, { id: schoolB, name: 'Merge Belts B' }] });
    await mkUser('ownerA', [['SCHOOL_OWNER_MANAGER', schoolA]]);
    await mkStyle(schoolA, 'A', 'bjj', 'BJJ');
    await mkStyle(schoolA, 'A', 'kids', 'Kids BJJ', { adultDisciplineId: cat.Abjj });
    await mkStyle(schoolB, 'B', 'bjj', 'BJJ');
  });

  afterAll(async () => {
    for (const table of CLEANUP_TABLES) {
      await superuser.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "schoolId" = ANY($1::text[])`, schoolIds);
    }
    const ids = Object.values(users).map((u) => u.id);
    // The rank-date correction's "ready to grade" check may have notified the owner.
    await superuser.$executeRawUnsafe(`DELETE FROM "Notification" WHERE "userId" = ANY($1::text[])`, ids);
    await superuser.user.deleteMany({ where: { id: { in: ids } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it("keeps the kept member's higher belt; the duplicate's history joins it, marked; other Schools' belts are untouched", async () => {
    const kate = await mkUser('kate1', [['STUDENT', schoolA], ['STUDENT', schoolB]]);
    const dan = await mkUser('dan1', [['STUDENT', schoolA], ['STUDENT', schoolB]]);
    const kateBelt = await mkBelt(kate.id, schoolA, 'A', 'bjj', 'Blue', 0, { promotedOn: '2024-01-10', classes: 5, statuses: { s1: 'SIGNED_OFF' } });
    // An earlier entry of Kate's on the same belt, and Dan's later one, on the lower belt.
    await superuser.promotionEvent.create({
      data: { id: randomUUID(), studentRankId: kateBelt.id, schoolId: schoolA, studentId: kate.id, type: 'PROMOTION', toRankId: cat.AbjjWhite, toStripeTierId: cat.AbjjWhite0, effectiveDate: new Date('2023-01-01') },
    });
    const danBelt = await mkBelt(dan.id, schoolA, 'A', 'bjj', 'White', 2, { promotedOn: '2025-06-01', classes: 9, statuses: { s1: 'LEARNING', s2: 'SIGNED_OFF' } });
    // Both are also Students at School B, each with a belt there.
    const kateAtB = await mkBelt(kate.id, schoolB, 'B', 'bjj', 'White', 0);
    const danAtB = await mkBelt(dan.id, schoolB, 'B', 'bjj', 'Blue', 1);
    const bBefore = await superuser.studentRank.findMany({ where: { schoolId: schoolB }, orderBy: { id: 'asc' } });
    const bEventsBefore = await superuser.promotionEvent.findMany({ where: { schoolId: schoolB }, orderBy: { id: 'asc' } });

    const pre = await preview(kate.id, dan.id);
    expect(pre.status).toBe(200);
    expect(pre.body.blockers).toEqual([]);
    expect(pre.body.beltsKept).toEqual([
      { disciplineId: cat.Abjj, styleName: 'BJJ', keptFrom: 'KEPT', keptBelt: 'Blue Belt', otherBelt: 'White Belt · 2 Stripes', sameRung: false },
    ]);
    // The preview changes nothing.
    expect(await superuser.studentRank.count({ where: { id: danBelt.id } })).toBe(1);

    const res = await merge(kate.id, dan.id);
    expect(res.status).toBe(201);
    expect(res.body.beltsKept).toEqual(pre.body.beltsKept);

    // One BJJ belt: Kate's own row, unchanged; Dan's row is gone.
    const belts = await beltsOf(kate.id);
    expect(belts.map((b) => [b.id, b.currentRankId, b.currentStripeId, b.classesAttendedTowardCheckpoint])).toEqual([[kateBelt.id, cat.AbjjBlue, cat.AbjjBlue0, 5]]);
    expect(await superuser.studentRank.count({ where: { id: danBelt.id } })).toBe(0);
    // History: all three entries on Kate's belt; Dan's marked as from his record.
    const events = await eventsOn(kateBelt.id);
    expect(events.map((e) => [e.studentId, e.mergedFromUserId, e.effectiveDate.toISOString().slice(0, 10)])).toEqual([
      [kate.id, null, '2023-01-01'],
      [kate.id, null, '2024-01-10'],
      [kate.id, dan.id, '2025-06-01'],
    ]);
    expect(events.find((e) => e.id === danBelt.eventId)?.mergedFromUserId).toBe(dan.id);
    // Sign-offs belong to the rung: Dan's (on a lower rung) go, Kate's stay;
    // both sign-off logs are kept, on Kate's belt.
    expect((await superuser.studentRankSkillStatus.findMany({ where: { studentRankId: kateBelt.id } })).map((s) => [s.skillId, s.status])).toEqual([[cat.Abjjs1, 'SIGNED_OFF']]);
    expect(await superuser.studentRankSkillStatus.count({ where: { studentId: dan.id, schoolId: schoolA } })).toBe(0);
    expect(await superuser.skillSignOffLog.count({ where: { studentRankId: kateBelt.id, studentId: kate.id } })).toBe(2);

    // The history API shows the mark.
    const history = await as('ownerA').get(`/v1/students/${kate.id}/rank-history?schoolId=${schoolA}`);
    expect(history.status).toBe(200);
    expect(history.body.items.map((e: { mergedFromUserId: string | null }) => e.mergedFromUserId)).toEqual([dan.id, null, null]);

    // The rank date of the kept belt is checked against the kept belt's own
    // previous grading (2023-01-01), not the merged-in entry (2025-06-01).
    const corrected = await as('ownerA').patch(`/v1/students/${kate.id}/ranks/${cat.Abjj}/rank-date`).send({ date: '2024-02-01' });
    expect(corrected.status).toBe(200);
    expect((await superuser.promotionEvent.findUniqueOrThrow({ where: { id: kateBelt.eventId } })).effectiveDate.toISOString().slice(0, 10)).toBe('2024-02-01');

    // Cross-tenant: School B's belts and history are exactly as they were.
    expect(await superuser.studentRank.findMany({ where: { schoolId: schoolB }, orderBy: { id: 'asc' } })).toEqual(bBefore);
    expect(await superuser.promotionEvent.findMany({ where: { schoolId: schoolB }, orderBy: { id: 'asc' } })).toEqual(bEventsBefore);
    expect(bBefore.map((b) => b.id).sort()).toEqual([kateAtB.id, danAtB.id].sort());

    // The Staff page's log records which belt was kept.
    const log = await superuser.staffActivity.findFirstOrThrow({ where: { schoolId: schoolA, action: 'MEMBERS_MERGED', targetUserId: kate.id } });
    expect(log.details).toMatchObject({ beltsKept: [{ styleName: 'BJJ', keptFrom: 'KEPT', keptBelt: 'Blue Belt', otherBelt: 'White Belt · 2 Stripes' }] });
  });

  it("keeps the duplicate's higher belt; the kept member's own belt history joins it, marked; its stale fee and correction are closed", async () => {
    const kate = await mkUser('kate2', [['STUDENT', schoolA]]);
    const dan = await mkUser('dan2', [['STUDENT', schoolA]]);
    // Same belt, but Dan has more stripes.
    const kateBelt = await mkBelt(kate.id, schoolA, 'A', 'bjj', 'White', 1, { classes: 3, statuses: { s1: 'SIGNED_OFF' } });
    const danBelt = await mkBelt(dan.id, schoolA, 'A', 'bjj', 'White', 2, { classes: 1, statuses: { s2: 'LEARNING' } });
    // Kate's fee waits on a promotion planned from her White 1; her correction is about White 1.
    const fee = await waitingFee(kate.id, 'bjj', 'AbjjWhite1');
    const fix = await correction(kate.id, 'bjj', 'AbjjWhite', 'AbjjWhite1');

    const pre = await preview(kate.id, dan.id);
    expect(pre.body.blockers).toEqual([]);
    expect(pre.body.beltsKept).toEqual([
      { disciplineId: cat.Abjj, styleName: 'BJJ', keptFrom: 'DUPLICATE', keptBelt: 'White Belt · 2 Stripes', otherBelt: 'White Belt · 1 Stripe', sameRung: false },
    ]);
    expect([pre.body.promotionFeesCancelled, pre.body.beltCorrectionsClosed]).toEqual([1, 1]);

    const res = await merge(kate.id, dan.id);
    expect(res.status).toBe(201);
    expect([res.body.promotionFeesCancelled, res.body.beltCorrectionsClosed]).toEqual([1, 1]);

    // Dan's belt row is now Kate's, as it was (progress and sign-offs); Kate's row is gone.
    const belts = await beltsOf(kate.id);
    expect(belts.map((b) => [b.id, b.currentStripeId, b.classesAttendedTowardCheckpoint])).toEqual([[danBelt.id, cat.AbjjWhite2, 1]]);
    expect(await superuser.studentRank.count({ where: { id: kateBelt.id } })).toBe(0);
    expect((await superuser.studentRankSkillStatus.findMany({ where: { studentRankId: danBelt.id } })).map((s) => [s.studentId, s.skillId, s.status])).toEqual([
      [kate.id, cat.Abjjs2, 'LEARNING'],
    ]);
    // Kate's own entry joins the kept belt, marked as from her record; Dan's is the kept belt's own.
    const events = await eventsOn(danBelt.id);
    expect(events.map((e) => [e.id, e.studentId, e.mergedFromUserId]).sort()).toEqual(
      [
        [kateBelt.eventId, kate.id, kate.id],
        [danBelt.eventId, kate.id, null],
      ].sort(),
    );
    expect(await superuser.skillSignOffLog.count({ where: { studentRankId: danBelt.id, studentId: kate.id } })).toBe(2);
    // Planned from, and about, a belt she no longer holds: closed by the owner's merge.
    expect(await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: fee.id } })).toMatchObject({ status: 'CANCELLED', closedById: users.ownerA.id, toDecideAt: null });
    expect(await superuser.rankCorrectionRequest.findUniqueOrThrow({ where: { id: fix.id } })).toMatchObject({ status: 'REJECTED', reviewedById: users.ownerA.id, studentId: kate.id });
  });

  it("on the same rung keeps the kept member's belt, with both records' classes and the further sign-off per skill, no duplicates", async () => {
    const kate = await mkUser('kate3', [['STUDENT', schoolA]]);
    const dan = await mkUser('dan3', [['STUDENT', schoolA]]);
    const kateBelt = await mkBelt(kate.id, schoolA, 'A', 'bjj', 'White', 2, {
      classes: 3,
      byType: { Fundamentals: 2 },
      statuses: { s1: 'LEARNING', s2: 'SIGNED_OFF' },
    });
    const danBelt = await mkBelt(dan.id, schoolA, 'A', 'bjj', 'White', 2, {
      classes: 4,
      byType: { Fundamentals: 1, Sparring: 3 },
      statuses: { s1: 'SIGNED_OFF', s2: 'LEARNING', s3: 'LEARNING' },
    });

    const pre = await preview(kate.id, dan.id);
    expect(pre.body.beltsKept).toEqual([
      { disciplineId: cat.Abjj, styleName: 'BJJ', keptFrom: 'KEPT', keptBelt: 'White Belt · 2 Stripes', otherBelt: 'White Belt · 2 Stripes', sameRung: true },
    ]);
    expect((await merge(kate.id, dan.id)).status).toBe(201);

    const [belt] = await beltsOf(kate.id);
    expect(belt).toMatchObject({ id: kateBelt.id, currentStripeId: cat.AbjjWhite2, classesAttendedTowardCheckpoint: 7, classesAttendedByType: { Fundamentals: 3, Sparring: 3 } });
    expect(await beltsOf(kate.id)).toHaveLength(1);
    expect(await superuser.studentRank.count({ where: { id: danBelt.id } })).toBe(0);
    // One status per skill: the further of the two.
    const statuses = await superuser.studentRankSkillStatus.findMany({ where: { studentRankId: kateBelt.id } });
    expect(Object.fromEntries(statuses.map((s) => [s.skillId, s.status]))).toEqual({ [cat.Abjjs1]: 'SIGNED_OFF', [cat.Abjjs2]: 'SIGNED_OFF', [cat.Abjjs3]: 'LEARNING' });
    expect(statuses).toHaveLength(3);
    expect(statuses.every((s) => s.studentId === kate.id)).toBe(true);
    expect(await superuser.studentRankSkillStatus.count({ where: { studentId: dan.id, schoolId: schoolA } })).toBe(0);
    // History and logs of both, on the kept belt; Dan's entry marked.
    expect((await eventsOn(kateBelt.id)).map((e) => [e.id, e.mergedFromUserId]).sort()).toEqual(
      [
        [kateBelt.eventId, null],
        [danBelt.eventId, dan.id],
      ].sort(),
    );
    expect(await superuser.skillSignOffLog.count({ where: { studentRankId: kateBelt.id, studentId: kate.id } })).toBe(2);
  });

  it('two waiting promotion fees or belt corrections in a style: the kept belt keeps its own, the other is closed; an accepted one stops the merge', async () => {
    const kate = await mkUser('kate4', [['STUDENT', schoolA]]);
    const dan = await mkUser('dan4', [['STUDENT', schoolA]]);
    await mkBelt(kate.id, schoolA, 'A', 'bjj', 'White', 0);
    await mkBelt(dan.id, schoolA, 'A', 'bjj', 'White', 0);
    const kateFee = await waitingFee(kate.id, 'bjj', 'AbjjWhite0');
    const danFee = await waitingFee(dan.id, 'bjj', 'AbjjWhite0');
    const kateFix = await correction(kate.id, 'bjj', 'AbjjWhite', 'AbjjWhite0');
    const danFix = await correction(dan.id, 'bjj', 'AbjjWhite', 'AbjjWhite0');

    // Dan's fee has been accepted (its charge is on his balance): the merge waits.
    await superuser.promotionFeeRequest.update({ where: { id: danFee.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    const blocked = await preview(kate.id, dan.id);
    expect(blocked.body.blockers).toEqual([{ code: 'SAME_STYLE_FEE_ACCEPTED', details: ['BJJ'] }]);
    const refused = await merge(kate.id, dan.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('MERGE_BLOCKED');
    expect(await superuser.studentRank.count({ where: { studentId: dan.id, schoolId: schoolA } })).toBe(1);
    expect(await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: danFee.id } })).toMatchObject({ studentId: dan.id, status: 'ACCEPTED' });

    // Unanswered, it is cancelled by the merge instead.
    await superuser.promotionFeeRequest.update({ where: { id: danFee.id }, data: { status: 'PENDING', acceptedAt: null } });
    const pre = await preview(kate.id, dan.id);
    expect(pre.body.blockers).toEqual([]);
    expect([pre.body.promotionFeesCancelled, pre.body.beltCorrectionsClosed]).toEqual([1, 1]);
    expect((await merge(kate.id, dan.id)).status).toBe(201);

    expect(await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: kateFee.id } })).toMatchObject({ studentId: kate.id, status: 'PENDING', closedById: null });
    expect(await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: danFee.id } })).toMatchObject({ studentId: kate.id, status: 'CANCELLED', closedById: users.ownerA.id });
    // Still exactly one fee waiting in the style.
    expect(await superuser.promotionFeeRequest.count({ where: { studentId: kate.id, disciplineId: cat.Abjj, status: { in: ['PENDING', 'ACCEPTED'] } } })).toBe(1);
    expect(await superuser.rankCorrectionRequest.findUniqueOrThrow({ where: { id: kateFix.id } })).toMatchObject({ status: 'PENDING' });
    expect(await superuser.rankCorrectionRequest.findUniqueOrThrow({ where: { id: danFix.id } })).toMatchObject({ studentId: kate.id, status: 'REJECTED', reviewedById: users.ownerA.id });
  });

  it('a Kids and an Adult program are separate styles: both belts are kept', async () => {
    const kate = await mkUser('kate5', [['STUDENT', schoolA]]);
    const dan = await mkUser('dan5', [['STUDENT', schoolA]]);
    const kids = await mkBelt(kate.id, schoolA, 'A', 'kids', 'Blue', 1);
    const adult = await mkBelt(dan.id, schoolA, 'A', 'bjj', 'White', 0);

    const pre = await preview(kate.id, dan.id);
    expect(pre.body.blockers).toEqual([]);
    expect(pre.body.beltsKept).toEqual([]);
    expect((await merge(kate.id, dan.id)).status).toBe(201);

    const belts = await superuser.studentRank.findMany({ where: { studentId: kate.id, schoolId: schoolA } });
    expect(belts.map((b) => [b.id, b.disciplineId]).sort()).toEqual(
      [
        [kids.id, cat.Akids],
        [adult.id, cat.Abjj],
      ].sort(),
    );
    // Nothing was folded, so nothing is marked.
    expect(await superuser.promotionEvent.count({ where: { studentId: kate.id, schoolId: schoolA, mergedFromUserId: { not: null } } })).toBe(0);
  });
});
