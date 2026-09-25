/**
 * Proves the chargeback-pattern-restriction job's own counting/threshold/idempotency
 * logic (Decision 68/112) — the piece a passing build genuinely cannot substitute
 * for, same reasoning class-occurrence-generation.e2e-spec.ts and
 * stripe-webhook-processing.e2e-spec.ts already established for their own jobs.
 * Triggers the processor directly (calling .process() against a fake Job) rather
 * than going through a real queue/Redis connection, and fakes
 * NOTIFICATION_FANOUT_QUEUE (getQueueToken override) the same way
 * notifications.e2e-spec.ts/stripe-webhook-processing.e2e-spec.ts already do —
 * exercises the real DB counting/idempotency logic, not a live email/Stripe call.
 *
 * Requires DATABASE_URL and DATABASE_URL_JOBS (this processor runs via
 * PrismaJobsService, the ultm8_jobs role — same convention every other job's own
 * e2e-spec in this repo already follows). Skips with a warning if either is unset.
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ChargebackPatternRestrictionProcessor } from '../src/jobs/chargeback-pattern-restriction.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[chargeback-pattern-restriction.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('chargeback-pattern-restriction job (Decision 68/112)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: ChargebackPatternRestrictionProcessor;

  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const paymentAccountIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const transactionIds: string[] = [];

  const fakeNotificationFanoutQueue = { addBulk: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChargebackPatternRestrictionProcessor,
        PrismaJobsService,
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: fakeNotificationFanoutQueue },
      ],
    }).compile();
    processor = moduleRef.get(ChargebackPatternRestrictionProcessor);
  });

  afterEach(() => {
    fakeNotificationFanoutQueue.addBulk.mockClear();
  });

  afterAll(async () => {
    await superuser.transaction.deleteMany({ where: { id: { in: transactionIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.paymentAccount.deleteMany({ where: { id: { in: paymentAccountIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
  });

  function fakeJob(studentId: string) {
    return { data: { studentId }, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  /** School + PaymentAccount + MembershipPlan + Student (STUDENT RoleGrant) +
   * School Owner (SCHOOL_OWNER_MANAGER RoleGrant) — the fixture shape every test
   * below builds on. */
  async function seedStudentWithSchool() {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Chargeback Fixture School' } });
    schoolIds.push(school.id);
    const owner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `chargeback-owner-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Chargeback',
        surname: 'Owner',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(owner.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });

    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `chargeback-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Chargeback',
        surname: 'Student',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(student.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id } });

    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB' },
    });
    paymentAccountIds.push(paymentAccount.id);
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Fixture Plan', price: 1000 },
    });
    membershipPlanIds.push(plan.id);

    return { school, owner, student, paymentAccount, plan };
  }

  /** Seeds one SUCCESSFUL-turned-DISPUTED Transaction with disputeLostAt set for
   * this Student — the row shape the job's own count query reads. */
  async function seedLostDisputeTransaction(fixture: Awaited<ReturnType<typeof seedStudentWithSchool>>) {
    const transaction = await superuser.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: fixture.school.id,
        studentId: fixture.student.id,
        paymentAccountId: fixture.paymentAccount.id,
        membershipPlanId: fixture.plan.id,
        amount: 1000,
        status: 'DISPUTED',
        paymentMethod: 'STRIPE',
        disputeLostAt: new Date(),
      },
    });
    transactionIds.push(transaction.id);
    return transaction;
  }

  it('below the threshold (1 lost dispute): not restricted, no notification', async () => {
    const fixture = await seedStudentWithSchool();
    await seedLostDisputeTransaction(fixture);

    await processor.process(fakeJob(fixture.student.id));

    const updated = await superuser.user.findUniqueOrThrow({ where: { id: fixture.student.id } });
    expect(updated.paymentRestrictedAt).toBeNull();
    expect(fakeNotificationFanoutQueue.addBulk).not.toHaveBeenCalled();
  });

  it('crossing the threshold (2 lost disputes): restricted, School Owner/Manager notified', async () => {
    const fixture = await seedStudentWithSchool();
    await seedLostDisputeTransaction(fixture);
    await seedLostDisputeTransaction(fixture);

    await processor.process(fakeJob(fixture.student.id));

    const updated = await superuser.user.findUniqueOrThrow({ where: { id: fixture.student.id } });
    expect(updated.paymentRestrictedAt).not.toBeNull();

    expect(fakeNotificationFanoutQueue.addBulk).toHaveBeenCalledTimes(1);
    const jobs = fakeNotificationFanoutQueue.addBulk.mock.calls[0][0] as Array<{ data: { userId: string } }>;
    expect(jobs.map((j) => j.data.userId)).toEqual([fixture.owner.id]);
  });

  it('a 3rd lost dispute after already restricted is idempotent — no duplicate notification', async () => {
    const fixture = await seedStudentWithSchool();
    await seedLostDisputeTransaction(fixture);
    await seedLostDisputeTransaction(fixture);
    await processor.process(fakeJob(fixture.student.id));
    const firstRestriction = await superuser.user.findUniqueOrThrow({ where: { id: fixture.student.id } });
    expect(firstRestriction.paymentRestrictedAt).not.toBeNull();
    fakeNotificationFanoutQueue.addBulk.mockClear();

    // A 3rd lost dispute — re-triggers the same check.
    await seedLostDisputeTransaction(fixture);
    await processor.process(fakeJob(fixture.student.id));

    const secondCheck = await superuser.user.findUniqueOrThrow({ where: { id: fixture.student.id } });
    expect(secondCheck.paymentRestrictedAt?.getTime()).toBe(firstRestriction.paymentRestrictedAt?.getTime());
    expect(fakeNotificationFanoutQueue.addBulk).not.toHaveBeenCalled();
  });
});
