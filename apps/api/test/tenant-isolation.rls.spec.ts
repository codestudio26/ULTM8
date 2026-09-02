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
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
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
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
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

  it('a request with no tenant context set sees zero rows, not an error and not all rows', async () => {
    // Deliberately bypass withUser — no SET LOCAL app.current_user_id at all.
    const schools = await appDb.school.findMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    expect(schools).toHaveLength(0);
  });
});
