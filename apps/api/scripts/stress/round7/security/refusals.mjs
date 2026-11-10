// Round 7 S, attack 2 — the new refusal messages (#531, Decision 449 item 6):
// strangers must get "not found" and must never be able to tell a real School
// (or record) from a missing one; people connected to the School get 403.
//
// Every route with a School in its path (from routes.mjs) is called twice by
// each stranger: once on School A's real id, once on an id that doesn't exist
// (other path ids the same both times). Any difference in status, code or
// message is an existence leak. The same routes are also called by A's
// member and parent, and every 404 they get on a switch-gated or payments
// page is listed (they should get 403, Decision 449 item 6).
// Run: node routes.mjs > out/routes.json && node refusals.mjs
import fs from 'fs';
import { call, rec, saveResults, loadWorld, refreshAll, signIn, db } from './lib.mjs';

const AREA = 'refusals';
const w = loadWorld();
await refreshAll(w);
for (const p of [w.extra.D.owner, w.extra.D.member, w.extra.stranger]) await signIn(p);
const A = w.schools.A, C = w.schools.C;
const routes = JSON.parse(fs.readFileSync(new URL('./out/routes.json', import.meta.url), 'utf8'));
const ghost = '00000000-0000-4000-8000-0000000000ff';
const ghost2 = '00000000-0000-4000-8000-0000000000ee';
const schoolRoutes = routes.filter((r) => /schools\/:(id|schoolId)(\/|$)/.test(r.path) && !r.path.startsWith('/platform-admin'));

// Other path params: real ids of School A's things (same in both calls).
const fill = (path, schoolId) =>
  path
    .replace(/schools\/:(id|schoolId)/, `schools/${schoolId}`)
    .replace(/:(studentId|userId|memberId)/g, A.people.adult1.id)
    .replace(/:branchId/g, A.b1)
    .replace(/:classId/g, A.classes.tomorrow1)
    .replace(/:(planId|membershipPlanId)/g, A.packId)
    .replace(/:waiverId/g, A.waiverId)
    .replace(/:disciplineId/g, A.styleId)
    .replace(/:[a-zA-Z]+/g, ghost2);

const strangers = { 'C owner': C.people.owner, 'C staff': C.people.staff1, 'D owner': w.extra.D.owner, 'D member': w.extra.D.member, stranger: w.extra.stranger };
const sig = (r) => `${r.status} ${r.body?.error?.code ?? ''} ${(r.body?.error?.message ?? (r.status < 300 ? '<data>' : '')).toString().slice(0, 120)}`;
const leaks = [];
let n = 0;
// Joining a School is open to anyone (it would make the stranger connected), so it is left out.
for (const r of schoolRoutes.filter((x) => !/\/join$/.test(x.path))) {
  // Mutations: strangers only, body {} (refused before anything is written, or a finding).
  for (const [who, p] of Object.entries(strangers)) {
    const body = r.method === 'GET' || r.method === 'DELETE' ? undefined : {};
    const real = await call(r.method, fill(r.path, A.id), p.tok, body);
    const missing = await call(r.method, fill(r.path, ghost), p.tok, body);
    n++;
    if (real.status < 300) {
      rec(AREA, `${who}: ${r.method} ${r.path} on School A succeeded`, false, `${sig(real)} ${JSON.stringify(real.body).slice(0, 200)}`);
      continue;
    }
    if (sig(real) !== sig(missing)) {
      leaks.push({ who, route: `${r.method} ${r.path}`, real: sig(real), missing: sig(missing) });
      rec(AREA, `${who}: ${r.method} ${r.path} — real School answered differently from a missing one`, false, `real: ${sig(real)} | missing: ${sig(missing)}`);
    }
  }
}
rec(AREA, `stranger calls compared (route × stranger)`, null, `${n} pairs, ${leaks.length} differ`);
fs.writeFileSync(new URL('./out/refusals-leaks.json', import.meta.url), JSON.stringify(leaks, null, 1));

// Connected people on GET routes: list who gets 404 where (should be 403 on switch/payments pages).
const connected = { 'A member': A.people.adult1, 'A parent': A.people.parent, 'A coach': A.people.coach, 'A staff (South)': A.people.staff2 };
const seen = [];
for (const r of schoolRoutes.filter((x) => x.method === 'GET')) {
  for (const [who, p] of Object.entries(connected)) {
    const res = await call('GET', fill(r.path, A.id), p.tok);
    seen.push({ who, route: r.path, file: r.file, res: sig(res) });
  }
}
fs.writeFileSync(new URL('./out/refusals-connected.json', import.meta.url), JSON.stringify(seen, null, 1));
const notFound = seen.filter((s) => s.res.startsWith('404') && /School not found/.test(s.res));
rec(AREA, 'connected people answered "School not found" (should be 403 per Decision 449 item 6)', notFound.length === 0, notFound.map((s) => `${s.who} ${s.route}`).join(' ; ').slice(0, 1500));
const fiveHundreds = seen.filter((s) => s.res.startsWith('5'));
rec(AREA, 'no 500s for connected people', fiveHundreds.length === 0, fiveHundreds.map((s) => `${s.who} ${s.route} ${s.res}`).join(' ; ').slice(0, 800));
saveResults('refusals');
await db.$disconnect();
