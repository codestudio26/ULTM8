// Bodies behind life.mjs's desk-sale 400/503 and waiver-sign 403 (round 4 world).
import { cast, call, db } from '../round4/common.mjs';
const YEAR = 365.25 * 86400e3;
const s = cast.schools.find((x) => x.size === 'medium');
const none = s.students.filter((st) => st.kind === 'none' || st.kind === 'lapsed').slice(0, 2);
for (const st of none) { const r = await call('d', 'POST', `/schools/${s.id}/desk-payments`, s.owner.tok, { studentId: st.id, membershipPlanId: s.plans['5-class pack'], paymentMethod: 'CASH' }); console.log('desk', r.status, JSON.stringify(r.body).slice(0, 200)); }
const w = await db.waiver.findFirst({ where: { schoolId: s.id, archivedAt: null } });
const users = await db.user.findMany({ where: { id: { in: s.students.map((x) => x.id) } }, select: { id: true, dateOfBirth: true } });
const kid = users.find((u) => Date.now() - u.dateOfBirth < 15 * YEAR);
const kidSt = s.students.find((x) => x.id === kid.id);
const r = await call('w', 'POST', `/waivers/${w.id}/sign`, kidSt.tok, { signerFullName: 'Round Four', signatureText: 'Round Four', waiverVersion: w.version });
console.log('kid self-sign', r.status, JSON.stringify(r.body).slice(0, 200));
const acct = await db.paymentAccount.findUnique({ where: { schoolId: s.id } }); console.log('payment account', acct?.provider ?? 'none');
await db.$disconnect();
