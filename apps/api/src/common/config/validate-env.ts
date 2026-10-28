/**
 * Boot-time environment check, run by ConfigModule.forRoot({ validate }) in
 * app.module.ts. Strict only when NODE_ENV=production (every deployed
 * environment, staging included — render.yaml sets it). Local dev, CI and
 * Jest keep the existing "boot without it, fail on first use" convention.
 *
 * Why this exists: every PrismaXService falls back to the schema's
 * DATABASE_URL — the superuser, which bypasses RLS — when its own scoped
 * DATABASE_URL_* is unset. Locally that's a convenience; deployed, it would
 * silently switch tenant isolation off. So a deployed API refuses to start
 * unless each scoped role has its own connection string, as a different
 * user from the superuser, with a real password.
 *
 * Vendor credentials (Twilio, Postmark, R2, ...) are only warned about: a
 * staging deploy can legitimately run before every vendor account exists.
 */

const SCOPED_DATABASE_URLS = [
  'DATABASE_URL_APP',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_JOBS',
  'DATABASE_URL_DISCOVERY',
  'DATABASE_URL_PLATFORM_ADMIN',
  'DATABASE_URL_GRADING_ERASURE',
] as const;

/** Signing secrets: each required, at least 32 characters, and all different
 * (one realm must never be able to verify another realm's tokens). */
const SIGNING_SECRETS = [
  'JWT_ACCESS_SECRET',
  'PLATFORM_ADMIN_JWT_SECRET',
  'QR_CLASS_TOKEN_SECRET',
  'QR_STUDENT_TOKEN_SECRET',
] as const;

const REQUIRED_PLAIN = ['DATABASE_URL', 'REDIS_URL', 'CORS_ALLOWED_ORIGINS', 'PORTAL_BASE_URL'] as const;

const OPTIONAL_VENDOR = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_VERIFY_SERVICE_SID',
  'POSTMARK_SERVER_TOKEN',
  'NOTIFICATIONS_FROM_EMAIL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
  'FCM_PROJECT_ID',
  'FCM_CLIENT_EMAIL',
  'FCM_PRIVATE_KEY',
  'CLOUDFLARE_STREAM_ACCOUNT_ID',
  'CLOUDFLARE_STREAM_API_TOKEN',
] as const;

const DEV_PASSWORD = 'changeme';

type Env = Record<string, unknown>;

function str(env: Env, key: string): string | undefined {
  const v = env[key];
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function parseDbUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/** Returns the problems that would make a deployed API unsafe to start. */
export function findEnvProblems(env: Env): string[] {
  const problems: string[] = [];

  for (const key of REQUIRED_PLAIN) {
    if (!str(env, key)) problems.push(`${key} is not set`);
  }

  const superuser = str(env, 'DATABASE_URL') ? parseDbUrl(str(env, 'DATABASE_URL')!) : undefined;
  for (const key of SCOPED_DATABASE_URLS) {
    const raw = str(env, key);
    if (!raw) {
      problems.push(`${key} is not set (the API would fall back to the superuser and bypass RLS)`);
      continue;
    }
    const url = parseDbUrl(raw);
    if (!url) {
      problems.push(`${key} is not a valid connection URL`);
      continue;
    }
    if (superuser && url.username === superuser.username) {
      problems.push(`${key} connects as the same user as DATABASE_URL (the superuser), which bypasses RLS`);
    }
    if (decodeURIComponent(url.password) === DEV_PASSWORD || url.password === '') {
      problems.push(`${key} uses the migration's dev password or none; set a real one`);
    }
  }

  const seen = new Map<string, string>();
  for (const key of SIGNING_SECRETS) {
    const v = str(env, key);
    if (!v) {
      problems.push(`${key} is not set`);
      continue;
    }
    if (v.length < 32) problems.push(`${key} must be at least 32 characters`);
    const dup = seen.get(v);
    if (dup) problems.push(`${key} must differ from ${dup}`);
    seen.set(v, key);
  }

  return problems;
}

export function missingVendorKeys(env: Env): string[] {
  return OPTIONAL_VENDOR.filter((key) => !str(env, key));
}

export function validateEnv(env: Env): Env {
  if (env.NODE_ENV !== 'production') return env;

  const problems = findEnvProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: NODE_ENV=production but the environment is unsafe:\n- ${problems.join('\n- ')}`,
    );
  }

  const missing = missingVendorKeys(env);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[validateEnv] Not configured yet (those features fail until set): ${missing.join(', ')}`);
  }
  return env;
}
