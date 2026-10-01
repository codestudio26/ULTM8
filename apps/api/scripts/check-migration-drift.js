/**
 * One-off diagnostic — NOT part of the app's real code, not run in CI.
 *
 * Checks two things directly against the live DB before merging master into this
 * branch, rather than inferring them from migration file text:
 *   1. Does `ultm8_rls_helper` actually hold CREATE on schema public right now?
 *      (our branch's 20260904 fix grants this; master's copy of that same
 *      migration never did — if master's later deploys relied on it anyway,
 *      it can only be because this was already true on the live DB.)
 *   2. What does `_prisma_migrations` actually have recorded for
 *      20260904000000_fix_rolegrant_rls_recursion — applied when, and is its
 *      stored checksum the same either way (it only matters if we ever run
 *      `prisma migrate deploy` again from a branch carrying a *different*
 *      version of that migration's SQL than whatever is on record).
 *
 * Usage (from apps/api): DATABASE_URL='...' node scripts/check-migration-drift.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const [privilege] = await prisma.$queryRawUnsafe(
    `SELECT has_schema_privilege('ultm8_rls_helper', 'public', 'CREATE') AS can_create`,
  );
  console.log('ultm8_rls_helper has CREATE on schema public:', privilege.can_create);

  const rows = await prisma.$queryRawUnsafe(
    `SELECT migration_name, checksum, started_at, finished_at, applied_steps_count
     FROM "_prisma_migrations"
     WHERE migration_name LIKE '2026%'
     ORDER BY started_at ASC`,
  );
  console.log(`\n${rows.length} migrations recorded in _prisma_migrations:`);
  for (const r of rows) {
    console.log(
      `  ${r.migration_name} | checksum=${r.checksum.slice(0, 12)}... | started=${r.started_at?.toISOString?.() ?? r.started_at} | steps=${r.applied_steps_count}`,
    );
  }

  const target = rows.find((r) => r.migration_name === '20260904000000_fix_rolegrant_rls_recursion');
  console.log('\n20260904000000_fix_rolegrant_rls_recursion recorded as:', target ? JSON.stringify(target, null, 2) : 'NOT FOUND');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
