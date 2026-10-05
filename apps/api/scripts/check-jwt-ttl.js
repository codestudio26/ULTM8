/**
 * One-off diagnostic — NOT part of the app's real code, not run in CI.
 *
 * Logs in against the live Render API and decodes the returned access token's own
 * `iat`/`exp` claims to confirm the actual TTL Render is issuing tokens with right
 * now — the only way to know JWT_ACCESS_TTL's new value has actually taken effect
 * post-deploy, rather than assuming a push took.
 *
 * Usage (from apps/api): node scripts/check-jwt-ttl.js
 */

const BASE_URL = process.env.API_BASE_URL || 'https://ultm8-api.onrender.com';

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function main() {
  const res = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@ultm8.local', passcode: '123456' }),
  });
  const body = await res.json();
  if (!body.accessToken) {
    console.error(`Login failed (${res.status}):`, body);
    process.exit(1);
  }

  const claims = decodeJwtPayload(body.accessToken);
  const ttlSeconds = claims.exp - claims.iat;
  console.log(`iat: ${new Date(claims.iat * 1000).toISOString()}`);
  console.log(`exp: ${new Date(claims.exp * 1000).toISOString()}`);
  console.log(`TTL: ${ttlSeconds}s (${(ttlSeconds / 60).toFixed(1)} min / ${(ttlSeconds / 3600).toFixed(2)} hr)`);
  console.log(ttlSeconds > 900 ? '\n2h TTL IS live.' : '\nStill the old 15m TTL — Render has not redeployed this change yet.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
