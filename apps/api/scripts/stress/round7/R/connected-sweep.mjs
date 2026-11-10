// Round 7 R: Decision 449 item 6 on the rehearsal's Schools. The rehearsal's
// J7 already checks strangers (other School's six roles) get 404. Here:
// people CONNECTED to the School (its member, its Branch Staff without a
// switch, paused staff) must get 403 with a reason, never 404; a person with
// no School at all and the other School's owner still get 404.
// Run from apps/api/scripts/rehearsal's env: node --import ../../../rehearsal/ts-resolve.mjs connected-sweep.mjs <cast.json>
import fs from 'fs';
import { call, signIn, signUp, db, journey, check, ok, save } from '../../../rehearsal/lib.mjs';
const castPath = process.argv[2];
const cast = JSON.parse(fs.readFileSync(castPath));
const gatedFor = (sid, studentId) => [`/schools/${sid}/payroll/report`, `/schools/${sid}/staff`, `/schools/${sid}/students/export`, `/schools/${sid}/payment-account`,
  `/schools/${sid}/students/${studentId}/files`, `/schools/${sid}/imports/limits`, `/schools/${sid}/freezes`, `/schools/${sid}/sign-ups`];
const short = (p, sid, st) => p.replace(sid, ':s').replace(st, ':st');
async function sweep(person, sid, st) {
  const out = [];
  for (const p of gatedFor(sid, st)) { const r = await call('GET', p, person.tok); out.push({ p: short(p, sid, st), status: r.status, code: r.body?.error?.code, msg: r.body?.error?.message }); }
  return out;
}
const fmt = (rs) => rs.map((r) => `${r.p} ${r.status}${r.code ? ' ' + r.code : ''}`).join('; ');
const stranger = await signUp({ first: 'Nobody', last: 'Linked' });
for (const [me, other] of [['A', 'B'], ['B', 'A']]) {
  journey(me, 'R7', 'Decision 449 item 6 refusals');
  const c = cast[me], sid = c.schoolId, st = c.adult.id;
  for (const k of ['owner', 'staff', 'adult']) await signIn(c[k]);
  await signIn(cast[other].owner);
  // 1. a member of this School
  const m = await sweep(c.adult, sid, st);
  ok(`${me}'s member gets 403 NO_PERMISSION (not 404) from the switch-gated pages`, m.every((r) => r.status === 403 && r.code === 'NO_PERMISSION'), fmt(m));
  // 2. Branch Staff: never 404 (allowed pages answer 200)
  const s = await sweep(c.staff, sid, st);
  ok(`${me}'s Branch Staff never get 404 from the switch-gated pages`, s.every((r) => r.status !== 404 && r.status < 500), fmt(s));
  // 3. someone with no School, and the other School's owner: 404
  const n = await sweep(stranger, sid, st);
  ok(`a person with no link to any School gets 404 from ${me}'s switch-gated pages`, n.every((r) => r.status === 404), fmt(n));
  const o = await sweep(cast[other].owner, sid, st);
  ok(`${other}'s owner gets 404 from ${me}'s switch-gated pages`, o.every((r) => r.status === 404), fmt(o));
  // 4. paused Branch Staff: 403 ACCESS_PAUSED
  const pz = await call('POST', `/schools/${sid}/staff/${c.staff.id}/pause`, c.owner.tok, {});
  let pzTok = null;
  try { await signIn(c.staff); pzTok = 'ok'; } catch (e) { pzTok = String(e).slice(0, 120); }
  const p = await sweep(c.staff, sid, st);
  ok(`${me}'s paused Branch Staff get 403 ACCESS_PAUSED from the switch-gated pages`, pz.status < 300 && p.every((r) => r.status === 403 && r.code === 'ACCESS_PAUSED'), `pause ${pz.status}; sign-in ${pzTok}; ${fmt(p)}`);
  const up = await call('POST', `/schools/${sid}/staff/${c.staff.id}/unpause`, c.owner.tok, {});
  await signIn(c.staff);
  const s2 = await sweep(c.staff, sid, st);
  ok(`${me}'s Branch Staff after unpause: back to the same answers`, up.status < 300 && fmt(s2) === fmt(s), `unpause ${up.status}; ${fmt(s2)}`);
  // 5. Branch Staff confirming a desk order with "record payments" off (Decision 449 item 6: connected -> 403, not "not found")
  const school = await db.school.findUnique({ where: { id: sid }, select: { branchStaffCanRecordPayments: true } });
  await call('PATCH', `/schools/${sid}`, c.owner.tok, { branchStaffCanRecordPayments: false });
  const tx = await db.transaction.findFirst({ where: { schoolId: sid, status: 'PENDING' }, orderBy: { createdAt: 'desc' } }) ?? await db.transaction.findFirst({ where: { schoolId: sid }, orderBy: { createdAt: 'desc' } });
  const conf = await call('PATCH', `/transactions/${tx.id}/confirm`, c.staff.tok, {});
  const canc = await call('PATCH', `/transactions/${tx.id}/cancel`, c.staff.tok, { reason: 'r7 probe' });
  const after = await db.transaction.findUnique({ where: { id: tx.id }, select: { status: true } });
  check(`${me}'s Branch Staff confirming an order with "record payments" off get a reason, not 404`, conf.status === 403 ? 'PASS' : 'FAIL', `confirm ${conf.status} ${conf.body?.error?.code ?? ''} ${conf.body?.error?.message ?? ''}; cancel (for comparison) ${canc.status} ${canc.body?.error?.code ?? ''}; order ${tx.status} -> ${after.status}`);
  await call('PATCH', `/schools/${sid}`, c.owner.tok, { branchStaffCanRecordPayments: school.branchStaffCanRecordPayments });
}
save(`connected-sweep-${Date.now().toString(36)}.json`);
await db.$disconnect();
