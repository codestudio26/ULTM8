/**
 * Shared guard for this directory's dev seed scripts. They create logins with
 * the passcode 123456 and fixed ids, which must never reach a real database.
 *
 * Allowed without asking: a DATABASE_URL host that is local (localhost,
 * 127.0.0.1, ::1) or the devcontainer's `db` service.
 *
 * Anything else (e.g. a shared staging Supabase) needs
 * ULTM8_ALLOW_DEV_SEED_HOST set to that exact host. That makes it a deliberate,
 * per-database choice, not something a stray env var can trigger. It is
 * always refused when NODE_ENV=production.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db']);

function assertDevDatabase(scriptName) {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(`${scriptName}: DATABASE_URL is not set.`);
  }
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error(`${scriptName}: DATABASE_URL is not a valid connection URL.`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${scriptName}: refusing to run with NODE_ENV=production (it creates logins with passcode 123456).`);
  }
  if (LOCAL_HOSTS.has(host)) return;
  if (process.env.ULTM8_ALLOW_DEV_SEED_HOST === host) {
    console.warn(`${scriptName}: seeding NON-LOCAL database ${host} (ULTM8_ALLOW_DEV_SEED_HOST matches).`);
    return;
  }
  throw new Error(
    `${scriptName}: refusing to seed non-local database "${host}" — it creates logins with passcode 123456. ` +
      `If this really is a throwaway/staging database, set ULTM8_ALLOW_DEV_SEED_HOST=${host}.`,
  );
}

module.exports = { assertDevDatabase };
