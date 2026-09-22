import { execFileSync } from 'child_process';

/**
 * Rotates the ultm8_app/ultm8_auth/ultm8_jobs/ultm8_discovery Postgres role
 * passwords to match the scoped connection strings already configured for
 * this service (DATABASE_URL_APP/_AUTH/_JOBS/_DISCOVERY — see each
 * PrismaXService's own header comment for what each role is for) rather than
 * the migration's own 'changeme' placeholder. Run from render.yaml's
 * buildCommand, right after `prisma migrate deploy` creates these roles.
 *
 * Reads each target password out of the connection string itself (the
 * built-in `URL` class plus an explicit `decodeURIComponent` — see that
 * call's own comment for why the decode step can't be skipped) rather than
 * duplicating it anywhere else — the env var is the one source of truth.
 * Idempotent: `ALTER ROLE ... PASSWORD` is safe to run with the same value
 * on every deploy, not just the first one.
 *
 * Not wired into CI (.github/workflows/ci.yml runs its own separate
 * `prisma migrate deploy` step against a local test Postgres, never this
 * file or render.yaml's buildCommand) — nothing to rotate there, CI's
 * DATABASE_URL_* values are already the real ones its own workflow sets.
 */
const ROLES: { role: string; envVar: string }[] = [
  { role: 'ultm8_app', envVar: 'DATABASE_URL_APP' },
  { role: 'ultm8_auth', envVar: 'DATABASE_URL_AUTH' },
  { role: 'ultm8_jobs', envVar: 'DATABASE_URL_JOBS' },
  { role: 'ultm8_discovery', envVar: 'DATABASE_URL_DISCOVERY' },
];

function main() {
  const superuserUrl = process.env.DATABASE_URL;
  if (!superuserUrl) {
    // Expected locally/in CI (neither sets this script up to run at all) —
    // only Render's buildCommand invokes this file, where DATABASE_URL is
    // always the superuser connection string entered in the dashboard.
    console.log('rotate-role-passwords: DATABASE_URL is not set — skipping.');
    return;
  }

  const statements = ROLES.map(({ role, envVar }) => {
    const raw = process.env[envVar];
    if (!raw) {
      throw new Error(`rotate-role-passwords: ${envVar} is not set — cannot rotate ${role}'s password.`);
    }
    let password: string;
    try {
      // FOUND ON REVIEW: `URL#password` returns the raw percent-encoded
      // component as-is — it does NOT decode it (verified directly: parsing
      // "p%40ss%2Fword" gives back "p%40ss%2Fword", not "p@ss/word"). Without
      // `decodeURIComponent` here, a password containing a URL-reserved
      // character (correctly percent-encoded in the connection string, as
      // Postgres connection URLs require) would get the still-encoded
      // literal string set as the actual Postgres password instead of the
      // intended one — wrong, and no error thrown to catch it.
      password = decodeURIComponent(new URL(raw).password);
    } catch (err) {
      throw new Error(`rotate-role-passwords: ${envVar} is not a valid connection URL: ${(err as Error).message}`);
    }
    if (!password) {
      throw new Error(`rotate-role-passwords: ${envVar} has no password component.`);
    }
    // Standard Postgres string-literal escaping — double any embedded single quote.
    const escaped = password.replace(/'/g, "''");
    return `ALTER ROLE ${role} PASSWORD '${escaped}';`;
  }).join('\n');

  execFileSync('npx', ['prisma', 'db', 'execute', '--url', superuserUrl, '--stdin'], {
    input: statements,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  console.log('rotate-role-passwords: rotated ultm8_app/ultm8_auth/ultm8_jobs/ultm8_discovery passwords.');
}

main();
