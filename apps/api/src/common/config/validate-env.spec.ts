import { findEnvProblems, validateEnv } from './validate-env';

const secret = (c: string) => c.repeat(40);

function goodEnv(): Record<string, string> {
  const db = (user: string) => `postgresql://${user}:s3cret-pw@db.example.com:5432/postgres`;
  return {
    NODE_ENV: 'production',
    DATABASE_URL: db('postgres'),
    DATABASE_URL_APP: db('ultm8_app'),
    DATABASE_URL_AUTH: db('ultm8_auth'),
    DATABASE_URL_JOBS: db('ultm8_jobs'),
    DATABASE_URL_DISCOVERY: db('ultm8_discovery'),
    DATABASE_URL_PLATFORM_ADMIN: db('ultm8_platform_admin'),
    DATABASE_URL_GRADING_ERASURE: db('ultm8_grading_erasure'),
    REDIS_URL: 'redis://redis:6379',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    PORTAL_BASE_URL: 'https://app.example.com',
    JWT_ACCESS_SECRET: secret('a'),
    PLATFORM_ADMIN_JWT_SECRET: secret('b'),
    QR_CLASS_TOKEN_SECRET: secret('c'),
    QR_STUDENT_TOKEN_SECRET: secret('d'),
  };
}

describe('validateEnv', () => {
  it('accepts a complete production environment', () => {
    expect(findEnvProblems(goodEnv())).toEqual([]);
    expect(() => validateEnv(goodEnv())).not.toThrow();
  });

  it('does nothing outside production', () => {
    expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => validateEnv({})).not.toThrow();
  });

  it('refuses a missing scoped database URL (superuser fallback)', () => {
    const env = goodEnv();
    delete env.DATABASE_URL_GRADING_ERASURE;
    expect(() => validateEnv(env)).toThrow(/DATABASE_URL_GRADING_ERASURE is not set/);
  });

  it('refuses a scoped URL that connects as the superuser', () => {
    const env = { ...goodEnv(), DATABASE_URL_APP: goodEnv().DATABASE_URL };
    expect(findEnvProblems(env).join()).toMatch(/DATABASE_URL_APP connects as the same user/);
  });

  it("refuses the migration's dev password", () => {
    const env = { ...goodEnv(), DATABASE_URL_JOBS: 'postgresql://ultm8_jobs:changeme@db:5432/postgres' };
    expect(findEnvProblems(env).join()).toMatch(/DATABASE_URL_JOBS uses the migration's dev password/);
  });

  it('refuses short or shared signing secrets', () => {
    const env = { ...goodEnv(), QR_CLASS_TOKEN_SECRET: 'short', QR_STUDENT_TOKEN_SECRET: secret('a') };
    const problems = findEnvProblems(env).join('\n');
    expect(problems).toMatch(/QR_CLASS_TOKEN_SECRET must be at least 32/);
    expect(problems).toMatch(/QR_STUDENT_TOKEN_SECRET must differ from JWT_ACCESS_SECRET/);
  });
});
