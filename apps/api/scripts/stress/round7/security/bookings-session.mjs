// Round 7 S, attacks 4 and 5 (API side):
//   - GET /bookings/me's opaque cursor (#533, Decision 450 item 2): tampered,
//     forged and other members' cursors never show someone else's bookings
//     and never give a 500;
//   - refresh-token rotation and logout still hold (the member app's web
//     build now keeps its tokens in sessionStorage, #533 / Decision 450 item 5).
import { call, must, signIn, db, rec, saveResults, loadWorld, refreshAll } from './lib.mjs';

const w = loadWorld();
const A = w.schools.A, P = A.people;
for (const k of ['owner', 'adult1', 'parent', 'adult2']) await signIn(P[k]);
const sig = (r) => `${r.status} ${r.body?.error?.code ?? ''} ${(r.body?.error?.message ?? '').toString().slice(0, 100)}`;
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const dec = (c) => JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));

// -------------------------------------------------------------- bookings
let AREA = 'bookings-cursor';
// Give adult1 and parent several bookings (classes A.now1, tomorrow1, small1 and the past one).
for (const p of [P.adult1, P.parent]) {
  for (const c of ['tomorrow1', 'small1', 'now1']) await call('POST', '/bookings', p.tok, { classId: A.classes[c] });
}
const all1 = await must('adult1 bookings', 'GET', '/bookings/me?limit=100', P.adult1.tok);
const mine = new Set(all1.items.map((b) => b.id));
const parentAll = await must('parent bookings', 'GET', '/bookings/me?limit=100', P.parent.tok);
const theirs = parentAll.items.map((b) => b.id);
rec(AREA, 'setup: both members have bookings', mine.size > 0 && theirs.length > 0, `${mine.size} / ${theirs.length}`);
const p1 = await must('page 1', 'GET', '/bookings/me?limit=1', P.adult1.tok);
rec(AREA, 'limit=1 gives a cursor', !!p1.nextCursor, p1.nextCursor);
const cur = p1.nextCursor ? dec(p1.nextCursor) : { p: 'up', at: new Date().toISOString(), s: new Date().toISOString(), id: 'x' };
rec(AREA, 'cursor decodes to', null, JSON.stringify(cur));
const parentCursor = (await must('parent page 1', 'GET', '/bookings/me?limit=1', P.parent.tok)).nextCursor;

const cases = {
  "another member's own cursor": parentCursor,
  "cursor with another member's booking id": enc({ ...cur, id: theirs[0] }),
  'id = SQL injection': enc({ ...cur, id: "' OR 1=1 --" }),
  'id = huge string': enc({ ...cur, id: 'z'.repeat(100000) }),
  'id = object': enc({ ...cur, id: { gt: '' } }),
  'id = array': enc({ ...cur, id: [theirs[0]] }),
  'part = unknown': enc({ ...cur, p: 'all' }),
  'part = __proto__': enc({ ...cur, p: '__proto__' }),
  'part = gone, no start': enc({ p: 'gone', at: cur.at, s: null, id: '' }),
  'part = gone, id empty-ish': enc({ p: 'gone', at: cur.at, s: null, id: ' ' }),
  'at far past': enc({ ...cur, at: '0001-01-01T00:00:00.000Z' }),
  'at JS min date': enc({ ...cur, at: '-271821-04-20T00:00:00.000Z' }),
  'at JS max date': enc({ ...cur, at: '+275760-09-13T00:00:00.000Z' }),
  'start JS min date': enc({ ...cur, s: '-271821-04-20T00:00:00.000Z' }),
  'start JS max date': enc({ ...cur, s: '+275760-09-13T00:00:00.000Z' }),
  'start year 5000 BC': enc({ ...cur, s: '-005000-01-01T00:00:00.000Z' }),
  'at = number': enc({ ...cur, at: 12345 }),
  'at = not a date': enc({ ...cur, at: 'yesterday' }),
  'start = 0 (epoch-ish string)': enc({ ...cur, s: '0' }),
  'not base64': '!!!***',
  'base64 of non-JSON': Buffer.from('hello').toString('base64url'),
  'JSON null': enc(null),
  'JSON array': enc([1, 2]),
  'old id-only cursor (uuid)': theirs[0],
  'very long cursor': 'A'.repeat(200000),
  'prototype pollution': Buffer.from('{"__proto__":{"p":"up"},"at":"2026-01-01T00:00:00Z","s":"2026-01-01T00:00:00Z","id":"x"}').toString('base64url'),
};
for (const [name, c] of Object.entries(cases)) {
  const r = await call('GET', `/bookings/me?limit=50&cursor=${encodeURIComponent(c)}`, P.adult1.tok);
  const items = r.body?.items ?? [];
  const foreign = items.filter((b) => !mine.has(b.id));
  rec(AREA, `${name}: no 500, no one else's booking`, r.status < 500 && foreign.length === 0, `${sig(r)} items=${items.length} foreign=${foreign.length}`);
}
for (const lim of ['0', '-1', '1000000', 'abc', '1e3', '2.5']) {
  const r = await call('GET', `/bookings/me?limit=${lim}`, P.adult1.tok);
  rec(AREA, `limit=${lim}: no 500`, r.status < 500, sig(r));
}
// Walk all pages with limit=1: same set, no repeats, no foreign.
const seen = [];
let c = null, guard = 0;
do {
  const r = await must('walk', 'GET', `/bookings/me?limit=1${c ? '&cursor=' + encodeURIComponent(c) : ''}`, P.adult1.tok);
  seen.push(...r.items.map((b) => b.id));
  c = r.nextCursor;
} while (c && ++guard < 50);
rec(AREA, 'paging one by one gives exactly my bookings once each', seen.length === mine.size && new Set(seen).size === mine.size && seen.every((id) => mine.has(id)), `${seen.length} vs ${mine.size}`);
// Guardian views of children's bookings: unchanged access.
const childB = await call('GET', `/bookings/me?studentId=${A.childId}`, P.adult1.tok);
rec(AREA, "studentId query param can't read a child's bookings via /bookings/me", childB.status === 400 || (childB.body?.items ?? []).every((b) => mine.has(b.id)), sig(childB));

// -------------------------------------------------------------- session
AREA = 'session';
const p = P.adult2;
await signIn(p);
const r1 = await call('POST', '/auth/refresh', null, { refreshToken: p.refresh });
rec(AREA, 'refresh works and rotates', r1.status < 300 && r1.body.refreshToken && r1.body.refreshToken !== p.refresh, sig(r1));
const meNew = await call('GET', '/users/me', r1.body.accessToken);
rec(AREA, 'the new access token works', meNew.status === 200, sig(meNew));
const replay = await call('POST', '/auth/refresh', null, { refreshToken: p.refresh });
rec(AREA, 'replaying the rotated-out refresh token → 401', replay.status === 401, sig(replay));
const fam = await call('POST', '/auth/refresh', null, { refreshToken: r1.body.refreshToken });
rec(AREA, '…and the replay burnt the whole family (the newer token is dead too)', fam.status === 401, sig(fam));
// Logout.
await signIn(p);
const lo = await call('POST', '/auth/logout', null, { refreshToken: p.refresh });
rec(AREA, 'logout', lo.status < 300, sig(lo));
const afterLo = await call('POST', '/auth/refresh', null, { refreshToken: p.refresh });
rec(AREA, 'refresh after logout → 401', afterLo.status === 401, sig(afterLo));
const accAfterLo = await call('GET', '/users/me', p.tok);
rec(AREA, 'access token after logout (lives until it expires, 15 min) — note', null, sig(accAfterLo));
// Someone else's refresh token on logout: does it log them out? (body-only, no auth needed by design)
await signIn(P.parent);
const otherLo = await call('POST', '/auth/logout', P.adult1.tok, { refreshToken: P.parent.refresh });
rec(AREA, "logout with someone else's refresh token (anyone holding it can revoke it) — note", null, sig(otherLo));
// Garbage refresh tokens.
for (const t of ['', 'x', 'a'.repeat(100000), "' OR 1=1--", null, 12, { $ne: null }]) {
  const r = await call('POST', '/auth/refresh', null, { refreshToken: t });
  rec(AREA, `refresh with ${JSON.stringify(t)?.slice(0, 20)}: 400/401, no 500`, [400, 401].includes(r.status), sig(r));
}
// Tokens in URLs: the login/refresh responses don't redirect; check no token in any Location header.
const raw = await fetch(process.env.API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: P.owner.email, passcode: P.owner.passcode }), redirect: 'manual' });
rec(AREA, 'login answers in the body, not a redirect', raw.status < 300 && !raw.headers.get('location'), `${raw.status} cache-control=${raw.headers.get('cache-control')}`);
await raw.text();

saveResults('bookings-session');
await db.$disconnect();
