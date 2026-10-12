/**
 * HTTP-level gate for TransactionsModule's Student-scoped self-read,
 * GET /transactions/me — closes the TRACK-B-ROADMAP.md "Explicitly blocked"
 * gap ("Invoice/receipt viewing, Student-scoped transaction history"). The
 * Staff-facing GET /schools/{id}/transactions ledger read is already covered
 * end-to-end by memberships.e2e-spec.ts (Phase 9) — not re-proven here. Same
 * ground rule as every other e2e spec in this repo: prove over real HTTP, not
 * just by reading the code.
 *
 * Fixture Transaction rows are created directly via the superuser client
 * (bypassing the real purchase flow, same shorthand bookings.e2e-spec.ts's own
 * mkActiveMembership helper uses for Membership) — the purchase flow itself is
 * memberships.e2e-spec.ts's job, this file only needs real Transaction rows to
 * prove the new read's scoping, pagination, and shape.
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
    '[transactions.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('TransactionsModule: GET /transactions/me — Student self-read, pagination, and isolation', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let tokenStudentA: string;
  let tokenStudentB: string;
  let paymentAccountId: string;
  let membershipPlanId: string;
  const transactionIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  function mkTransaction(studentId: string, amount: number) {
    return superuser.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        studentId,
        paymentAccountId,
        membershipPlanId,
        amount,
        currency: 'gbp',
        status: 'SUCCESSFUL',
        paymentMethod: 'BANK_TRANSFER',
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Transactions HTTP School' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `transactions-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    studentA = await mkUser('student-a');
    studentB = await mkUser('student-b');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
      ],
    });

    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);

    const paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'BANK_TRANSFER', accountTitle: 'Fixture', country: 'GB' },
    });
    paymentAccountId = paymentAccount.id;

    const membershipPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-Class Pack', price: 5000, classesIncluded: 5 },
    });
    membershipPlanId = membershipPlan.id;
  });

  afterAll(async () => {
    await superuser.transaction.deleteMany({ where: { id: { in: transactionIds } } });
    await superuser.membershipPlan.delete({ where: { id: membershipPlanId } });
    await superuser.paymentAccount.delete({ where: { id: paymentAccountId } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'transactions-http-' } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  it('is rejected unauthenticated — 401', async () => {
    const res = await request(app.getHttpServer()).get('/v1/transactions/me');
    expect(res.status).toBe(401);
  });

  it("returns only the caller's own Transactions, with the membership plan's title joined on, and a different Student gets none of them", async () => {
    const txA = await mkTransaction(studentA.id, 5000);
    transactionIds.push(txA.id);
    const txB = await mkTransaction(studentB.id, 3000);
    transactionIds.push(txB.id);

    const resA = await request(app.getHttpServer()).get('/v1/transactions/me').set('Authorization', `Bearer ${tokenStudentA}`);
    expect(resA.status).toBe(200);
    expect(resA.body.items.some((t: { id: string }) => t.id === txA.id)).toBe(true);
    expect(resA.body.items.some((t: { id: string }) => t.id === txB.id)).toBe(false);
    const rowA = resA.body.items.find((t: { id: string }) => t.id === txA.id);
    expect(rowA.amount).toBe(5000);
    expect(rowA.currency).toBe('gbp');
    expect(rowA.status).toBe('SUCCESSFUL');
    expect(rowA.paymentMethod).toBe('BANK_TRANSFER');
    expect(rowA.membershipPlanTitle).toBe('5-Class Pack');
    expect(typeof rowA.billingDate).toBe('string');
    // Self-read never resolves the caller's own name — see
    // TransactionResponseDto's own header comment.
    expect(rowA.studentFirstName).toBeUndefined();

    const resB = await request(app.getHttpServer()).get('/v1/transactions/me').set('Authorization', `Bearer ${tokenStudentB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.items.some((t: { id: string }) => t.id === txA.id)).toBe(false);
    expect(resB.body.items.some((t: { id: string }) => t.id === txB.id)).toBe(true);
  });

  it('paginates with cursor/limit', async () => {
    const extra = await Promise.all([mkTransaction(studentA.id, 100), mkTransaction(studentA.id, 200), mkTransaction(studentA.id, 300)]);
    extra.forEach((t) => transactionIds.push(t.id));

    const first = await request(app.getHttpServer())
      .get('/v1/transactions/me')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(first.status).toBe(200);
    expect(first.body.items.length).toBe(1);
    expect(typeof first.body.nextCursor).toBe('string');

    const second = await request(app.getHttpServer())
      .get('/v1/transactions/me')
      .query({ limit: 1, cursor: first.body.nextCursor })
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(second.status).toBe(200);
    expect(second.body.items.length).toBe(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });
});
