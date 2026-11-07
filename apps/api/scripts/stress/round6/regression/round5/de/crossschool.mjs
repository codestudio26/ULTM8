// Privacy across Schools for people who belong to two Schools.
// Actors at School B (owner, Branch Staff, instructor) read everything they can
// about the shared member (also at A and C) and the shared child (also at A):
// no response may carry School A's or C's data (ids or A-/C- markers).
// Then B's actors try A-only members, B ids with A params, and writes.
// Then RLS directly with the app role. Output: crossschool-result.json.
import fs from 'fs';
import { db, call, pool } from '../../round4/common.mjs';
import { createRequire } from 'module';
const require = createRequire(new URL('../../../../../../package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const life = JSON.parse(fs.readFileSync(new URL('./cast-life.json', import.meta.url)));
const { A, B, C } = cast;
const S = cast.shared.id, K = cast.kidAB;
const aOnly = cast.studentsA[3].id; // an A-only member
const results = [];
const foreign = (txt, own) => {
  const hits = [];
  for (const [k, s] of [['A', A], ['C', C]]) {
    if (k === own) continue;
    if (txt.includes(s.id)) hits.push(`${k}.schoolId`);
    for (const m of [`${k}-NOTE`, `${k}-MED`, `${k}-CHARGE`, `${k}-WAIVER`, `${k}-BROADCAST`, `${k}-TAG`]) if (txt.includes(m)) hits.push(m);
    if (txt.includes(s.nowClass)) hits.push(`${k}.class`);
    for (const b of s.branches) if (txt.includes(b)) hits.push(`${k}.branch`);
  }
  if (own !== 'A' && /Kreuzberg|Spandau/.test(txt)) hits.push('A.branchName');
  if (own !== 'A' && txt.includes(cast.mother.id)) hits.push('mother(A-only Guardian).id');
  if (own !== 'A' && /Sabine/.test(txt)) hits.push('mother(A-only Guardian).name');
  return [...new Set(hits)];
};
const READS = (sch, st) => [
  `/schools/${sch.id}/students/${st}/profile`, `/schools/${sch.id}/students/${st}/guardians`, `/schools/${sch.id}/students/${st}/leaving-summary`,
  `/schools/${sch.id}/students/${st}/medical-info`, `/schools/${sch.id}/students/${st}/memberships`, `/schools/${sch.id}/students/${st}/freezable-memberships`,
  `/schools/${sch.id}/students/${st}/check-in-code`, `/schools/${sch.id}/students/${st}/membership-card`, `/schools/${sch.id}/students/${st}/notes`,
  `/schools/${sch.id}/students/${st}/tags`, `/schools/${sch.id}/students/${st}/custom-fields`, `/schools/${sch.id}/students/${st}/files`,
  `/schools/${sch.id}/students/${st}/temporary-passcode`, `/schools/${sch.id}/students/${st}/charges`, `/schools/${sch.id}/students/${st}/recurring-charges`,
  `/students/${st}/medical-info`, `/students/${st}/bookings`, `/students/${st}/bookings?schoolId=${sch.id}`, `/students/${st}/bookings/next`,
  `/students/${st}/membership-status`, `/students/${st}/membership-status?schoolId=${sch.id}`, `/students/${st}/ranks`, `/students/${st}/eligibility`,
  `/students/${st}/grading`, `/students/${st}/rank-history`, `/students/${st}/promotion-fee-requests`, `/students/${st}/waiver-status`,
  `/students/${st}/waiver-status?schoolId=${sch.id}`, `/students/${st}/lessons`, `/students/${st}/charges`, `/students/${st}/recurring-charges`,
  `/students/${st}/ranks/declare-options?schoolId=${sch.id}`,
];
const LISTS = (sch) => [
  `/schools/${sch.id}/students?q=Br%C3%BCckner`, `/schools/${sch.id}/students`, `/schools/${sch.id}/students/export`, `/schools/${sch.id}/waivers`,
  `/schools/${sch.id}/attendance/stats`, `/schools/${sch.id}/dashboard`, `/schools/${sch.id}/birthdays`, `/schools/${sch.id}/transactions`,
  `/schools/${sch.id}/charge-reports/member-balances`, `/schools/${sch.id}/staff/activity`, `/schools/${sch.id}/cancellations`, `/schools/${sch.id}/student-tags`,
  `/schools/${sch.id}/notifications/broadcasts`, `/schools/${sch.id}/freezes`, `/schools/${sch.id}/sign-ups`, `/schools/${sch.id}/child-invites`,
  `/front-desk/kiosk/students?schoolId=${sch.id}`,
];

const tests = [];
const actorsB = [['B.owner', B.owner.tok], ['B.staff', B.staff.tok], ['B.instructor', B.instrTok]];
for (const [who, tok] of actorsB) {
  for (const st of [S, K]) for (const p of READS(B, st)) tests.push({ kind: 'shared-read', who, tok, method: 'GET', path: p, own: 'B' });
  for (const p of LISTS(B)) tests.push({ kind: 'list', who, tok, method: 'GET', path: p, own: 'B' });
  for (const p of READS(B, aOnly)) tests.push({ kind: 'aonly-via-B', who, tok, method: 'GET', path: p, own: 'B', mustRefuse: true });
  for (const p of READS(A, S)) tests.push({ kind: 'A-path', who, tok, method: 'GET', path: p, own: 'B', mustRefuse: true });
  for (const p of LISTS(A)) tests.push({ kind: 'A-list', who, tok, method: 'GET', path: p, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-signatures', who, tok, method: 'GET', path: `/schools/${A.id}/waivers/${life.waivers.A}/signatures`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-waiver-via-B', who, tok, method: 'GET', path: `/schools/${B.id}/waivers/${life.waivers.A}/signatures`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-waiver', who, tok, method: 'GET', path: `/waivers/${life.waivers.A}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-class', who, tok, method: 'GET', path: `/classes/${A.nowClass}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-class-roster', who, tok, method: 'GET', path: `/classes/${A.nowClass}/attendance`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-class-bookings', who, tok, method: 'GET', path: `/classes/${A.nowClass}/bookings`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-booking-via-student', who, tok, method: 'GET', path: `/students/${S}/bookings?schoolId=${A.id}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-status-via-student', who, tok, method: 'GET', path: `/students/${S}/membership-status?schoolId=${A.id}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-waiver-status', who, tok, method: 'GET', path: `/students/${S}/waiver-status?schoolId=${A.id}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-ranks', who, tok, method: 'GET', path: `/students/${S}/ranks?schoolId=${A.id}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-lessons', who, tok, method: 'GET', path: `/students/${S}/lessons?schoolId=${A.id}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-note-patch', who, tok, method: 'PATCH', path: `/schools/${B.id}/students/${S}/notes/${life.notes.A}`, body: { body: 'B-HIJACK' }, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-note-delete', who, tok, method: 'DELETE', path: `/schools/${B.id}/students/${S}/notes/${life.notes.A}`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-charge-pay', who, tok, method: 'POST', path: `/schools/${B.id}/students/${S}/charge-payments`, body: { chargeIds: [life.charges.A], paymentMethod: 'CASH', amount: 2500 }, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-booking-cancel', who, tok, method: 'POST', path: `/bookings/${life.bookings.A}/cancel`, body: {}, own: 'B', mustRefuse: true });
  tests.push({ kind: 'A-medical-delete', who, tok, method: 'DELETE', path: `/schools/${B.id}/students/${aOnly}/medical-info`, own: 'B', mustRefuse: true });
  tests.push({ kind: 'merge-preview-A-dup', who, tok, method: 'GET', path: `/schools/${B.id}/students/${S}/merge/preview?duplicateId=${aOnly}`, own: 'B', mustRefuse: true });
}
// The shared member's own view, the shared Guardian's own view: may see both Schools (it is them).
const self = [`/users/me`, `/bookings/me`, `/memberships/me`, `/waivers/me`, `/notifications/me`, `/transactions/me`, `/student-notes/me`, `/membership-cards/me`, `/memberships/freezes/me`];
for (const p of self) tests.push({ kind: 'self', who: 'shared', tok: cast.shared.tok, method: 'GET', path: p, own: '*' });
for (const p of ['/guardians/me/minors', `/guardians/me/minors/${K}/schools`, `/guardians/me/minors/${K}/bookings`, `/guardians/me/minors/${K}/waivers`, '/notifications/me'])
  tests.push({ kind: 'mother(A only)', who: 'mother', tok: cast.mother.tok, method: 'GET', path: p, own: 'A' });
// Mother is a Guardian at A only: does she see the child's School B data (bookings, waivers, notices)?
const out = await pool(tests, 12, async (t) => {
  const r = await call(t.kind, t.method, t.path, t.tok, t.body);
  const txt = JSON.stringify(r.body ?? '');
  const hits = t.own === '*' ? [] : foreign(txt, t.own);
  const refused = r.status >= 400;
  const bad = (t.mustRefuse && !refused && r.status !== 0) || hits.length > 0 || r.status >= 500;
  return { kind: t.kind, who: t.who, method: t.method, path: t.path.replaceAll(A.id, '{A}').replaceAll(B.id, '{B}').replaceAll(S, '{S}').replaceAll(K, '{K}').replaceAll(aOnly, '{aOnly}'), status: r.status, hits, bad, sample: bad || t.kind.startsWith('mother') || t.kind === 'self' ? txt.slice(0, 400) : undefined };
});
const bad = out.filter((x) => x.bad);
console.log(`${out.length} requests; ${bad.length} flagged`);
for (const x of bad) console.log(`${x.who} ${x.method} ${x.path} -> ${x.status} ${x.hits.join(',')}  ${x.sample?.slice(0, 250) ?? ''}`);
console.log('codes:', JSON.stringify(out.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {})));
for (const x of out.filter((x) => x.kind.startsWith('mother'))) console.log('MOTHER', x.path, x.status, x.hits.join(','), x.sample?.slice(0, 300));

// RLS directly: app role with B's owner/staff/instructor as the current user.
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
const rls = {};
for (const [who, id] of [['B.owner', B.owner.id], ['B.staff', B.staff.id], ['mother', cast.mother.id], ['father', cast.father.id]]) {
  rls[who] = await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${id}'`);
    const q = async (sql) => { try { return Number((await tx.$queryRawUnsafe(sql))[0].n); } catch (e) { return 'ERR ' + e.message.slice(0, 80).replace(/\s+/g, ' '); } };
    const r = {};
    for (const [t, col] of [['Booking', 'studentId'], ['Attendance', 'studentId'], ['StudentNote', 'studentId'], ['Membership', 'studentId'], ['Transaction', 'studentId'], ['Charge', 'studentId'], ['WaiverSignature', 'studentId'], ['RoleGrant', 'userId'], ['StudentTag', 'studentId'], ['StudentCheckInCode', 'studentId'], ['StaffActivity', 'targetUserId'], ['Notification', 'recipientId'], ['StudentMedicalInfo', 'studentId']]) {
      r[t] = await q(`select count(*)::int n from "${t}" where "schoolId" = '${A.id}' and "${col}" in ('${S}','${K}')`);
    }
    r.UserRowOfAonly = await q(`select count(*)::int n from "User" where id = '${aOnly}'`);
    r.GuardianLinksOfKid = await q(`select count(*)::int n from "GuardianLink" where "studentId" = '${K}'`);
    r.UserRowOfMother = await q(`select count(*)::int n from "User" where id = '${cast.mother.id}'`);
    return r;
  }).catch((e) => 'tx error ' + e.message.slice(0, 200));
}
console.log('RLS (rows of School A about the shared people, as seen by):', JSON.stringify(rls, null, 1));
await app.$disconnect();
fs.writeFileSync(new URL('./crossschool-result.json', import.meta.url), JSON.stringify({ out, rls }, null, 1));
await db.$disconnect();
