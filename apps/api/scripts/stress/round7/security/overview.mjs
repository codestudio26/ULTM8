// Round 7 S, attack 1 — the Franchise overview (#534, Decision 450 item 1):
// GET /franchises/:id/overview and its SECURITY DEFINER functions.
//   Who gets data, who gets 403 NO_PERMISSION, who gets 404 (Decision 449
//   item 6), malformed ids, forged tokens, impersonation, the functions called
//   straight as ultm8_app, and that only totals ever leave.
// Needs out/world.json from world7.mjs. Run: node overview.mjs
import { createRequire } from 'module';
import { call, must, signIn, db, rec, refused, saveResults, loadWorld, refreshAll, sleep } from './lib.mjs';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const jwt = require('jsonwebtoken');
const pg = require('pg');

const AREA = 'overview';
const w = loadWorld();
await refreshAll(w);
for (const f of Object.values(w.franchises)) await signIn(f.owner);
for (const p of [w.extra.D.owner, w.extra.D.member, w.extra.stranger]) await signIn(p);
const F1 = w.franchises.F1, F2 = w.franchises.F2;
const A = w.schools.A, B = w.schools.B, C = w.schools.C;
const ov = (tok, id = F1.id, q = '') => call('GET', `/franchises/${encodeURIComponent(id)}/overview${q}`, tok);
const ovRaw = (tok, rawPath) => call('GET', `/franchises/${rawPath}/overview`, tok);

// Everything personal we know about, to scan responses for.
const personal = new Set();
for (const s of Object.values(w.schools)) {
  for (const p of Object.values(s.people)) for (const v of [p.id, p.email, p.phone, p.first, p.last]) if (v) personal.add(String(v));
  for (const v of [s.childId, s.child2Id]) if (v) personal.add(v);
}
for (const p of [F1.owner, F2.owner, w.extra.D.owner, w.extra.D.member, w.extra.stranger]) for (const v of [p.id, p.email, p.phone]) personal.add(v);
const childNames = ['Kit', 'Kip'];
function leaks(body) {
  const text = JSON.stringify(body);
  return [...personal, ...childNames].filter((v) => v.length >= 3 && text.includes(v));
}
const ALLOWED_SCHOOL_KEYS = ['schoolId', 'name', 'archivedAt', 'timeZone', 'enrolledStudents', 'activeStudents', 'checkInsLast30Days', 'months', 'revenue'];

// 1. The owner gets the overview, both Schools, nothing else.
const own = await ov(F1.owner.tok);
rec(AREA, 'F1 owner: 200', own.status === 200, `${own.status}`);
const ids = (own.body?.schools ?? []).map((s) => s.schoolId).sort();
rec(AREA, 'F1 owner: exactly Schools A and B', JSON.stringify(ids) === JSON.stringify([A.id, B.id].sort()), JSON.stringify(own.body?.schools?.map((s) => s.name)));
rec(AREA, 'F1 owner: no personal data in the response', leaks(own.body).length === 0, leaks(own.body).join(','));
const extraKeys = (own.body?.schools ?? []).flatMap((s) => Object.keys(s).filter((k) => !ALLOWED_SCHOOL_KEYS.includes(k)));
rec(AREA, 'F1 owner: per-School rows carry only the documented keys', extraKeys.length === 0, extraKeys.join(','));
rec(AREA, 'F1 owner: every count is a number', (own.body?.schools ?? []).every((s) => ['enrolledStudents', 'activeStudents', 'checkInsLast30Days'].every((k) => Number.isInteger(s[k]))), JSON.stringify(own.body?.schools?.map((s) => [s.enrolledStudents, s.activeStudents, s.checkInsLast30Days])));
rec(AREA, 'F1 owner: response shape', null, JSON.stringify(own.body).slice(0, 400));
const own2 = await ov(F2.owner.tok, F2.id);
rec(AREA, 'F2 owner: only School C', own2.status === 200 && own2.body.schools.length === 1 && own2.body.schools[0].schoolId === C.id, `${own2.status} ${own2.body?.schools?.map((s) => s.name)}`);

// 2. Strangers: 404, the same body as for an id that doesn't exist.
const ghost = '00000000-0000-4000-8000-000000000000';
const ghostR = await ov(w.extra.stranger.tok, ghost);
const strangers = {
  'F2 owner': F2.owner, 'C owner': C.people.owner, 'C co-owner': C.people.coowner, 'C staff': C.people.staff1, 'C coach': C.people.coach,
  'C member': C.people.adult1, 'C parent': C.people.parent, 'D owner': w.extra.D.owner, 'D member': w.extra.D.member, 'stranger': w.extra.stranger,
};
for (const [who, p] of Object.entries(strangers)) {
  const r = await ov(p.tok);
  rec(AREA, `${who} → F1: 404 like a missing id`, r.status === 404 && JSON.stringify(r.body) === JSON.stringify(ghostR.body), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}
rec(AREA, 'F1 owner → F2: 404', (await ov(F1.owner.tok, F2.id)).status === 404);
rec(AREA, 'F1 owner → missing id: 404', (await ov(F1.owner.tok, ghost)).status === 404);

// 3. Connected to F1 (role at a member School, or Guardian of a student there): 403 NO_PERMISSION, no data.
for (const k of ['A', 'B']) {
  const s = w.schools[k];
  for (const role of ['owner', 'coowner', 'staff1', 'staff2', 'staffStripe', 'coach', 'adult1', 'adult2', 'noHome', 'parent', 'unsigned']) {
    const r = await ov(s.people[role].tok);
    rec(AREA, `${k}.${role} → F1: 403 NO_PERMISSION`, r.status === 403 && r.body?.error?.code === 'NO_PERMISSION' && !r.body?.schools, `${r.status} ${r.body?.error?.code}`);
  }
}

// 4. Malformed ids, injection, huge ids, query params: never a 500, never data.
const weird = [
  "' OR 1=1--", `${F1.id}' OR '1'='1`, `${F1.id}%27--`, `${F1.id.toUpperCase()}`, ` ${F1.id}`, `${F1.id} `, `${F1.id}%00`, `${F1.id};select 1`,
  'x'.repeat(5000), '9'.repeat(400), '..%2F..%2Fschools', '%E2%80%AE' + F1.id, F1.id.replace(/-/g, ''), `{${F1.id}}`, 'null', 'undefined', '0', '-1',
];
for (const id of weird) {
  for (const [who, tok] of [['F1 owner', F1.owner.tok], ['stranger', w.extra.stranger.tok]]) {
    const r = await ovRaw(tok, id.includes('%') ? id : encodeURIComponent(id));
    const okStatus = who === 'F1 owner' && id === F1.id.toUpperCase() ? [200, 404] : [400, 404];
    rec(AREA, `${who}: id ${JSON.stringify(id.slice(0, 40))}${id.length > 40 ? '…' : ''} → ${okStatus.join('/')}, no 500`, okStatus.includes(r.status) && (r.status !== 200 || leaks(r.body).length === 0), `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  }
}
const upper = await ov(F1.owner.tok, F1.id.toUpperCase());
rec(AREA, 'F1 owner, id in capitals', null, `${upper.status} schools=${upper.body?.schools?.length}`);
for (const q of [`?franchiseId=${F2.id}`, `?schoolId=${C.id}`, `?userId=${F1.owner.id}`, '?limit=99999']) {
  const r = await ov(F1.owner.tok, F1.id, q);
  rec(AREA, `F1 owner with ${q}: still only A and B (or refused)`, r.status === 400 || (r.status === 200 && r.body.schools.every((s) => [A.id, B.id].includes(s.schoolId))), `${r.status}`);
  const r2 = await ov(w.extra.stranger.tok, F1.id, q);
  rec(AREA, `stranger with ${q}: 404/400`, [400, 404].includes(r2.status), `${r2.status}`);
}

// 5. Forged tokens.
const fakeSecret = jwt.sign({ sub: F1.owner.id, email: F1.owner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId: F1.id, schoolId: null, branchId: null }] }, 'not-the-secret', { expiresIn: 600 });
rec(AREA, 'token signed with another key → 401', (await ov(fakeSecret)).status === 401);
const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: F1.owner.id, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.';
rec(AREA, 'alg:none token → 401', (await ov(none)).status === 401);
// Real token of the stranger with its payload's sub swapped (signature no longer matches).
const [h, , sig] = w.extra.stranger.tok.split('.');
const swapped = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(w.extra.stranger.tok.split('.')[1], 'base64url')), sub: F1.owner.id })).toString('base64url')}.${sig}`;
rec(AREA, "stranger's token with sub swapped to the F1 owner → 401", (await ov(swapped)).status === 401);
// A correctly signed token (harness has the secret) whose grants claim FRANCHISE_OWNER of F1 for the stranger:
// the claims must not matter, only the database.
const secret = process.env.JWT_ACCESS_SECRET;
const strangerClaims = jwt.sign({ sub: w.extra.stranger.id, email: w.extra.stranger.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId: F1.id, schoolId: null, branchId: null }] }, secret, { expiresIn: 600 });
const sc = await ov(strangerClaims);
rec(AREA, 'stranger with forged FRANCHISE_OWNER claim (valid signature, no rca) → 404', sc.status === 404, `${sc.status} ${JSON.stringify(sc.body).slice(0, 120)}`);
// Impersonation (as a Platform Admin's read-only session would mint it) of a user who owns F1 *and* A.
// The F1 owner has no School grant, so the person used is A's owner, given F1 ownership too? No: use the
// real impersonation of A's owner and ask for F1 (they're linked: 403 expected anyway), and of F1's owner
// with a School id on the session.
const imp = (sub, email, schoolId) => jwt.sign({ sub, email, grants: [], impersonation: { adminUserId: '00000000-0000-4000-8000-0000000000aa', startedAt: new Date().toISOString(), schoolId } }, secret, { expiresIn: 600 });
const impR = await ov(imp(F1.owner.id, F1.owner.email, A.id));
rec(AREA, 'impersonation session of the F1 owner → refused, no data', impR.status === 403 && !impR.body?.schools, `${impR.status} ${JSON.stringify(impR.body).slice(0, 140)}`);
const impS = await ov(imp(w.extra.stranger.id, w.extra.stranger.email, A.id));
rec(AREA, 'impersonation of a stranger → same refusal (no existence signal)', impS.status === impR.status, `${impS.status}`);
const impG = await call('GET', `/franchises/${ghost}/overview`, imp(w.extra.stranger.id, w.extra.stranger.email, A.id));
rec(AREA, 'impersonation → missing id: same status as a real one', impG.status === impS.status, `${impG.status}`);

// 6. The functions themselves, as ultm8_app.
const appDb = new pg.Client({ connectionString: process.env.DATABASE_URL_APP.replace(/\?.*$/, '') });
await appDb.connect();
async function asApp(userId, sqlText, params = [], imper = null) {
  await appDb.query('BEGIN');
  try {
    await appDb.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId ?? '']);
    if (imper) await appDb.query(`SELECT set_config('app.impersonation_school_id', $1, true)`, [imper]);
    const r = await appDb.query(sqlText, params);
    return { rows: r.rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await appDb.query('ROLLBACK');
  }
}
for (const fn of ['franchise_overview_school_totals', 'franchise_overview_school_months', 'franchise_overview_school_revenue']) {
  for (const [who, uid] of [['stranger', w.extra.stranger.id], ['A owner', A.people.owner.id], ['F2 owner', F2.owner.id], ['no user', null], ['empty string', '']]) {
    const r = await asApp(uid, `SELECT * FROM public.${fn}($1)`, [F1.id]);
    rec(AREA, `SQL ${fn} as ${who} for F1 → nothing`, !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);
  }
  const ownR = await asApp(F1.owner.id, `SELECT * FROM public.${fn}($1)`, [F1.id]);
  rec(AREA, `SQL ${fn} as F1 owner → rows (the expected path)`, !ownR.error && ownR.rows.length > 0, ownR.error ?? `${ownR.rows.length} rows`);
  const impR2 = await asApp(F1.owner.id, `SELECT * FROM public.${fn}($1)`, [F1.id], A.id);
  rec(AREA, `SQL ${fn} as F1 owner during impersonation → nothing`, !impR2.error && impR2.rows.length === 0, impR2.error ?? `${impR2.rows.length} rows`);
  const inj = await asApp(F1.owner.id, `SELECT * FROM public.${fn}($1)`, [`${F2.id}' OR '1'='1`]);
  rec(AREA, `SQL ${fn} with an injected id → nothing`, !inj.error && inj.rows.length === 0, inj.error ?? `${inj.rows.length} rows`);
  const other = await asApp(F1.owner.id, `SELECT * FROM public.${fn}($1)`, [F2.id]);
  rec(AREA, `SQL ${fn} as F1 owner for F2 → nothing`, !other.error && other.rows.length === 0, other.error ?? `${other.rows.length} rows`);
  const nul = await asApp(F1.owner.id, `SELECT * FROM public.${fn}(NULL)`);
  rec(AREA, `SQL ${fn}(NULL) → nothing`, !nul.error && nul.rows.length === 0, nul.error ?? `${nul.rows.length} rows`);
}
for (const fn of ['franchise_overview_scope($1)', 'franchise_overview_zone($1)']) {
  const r = await asApp(F1.owner.id, `SELECT * FROM public.${fn}`, [F1.id]);
  rec(AREA, `SQL ${fn.split('(')[0]} can't be called by ultm8_app`, !!r.error && /permission denied/.test(r.error), r.error ?? `${r.rows.length} rows`);
}
// search_path tricks: a temp function shadowing a name the definer uses.
const shadow = await asApp(F1.owner.id, `CREATE TEMP TABLE "School"(id text); SELECT * FROM public.franchise_overview_school_totals('${F1.id}')`);
rec(AREA, 'SQL: a temp table named School does not change the result', null, shadow.error ?? `${shadow.rows?.length} rows`);
// Who else can execute the functions.
const su = new pg.Client({ connectionString: process.env.DATABASE_URL.replace(/\?.*$/, '') });
await su.connect();
const acl = await su.query(`SELECT p.proname, pg_get_userbyid(p.proowner) owner, p.prosecdef, p.proacl::text, p.proconfig::text FROM pg_proc p WHERE p.proname LIKE 'franchise_overview%' ORDER BY 1`);
for (const row of acl.rows) rec(AREA, `SQL acl ${row.proname}`, row.owner === 'ultm8_rls_helper' && !/=X\//.test(row.proacl ?? '') && (row.proconfig ?? '').includes('search_path='), `${row.owner} definer=${row.prosecdef} acl=${row.proacl} cfg=${row.proconfig}`);
const helper = await su.query(`SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='ultm8_rls_helper'`);
rec(AREA, 'ultm8_rls_helper is NOLOGIN, not superuser', helper.rows[0] && !helper.rows[0].rolcanlogin && !helper.rows[0].rolsuper, JSON.stringify(helper.rows[0]));
for (const role of ['ultm8_jobs', 'ultm8_discovery', 'ultm8_platform_admin', 'ultm8_auth']) {
  const r = await su.query(`SELECT has_function_privilege($1, 'public.franchise_overview_school_totals(text)', 'EXECUTE') AS x`, [role]).catch((e) => ({ rows: [{ x: e.message }] }));
  rec(AREA, `role ${role} cannot execute the overview functions`, r.rows[0].x === false || /does not exist/.test(String(r.rows[0].x)), String(r.rows[0].x));
}
await appDb.end();
await su.end();

// 7. Timing: stranger on a real Franchise vs on a missing id (medians of 25).
async function median(fn) {
  const t = [];
  for (let i = 0; i < 25; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s); }
  t.sort((a, b) => a - b);
  return t[12];
}
const tReal = await median(() => ov(w.extra.stranger.tok, F1.id));
const tGhost = await median(() => ov(w.extra.stranger.tok, ghost));
const tBad = await median(() => ov(w.extra.stranger.tok, 'abc'));
rec(AREA, 'timing: stranger on real vs missing Franchise (ms, median of 25)', Math.abs(tReal - tGhost) < 15, `real=${tReal.toFixed(1)} missing=${tGhost.toFixed(1)} notUuid=${tBad.toFixed(1)}`);
// A School owner (with School grants) on a real non-member Franchise vs missing.
const tCReal = await median(() => ov(C.people.owner.tok, F1.id));
const tCGhost = await median(() => ov(C.people.owner.tok, ghost));
rec(AREA, 'timing: other School owner on real vs missing Franchise (ms)', Math.abs(tCReal - tCGhost) < 15, `real=${tCReal.toFixed(1)} missing=${tCGhost.toFixed(1)}`);

saveResults('overview');
await db.$disconnect();
