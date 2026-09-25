/**
 * One-off diagnostic — NOT part of the app's real code, not run in CI. Reproduces the
 * exact CREATE FUNCTION statement from
 * prisma/migrations/20260904000000_fix_rolegrant_rls_recursion/migration.sql directly
 * via `pg`, bypassing Prisma, so we see Postgres's raw error/detail/hint instead of
 * Prisma's wrapped one. Written as a committed file (not an inline shell one-liner)
 * because multi-line escaped heredocs were repeatedly getting mangled in terminal
 * copy-paste while debugging this.
 *
 * Run: DATABASE_URL='...' node scripts/debug-migration-permission.js
 */
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE FUNCTION is_active_school_owner_manager_test(p_school_id text)
      RETURNS boolean
      LANGUAGE sql
      SECURITY DEFINER
      STABLE
      SET search_path = ''
      AS $func$
        SELECT EXISTS (
          SELECT 1 FROM public."RoleGrant"
          WHERE "userId" = current_setting('app.current_user_id', true)
        );
      $func$;
    `);
    console.log('CREATE FUNCTION succeeded');
    await client.query('DROP FUNCTION is_active_school_owner_manager_test(text)');
    console.log('DROP FUNCTION succeeded (cleaned up)');
  } catch (err) {
    console.error('FAILED:', err.message);
    console.error('detail:', err.detail);
    console.error('hint:', err.hint);
    console.error('code:', err.code);
    console.error('schema:', err.schema, 'table:', err.table);
  } finally {
    await client.end();
  }
}

main();
