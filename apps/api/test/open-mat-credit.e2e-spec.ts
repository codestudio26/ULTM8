/**
 * Decision 304 item 3: the School setting "Open mat uses a class credit"
 * (Settings → Check-in rules), on by default. On: an open mat takes a Class
 * Pack or Friend Pass credit like any class. Off: it still needs a membership
 * or pass that covers it, but takes no credit, and cancelling it gives
 * nothing back. A class is open mat when every style on it has the class type
 * "Open mat"; any other class keeps taking a credit.
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

describeIfDb('Open mat uses a class credit (Decision 304 item 3)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let bjj: { id: string };
  let packPlanId: string;
  let friendPlanId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  const OPEN_MAT = () => [{ disciplineId: bjj.id, classType: 'Open mat' }];
  const FUNDAMENTALS = () => [{ disciplineId: bjj.id, classType: 'Fundamentals' }];
  const mkClass = async (styles: Array<{ disciplineId: string; classType: string }>) => {
    const startDate = new Date(Date.now() + 2 * 86_400_000 + Math.floor(Math.random() * 3_600_000));
    return superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        title: 'Mat time',
        activities: ['BJJ'],
        styles,
        membershipInclusion: true,
        startDate,
        endDate: new Date(startDate.getTime() + 3_600_000),
      },
    });
  };
  const mkMembership = (who: string, planId: string, classesRemaining: number) =>
    superuser.membership.create({
      data: { id: randomUUID(), studentId: users[who].id, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining },
    });
  const credits = async (membershipId: string) => (await superuser.membership.findUniqueOrThrow({ where: { id: membershipId } })).classesRemaining;
  const book = (who: string, classId: string, body: Record<string, unknown> = {}) => http().post(`/v1/classes/${classId}/book`).set(as(who)).send(body);
  const cancel = (who: string, bookingId: string) => http().patch(`/v1/bookings/${bookingId}/cancel`).set(as(who)).send({});
  const setRule = async (on: boolean) => {
    const current = await http().get(`/v1/schools/${school.id}/check-in-rules`).set(as('owner'));
    expect(current.status).toBe(200);
    const res = await http().put(`/v1/schools/${school.id}/check-in-rules`).set(as('owner')).send({ ...current.body, openMatUsesCredit: on });
    expect(res.status).toBe(200);
    expect(res.body.openMatUsesCredit).toBe(on);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Open Mat Credit School', timezone: 'Europe/London', classCancellationPolicy: 'AUTO_CREDIT' } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals', 'Open mat'] } });
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    packPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '10 classes', price: 10000, classesIncluded: 10 } })).id;
    friendPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Friend Pass', price: 0, classesIncluded: 1 } })).id;

    for (const label of ['owner', 'ana', 'ben', 'empty', 'none', 'staff']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `omc-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Mat',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      const role = label === 'owner' ? 'SCHOOL_OWNER_MANAGER' : label === 'staff' ? 'BRANCH_STAFF' : 'STUDENT';
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label].id, schoolId: school.id } });
      tokens[label] = jwt.sign({ sub: users[label].id, email: users[label].email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
      if (role === 'STUDENT') {
        await superuser.studentRank.create({ data: { id: randomUUID(), studentId: users[label].id, disciplineId: bjj.id, schoolId: school.id, currentRankId: white.id } });
      }
    }
  });

  afterAll(async () => {
    // Cancelling a class tells its students.
    await superuser.notification.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('is on by default, and an open mat then takes a credit like any class', async () => {
    const rules = await http().get(`/v1/schools/${school.id}/check-in-rules`).set(as('owner'));
    expect(rules.body.openMatUsesCredit).toBe(true);
    const pack = await mkMembership('ana', packPlanId, 5);
    const res = await book('ana', (await mkClass(OPEN_MAT())).id);
    expect(res.status).toBe(201);
    expect(await credits(pack.id)).toBe(4);
    expect((await superuser.booking.findUniqueOrThrow({ where: { id: res.body.id } })).creditUsed).toBe(true);
    // Cancelling gives the credit back, as before.
    expect((await cancel('ana', res.body.id)).status).toBe(200);
    expect(await credits(pack.id)).toBe(5);
    await superuser.booking.deleteMany({ where: { id: res.body.id } });
    await superuser.membership.delete({ where: { id: pack.id } });
  });

  it('only the owner (or staff with the check-in rules right) can turn it off', async () => {
    const current = await http().get(`/v1/schools/${school.id}/check-in-rules`).set(as('owner'));
    const res = await http().put(`/v1/schools/${school.id}/check-in-rules`).set(as('staff')).send({ ...current.body, openMatUsesCredit: false });
    expect(res.status).toBe(403);
    expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).openMatUsesClassCredit).toBe(true);
    // Left out of a save, it stays as it is.
    const { openMatUsesCredit: _left, ...older } = current.body;
    const kept = await http().put(`/v1/schools/${school.id}/check-in-rules`).set(as('owner')).send(older);
    expect(kept.status).toBe(200);
    expect(kept.body.openMatUsesCredit).toBe(true);
  });

  describe('turned off', () => {
    beforeAll(() => setRule(false));
    afterAll(() => setRule(true));

    it("an open mat takes no credit, and cancelling it gives nothing back (no credit, no refund)", async () => {
      const pack = await mkMembership('ana', packPlanId, 5);
      const res = await book('ana', (await mkClass(OPEN_MAT())).id);
      expect(res.status).toBe(201);
      expect(res.body.sourceMembershipId).toBe(pack.id);
      expect(await credits(pack.id)).toBe(5);
      expect((await superuser.booking.findUniqueOrThrow({ where: { id: res.body.id } })).creditUsed).toBe(false);
      const cancelled = await cancel('ana', res.body.id);
      expect(cancelled.status).toBe(200);
      expect(await credits(pack.id)).toBe(5);
      expect(cancelled.body.refundResolution).toBeNull();
      await superuser.booking.deleteMany({ where: { id: res.body.id } });
      await superuser.membership.delete({ where: { id: pack.id } });
    });

    it('the School cancelling the open mat gives back no credit it never took', async () => {
      const pack = await mkMembership('ben', packPlanId, 5);
      const cls = await mkClass(OPEN_MAT());
      const res = await book('ben', cls.id);
      expect(res.status).toBe(201);
      expect(await credits(pack.id)).toBe(5);
      const cancelled = await http().post(`/v1/classes/${cls.id}/cancel`).set(as('owner')).send({});
      expect(cancelled.status).toBe(201);
      const booking = await superuser.booking.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(booking.status).toBe('CANCELLED');
      expect(booking.refundResolution).toBeNull();
      expect(await credits(pack.id)).toBe(5);
      // The cancellation notice is written by a queue worker: let it land
      // before the clean-up deletes the student.
      for (let i = 0; i < 50 && (await superuser.notification.count({ where: { userId: users.ben.id } })) === 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await superuser.booking.deleteMany({ where: { studentId: users.ben.id } });
      await superuser.membership.delete({ where: { id: pack.id } });
    });

    it('any other class, or a mixed class with a non-open-mat style, still takes a credit', async () => {
      const pack = await mkMembership('ben', packPlanId, 5);
      const plain = await book('ben', (await mkClass(FUNDAMENTALS())).id);
      expect(plain.status).toBe(201);
      expect(await credits(pack.id)).toBe(4);
      const judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo', classTypesOffered: ['Randori'] } });
      const mixed = await book('ben', (await mkClass([...OPEN_MAT(), { disciplineId: judo.id, classType: 'Randori' }])).id);
      expect(mixed.status).toBe(201);
      expect(await credits(pack.id)).toBe(3);
      await superuser.booking.deleteMany({ where: { studentId: users.ben.id } });
      await superuser.membership.delete({ where: { id: pack.id } });
    });

    it("a guest's Friend Pass takes no credit either", async () => {
      const pack = await mkMembership('ana', packPlanId, 5);
      const pass = await mkMembership('ana', friendPlanId, 1);
      const res = await book('ana', (await mkClass(OPEN_MAT())).id, { attendeeMembershipIds: [pass.id] });
      expect(res.status).toBe(201);
      expect(await credits(pass.id)).toBe(1);
      expect(await credits(pack.id)).toBe(5);
      const guest = await superuser.bookingAttendee.findFirstOrThrow({ where: { bookingId: res.body.id } });
      expect(guest.creditUsed).toBe(false);
      expect((await cancel('ana', res.body.id)).status).toBe(200);
      expect(await credits(pass.id)).toBe(1);
      expect((await superuser.bookingAttendee.findFirstOrThrow({ where: { bookingId: res.body.id } })).refundResolution).toBeNull();
      await superuser.bookingAttendee.deleteMany({ where: { bookingId: res.body.id } });
      await superuser.booking.deleteMany({ where: { id: res.body.id } });
      await superuser.membership.deleteMany({ where: { id: { in: [pack.id, pass.id] } } });
    });

    it('still needs a membership or pass that covers it: a used-up pack or none is refused', async () => {
      const cls = await mkClass(OPEN_MAT());
      await mkMembership('empty', packPlanId, 0);
      const used = await book('empty', cls.id);
      expect(used.status).toBe(400);
      expect(used.body.error.code).toBe('PACK_USED_UP');
      expect((await book('none', cls.id)).status).toBe(400);
    });
  });
});
