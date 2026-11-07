// billing C14b alone (after billing.mjs on the same cast): cancel a cash order with a reason, then confirm it.
import fs from 'fs';
import { db, call } from '../booking-schedule/lib.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('../booking-schedule/cast.json', import.meta.url)));
const s = cast.schools[15]; // an odd (cash) School
const plan = await db.membershipPlan.findFirst({ where: { schoolId: s.id, title: '10-class pack', archivedAt: null }, orderBy: { createdAt: 'desc' } });
const adults = await db.user.findMany({ where: { id: { in: s.students.map((x) => x.id) }, dateOfBirth: { lt: new Date('2000-01-01') } }, select: { id: true } });
const st = s.students.find((x) => x.id === adults[50].id);
const r = await call('buy', 'POST', `/membership-plans/${plan.id}/purchase`, st.tok, {});
const noReason = await call('cancel', 'PATCH', `/transactions/${r.body.transactionId}/cancel`, s.owner.tok, {});
const cancel = await call('cancel', 'PATCH', `/transactions/${r.body.transactionId}/cancel`, s.owner.tok, { reason: 'Never arrived' });
const confirm = await call('confirm', 'PATCH', `/transactions/${r.body.transactionId}/confirm`, s.owner.tok, {});
const o = await db.transaction.findUnique({ where: { id: r.body.transactionId } });
console.log(`buy ${r.status}; cancel without reason ${noReason.status} ${JSON.stringify(noReason.body?.error?.message)}; cancel with reason ${cancel.status}; confirm after ${confirm.status} → ${o.status}, membership ${o.membershipId ?? 'none'}`);
await db.$disconnect();
