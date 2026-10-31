/**
 * Backlog 3.20 over real HTTP (Decisions 281, 285, 297, 298): Kids and Adult
 * are two linked styles. From the Kids style's "Ready for Adult from age"
 * (default 16) a kid shows "Ready for Adult program" on the board and can be
 * graded into the Adult style, onto an adult rank above its first belt. Their
 * rank row moves to Adult with its history; sign-offs carry over to Adult
 * skills of the same name; only the class count starts again. The move is
 * charged like any other promotion, at the Adult rank's own price (Decision
 * 419 item 2): single and bulk, waiting for the fee or not, waived, declined,
 * and answered by a Guardian for a child.
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
import { PromotionFeeService } from '../src/ranks/promotion-fee.service';
import { giveLiveMembership } from './live-membership';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[kids-adult-programs.e2e-spec] Skipped — database / secrets not set.');
}

const yearsAgo = (years: number, days = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - days);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

describeIfDb('Kids and Adult programs (backlog 3.20)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let school: { id: string };
  let kids: { id: string };
  let adult: { id: string };
  let other: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const skill: Record<string, string> = {};
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};

  const as = (who: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token[who]}`);
    const server = () => request(app.getHttpServer());
    return { get: (p: string) => auth(server().get(p)), post: (p: string) => auth(server().post(p)), patch: (p: string) => auth(server().patch(p)), put: (p: string) => auth(server().put(p)) };
  };
  const move = (who: string, student: string, body: object) => as(who).post(`/v1/students/${id[student]}/ranks/${kids.id}/move-to-adult`).send(body);
  const board = (who: string, disciplineId: string) => as(who).get(`/v1/schools/${school.id}/grading-board?disciplineId=${disciplineId}`);

  async function mkUser(label: string, dateOfBirth: Date) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(), email: `kids-adult-${label}-${randomUUID()}@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label, surname: 'Prog', passcodeHash: 'x', dateOfBirth, phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
  }
  async function ladder(disciplineId: string, belts: Array<[string, number]>) {
    for (const [order, [name, stripes]] of belts.entries()) {
      const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId, schoolId: school.id, order, name, primaryColour: '#FFFFFF' } });
      for (let t = 0; t <= stripes; t++) {
        const tier = await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: t ? `${name} ${t}` : name, classesRequired: 3 },
        });
        rung[`${t ? `${name} ${t}` : name}`] = { id: tier.id, rankId: rank.id };
      }
    }
  }
  async function kid(label: string, dateOfBirth: Date, at = 'Grey') {
    await mkUser(label, dateOfBirth);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: id[label], schoolId: school.id } });
    await giveLiveMembership(superuser, school.id, id[label]);
    const sr = await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: id[label], disciplineId: kids.id, schoolId: school.id, currentRankId: rung[at].rankId, currentStripeId: rung[at].id,
        classesAttendedTowardCheckpoint: 5, dateOfCurrentRank: new Date(Date.now() - 90 * 86_400_000),
      },
    });
    return sr;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: `Kids Adult ${randomUUID().slice(0, 6)}`, ranksToggle: true } });
    kids = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ Kids' } });
    adult = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    other = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    await ladder(kids.id, [['Kids White', 0], ['Grey', 0], ['Green', 0]]);
    await ladder(adult.id, [['White', 1], ['Blue', 0], ['Purple', 0]]);
    for (const [disciplineId, name] of [[kids.id, 'Armbar'], [kids.id, 'Kids only'], [adult.id, 'Armbar']] as const) {
      const s = await superuser.skill.create({ data: { id: randomUUID(), disciplineId, schoolId: school.id, name } });
      skill[`${disciplineId === kids.id ? 'kids' : 'adult'} ${name}`] = s.id;
    }

    await mkUser('owner', yearsAgo(40));
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: id.owner, schoolId: school.id } });
    token.owner = jwt.sign({ sub: id.owner, email: 'o@example.test', grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    // A coach who grades Kids but may not change its settings, and one who may.
    for (const [label, settings] of [['coach', false], ['settingsCoach', true]] as const) {
      await mkUser(label, yearsAgo(30));
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: id[label], schoolId: school.id } });
      await superuser.gradingPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: id[label], disciplineId: kids.id, canChangeBoardThresholds: settings } });
      token[label] = jwt.sign({ sub: id[label], email: `${label}@example.test`, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });
    }
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    // The promotion fee on the move (Decision 419 item 2): the ledger first.
    await superuser.chargeAllocation.deleteMany({ where });
    await superuser.balanceEntry.deleteMany({ where });
    await superuser.transaction.deleteMany({ where });
    await superuser.charge.deleteMany({ where });
    await superuser.promotionFeeRequest.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.guardianLink.deleteMany({ where: { studentId: { in: userIds } } });
    await superuser.promotionEvent.deleteMany({ where });
    await superuser.studentRankSkillStatus.deleteMany({ where });
    await superuser.studentRank.deleteMany({ where });
    await superuser.gradingPermission.deleteMany({ where });
    await superuser.skill.deleteMany({ where });
    await superuser.rankStripeTier.deleteMany({ where });
    await superuser.rank.deleteMany({ where });
    await superuser.discipline.updateMany({ where, data: { adultDisciplineId: null } });
    await superuser.discipline.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    // A notification job can still be writing as the suite ends: clear and retry.
    for (let attempt = 0; ; attempt++) {
      await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
      try {
        await superuser.user.deleteMany({ where: { id: { in: userIds } } });
        break;
      } catch (err) {
        if (attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner links the Kids style to its Adult style; one level only', async () => {
    expect((await as('owner').patch(`/v1/disciplines/${kids.id}`).send({ adultDisciplineId: kids.id })).status).toBe(400);
    const linked = await as('owner').patch(`/v1/disciplines/${kids.id}`).send({ adultDisciplineId: adult.id });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ adultDisciplineId: adult.id, readyForAdultAge: 16 });
    // Adult can't become a Kids style too, nor link to a Kids style.
    expect((await as('owner').patch(`/v1/disciplines/${adult.id}`).send({ adultDisciplineId: other.id })).status).toBe(400);
    expect((await as('owner').patch(`/v1/disciplines/${other.id}`).send({ adultDisciplineId: kids.id })).status).toBe(400);
    // A coach can't link styles.
    expect((await as('coach').patch(`/v1/disciplines/${kids.id}`).send({ adultDisciplineId: null })).status).toBe(403);
  });

  it('the age is a style setting: the owner or "Change grading settings"', async () => {
    expect((await as('coach').put(`/v1/disciplines/${kids.id}/ready-for-adult-age`).send({ age: 15 })).status).toBe(403);
    expect((await as('settingsCoach').put(`/v1/disciplines/${kids.id}/ready-for-adult-age`).send({ age: 15 })).body.readyForAdultAge).toBe(15);
    expect((await as('owner').put(`/v1/disciplines/${kids.id}/ready-for-adult-age`).send({ age: 16 })).body.readyForAdultAge).toBe(16);
    expect((await as('owner').put(`/v1/disciplines/${other.id}/ready-for-adult-age`).send({ age: 16 })).body.error.code).toBe('ADULT_NOT_LINKED');
  });

  it('the board tags kids who have reached the age', async () => {
    await kid('Ana', yearsAgo(16, 1));
    await kid('Ben', yearsAgo(15));
    const items = (await board('owner', kids.id)).body.items as Array<{ firstName: string; readyForAdult: boolean }>;
    expect(Object.fromEntries(items.map((i) => [i.firstName, i.readyForAdult]))).toEqual({ Ana: true, Ben: false });
    expect(((await board('owner', adult.id)).body.items as unknown[]).length).toBe(0);
  });

  it('too young, a first adult belt, or not linked: refused', async () => {
    expect((await move('coach', 'Ben', { targetRungId: rung.Blue.id })).body.error.code).toBe('ADULT_TOO_YOUNG');
    expect((await move('coach', 'Ana', { targetRungId: rung['White 1'].id })).body.error.code).toBe('ADULT_FIRST_BELT');
    expect((await move('coach', 'Ana', { targetRungId: rung.Green.id })).status).toBe(400);
  });

  it('grading Ana into Adult moves her rank and history; matching sign-offs carry over; classes restart', async () => {
    const sr = await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: id.Ana, disciplineId: kids.id } } });
    for (const s of ['kids Armbar', 'kids Kids only']) {
      await superuser.studentRankSkillStatus.create({ data: { id: randomUUID(), studentRankId: sr.id, schoolId: school.id, studentId: id.Ana, skillId: skill[s], status: 'SIGNED_OFF' } });
    }
    const res = await move('coach', 'Ana', { targetRungId: rung.Blue.id, note: 'Turned 16' });
    expect(res.status).toBe(201);
    const moved = await superuser.studentRank.findUniqueOrThrow({ where: { id: sr.id }, include: { skillStatuses: true } });
    expect(moved).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id, classesAttendedTowardCheckpoint: 0 });
    expect(moved.skillStatuses.filter((s) => s.status === 'SIGNED_OFF').map((s) => s.skillId).sort()).toEqual(
      [skill['kids Armbar'], skill['kids Kids only'], skill['adult Armbar']].sort(),
    );
    const event = await superuser.promotionEvent.findFirstOrThrow({ where: { studentRankId: sr.id } });
    expect(event).toMatchObject({ type: 'PROMOTION', fromStripeTierId: rung.Grey.id, toStripeTierId: rung.Blue.id, systemNote: 'Moved to Adult program.', note: 'Turned 16', performedById: id.coach });
    // She is under Adult now, not Kids.
    expect(((await board('owner', kids.id)).body.items as Array<{ firstName: string }>).map((i) => i.firstName)).toEqual(['Ben']);
    expect(((await board('owner', adult.id)).body.items as Array<{ firstName: string }>).map((i) => i.firstName)).toEqual(['Ana']);
    // A second move has nothing to move.
    expect((await move('coach', 'Ana', { targetRungId: rung.Purple.id })).status).toBe(400);
  });

  it('a kid who already has an Adult rank is refused', async () => {
    await kid('Cy', yearsAgo(17));
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: id.Cy, disciplineId: adult.id, schoolId: school.id, currentRankId: rung.White.rankId, currentStripeId: rung.White.id },
    });
    expect((await move('owner', 'Cy', { targetRungId: rung.Blue.id })).body.error.code).toBe('ADULT_ALREADY');
  });

  describe('bulk promote: "Promote to" with the Adult program group (Decision 281 item 2)', () => {
    const bulk = (who: string, body: object) => as(who).post(`/v1/schools/${school.id}/grading/bulk-promote`).send({ disciplineId: kids.id, ...body });
    const rankOf = (student: string) => superuser.studentRank.findFirstOrThrow({ where: { studentId: id[student] } });

    beforeAll(async () => {
      await kid('Dee', yearsAgo(17));
      await kid('Eve', yearsAgo(15));
      await kid('Fay', yearsAgo(12), 'Kids White');
      await kid('Gil', yearsAgo(16, 3), 'Green');
    });

    it('the check judges each pick: Adult ranks from the age, skips up the Kids ladder, the rest refused', async () => {
      const res = await bulk('coach', {
        studentIds: [id.Dee, id.Eve, id.Fay, id.Gil, id.Cy, id.Ben],
        dryRun: true,
        targets: [
          { studentId: id.Dee, rungId: rung.Blue.id },
          { studentId: id.Eve, rungId: rung.Blue.id },
          { studentId: id.Fay, rungId: rung.Green.id },
          { studentId: id.Gil, rungId: rung.Purple.id },
          { studentId: id.Cy, rungId: rung.Blue.id },
          { studentId: id.Ben, rungId: rung['White 1'].id },
        ],
      });
      expect(res.status).toBe(201);
      const ready = Object.fromEntries((res.body.ready as Array<{ studentId: string; toRungId: string; toAdult?: boolean }>).map((r) => [r.studentId, r]));
      expect(ready[id.Dee]).toMatchObject({ fromRungId: rung.Grey.id, toRungId: rung.Blue.id, toAdult: true });
      expect(ready[id.Fay]).toMatchObject({ fromRungId: rung['Kids White'].id, toRungId: rung.Green.id });
      expect(ready[id.Fay].toAdult).toBeUndefined();
      // The top Kids rank has no next Kids rank, but can still move into Adult.
      expect(ready[id.Gil]).toMatchObject({ fromRungId: rung.Green.id, toRungId: rung.Purple.id, toAdult: true });
      const cannot = Object.fromEntries((res.body.cannotPromote as Array<{ studentId: string; reasons: string[] }>).map((r) => [r.studentId, r.reasons[0]]));
      expect(cannot).toEqual({
        [id.Eve]: expect.stringContaining('Ready for Adult from age'),
        [id.Cy]: 'This student already has a rank in the Adult program.',
        [id.Ben]: expect.stringContaining("Adult program's first belt"),
      });
    });

    it('promotes the batch: kids into Adult with "Moved to Adult program", a skip recorded, no promotion twice', async () => {
      const targets = [
        { studentId: id.Dee, rungId: rung.Blue.id },
        { studentId: id.Fay, rungId: rung.Green.id },
      ];
      const expected = [
        { studentId: id.Dee, rungId: rung.Grey.id },
        { studentId: id.Fay, rungId: rung['Kids White'].id },
      ];
      const res = await bulk('coach', { studentIds: [id.Dee, id.Fay], targets, expected, note: 'Spring Grading Day' });
      expect(res.status).toBe(201);
      expect((res.body.ready as unknown[]).length).toBe(2);
      expect(await rankOf('Dee')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id, classesAttendedTowardCheckpoint: 0 });
      expect(await rankOf('Fay')).toMatchObject({ disciplineId: kids.id, currentStripeId: rung.Green.id });
      const ev = (student: string) => superuser.promotionEvent.findFirstOrThrow({ where: { studentId: id[student] } });
      expect(await ev('Dee')).toMatchObject({ type: 'BULK_PROMOTION', toStripeTierId: rung.Blue.id, note: 'Spring Grading Day', systemNote: 'Moved to Adult program. Promoted in a batch.' });
      expect(await ev('Fay')).toMatchObject({ type: 'BULK_PROMOTION', rungsSkipped: 1, systemNote: 'Promoted in a batch. Skipped 1 rank in between.' });
      // The same batch sent again (a lost reply): skipped, not promoted twice.
      const again = await bulk('coach', { studentIds: [id.Dee, id.Fay], targets, expected });
      expect(again.body.ready).toEqual([]);
      expect((again.body.cannotPromote as Array<{ reasons: string[] }>).map((c) => c.reasons[0])).toEqual(['already promoted since the check', 'already promoted since the check']);
    });

    it('a pick that is not above the current rank, or off both ladders, is refused', async () => {
      const res = await bulk('owner', {
        studentIds: [id.Fay, id.Gil],
        dryRun: true,
        targets: [
          { studentId: id.Fay, rungId: rung.Grey.id },
          { studentId: id.Gil, rungId: randomUUID() },
        ],
      });
      expect((res.body.cannotPromote as Array<{ reasons: string[] }>).map((c) => c.reasons[0])).toEqual([
        'the rank picked is not above their current rank',
        'the rank picked is not on this style or its Adult program',
      ]);
    });
  });

  describe('the move is charged like any other promotion (Decision 419 item 2)', () => {
    const feeAction = (who: string, requestId: string, action: 'accept' | 'decline' | 'waive' | 'cancel') =>
      as(who).post(`/v1/promotion-fee-requests/${requestId}/${action}`).send({});
    const bulk = (who: string, body: object) => as(who).post(`/v1/schools/${school.id}/grading/bulk-promote`).send({ disciplineId: kids.id, ...body });
    const rankOf = (student: string) => superuser.studentRank.findFirstOrThrow({ where: { studentId: id[student] } });
    const requestsOf = (student: string) => superuser.promotionFeeRequest.findMany({ where: { studentId: id[student] }, orderBy: { createdAt: 'asc' } });
    const setFee = (promotionFeeEnabled: boolean, promotionFeeGradeBeforePaid = false) =>
      superuser.school.update({ where: { id: school.id }, data: { promotionFeeEnabled, promotionFeeGradeBeforePaid } });
    const cardOf = async (disciplineId: string, student: string) =>
      ((await board('owner', disciplineId)).body.items as Array<{ studentId: string; feeStatus: string | null; feeRequest: Record<string, unknown> | null }>).find(
        (i) => i.studentId === id[student],
      );
    const deskPay = (student: string, amount: number, chargeId: string) =>
      as('owner').post(`/v1/schools/${school.id}/students/${id[student]}/charge-payments`).send({ amount, paymentMethod: 'CASH', sendReceipt: false, chargeId });
    async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
      const start = Date.now();
      for (;;) {
        const v = await fn();
        if (done(v) || Date.now() - start > timeoutMs) return v;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    async function student(label: string, at = 'Grey') {
      await kid(label, yearsAgo(17), at);
      token[label] = jwt.sign({ sub: id[label], email: `${label}@example.test`, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
    }
    const coachDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

    beforeAll(async () => {
      // Blue is priced 30.00; Purple has no price (free); the Kids Green belt 10.00.
      await superuser.school.update({ where: { id: school.id }, data: { defaultCurrency: 'GBP', timezone: 'UTC' } });
      // Desk payments need the School's payments set up.
      await superuser.paymentAccount.create({
        data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
      });
      await superuser.rankStripeTier.update({ where: { id: rung.Blue.id }, data: { promotionFeeMinor: 3000 } });
      await superuser.rankStripeTier.update({ where: { id: rung.Green.id }, data: { promotionFeeMinor: 1000 } });
    });

    it('fee off: the move is free and applies at once', async () => {
      await setFee(false);
      await student('Hugo');
      const res = await move('coach', 'Hugo', { targetRungId: rung.Blue.id });
      expect(res.status).toBe(201);
      expect(res.body.feeRequest).toBeNull();
      expect(await rankOf('Hugo')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
      expect(await requestsOf('Hugo')).toEqual([]);
    });

    it('fee on: an unpriced Adult rank is free', async () => {
      await setFee(true, false);
      await student('Ines');
      const res = await move('coach', 'Ines', { targetRungId: rung.Purple.id });
      expect(res.body.promotionEvent).not.toBeNull();
      expect(res.body.feeRequest).toBeNull();
      expect(await rankOf('Ines')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Purple.id });
    });

    let waitingId: string;
    it('"Allow grading before the fee is paid" off: the move waits for the Adult rank\'s fee, and the payer is told', async () => {
      await student('Jade');
      const res = await move('coach', 'Jade', { targetRungId: rung.Blue.id, effectiveDate: coachDate, note: 'Turned 17' });
      expect(res.status).toBe(201);
      expect(res.body.promotionEvent).toBeNull();
      expect(res.body.feeRequest).toMatchObject({
        status: 'PENDING', promotionWaits: true, amountMinor: 3000, currency: 'GBP', disciplineId: kids.id, toDisciplineId: adult.id, toRungId: rung.Blue.id, toRungName: 'Blue', expectedCurrentRungId: rung.Grey.id,
      });
      waitingId = res.body.feeRequest.id;
      // Nothing moved yet.
      expect(await rankOf('Jade')).toMatchObject({ disciplineId: kids.id, currentStripeId: rung.Grey.id });
      expect(await cardOf(kids.id, 'Jade')).toMatchObject({ feeStatus: 'waiting', feeRequest: { id: waitingId, toRungId: rung.Blue.id, toAdult: true, promotionApplied: false } });
      const n = await waitFor(() => superuser.notification.findUnique({ where: { id: `grading-fee-${waitingId}` } }), (v) => v !== null);
      expect(n).toMatchObject({ userId: id.Jade, title: 'Promotion fee', type: 'GRADING_PROMOTION_FEE' });
      expect(n?.body).toMatch(/^Your promotion to Blue \(BJJ\) has a fee of £30\.00/);
      // The app names the Adult style.
      const mine = await as('Jade').get(`/v1/students/${id.Jade}/promotion-fee-requests`);
      expect(mine.body.items[0]).toMatchObject({ id: waitingId, disciplineName: 'BJJ Kids', toDisciplineName: 'BJJ', toDisciplineId: adult.id });
      // The School's list, filtered by either style.
      for (const disciplineId of [kids.id, adult.id]) {
        const list = await as('owner').get(`/v1/schools/${school.id}/promotion-fee-requests?studentId=${id.Jade}&disciplineId=${disciplineId}`);
        expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([waitingId]);
      }
    });

    it('while it waits, she is neither moved again nor promoted in Kids', async () => {
      expect((await move('owner', 'Jade', { targetRungId: rung.Purple.id })).status).toBe(409);
      expect((await as('owner').post(`/v1/students/${id.Jade}/ranks/${kids.id}/promote`).send({ targetRungId: rung.Green.id })).status).toBe(409);
      expect(await requestsOf('Jade')).toHaveLength(1);
    });

    it('accepted and paid at the desk: the move applies once, with the coach\'s date and as the coach\'s grade', async () => {
      const accepted = await feeAction('Jade', waitingId, 'accept');
      expect(accepted.body).toMatchObject({ status: 'ACCEPTED', promotionApplied: false, gradingDate: coachDate });
      const charge = await superuser.charge.findUniqueOrThrow({ where: { promotionFeeRequestId: waitingId } });
      expect(charge).toMatchObject({ description: 'Blue', grossAmount: 3000, studentId: id.Jade });
      // The Payments card names the Adult style, and links to Kids until the move applies.
      const view = await as('owner').get(`/v1/schools/${school.id}/students/${id.Jade}/charges`);
      expect(view.body.charges.find((c: { id: string }) => c.id === charge.id).promotionFee).toMatchObject({ disciplineName: 'BJJ', disciplineId: kids.id, toRungName: 'Blue' });
      expect((await rankOf('Jade')).disciplineId).toBe(kids.id);

      expect((await deskPay('Jade', 3000, charge.id)).status).toBe(201);
      const row = await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: waitingId } });
      expect(row.status).toBe('PAID');
      expect(row.promotionEventId).not.toBeNull();
      expect(await rankOf('Jade')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id, classesAttendedTowardCheckpoint: 0 });
      const event = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: row.promotionEventId! } });
      expect(event).toMatchObject({ type: 'PROMOTION', performedById: id.coach, fromStripeTierId: rung.Grey.id, toStripeTierId: rung.Blue.id, systemNote: 'Moved to Adult program.', note: 'Turned 17' });
      expect(event.effectiveDate.toISOString()).toBe(`${coachDate}T00:00:00.000Z`);
      // Settling again changes nothing.
      await app.get(PromotionFeeService).settlePaidCharges(school.id, id.Jade);
      expect(await superuser.promotionEvent.count({ where: { studentId: id.Jade } })).toBe(1);
      // Applied: the charge now links to the Adult style, where her rank is.
      const after = await as('owner').get(`/v1/schools/${school.id}/students/${id.Jade}/charges`);
      expect(after.body.charges.find((c: { id: string }) => c.id === charge.id).promotionFee.disciplineId).toBe(adult.id);
    });

    it('the owner waives a waiting move: it applies now, as the coach made it; a coach cannot waive', async () => {
      await student('Kai');
      const requestId = (await move('coach', 'Kai', { targetRungId: rung.Blue.id })).body.feeRequest.id;
      expect((await feeAction('coach', requestId, 'waive')).status).toBe(403);
      const waived = await feeAction('owner', requestId, 'waive');
      expect(waived.body).toMatchObject({ status: 'WAIVED', promotionApplied: true, toDecide: false });
      expect(await rankOf('Kai')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
      const event = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: waived.body.promotionEventId } });
      expect(event).toMatchObject({ performedById: id.coach, systemNote: 'Moved to Adult program.' });
    });

    it('declined: nothing moves and Kids shows "Fee declined"; waived after, it is "to decide" and the coach moves her fee-free', async () => {
      await student('Lia');
      const requestId = (await move('coach', 'Lia', { targetRungId: rung.Blue.id })).body.feeRequest.id;
      expect((await feeAction('Lia', requestId, 'decline')).body.status).toBe('DECLINED');
      expect(await rankOf('Lia')).toMatchObject({ disciplineId: kids.id, currentStripeId: rung.Grey.id });
      expect((await cardOf(kids.id, 'Lia'))?.feeStatus).toBe('declined');

      const waived = await feeAction('owner', requestId, 'waive');
      expect(waived.body).toMatchObject({ status: 'WAIVED', promotionApplied: false, toDecide: true });
      expect(await cardOf(kids.id, 'Lia')).toMatchObject({ feeStatus: 'toDecide', feeRequest: { toRungId: rung.Blue.id, toAdult: true, feeFree: true } });
      const moved = await move('coach', 'Lia', { targetRungId: rung.Blue.id, expectedCurrentRungId: rung.Grey.id });
      expect(moved.status).toBe(201);
      expect(moved.body.feeRequest).toBeNull();
      expect(await rankOf('Lia')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
      const all = await requestsOf('Lia');
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ toDecideResolution: 'PROMOTED', toDecideResolvedById: id.coach });
    });

    it('a Kids promotion waiting for its fee holds the single move, as it holds bulk (Decision 314 item 3)', async () => {
      await student('Max');
      const promoted = await as('coach').post(`/v1/students/${id.Max}/ranks/${kids.id}/promote`).send({ targetRungId: rung.Green.id });
      expect(promoted.body.feeRequest).toMatchObject({ promotionWaits: true, amountMinor: 1000, toDisciplineId: null });
      const refused = await move('coach', 'Max', { targetRungId: rung.Blue.id });
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/promotion to Green is waiting for its fee/);
      const checked = await bulk('coach', { studentIds: [id.Max], dryRun: true, targets: [{ studentId: id.Max, rungId: rung.Blue.id }] });
      expect(checked.body.cannotPromote).toEqual([{ studentId: id.Max, reasons: ['a promotion is waiting for its fee'] }]);
      expect(await rankOf('Max')).toMatchObject({ disciplineId: kids.id, currentStripeId: rung.Grey.id });
      expect(await requestsOf('Max')).toHaveLength(1);
    });

    it('"Allow grading before the fee is paid" on: moved at once, the fee is asked for; declined shows on the Adult board', async () => {
      await setFee(true, true);
      await student('Noa');
      const res = await move('coach', 'Noa', { targetRungId: rung.Blue.id });
      expect(res.body.promotionEvent).not.toBeNull();
      expect(res.body.feeRequest).toMatchObject({ status: 'PENDING', promotionWaits: false, amountMinor: 3000, promotionEventId: res.body.promotionEvent.id, toDisciplineId: adult.id });
      expect(await rankOf('Noa')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
      expect((await feeAction('Noa', res.body.feeRequest.id, 'decline')).body.status).toBe('DECLINED');
      // The move stays; the Adult board (where she is now) shows the declined fee.
      expect(await rankOf('Noa')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
      expect(await cardOf(adult.id, 'Noa')).toMatchObject({ feeStatus: 'declined', feeRequest: { toAdult: true, promotionApplied: true } });
    });

    it('bulk, the fee waiting: one request each at the Adult rank\'s price; waiving applies the batch move', async () => {
      await setFee(true, false);
      await student('Oli');
      await student('Pia', 'Green');
      const targets = [
        { studentId: id.Oli, rungId: rung.Blue.id },
        { studentId: id.Pia, rungId: rung.Purple.id },
      ];
      const res = await bulk('coach', { studentIds: [id.Oli, id.Pia], targets, expected: [{ studentId: id.Oli, rungId: rung.Grey.id }, { studentId: id.Pia, rungId: rung.Green.id }] });
      expect(res.status).toBe(201);
      // Purple is free: moved now. Blue is priced: waiting for its fee.
      expect(res.body.ready).toEqual([expect.objectContaining({ studentId: id.Pia, toRungId: rung.Purple.id, toAdult: true })]);
      expect(res.body.ready[0].feeRequestId).toBeUndefined();
      expect(res.body.waitingForFee).toEqual([expect.objectContaining({ studentId: id.Oli, toRungId: rung.Blue.id, toAdult: true, feeRequestId: expect.any(String) })]);
      expect(await rankOf('Oli')).toMatchObject({ disciplineId: kids.id, currentStripeId: rung.Grey.id });
      expect(await rankOf('Pia')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Purple.id });
      const [oliRequest] = await requestsOf('Oli');
      expect(oliRequest).toMatchObject({ amountMinor: 3000, toDisciplineId: adult.id, promotionWaits: true });
      expect(oliRequest.pendingGrade).toMatchObject({ type: 'MOVE_TO_ADULT', bulk: { systemNote: 'Promoted in a batch.' } });

      // Sent again: the waiting student is skipped, never asked twice.
      const again = await bulk('coach', { studentIds: [id.Oli], targets: [targets[0]] });
      expect(again.body.cannotPromote).toEqual([{ studentId: id.Oli, reasons: ['a promotion is waiting for its fee'] }]);
      expect(await requestsOf('Oli')).toHaveLength(1);

      const waived = await feeAction('owner', oliRequest.id, 'waive');
      expect(waived.body.promotionApplied).toBe(true);
      const event = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: waived.body.promotionEventId } });
      expect(event).toMatchObject({ type: 'BULK_PROMOTION', performedById: id.coach, systemNote: 'Moved to Adult program. Promoted in a batch.' });
      expect(await rankOf('Oli')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
    });

    it('bulk with "Allow grading before the fee is paid" on: moved at once, the request waits', async () => {
      await setFee(true, true);
      await student('Quin');
      const res = await bulk('coach', { studentIds: [id.Quin], targets: [{ studentId: id.Quin, rungId: rung.Blue.id }] });
      expect(res.body.waitingForFee).toEqual([]);
      expect(res.body.ready).toEqual([expect.objectContaining({ studentId: id.Quin, toAdult: true, promotionEventId: expect.any(String), feeRequestId: expect.any(String) })]);
      expect(await rankOf('Quin')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
      expect((await requestsOf('Quin'))[0]).toMatchObject({ promotionWaits: false, promotionEventId: res.body.ready[0].promotionEventId, status: 'PENDING' });
    });

    it('a Guardian answers for a child: told instead of the child, accepts, and the paid fee moves the child', async () => {
      await setFee(true, false);
      await student('Rio');
      await mkUser('parent', yearsAgo(45));
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: id.parent, studentId: id.Rio } });
      token.parent = jwt.sign({ sub: id.parent, email: 'parent@example.test', grants: [] });
      const requestId = (await move('coach', 'Rio', { targetRungId: rung.Blue.id })).body.feeRequest.id;
      const n = await waitFor(() => superuser.notification.findUnique({ where: { id: `grading-fee-${requestId}-${id.parent}` } }), (v) => v !== null);
      expect(n?.body).toMatch(/^Rio's promotion to Blue \(BJJ\) has a fee of £30\.00/);
      expect(await superuser.notification.findUnique({ where: { id: `grading-fee-${requestId}` } })).toBeNull();

      const theirs = await as('parent').get(`/v1/students/${id.Rio}/promotion-fee-requests`);
      expect(theirs.body.items[0]).toMatchObject({ id: requestId, toDisciplineName: 'BJJ', toRungName: 'Blue', amountMinor: 3000 });
      expect((await feeAction('parent', requestId, 'accept')).body.status).toBe('ACCEPTED');
      const charge = await superuser.charge.findUniqueOrThrow({ where: { promotionFeeRequestId: requestId } });
      expect(charge.studentId).toBe(id.Rio);
      expect((await deskPay('Rio', 3000, charge.id)).status).toBe(201);
      expect(await rankOf('Rio')).toMatchObject({ disciplineId: adult.id, currentStripeId: rung.Blue.id });
    });

    it('paid, but the Kids style was unlinked meanwhile: the move can\'t apply, and the owner is asked to decide (Decision 414 item 1)', async () => {
      await student('Sol');
      const requestId = (await move('coach', 'Sol', { targetRungId: rung.Blue.id })).body.feeRequest.id;
      await feeAction('Sol', requestId, 'accept');
      await superuser.discipline.update({ where: { id: kids.id }, data: { adultDisciplineId: null } });
      try {
        const charge = await superuser.charge.findUniqueOrThrow({ where: { promotionFeeRequestId: requestId } });
        expect((await deskPay('Sol', 3000, charge.id)).status).toBe(201);
        const row = await superuser.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } });
        expect(row).toMatchObject({ status: 'ACCEPTED', promotionEventId: null });
        expect(row.promotionBlockedAt).not.toBeNull();
        expect(await rankOf('Sol')).toMatchObject({ disciplineId: kids.id, currentStripeId: rung.Grey.id });
        const notice = await waitFor(() => superuser.notification.findFirst({ where: { userId: id.owner, type: 'GRADING_FEE_BLOCKED' } }), (v) => v !== null);
        expect(notice?.body).toMatch(/fee for Blue \(BJJ\) is paid, but the promotion can't apply/);
      } finally {
        await superuser.discipline.update({ where: { id: kids.id }, data: { adultDisciplineId: adult.id } });
      }
    });
  });
});
