// My dojo vs other testers' R5 Schools: reads and money writes both ways.
import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./jp-cast.json', import.meta.url)));
const others = await db.school.findMany({ where: { name: { startsWith: 'R5 ' }, NOT: { name: { startsWith: 'R5 JP' } } }, select: { id: true, name: true }, take: 6 });
const res = [];
for (const o of others) {
  const ost = await db.roleGrant.findFirst({ where: { schoolId: o.id, role: 'STUDENT', revokedAt: null }, select: { userId: true } });
  const oown = await db.roleGrant.findFirst({ where: { schoolId: o.id, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, include: { user: true } });
  const otok = oown && tokenRca(oown.user, [grant('SCHOOL_OWNER_MANAGER', o.id)]);
  const me = C.bulk[20];
  const tries = [
    ['my owner reads their roster', 'GET', `/schools/${o.id}/students`, C.owner.tok],
    ['my owner reads their transactions', 'GET', `/schools/${o.id}/transactions`, C.owner.tok],
    ['my owner charges their student via my School', 'POST', `/schools/${C.schoolId}/students/${ost?.userId}/charges`, C.owner.tok, { description: 'x', amount: 100, dueDate: '2026-12-01' }],
    ['my owner charges their student via their School', 'POST', `/schools/${o.id}/students/${ost?.userId}/charges`, C.owner.tok, { description: 'x', amount: 100, dueDate: '2026-12-01' }],
    ['my owner gives credit to their student', 'POST', `/schools/${o.id}/students/${ost?.userId}/credits`, C.owner.tok, { amount: 100, note: 'x' }],
    ['their owner reads my roster', 'GET', `/schools/${C.schoolId}/students?search=佐藤`, otok],
    ['their owner reads my member balances', 'GET', `/schools/${C.schoolId}/charge-reports/member-balances`, otok],
    ['their owner charges my student', 'POST', `/schools/${o.id}/students/${me.id}/charges`, otok, { description: 'x', amount: 100, dueDate: '2026-12-01' }],
    ['their owner desk-sells my plan to my student', 'POST', `/schools/${o.id}/desk-payments`, otok, { studentId: me.id, membershipPlanId: C.plans['回数券 10回'], paymentMethod: 'CASH' }],
    ['their owner gifts my Friend Pass', 'POST', `/schools/${C.schoolId}/students/${me.id}/memberships/gift`, otok, { membershipPlanId: C.plans['友達パス'] }],
  ];
  for (const [label, m, p, t, b] of tries) { const r = await call('x', m, p, t, b); res.push({ school: o.name.slice(0, 30), label, status: r.status, leak: r.status < 300 ? JSON.stringify(r.body).slice(0, 120) : '' }); }
}
const bad = res.filter((r) => r.status < 300 || r.status >= 500);
console.log(`${res.length} tries, ${bad.length} allowed or 5xx`); console.table(bad.length ? bad : res.slice(0, 10));
await db.$disconnect();
