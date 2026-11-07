// Round 6 P — who confirms a Pix/cash order (#509, Decision 441 item 2 /
// 442 item 4 / 443 item 2) and who gets the "new order waiting" notice (#513).
// School B (Brazil, bank transfer, "Let Branch Staff record payments" on).
import { call, must, signIn, stepUp, db, rec, refused, saveResults, loadWorld, refreshAll, sleep } from './lib.mjs';

const A = 'orders';
const w = loadWorld();
await refreshAll(w);
const B = w.schools.B, SA = w.schools.A;
const P = B.people, PA = SA.people;

async function order(person, studentId) {
  const r = await must('order', 'POST', `/membership-plans/${B.packId}/purchase`, person.tok, studentId ? { studentId } : {});
  return r.transactionId;
}
async function noticesFor(txId) {
  // The fan-out job writes the in-app rows; give it a moment.
  for (let i = 0; i < 40; i++) {
    const rows = await db.notification.findMany({ where: { schoolId: B.id, type: 'CASH_PAYMENT', title: 'Cash payment waiting' }, select: { userId: true, body: true, targetType: true, targetId: true, createdAt: true } });
    const since = rows.filter((r) => r.createdAt > txId.at);
    if (since.length >= txId.expect) return since;
    await sleep(250);
  }
  return (await db.notification.findMany({ where: { schoolId: B.id, type: 'CASH_PAYMENT', title: 'Cash payment waiting' }, select: { userId: true, body: true, targetType: true, targetId: true, createdAt: true } })).filter((r) => r.createdAt > txId.at);
}
const who = (rows) => {
  const names = {};
  for (const [k, p] of Object.entries(P)) names[p.id] = `B.${k}`;
  for (const [k, p] of Object.entries(PA)) names[p.id] = `A.${k}`;
  return rows.map((r) => names[r.userId] ?? r.userId).sort();
};

// --- 1. adult1 (home North): who is told, who may confirm ---------------------
let at = new Date();
const t1 = await order(P.adult1);
const n1 = await noticesFor({ at, expect: 4 });
const got1 = who(n1);
rec(A, 'order by a North member: told = owners + North staff only', JSON.stringify(got1) === JSON.stringify(['B.coowner', 'B.owner', 'B.staff1', 'B.staffStripe'].sort()), got1.join(','));
const staffNotice = n1.find((r) => r.userId === P.staff1.id);
rec(A, 'staff notice opens the student (STUDENT target), owners PAYMENT', staffNotice?.targetType === 'STUDENT' && staffNotice?.targetId === P.adult1.id && n1.find((r) => r.userId === P.owner.id)?.targetType === 'PAYMENT', JSON.stringify(n1.map((r) => [who([r])[0], r.targetType])));
rec(A, 'notice body (what it reveals)', null, staffNotice?.body);

for (const [label, tok] of [
  ['South staff (other branch)', P.staff2.tok], ['coach', P.coach.tok], ['the member themself', P.adult1.tok], ['another member', P.adult2.tok],
  ['a parent at the School', P.parent.tok], ["School A's owner", PA.owner.tok], ["School A's staff", PA.staff1.tok], ["School A's member", PA.adult1.tok],
]) {
  refused(A, `${label} can't confirm the order`, await call('PATCH', `/transactions/${t1}/confirm`, tok, {}));
}
const fake = '00000000-0000-4000-8000-000000000000';
const rFake = await call('PATCH', `/transactions/${fake}/confirm`, P.staff2.tok, {});
const rReal = await call('PATCH', `/transactions/${t1}/confirm`, P.staff2.tok, {});
rec(A, 'other-branch staff: a real order id and a made-up one answer the same (no enumeration)', rFake.status === rReal.status && rFake.body?.error?.message === rReal.body?.error?.message, `${rFake.status}/${rReal.status} "${rFake.body?.error?.message}" vs "${rReal.body?.error?.message}"`);
const rA = await call('PATCH', `/transactions/${t1}/confirm`, PA.owner.tok, {});
const rAf = await call('PATCH', `/transactions/${fake}/confirm`, PA.owner.tok, {});
rec(A, "other School's owner: real vs made-up order id look the same", rA.status === rAf.status && rA.body?.error?.message === rAf.body?.error?.message, `${rA.status}/${rAf.status}`);
refused(A, "North staff can't cancel it (no 'Can cancel charges')", await call('PATCH', `/transactions/${t1}/cancel`, P.staff1.tok, { reason: 'test' }), [403, 404]);
const before = await db.transaction.findUnique({ where: { id: t1 } });
rec(A, 'still PENDING after all the refusals', before.status === 'PENDING', before.status);
const ok1 = await call('PATCH', `/transactions/${t1}/confirm`, P.staff1.tok, {});
const after1 = await db.transaction.findUnique({ where: { id: t1 } });
rec(A, 'North staff (record payments on) confirms the North member\'s order', ok1.status < 300 && after1.status === 'SUCCESSFUL', `${ok1.status} ${after1.status}`);
rec(A, 'what the confirm response gives staff (Spec §8.2: staff never see Transactions)', null, JSON.stringify(ok1.body).slice(0, 300));
const ms = await db.membership.findFirst({ where: { studentId: P.adult1.id, schoolId: B.id }, orderBy: { createdAt: 'desc' } });
rec(A, 'the membership exists after the staff confirm', !!ms && ms.status === 'ACTIVE', ms?.status);
// Staff still can't read the Transactions list.
refused(A, "North staff still can't list Transactions", await call('GET', `/schools/${B.id}/transactions`, P.staff1.tok), [403]);

// --- 2. noHome: owners only -----------------------------------------------------
at = new Date();
const t2 = await order(P.noHome);
const n2 = await noticesFor({ at, expect: 2 });
await sleep(1500);
const n2b = await noticesFor({ at, expect: 2 });
rec(A, 'order by a member with no home branch: only owners told', JSON.stringify(who(n2b)) === JSON.stringify(['B.coowner', 'B.owner']), who(n2b).join(','));
refused(A, "North staff can't confirm a no-home-branch member's order", await call('PATCH', `/transactions/${t2}/confirm`, P.staff1.tok, {}));
refused(A, "South staff can't confirm a no-home-branch member's order", await call('PATCH', `/transactions/${t2}/confirm`, P.staff2.tok, {}));
const ok2 = await call('PATCH', `/transactions/${t2}/confirm`, P.coowner.tok, {});
rec(A, 'co-owner confirms it', ok2.status < 300, `${ok2.status}`);

// --- 3. a child bought for by the parent (child home North) --------------------
at = new Date();
const t3 = await order(P.parent, B.childId);
const n3 = await noticesFor({ at, expect: 4 });
rec(A, "parent's order for a North child: owners + North staff told", JSON.stringify(who(n3)) === JSON.stringify(['B.coowner', 'B.owner', 'B.staff1', 'B.staffStripe'].sort()), who(n3).join(','));
refused(A, "South staff can't confirm the North child's order", await call('PATCH', `/transactions/${t3}/confirm`, P.staff2.tok, {}));
const ok3 = await call('PATCH', `/transactions/${t3}/confirm`, P.staffStripe.tok, {});
rec(A, 'another North staff member confirms it', ok3.status < 300, `${ok3.status}`);

// --- 4. the School switch off ----------------------------------------------------
await must('switch off', 'PATCH', `/schools/${B.id}`, P.owner.tok, { branchStaffCanRecordPayments: false });
at = new Date();
const t4 = await order(P.adult2);
const n4 = await noticesFor({ at, expect: 2 });
await sleep(1500);
const n4b = await noticesFor({ at, expect: 2 });
rec(A, 'switch off: a South member\'s order tells owners only', JSON.stringify(who(n4b)) === JSON.stringify(['B.coowner', 'B.owner']), who(n4b).join(','));
refused(A, "switch off: South staff can't confirm", await call('PATCH', `/transactions/${t4}/confirm`, P.staff2.tok, {}));
// Staff can't turn the switch back on themselves.
refused(A, "staff can't switch 'record payments' on", await call('PATCH', `/schools/${B.id}`, P.staff2.tok, { branchStaffCanRecordPayments: true }), [403]);
refused(A, "a coach can't switch it on", await call('PATCH', `/schools/${B.id}`, P.coach.tok, { branchStaffCanRecordPayments: true }), [403]);
const sch = await db.school.findUnique({ where: { id: B.id }, select: { branchStaffCanRecordPayments: true } });
rec(A, 'switch is still off', sch.branchStaffCanRecordPayments === false, String(sch.branchStaffCanRecordPayments));
// Switching on after the order: staff can then confirm an older order (by design: the check is at confirm time).
await must('switch on', 'PATCH', `/schools/${B.id}`, P.owner.tok, { branchStaffCanRecordPayments: true });
const ok4 = await call('PATCH', `/transactions/${t4}/confirm`, P.staff2.tok, {});
rec(A, 'switch back on: South staff can confirm the waiting South order', ok4.status < 300, `${ok4.status}`);

// --- 5. staff whose role was removed / moved ------------------------------------
// A staff member moved off North (role removed): can't confirm a North order.
at = new Date();
const t5 = await order(P.unsigned);
await noticesFor({ at, expect: 4 });
const grants = await db.roleGrant.findMany({ where: { userId: P.staffStripe.id, schoolId: B.id, role: 'BRANCH_STAFF', revokedAt: null } });
const del = await call('DELETE', `/users/${P.staffStripe.id}/role-grants/${grants[0].id}`, P.owner.tok);
if (del.status >= 300) rec(A, 'owner removes staffStripe (setup)', false, `${del.status} ${del.body?.error?.message}`);
const oldTok = P.staffStripe.tok;
refused(A, 'removed staff, old token: can\'t confirm', await call('PATCH', `/transactions/${t5}/confirm`, oldTok, {}), [401, 403, 404]);
await signIn(P.staffStripe).catch(() => {});
refused(A, 'removed staff, fresh token: can\'t confirm', await call('PATCH', `/transactions/${t5}/confirm`, P.staffStripe.tok, {}), [401, 403, 404]);

// --- 6. a member whose account is being deleted (Decision 440: staff can't sell to a locked member)
at = new Date();
const t6 = await order(P.adult2);
await noticesFor({ at, expect: 3 });
const su = await stepUp(P.adult2);
const delReq = await call('POST', '/users/me/deletion', P.adult2.tok, undefined, { 'x-step-up-token': su });
rec(A, 'adult2 asks to delete their account (setup)', delReq.status < 300, `${delReq.status} ${JSON.stringify(delReq.body).slice(0, 120)}`);
const c6 = await call('PATCH', `/transactions/${t6}/confirm`, P.staff2.tok, {});
const ms6 = await db.membership.findFirst({ where: { studentId: P.adult2.id, schoolId: B.id, status: 'ACTIVE' } });
rec(A, "confirming a locked member's waiting order (staff) — refused or not?", c6.status >= 400, `${c6.status} ${c6.body?.error?.code ?? ''} membership active=${!!ms6}`);
const c6o = await call('PATCH', `/transactions/${t6}/confirm`, P.owner.tok, {});
rec(A, "confirming a locked member's waiting order (owner)", null, `${c6o.status} ${c6o.body?.error?.code ?? ''}`);

saveResults('orders');
await db.$disconnect();
