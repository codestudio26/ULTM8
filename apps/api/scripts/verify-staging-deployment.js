/**
 * One-off diagnostic — NOT part of the app's real code, not run in CI.
 *
 * Consolidates several separate manual checks into one run, for confirming the live
 * Render deployment (https://ultm8-api.onrender.com) is actually current and
 * genuinely staging-grade, not just "up." This session's own sandbox has no
 * outbound network access to onrender.com (confirmed: the egress proxy returns a
 * 403 policy denial) — run this from your own terminal instead.
 *
 * Usage (from apps/api): node scripts/verify-staging-deployment.js
 * Optional: API_BASE_URL=https://... to point at a different deploy.
 */

const BASE_URL = process.env.API_BASE_URL || 'https://ultm8-api.onrender.com';

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function checkReachable() {
  console.log(`\n--- Reachability (${BASE_URL}) ---`);
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/v1/docs-json`);
  const elapsedMs = Date.now() - start;
  if (!res.ok) {
    console.error(`FAILED — /v1/docs-json returned ${res.status}`);
    return null;
  }
  console.log(`OK — responded in ${elapsedMs}ms${elapsedMs > 5000 ? ' (slow — likely a free-tier cold start, see note below)' : ''}`);
  return res.json();
}

function checkDeployFreshness(openapiDoc) {
  console.log('\n--- Deploy freshness (does the live API include today\'s QR check-in work?) ---');
  if (!openapiDoc) {
    console.log('SKIPPED — could not fetch the live OpenAPI spec.');
    return;
  }
  const classesParams = openapiDoc.paths?.['/v1/schools/{schoolId}/classes']?.get?.parameters ?? [];
  const hasInstructorFilter = classesParams.some((p) => p.name === 'instructorId');
  console.log(
    hasInstructorFilter
      ? 'OK — GET /schools/{schoolId}/classes has the instructorId/date filter (this phase\'s change is live).'
      : 'STALE — the live API does NOT have the instructorId filter yet. The Render service is still building from an old commit/branch — check its Settings > Build & Deploy > Branch in the Render dashboard.',
  );

  const bookingsParams = openapiDoc.paths?.['/v1/bookings/me']?.get?.parameters ?? [];
  const hasStatusFilter = bookingsParams.some((p) => p.name === 'status');
  console.log(
    hasStatusFilter
      ? 'OK — GET /bookings/me has the status filter (this phase\'s bug-fix commit is live).'
      : 'STALE — the live API does NOT have the status filter yet — same branch/deploy concern as above.',
  );

  const hasAttendanceScan = !!openapiDoc.paths?.['/v1/attendance/scan'];
  console.log(hasAttendanceScan ? 'OK — POST /attendance/scan exists.' : 'MISSING — POST /attendance/scan is not in the live API at all.');
}

async function checkJwtTtl() {
  console.log('\n--- JWT_ACCESS_TTL ---');
  const res = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@ultm8.local', passcode: '123456' }),
  });
  const body = await res.json();
  if (!body.accessToken) {
    console.log(`SKIPPED — login failed (${res.status}): ${JSON.stringify(body)}. This is expected if that seed account doesn't exist on this deploy's database.`);
    return;
  }
  const claims = decodeJwtPayload(body.accessToken);
  const ttlSeconds = claims.exp - claims.iat;
  console.log(`TTL: ${ttlSeconds}s (${(ttlSeconds / 60).toFixed(1)} min)`);
  console.log(ttlSeconds > 900 ? 'OK — the 2h dev TTL is live.' : 'STILL 15m — JWT_ACCESS_TTL=2h has not taken effect on this deploy.');
}

async function checkCors() {
  console.log('\n--- CORS_ALLOWED_ORIGINS ---');
  const candidateOrigins = ['http://localhost:5173', 'http://localhost:8081', 'http://localhost:19006'];
  for (const origin of candidateOrigins) {
    const res = await fetch(`${BASE_URL}/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
      },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    console.log(`${origin} -> ${allowed === origin ? 'ALLOWED' : `blocked (server returned: ${allowed ?? 'none'})`}`);
  }
  console.log('If apps/school-portal or `expo start --web` runs from an origin not listed above as ALLOWED, update CORS_ALLOWED_ORIGINS in Render\'s dashboard (Environment tab) to include it.');
}

async function main() {
  const openapiDoc = await checkReachable();
  checkDeployFreshness(openapiDoc);
  await checkJwtTtl();
  await checkCors();

  console.log('\n--- Not checkable over HTTP — verify directly in the dashboards ---');
  console.log('1. Render > ultm8-api > Settings > Build & Deploy > Branch: confirm it tracks track-b-student-app-pka8oo (NOT track-b-student-app).');
  console.log('2. Render > ultm8-api > Environment: confirm DATABASE_URL_APP/_AUTH/_JOBS/_DISCOVERY and CORS_ALLOWED_ORIGINS are all actually set (they are sync:false, so Render never fills them in automatically).');
  console.log('3. Render > ultm8-api > plan: free-tier web services spin down after 15 min idle, causing a ~30-60s cold start on the next request (the slow-response note above, if you saw it). Fine for occasional testing; worth upgrading before any real usage test that cares about response time.');
  console.log('4. Supabase > project status: free-tier Postgres pauses after 7 days of zero activity (reversible via the dashboard, but needs a manual unpause — it will NOT un-pause itself on the next request the way Render\'s cold start does).');
  console.log('5. Render > ultm8-redis (Key Value) plan: confirm whether its free tier has its own expiry window, same as Postgres\'s free-tier 30-day one that render.yaml\'s own header comment already flags.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
