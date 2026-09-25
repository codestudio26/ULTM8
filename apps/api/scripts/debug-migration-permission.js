/**
 * One-off diagnostic — NOT part of the app's real code, not run in CI. Runs each
 * statement from prisma/migrations/20260904000000_fix_rolegrant_rls_recursion/
 * migration.sql individually (not inside one transaction, so a failure on one
 * doesn't hide the rest), via `pg` directly, to see exactly which statement throws
 * "permission denied for schema public" and Postgres's raw error/detail/hint for it —
 * Prisma's own error only ever named the migration, never the specific statement.
 * Committed as a file rather than an inline shell command since multi-line escaped
 * heredocs kept getting mangled in terminal copy-paste while debugging this live.
 *
 * Cleans up after itself (drops the role/function) at the end regardless of where it
 * got to, so it's safe to re-run.
 *
 * Run: DATABASE_URL='...' node scripts/debug-migration-permission.js
 */
const { Client } = require('pg');

async function step(client, label, sql) {
  try {
    await client.query(sql);
    console.log(`OK   — ${label}`);
    return true;
  } catch (err) {
    console.error(`FAIL — ${label}`);
    console.error('  message:', err.message);
    console.error('  detail:', err.detail);
    console.error('  hint:', err.hint);
    console.error('  code:', err.code);
    return false;
  }
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await step(
    client,
    '1. CREATE ROLE ultm8_rls_helper NOLOGIN BYPASSRLS',
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_rls_helper') THEN
         CREATE ROLE ultm8_rls_helper NOLOGIN BYPASSRLS;
       END IF;
     END
     $$;`,
  );

  await step(client, '2. GRANT ultm8_rls_helper TO CURRENT_USER', 'GRANT ultm8_rls_helper TO CURRENT_USER;');

  await step(
    client,
    '3. CREATE FUNCTION is_active_school_owner_manager_test',
    `CREATE OR REPLACE FUNCTION is_active_school_owner_manager_test(p_school_id text)
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
     $func$;`,
  );

  await step(
    client,
    '4. ALTER FUNCTION ... OWNER TO ultm8_rls_helper',
    'ALTER FUNCTION is_active_school_owner_manager_test(text) OWNER TO ultm8_rls_helper;',
  );

  await step(
    client,
    '5. GRANT EXECUTE ON FUNCTION ... TO ultm8_app',
    'GRANT EXECUTE ON FUNCTION is_active_school_owner_manager_test(text) TO ultm8_app;',
  );

  // Cleanup — best-effort, ignore errors here.
  try {
    await client.query('DROP FUNCTION IF EXISTS is_active_school_owner_manager_test(text);');
    console.log('cleanup: dropped test function');
  } catch (e) {
    console.error('cleanup failed (function):', e.message);
  }

  await client.end();
}

main();
