/**
 * Decision 433 (stress test round 5, PRIV-1): a closed School kept after its
 * 90 days for its members' payment history (or signed waivers) no longer
 * keeps their other data. The purge ends every role there, dated at the
 * close, and deletes the non-financial member rows; payment history and
 * notifications stay. Schools purged before this change are caught up.
 *
 * Close → backdate → purge → the former owner can't export the students.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS, JWT_ACCESS_SECRET
 * (and REDIS_URL for the queues).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TenantLifecyclePurgeProcessor } from '../src/jobs/tenant-lifecycle-purge.processor';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[closed-school-member-data-purge.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 3_600_000;

describeIfDb('Closed School member data purge (Decision 433, PRIV-1)', () => {
  let app: INestApplication;
  let processor: TenantLifecyclePurgeProcessor;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);
  const schoolIds: string[] = [];
  const job = { data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never;
  const http = () => request(app.getHttpServer());

  const mkUser = (label: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `cs-purge-${label}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1557${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Purge',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-05-05'),
        phoneVerifiedAt: new Date(),
      },
    });
  const token = (u: { id: string; email: string }, schoolId: string) =>
    jwt.sign({ sub: u.id, email: u.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId, branchId: null }] });

  /** A School closed `closedDaysAgo` days ago, past its purgeAt, with a member
   * who has payment history (so it is kept, anonymized) and data of every
   * kind the purge deletes. */
  async function seedClosedSchool(name: string, extra: { purgedAt?: Date } = {}) {
    const closedAt = new Date(Date.now() - 95 * DAY);
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: `${name} ${tag}`, archivedAt: closedAt, purgeAt: new Date(Date.now() - 5 * DAY), purgedAt: extra.purgedAt ?? null },
    });
    schoolIds.push(school.id);
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Main ${tag}` } });
    const owner = await mkUser('owner');
    const coach = await mkUser('coach');
    const student = await mkUser('student');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id, branchId: branch.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
      ],
    });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, schoolId: school.id, membershipPlanId: plan.id, frequency: 'RECURRING' },
    });
    const account = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'DE', stripeConnectedAccountId: `acct_${tag}_${randomUUID().slice(0, 6)}` },
    });
    const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: `Judo ${tag}`, classTypesOffered: [] } });
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, branchId: branch.id, title: 'Randori', startDate: new Date(closedAt.getTime() - 10 * DAY), endDate: new Date(closedAt.getTime() - 10 * DAY + 3_600_000), membershipInclusion: true },
    });
    const plainBooking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: school.id, branchId: branch.id, status: 'COMPLETED', sourceMembershipId: membership.id },
    });
    // A late-cancel fee was charged for this one: a money row refers to it.
    const feeBooking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: school.id, branchId: branch.id, status: 'CANCELLED', cancellationChargeAmount: 500 },
    });
    await superuser.transaction.create({
      data: { id: randomUUID(), schoolId: school.id, studentId: student.id, paymentAccountId: account.id, kind: 'LATE_CANCEL_FEE', bookingId: feeBooking.id, amount: 500, currency: 'EUR', status: 'SUCCESSFUL', paymentMethod: 'STRIPE' },
    });
    await superuser.trainingLog.create({
      data: { id: randomUUID(), schoolId: school.id, studentId: student.id, disciplineId: style.id, minutes: 60, source: 'CHECK_IN', openMat: false, countsTowardHours: true, classId: cls.id, bookingId: plainBooking.id, trainedAt: cls.startDate },
    });
    await superuser.studentNote.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, authorId: owner.id, body: 'Kontaktverbot gegen Ex-Partner' } });
    const tagRow = await superuser.schoolTag.create({ data: { id: randomUUID(), schoolId: school.id, name: `Wettkampf ${tag}` } });
    await superuser.studentTag.create({ data: { tagId: tagRow.id, schoolId: school.id, studentId: student.id } });
    await superuser.studentCheckInCode.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, code: String(Math.floor(100_000 + Math.random() * 899_999)) } });
    // The STUDENT grant's own trigger already recorded a join date (20270123000000_member_details).
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, branchId: branch.id } });
    await superuser.notificationBroadcast.create({
      data: { id: randomUUID(), schoolId: school.id, sentById: owner.id, sentByName: 'Owner', title: 'Halle zu', body: 'Die Halle bleibt am Montag zu.', audience: 'ALL', recipientCount: 1 },
    });
    await superuser.staffActivity.create({ data: { id: randomUUID(), schoolId: school.id, actorId: owner.id, targetUserId: coach.id, action: 'PAUSED' } });
    await superuser.coachInvite.create({
      data: { id: randomUUID(), schoolId: school.id, email: `invitee-${tag}@example.test`, tokenHash: randomUUID(), role: 'INSTRUCTOR', invitedById: owner.id, expiresAt: new Date(closedAt.getTime() + DAY) },
    });
    await superuser.frontDeskSession.create({ data: { id: randomUUID(), schoolId: school.id, branchId: branch.id, startedById: owner.id, expiresAt: new Date(closedAt.getTime() + DAY) } });
    await superuser.notification.create({ data: { id: randomUUID(), userId: student.id, title: 'For you', body: 'A notice', schoolId: school.id } });
    return { school, branch, owner, coach, student, membership, plainBooking, feeBooking, closedAt };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ClientService)
      .useValue({ isConfigured: () => true, deleteObject: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    processor = app.get(TenantLifecyclePurgeProcessor);
  });

  afterAll(async () => {
    const ids = schoolIds;
    await superuser.notification.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.transaction.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.school.deleteMany({ where: { id: { in: ids } } });
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function counts(schoolId: string) {
    const where = { schoolId };
    return {
      liveGrants: await superuser.roleGrant.count({ where: { schoolId, revokedAt: null } }),
      notes: await superuser.studentNote.count({ where }),
      schoolTags: await superuser.schoolTag.count({ where }),
      studentTags: await superuser.studentTag.count({ where }),
      checkInCodes: await superuser.studentCheckInCode.count({ where }),
      joinDates: await superuser.studentJoinDate.count({ where }),
      homeBranches: await superuser.studentHomeBranch.count({ where }),
      broadcasts: await superuser.notificationBroadcast.count({ where }),
      staffActivity: await superuser.staffActivity.count({ where }),
      coachInvites: await superuser.coachInvite.count({ where }),
      frontDeskSessions: await superuser.frontDeskSession.count({ where }),
      trainingLogs: await superuser.trainingLog.count({ where }),
    };
  }
  const NOTHING = { liveGrants: 0, notes: 0, schoolTags: 0, studentTags: 0, checkInCodes: 0, joinDates: 0, homeBranches: 0, broadcasts: 0, staffActivity: 0, coachInvites: 0, frontDeskSessions: 0, trainingLogs: 0 };

  it('close → 90 days → purge: roles end at the close, member data goes, payment history and notices stay, the former owner is refused', async () => {
    const s = await seedClosedSchool('PRIV-1 purge');
    const before = token(s.owner, s.school.id);
    expect((await http().get(`/v1/schools/${s.school.id}/students/export`).set('Authorization', `Bearer ${before}`)).status).toBe(200);

    await processor.process(job);

    const school = await superuser.school.findUniqueOrThrow({ where: { id: s.school.id } });
    expect(school.name).toBe('[Closed School]');
    expect(school.memberDataPurgedAt).toBeTruthy();
    expect(await counts(s.school.id)).toEqual(NOTHING);
    // Every role ended on the day the School closed, not today, so the
    // waiver retention clock (Decision 426 item 1) doesn't move.
    const grants = await superuser.roleGrant.findMany({ where: { schoolId: s.school.id } });
    expect(grants).toHaveLength(3);
    for (const g of grants) expect(g.revokedAt?.toISOString()).toBe(s.closedAt.toISOString());
    // Payment history stays (Decision 261): the Membership, the fee and the
    // Booking it was charged for. The plain Booking is gone.
    expect(await superuser.membership.count({ where: { schoolId: s.school.id } })).toBe(1);
    expect(await superuser.transaction.count({ where: { schoolId: s.school.id } })).toBe(1);
    expect(await superuser.booking.findUnique({ where: { id: s.feeBooking.id } })).not.toBeNull();
    expect(await superuser.booking.findUnique({ where: { id: s.plainBooking.id } })).toBeNull();
    // Each person's own notices stay (Decisions 244, 277).
    expect(await superuser.notification.count({ where: { schoolId: s.school.id } })).toBe(1);

    // The token from before the purge is refused (401 once rolesChangedAt is
    // past its issue time, else 403 from the ended role), and so is a fresh one.
    const stale = await http().get(`/v1/schools/${s.school.id}/students/export`).set('Authorization', `Bearer ${before}`);
    expect([401, 403]).toContain(stale.status);
    const fresh = token(s.owner, s.school.id);
    for (const path of ['students/export', `students/${s.student.id}/notes`, 'attendance/stats']) {
      const res = await http().get(`/v1/schools/${s.school.id}/${path}`).set('Authorization', `Bearer ${fresh}`);
      expect([403, 404]).toContain(res.status);
    }

    // A second run changes nothing and doesn't fail.
    await processor.process(job);
    expect(await counts(s.school.id)).toEqual(NOTHING);
    expect(await superuser.booking.findUnique({ where: { id: s.feeBooking.id } })).not.toBeNull();
  });

  it('a School purged before this change is caught up on the next run', async () => {
    const s = await seedClosedSchool('PRIV-1 backfill', { purgedAt: new Date(Date.now() - 2 * DAY) });
    expect((await counts(s.school.id)).liveGrants).toBe(3);

    await processor.process(job);

    expect(await counts(s.school.id)).toEqual(NOTHING);
    expect((await superuser.school.findUniqueOrThrow({ where: { id: s.school.id } })).memberDataPurgedAt).toBeTruthy();
    expect(await superuser.membership.count({ where: { schoolId: s.school.id } })).toBe(1);
  });

  it('the jobs role still cannot delete a live School\'s bookings or broadcasts', async () => {
    const jobs = new PrismaClient({ datasourceUrl: DATABASE_URL_JOBS });
    try {
      const s = await seedClosedSchool('PRIV-1 live');
      // Reopened: neither archived nor purged.
      await superuser.school.update({ where: { id: s.school.id }, data: { archivedAt: null, purgeAt: null } });
      const deleted = await jobs.booking.deleteMany({ where: { schoolId: s.school.id } });
      expect(deleted.count).toBe(0);
      await expect(jobs.notificationBroadcast.deleteMany({ where: { schoolId: s.school.id } })).resolves.toEqual({ count: 0 });
      expect(await superuser.notificationBroadcast.count({ where: { schoolId: s.school.id } })).toBe(1);
      expect(await superuser.booking.count({ where: { schoolId: s.school.id } })).toBe(2);
    } finally {
      await jobs.$disconnect();
    }
  });
});
