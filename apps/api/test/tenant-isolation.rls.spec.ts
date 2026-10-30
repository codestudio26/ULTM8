/**
 * The CI cross-tenant isolation gate (ultm8-tenant-isolation §5): asserts that a
 * caller scoped to Tenant A can never read or write Tenant B's resources.
 *
 * This tests the RLS policies directly (School, Branch, User) rather than going
 * through HTTP endpoints, because Phase 1 only ships AuthModule — there is no
 * TenantsModule CRUD yet to exercise via HTTP. It targets exactly what this phase
 * actually built (schema.prisma + migration.sql's RLS policies), which is also
 * confirmed as a required-to-merge gate from day one (ultm8-tenant-isolation §5),
 * not something to bolt on once TenantsModule exists.
 *
 * Requires a real Postgres instance with the Phase 1 migration applied — two
 * connection strings:
 *   DATABASE_URL      — a real Postgres superuser (bypasses RLS unconditionally,
 *                        used only to set up fixtures)
 *   DATABASE_URL_APP  — the ultm8_app role the migration creates (subject to RLS —
 *                        this is what's actually under test)
 *
 * If neither is set, the suite skips with a warning rather than failing — see
 * .github/workflows/ci.yml for how CI provides both via a Postgres service container,
 * which is what actually makes this gate "required to merge."
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tenant-isolation.rls.spec] Skipped — DATABASE_URL / DATABASE_URL_APP not set. ' +
      'This gate MUST run against a real Postgres in CI (see .github/workflows/ci.yml); ' +
      'a local skip is not a substitute for that.',
  );
}

describeIfDb('cross-tenant isolation (RLS)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  let userA: { id: string };
  let userB: { id: string };

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  beforeAll(async () => {
    // Fixtures created as superuser — bypasses RLS unconditionally, no tenant context needed.
    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'RLS Test School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'RLS Test School B' } });
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Branch A1' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolB.id, name: 'Branch B1' } });

    userA = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `rls-a-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'A',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userB = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `rls-b-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'B',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });

    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: userA.id, schoolId: schoolA.id },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: userB.id, schoolId: schoolB.id },
    });
  });

  afterAll(async () => {
    // Cleanup as superuser (bypasses RLS).
    await superuser.roleGrant.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await superuser.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
    await superuser.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
  });

  it('a token scoped to Tenant A cannot read Tenant B\'s School row', async () => {
    const visible = await withUser(userA.id, (tx) => tx.school.findMany());
    const ids = visible.map((s) => s.id);
    expect(ids).toContain(schoolA.id);
    expect(ids).not.toContain(schoolB.id);
  });

  it('a token scoped to Tenant A cannot read Tenant B\'s Branch row', async () => {
    const visible = await withUser(userA.id, (tx) => tx.branch.findMany());
    const ids = visible.map((b) => b.id);
    expect(ids).toContain(branchA.id);
    expect(ids).not.toContain(branchB.id);
  });

  it('a token scoped to Tenant A cannot read User B\'s profile (different Schools, no shared grant)', async () => {
    const visible = await withUser(userA.id, (tx) => tx.user.findMany());
    const ids = visible.map((u) => u.id);
    expect(ids).toContain(userA.id);
    expect(ids).not.toContain(userB.id);
  });

  it('a token scoped to Tenant A cannot write to Tenant B\'s School row', async () => {
    await withUser(userA.id, (tx) =>
      tx.school.updateMany({ where: { id: schoolB.id }, data: { name: 'HACKED BY TENANT A' } }),
    );
    const unchanged = await superuser.school.findUniqueOrThrow({ where: { id: schoolB.id } });
    expect(unchanged.name).toBe('RLS Test School B');
  });

  it('a Franchise join request is visible only to that School\'s Owner and that Franchise\'s Owner (Decision 352)', async () => {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'RLS Join Franchise' } });
    const otherFranchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'RLS Other Franchise' } });
    try {
      // userA owns a different Franchise, so a FRANCHISE_OWNER grant alone is not enough.
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: userA.id, franchiseId: otherFranchise.id } });
      const req = await superuser.franchiseJoinRequest.create({
        data: { id: randomUUID(), franchiseId: franchise.id, schoolId: schoolB.id, schoolName: 'RLS Test School B', requestedById: userB.id },
      });

      const seenByA = await withUser(userA.id, (tx) => tx.franchiseJoinRequest.findMany({ where: { id: req.id } }));
      expect(seenByA).toHaveLength(0);
      await withUser(userA.id, (tx) => tx.franchiseJoinRequest.updateMany({ where: { id: req.id }, data: { status: 'ACCEPTED' } }));
      expect((await superuser.franchiseJoinRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');

      const seenByB = await withUser(userB.id, (tx) => tx.franchiseJoinRequest.findMany({ where: { id: req.id } }));
      expect(seenByB).toHaveLength(1);

      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: userA.id, franchiseId: franchise.id } });
      const seenByOwner = await withUser(userA.id, (tx) => tx.franchiseJoinRequest.findMany({ where: { id: req.id } }));
      expect(seenByOwner).toHaveLength(1);
    } finally {
      await superuser.roleGrant.deleteMany({ where: { franchiseId: { in: [franchise.id, otherFranchise.id] } } });
      await superuser.franchise.deleteMany({ where: { id: { in: [franchise.id, otherFranchise.id] } } });
    }
  });

  it('charges, balance entries and allocations are visible only within their School (Decisions 303, 338)', async () => {
    const chargeId = randomUUID();
    const entryId = randomUUID();
    const allocationId = randomUUID();
    // userB owns School B; the charge is on userB's own account there.
    await superuser.charge.create({
      data: {
        id: chargeId, schoolId: schoolB.id, studentId: userB.id, invoiceNumber: 1, description: 'RLS charge', unitAmount: 1000,
        taxRateBasisPoints: 0, taxInclusive: true, netAmount: 1000, taxAmount: 0, grossAmount: 1000, currency: 'GBP', dueDate: new Date('2026-11-01'),
      },
    });
    try {
      await superuser.balanceEntry.create({ data: { id: entryId, schoolId: schoolB.id, studentId: userB.id, kind: 'CHARGE', amount: 1000, currency: 'GBP', chargeId } });
      await superuser.chargeAllocation.create({ data: { id: allocationId, schoolId: schoolB.id, studentId: userB.id, chargeId, amount: 100 } });

      expect(await withUser(userA.id, (tx) => tx.charge.findMany({ where: { id: chargeId } }))).toHaveLength(0);
      expect(await withUser(userA.id, (tx) => tx.balanceEntry.findMany({ where: { id: entryId } }))).toHaveLength(0);
      expect(await withUser(userA.id, (tx) => tx.chargeAllocation.findMany({ where: { id: allocationId } }))).toHaveLength(0);
      expect(await withUser(userB.id, (tx) => tx.charge.findMany({ where: { id: chargeId } }))).toHaveLength(1);

      // The app connection never writes them: no INSERT or UPDATE grant at all.
      await expect(withUser(userA.id, (tx) => tx.charge.updateMany({ where: { id: chargeId }, data: { grossAmount: 1 } }))).rejects.toThrow();
      await expect(
        withUser(userA.id, (tx) => tx.balanceEntry.create({ data: { schoolId: schoolA.id, studentId: userA.id, kind: 'PAYMENT', amount: -1, currency: 'GBP', transactionId: randomUUID() } })),
      ).rejects.toThrow();
    } finally {
      await superuser.chargeAllocation.deleteMany({ where: { chargeId } });
      await superuser.balanceEntry.deleteMany({ where: { chargeId } });
      await superuser.charge.deleteMany({ where: { id: chargeId } });
    }
  });

  it('recurring charges are visible only within their School, and never written by the app connection (Decision 412)', async () => {
    const id = randomUUID();
    await superuser.recurringCharge.create({
      data: {
        id, schoolId: schoolB.id, studentId: userB.id, description: 'RLS recurring', unitAmount: 1000, currency: 'GBP',
        frequency: 'MONTHLY', firstDate: new Date('2026-11-01'), nextDate: new Date('2026-11-01'),
      },
    });
    try {
      expect(await withUser(userA.id, (tx) => tx.recurringCharge.findMany({ where: { id } }))).toHaveLength(0);
      expect(await withUser(userB.id, (tx) => tx.recurringCharge.findMany({ where: { id } }))).toHaveLength(1);
      await expect(withUser(userB.id, (tx) => tx.recurringCharge.updateMany({ where: { id }, data: { unitAmount: 1 } }))).rejects.toThrow();
      await expect(
        withUser(userA.id, (tx) =>
          tx.recurringCharge.create({
            data: { schoolId: schoolA.id, studentId: userA.id, description: 'x', unitAmount: 1, currency: 'GBP', frequency: 'WEEKLY', firstDate: new Date('2026-11-01') },
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await superuser.recurringCharge.deleteMany({ where: { id } });
    }
  });

  it('charge refunds are visible only within their School and never written by the app (backlog 3.6 step 4)', async () => {
    const accountId = randomUUID();
    const transactionId = randomUUID();
    const refundId = randomUUID();
    await superuser.paymentAccount.create({ data: { id: accountId, schoolId: schoolB.id, provider: 'CASH', accountTitle: 'RLS desk', country: 'GB' } });
    try {
      await superuser.transaction.create({
        data: { id: transactionId, schoolId: schoolB.id, studentId: userB.id, paymentAccountId: accountId, kind: 'CHARGE_PAYMENT', amount: 1000, currency: 'GBP', status: 'SUCCESSFUL', paymentMethod: 'CASH' },
      });
      await superuser.chargeRefund.create({ data: { id: refundId, schoolId: schoolB.id, studentId: userB.id, transactionId, kind: 'MONEY_BACK', amount: 100, currency: 'GBP', notes: 'RLS' } });

      expect(await withUser(userA.id, (tx) => tx.chargeRefund.findMany({ where: { id: refundId } }))).toHaveLength(0);
      expect(await withUser(userB.id, (tx) => tx.chargeRefund.findMany({ where: { id: refundId } }))).toHaveLength(1);
      await expect(
        withUser(userA.id, (tx) => tx.chargeRefund.create({ data: { schoolId: schoolA.id, studentId: userA.id, transactionId, kind: 'CREDIT', amount: 1, currency: 'GBP' } })),
      ).rejects.toThrow();
      await expect(withUser(userB.id, (tx) => tx.chargeRefund.updateMany({ where: { id: refundId }, data: { amount: 1 } }))).rejects.toThrow();
    } finally {
      await superuser.chargeRefund.deleteMany({ where: { id: refundId } });
      await superuser.transaction.deleteMany({ where: { id: transactionId } });
      await superuser.paymentAccount.deleteMany({ where: { id: accountId } });
    }
  });

  it('a request with no tenant context set sees zero rows, not an error and not all rows', async () => {
    // Deliberately bypass withUser — no SET LOCAL app.current_user_id at all.
    const schools = await appDb.school.findMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    expect(schools).toHaveLength(0);
  });
});
