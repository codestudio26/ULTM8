/**
 * Sets each scoped Postgres login role's password to the one in its
 * DATABASE_URL_* connection string. Without this the roles keep the
 * migrations' dev password 'changeme'. Run by render.yaml's buildCommand
 * right after `prisma migrate deploy`. Idempotent: ALTER ROLE with the same
 * password on every deploy is harmless.
 *
 * The connection strings are the single source of truth: you choose each
 * password once, put it in the env var, and this applies it. Nothing is
 * printed except role names.
 *
 * Ported from origin/track-b-student-app-pka8oo (where it ran the live staging
 * deploy), extended to the two roles added since (platform_admin,
 * grading_erasure), and plain JS so it needs no ts-node.
 *
 * Usage (from repo root, DATABASE_URL = superuser):
 *   node apps/api/scripts/rotate-role-passwords.js
 */
const { execFileSync } = require('child_process');

const ROLES = [
  { role: 'ultm8_app', envVar: 'DATABASE_URL_APP' },
  { role: 'ultm8_auth', envVar: 'DATABASE_URL_AUTH' },
  { role: 'ultm8_jobs', envVar: 'DATABASE_URL_JOBS' },
  { role: 'ultm8_discovery', envVar: 'DATABASE_URL_DISCOVERY' },
  { role: 'ultm8_platform_admin', envVar: 'DATABASE_URL_PLATFORM_ADMIN' },
  { role: 'ultm8_grading_erasure', envVar: 'DATABASE_URL_GRADING_ERASURE' },
];

function passwordFor(envVar, role) {
  const raw = process.env[envVar];
  if (!raw) throw new Error(`rotate-role-passwords: ${envVar} is not set — cannot set ${role}'s password.`);
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    throw new Error(`rotate-role-passwords: ${envVar} is not a valid connection URL.`);
  }
  // URL#password stays percent-encoded; decode so a password containing
  // reserved characters is set as intended, not as its encoded form.
  const password = decodeURIComponent(url.password);
  if (!password) throw new Error(`rotate-role-passwords: ${envVar} has no password.`);
  if (password === 'changeme') throw new Error(`rotate-role-passwords: ${envVar} still uses the dev password 'changeme'.`);
  // Supabase's pooler usernames look like "ultm8_app.<project-ref>": the role is the part before the dot.
  const user = decodeURIComponent(url.username).split('.')[0];
  if (user !== role) throw new Error(`rotate-role-passwords: ${envVar} connects as "${user}", expected "${role}".`);
  return password;
}

function main() {
  const superuserUrl = process.env.DATABASE_URL;
  if (!superuserUrl) {
    console.log('rotate-role-passwords: DATABASE_URL is not set — skipping.');
    return;
  }

  const sql = ROLES.map(({ role, envVar }) => {
    const escaped = passwordFor(envVar, role).replace(/'/g, "''");
    return `ALTER ROLE ${role} PASSWORD '${escaped}';`;
  }).join('\n');

  execFileSync('npx', ['prisma', 'db', 'execute', '--url', superuserUrl, '--stdin'], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });

  console.log(`rotate-role-passwords: set passwords for ${ROLES.map((r) => r.role).join(', ')}.`);
}

main();
