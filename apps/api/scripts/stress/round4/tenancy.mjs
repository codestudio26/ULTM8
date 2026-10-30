// Round 4, phase 3: tenant isolation at scale. 200 random pairs of Schools (some
// in the same Franchise, some in different countries): the owner, Branch Staff
// and a student of School A try to read and change School B's things on every
// endpoint family, old and new. Every attempt must be refused, and no refusal may
// carry B's data. Then RLS directly, with the app database role.
import { db, call, pool, cast, checks, codes, stats } from './common.mjs';
import { createRequire } from 'module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { ok, save } = checks('tenancy');

let r = 99; const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
const pairs = [];
for (let i = 0; i < 200; i++) {
  const a = cast.schools[Math.floor(rand() * cast.schools.length)];
  // A quarter of the pairs inside one Franchise: same brand, still separate Schools.
  const fr = a.franchiseId && i % 4 === 0 ? cast.schools.filter((x) => x.franchiseId === a.franchiseId && x.id !== a.id) : null;
  const b = fr?.length ? fr[Math.floor(rand() * fr.length)] : cast.schools[Math.floor(rand() * cast.schools.length)];
  if (a.id !== b.id) pairs.push([a, b]);
}

const READS = (b, st) => [
  `/schools/${b.id}/students`, `/schools/${b.id}/students/export`, `/schools/${b.id}/students/${st.id}/profile`, `/schools/${b.id}/students/${st.id}/guardians`,
  `/schools/${b.id}/students/${st.id}/notes`, `/schools/${b.id}/students/${st.id}/check-in-code`, `/schools/${b.id}/students/${st.id}/membership-card`,
  `/schools/${b.id}/students/${st.id}/charges`, `/schools/${b.id}/students/${st.id}/recurring-charges`, `/schools/${b.id}/students/${st.id}/memberships`,
  `/schools/${b.id}/students/${st.id}/leaving-summary`, `/schools/${b.id}/students/${st.id}/freezable-memberships`,
  `/schools/${b.id}/staff`, `/schools/${b.id}/staff/activity`, `/schools/${b.id}/staff/settings`, `/schools/${b.id}/dashboard`, `/schools/${b.id}/birthdays`,
  `/schools/${b.id}/transactions`, `/schools/${b.id}/charge-reports/overview`, `/schools/${b.id}/charge-reports/member-balances`, `/schools/${b.id}/late-fees`,
  `/schools/${b.id}/freezes`, `/schools/${b.id}/sign-ups`, `/schools/${b.id}/rank-corrections`, `/schools/${b.id}/child-invites`, `/schools/${b.id}/waivers`,
  `/schools/${b.id}/notifications/broadcasts`, `/schools/${b.id}/cancellations`, `/schools/${b.id}/front-desk/sessions`, `/schools/${b.id}/payment-account`,
  `/membership-plans/${b.plans.Unlimited}/members`,
];
const WRITES = (b, st) => [
  ['POST', `/schools/${b.id}/students/${st.id}/notes`, { body: 'x', showToMember: false }],
  ['POST', `/schools/${b.id}/students/${st.id}/check-in-code`, {}],
  ['POST', `/schools/${b.id}/students/${st.id}/charges`, { description: 'x', amount: 100, dueDate: '2026-12-01' }],
  ['POST', `/schools/${b.id}/students/${st.id}/credits`, { amount: 100, note: 'x' }],
  ['POST', `/schools/${b.id}/desk-payments`, { studentId: st.id, membershipPlanId: b.plans['5-class pack'], paymentMethod: 'CASH' }],
  ['POST', `/schools/${b.id}/notifications/broadcast`, { title: 'x', body: 'y', audience: 'ALL' }],
  ['POST', `/schools/${b.id}/staff/${b.staff.id}/pause`, {}],
  ['PUT', `/schools/${b.id}/staff/settings`, { mustAcceptFirst: true }],
  ['PUT', `/schools/${b.id}/late-fees`, { enabled: true, type: 'FIXED', fixedAmount: 100, graceDays: 1 }],
  ['POST', `/schools/${b.id}/front-desk/sessions`, { branchId: b.branches[0] }],
  ['PATCH', `/schools/${b.id}`, { name: 'Hijacked' }],
  ['POST', `/classes/${b.nowClasses[0]}/book`, { studentId: st.id }],
  ['POST', `/classes/${b.nowClasses[0]}/attendance-scan`, { studentId: st.id }],
  ['POST', `/schools/${b.id}/waivers`, { title: 'x', body: 'x' }],
];

const attempts = [];
for (const [a, b] of pairs) {
  const st = b.students[Math.floor(rand() * b.students.length)];
  const actors = [['owner', a.owner.tok], ['staff', a.staff.tok], ['student', a.students[0].tok]];
  for (const [who, tok] of actors) {
    for (const p of READS(b, st)) attempts.push({ who, method: 'GET', path: p, tok, b, st });
    if (who !== 'student' || rand() < 0.3) for (const [m, p, body] of WRITES(b, st)) attempts.push({ who, method: m, path: p, tok, body, b, st });
  }
}
console.log(`${pairs.length} pairs, ${attempts.length} attempts`);
const leaks = [], allowed = [], errors = [];
await pool(attempts, 48, async (x) => {
  const res = await call(`xt:${x.method}`, x.method, x.path, x.tok, x.body);
  const text = JSON.stringify(res.body ?? '');
  if (res.status < 300) allowed.push(`${x.who} ${x.method} ${x.path.replace(x.b.id, 'B').replace(x.st.id, 'ST')} -> ${res.status}`);
  if (res.status >= 500) errors.push(`${x.who} ${x.method} ${x.path.replace(x.b.id, 'B').replace(x.st.id, 'ST')} -> ${res.status}`);
  if (res.status >= 300 && (text.includes(x.st.id) && !x.path.includes(x.st.id))) leaks.push(`${x.who} ${x.method} ${x.path}`);
});
const uniq = (a) => [...new Set(a)];
ok('X1 every cross-School attempt refused', allowed.length === 0, `${allowed.length} allowed: ${uniq(allowed).slice(0, 15).join('; ')}`);
ok('X2 no refusal carries the other School\'s data', leaks.length === 0, uniq(leaks).slice(0, 10).join('; '));
ok('X3 no cross-School attempt causes a 500', errors.length === 0, `${errors.length}: ${uniq(errors).slice(0, 15).join('; ')}`);
ok('X4 the other School is unchanged', (await db.school.count({ where: { name: 'Hijacked' } })) === 0 && (await db.studentNote.count({ where: { body: 'x' } }).catch(() => 0)) === 0, '');
console.log('status codes', JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.codes]))));

// RLS directly: the app role, with a tenant context for A's owner, reads B's rows.
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
let rlsLeak = 0;
for (const [a, b] of pairs.slice(0, 40)) {
  const rows = await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('app.current_user_id', '${a.owner.id}', true)`);
    const n1 = await tx.roleGrant.count({ where: { schoolId: b.id } });
    const n2 = await tx.membership.count({ where: { schoolId: b.id } });
    const n3 = await tx.booking.count({ where: { schoolId: b.id } });
    const n4 = await tx.transaction.count({ where: { schoolId: b.id } });
    const n5 = await tx.studentNote.count({ where: { schoolId: b.id } }).catch(() => 0);
    const n6 = await tx.charge.count({ where: { schoolId: b.id } }).catch(() => 0);
    return n1 + n2 + n3 + n4 + n5 + n6;
  }).catch((e) => { console.log('rls error', e.message.slice(0, 200)); return -1; });
  if (rows !== 0) rlsLeak++;
}
const own = await app.$transaction(async (tx) => { await tx.$executeRawUnsafe(`select set_config('app.current_user_id', '${pairs[0][0].owner.id}', true)`); return tx.roleGrant.count({ where: { schoolId: pairs[0][0].id } }); });
ok('X5 RLS: with School A\'s owner as the tenant, the app role sees none of School B\'s grants, memberships, bookings, payments, notes or charges', rlsLeak === 0 && own > 0, `${rlsLeak} of 40 pairs leaked; sanity: A's own grants visible = ${own}`);
await app.$disconnect();

save();
await db.$disconnect();
