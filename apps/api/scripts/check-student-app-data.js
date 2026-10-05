/**
 * One-off diagnostic — NOT part of the app's real code, not run in CI.
 *
 * Hits the LIVE Render API (same base URL apps/student/app.json points at) as the
 * seeded dev student, then calls every "my data" / screen-backing endpoint the
 * Student app itself calls — exactly reproducing what each screen does, server-side,
 * so we can tell in one shot whether the "I can't see any dummy data" report is a
 * real empty-response from the API or something client-side (stale cache, etc.)
 * further up the stack. No DB/Postgres access needed — plain HTTPS, so this is
 * runnable from a GitHub Codespace terminal same as any other `node ...` command.
 *
 * Usage (from apps/api): node scripts/check-student-app-data.js
 * Optional override: API_BASE_URL=https://... node scripts/check-student-app-data.js
 */

const BASE_URL = process.env.API_BASE_URL || 'https://ultm8-api.onrender.com';
const EMAIL = 'student@ultm8.local';
const PASSCODE = '123456';

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json);
}

async function call(method, path, token, label) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  const itemCount = Array.isArray(body?.items) ? body.items.length : undefined;
  console.log(`\n--- ${label} ---`);
  console.log(`${method} ${path} -> ${res.status}${itemCount !== undefined ? ` (items: ${itemCount})` : ''}`);
  console.log(JSON.stringify(body, null, 2).slice(0, 2000));
  return { status: res.status, body };
}

async function main() {
  console.log(`Checking ${BASE_URL} as ${EMAIL} ...`);

  const loginRes = await fetch(`${BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, passcode: PASSCODE }),
  });
  const loginBody = await loginRes.json();
  // NestJS defaults a POST route to 201 Created unless @HttpCode overrides it, and
  // AuthController's login route doesn't override it — 201 here is success, not an error.
  if (!loginBody.accessToken) {
    console.error(`Login failed (${loginRes.status}):`, loginBody);
    process.exit(1);
  }
  const token = loginBody.accessToken;
  const claims = decodeJwtPayload(token);
  const studentId = claims.sub;
  const schoolId = (claims.grants || []).find((g) => g.role === 'STUDENT' && g.schoolId)?.schoolId;
  console.log(`Logged in OK. sub=${studentId} grants=${JSON.stringify(claims.grants)}`);

  if (!schoolId) {
    console.error('No STUDENT grant with a schoolId found in the JWT — nothing else will resolve correctly.');
    process.exit(1);
  }

  // Exactly the calls each Student-app screen makes.
  await call('GET', '/v1/academies', token, 'Academies list (AcademiesListScreen)');
  await call('GET', `/v1/academies/${schoolId}`, token, 'Academy detail (AcademyDetailScreen)');
  await call('GET', '/v1/memberships/me', token, 'My Memberships (MyMembershipsScreen)');
  await call('GET', '/v1/bookings/me', token, 'My Bookings (MyBookingsScreen)');
  await call('GET', '/v1/notifications/me', token, 'Notifications (NotificationsScreen)');
  await call('GET', '/v1/waivers/me', token, 'My Waiver Signatures (WaiversScreen)');
  await call('GET', `/v1/schools/${schoolId}/waivers`, token, 'School Waivers (WaiversScreen)');
  await call('GET', `/v1/students/${studentId}/ranks?schoolId=${schoolId}`, token, 'My Rank (MyRankSection)');
  await call('GET', `/v1/schools/${schoolId}/disciplines`, token, 'Disciplines (MyRankSection)');

  console.log('\nDone. Any screen above showing "items: 0" with a 200 status means the API genuinely has no data for that caller — re-run the seed script. A non-200 status means a real server error (check Render logs). "items" present with a count > 0 but the app still shows nothing means the bug is client-side (cache/rendering), not the API.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
