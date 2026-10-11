/**
 * Who may book (Decision 173): each rung's "unlocks booking" list, set by the
 * school owner, opens those class types to that rung and every rung above.
 * Class types no rung unlocks are open to everyone. Exercised over real HTTP
 * booking, with Gus's own example ladder: White · 3 Stripes unlocks Advanced
 * and Open Mat; Fundamentals is unlocked nowhere.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[booking-unlocks.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Booking — rungs unlock class types (Decision 173)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let student: { id: string; email: string };
  let owner: { id: string; email: string };
  let tokenStudent: string;
  let tokenOwner: string;
  let bjj: { id: string; name: string };
  let judo: { id: string };
  let white: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const userIds: string[] = [];

  /** A future class in one style; returns the booking response status. */
  async function book(styles: Array<{ disciplineId: string; classType: string | null }>, overrideReason?: string, token = tokenStudent) {
    const future = new Date(Date.now() + 24 * 3_600_000);
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Gated', activities: ['BJJ'], styles, startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/book`)
      .set('Authorization', `Bearer ${token}`)
      .send(overrideReason ? { studentId: student.id, overrideReason } : {});
    return res;
  }

  async function placeStudent(rungKey: string | null, verificationStatus: 'VERIFIED' | 'UNVERIFIED' = 'VERIFIED') {
    await superuser.studentRank.deleteMany({ where: { studentId: student.id, disciplineId: bjj.id } });
    if (rungKey) {
      await superuser.studentRank.create({
        data: {
          id: randomUUID(), studentId: student.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: rung[rungKey].rankId, currentStripeId: rung[rungKey].id,
          verificationStatus,
        },
      });
    }
  }

  const bjjClass = (classType: string | null) => [{ disciplineId: bjj.id, classType }];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Booking Unlocks School', ranksToggle: true } });
    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `booking-unlocks-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    student = await mkUser('student');
    owner = await mkUser('owner');
    userIds.push(student.id, owner.id);
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
      ],
    });
    tokenStudent = jwt.sign({ sub: student.id, email: student.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
    tokenOwner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });

    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });

    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals', 'Advanced', 'Open Mat'] } });
    white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White Belt', primaryColour: '#FFFFFF' } });
    const blue = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 1, name: 'Blue Belt', primaryColour: '#3B5FCB' } });
    for (const n of [0, 1, 2, 3, 4]) {
      const t = await superuser.rankStripeTier.create({
        data: {
          id: randomUUID(), rankId: white.id, schoolId: school.id, order: n, count: n, colour: '#000000', name: `White ${n}`,
          stripeSegments: n > 0 ? [{ count: n, colour: '#000000' }] : [],
          bookingUnlocksClassTypes: n === 3 ? ['Advanced', 'Open Mat'] : [],
        },
      });
      rung[`white-${n}`] = { id: t.id, rankId: white.id };
    }
    const b0 = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: blue.id, schoolId: school.id, order: 0, count: 0, colour: '#000000', name: 'Blue 0' } });
    rung['blue-0'] = { id: b0.id, rankId: blue.id };

    judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo', classTypesOffered: ['Randori'] } });
  });

  afterAll(async () => {
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a type no rung unlocks (Fundamentals) is open to everyone, even with no rank in the style', async () => {
    await placeStudent(null);
    expect((await book(bjjClass('Fundamentals'))).status).toBe(201);
  });

  it('a restricted type is refused before the unlocking rung, with a reason naming it', async () => {
    await placeStudent('white-1');
    const res = await book(bjjClass('Open Mat'));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('BJJ · Open Mat');
  });

  it('the unlocking rung and every rung above may book it', async () => {
    for (const key of ['white-3', 'white-4', 'blue-0']) {
      await placeStudent(key);
      expect((await book(bjjClass('Advanced'))).status).toBe(201);
    }
  });

  it('no rank in the style: a restricted type is refused', async () => {
    await placeStudent(null);
    expect((await book(bjjClass('Advanced'))).status).toBe(403);
  });

  it('a style where nothing is set is open, and so is a class with no class type', async () => {
    await placeStudent(null);
    expect((await book([{ disciplineId: judo.id, classType: 'Randori' }])).status).toBe(201);
    expect((await book(bjjClass(null))).status).toBe(201);
  });

  it('Staff can still override per booking, and it is recorded', async () => {
    await placeStudent('white-0');
    const res = await book(bjjClass('Open Mat'), 'Visiting purple belt, checked by coach', tokenOwner);
    expect(res.status).toBe(201);
    expect(res.body.overrideReason).toBe('Visiting purple belt, checked by coach');
  });

  it('a belt the student declared and the School hasn\'t verified yet still books (Decision 137.3)', async () => {
    await placeStudent('white-3', 'UNVERIFIED');
    expect((await book(bjjClass('Advanced'))).status).toBe(201);
    await placeStudent('white-1', 'UNVERIFIED');
    expect((await book(bjjClass('Advanced'))).status).toBe(403); // the rung still decides
  });

  it('claiming a waitlist spot goes through the same rank gate as booking (Decision 173)', async () => {
    const future = new Date(Date.now() + 24 * 3_600_000);
    const claim = async () => {
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Waitlisted', activities: ['BJJ'], styles: bjjClass('Advanced'), startDate: future, endDate: new Date(future.getTime() + 3_600_000), capacity: 5 },
      });
      const entry = await superuser.waitlistEntry.create({
        data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: school.id, position: 1, status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: new Date(Date.now() + 3_600_000) },
      });
      return request(app.getHttpServer()).post(`/v1/waitlist/${entry.id}/claim`).set('Authorization', `Bearer ${tokenStudent}`).send({});
    };
    await placeStudent('white-1');
    const refused = await claim();
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain('BJJ · Advanced');
    await placeStudent('white-3');
    expect((await claim()).status).toBe(201);
  });

  it('a grading-day pass books only the class it is for (Decisions 144, 159.2, 162)', async () => {
    const ticket = await superuser.user.create({
      data: {
        id: randomUUID(), email: `booking-unlocks-ticket-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'ticket', surname: 'Tenant', passcodeHash: 'x', dateOfBirth: new Date('2000-01-01'), phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(ticket.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: ticket.id, schoolId: school.id } });
    const tokenTicket = jwt.sign({ sub: ticket.id, email: ticket.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
    const future = new Date(Date.now() + 48 * 3_600_000);
    const mkClass = (title: string) =>
      superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title, activities: ['BJJ'], styles: bjjClass(null), startDate: future, endDate: new Date(future.getTime() + 3_600_000) } });
    const gradingDay = await mkClass('Grading day');
    const other = await mkClass('Ordinary class');
    // The School's own pass for its grading day: one credit, scoped to that class.
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Grading fee', price: 3000, classesIncluded: 1, scopedClassId: gradingDay.id },
    });
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: ticket.id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 1, scopedClassId: gradingDay.id },
    });
    const bookAs = (classId: string) => request(app.getHttpServer()).post(`/v1/classes/${classId}/book`).set('Authorization', `Bearer ${tokenTicket}`).send({});
    expect((await bookAs(other.id)).status).toBe(400);
    expect((await bookAs(gradingDay.id)).status).toBe(201);
  });

  it('the owner sets the list on a rung; it is kept when a later edit leaves it out', async () => {
    const tiers = await superuser.rankStripeTier.findMany({ where: { rankId: white.id }, orderBy: { order: 'asc' } });
    const send = (unlocks?: string[]) =>
      request(app.getHttpServer())
        .patch(`/v1/ranks/${white.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          stripeTiers: tiers.map((t) => ({
            order: t.order, count: t.count, colour: t.colour,
            ...(t.order === 2 && unlocks ? { bookingUnlocksClassTypes: unlocks } : {}),
          })),
        });
    const set = await send(['Advanced']);
    expect(set.status).toBe(200);
    expect((await superuser.rankStripeTier.findUniqueOrThrow({ where: { id: rung['white-2'].id } })).bookingUnlocksClassTypes).toEqual(['Advanced']);
    expect((await superuser.rankStripeTier.findUniqueOrThrow({ where: { id: rung['white-3'].id } })).bookingUnlocksClassTypes).toEqual(['Advanced', 'Open Mat']);
    const kept = await send();
    expect(kept.status).toBe(200);
    expect((await superuser.rankStripeTier.findUniqueOrThrow({ where: { id: rung['white-2'].id } })).bookingUnlocksClassTypes).toEqual(['Advanced']);
  });
});
