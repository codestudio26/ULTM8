// Seed fix-ups: home branches (StudentHomeBranch, as a join through the API would set), and a fake-Stripe connected account id.
import fs from 'fs';
import { db, randomUUID } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-br.json', import.meta.url)));
const have = new Set((await db.studentHomeBranch.findMany({ where: { schoolId: C.S }, select: { studentId: true } })).map((r) => r.studentId));
const rows = C.students.filter((s) => !have.has(s.id)).map((s) => ({ id: randomUUID(), schoolId: C.S, studentId: s.id, branchId: s.branch }));
await db.studentHomeBranch.createMany({ data: rows });
const pt = C.pt.students.filter((s) => !have.has(s.id)).map((s) => ({ id: randomUUID(), schoolId: C.PT, studentId: s.id, branchId: C.ptBranch }));
await db.studentHomeBranch.createMany({ data: pt, skipDuplicates: true });
const pa = await db.paymentAccount.findFirst({ where: { schoolId: C.S } });
if (pa && !pa.stripeConnectedAccountId) {
  const acct = await (await fetch('http://localhost:12111/v1/accounts', { method: 'POST' })).json();
  await db.paymentAccount.update({ where: { id: pa.id }, data: { stripeConnectedAccountId: acct.id } });
}
console.log('home branches', rows.length + pt.length, 'acct', (await db.paymentAccount.findFirst({ where: { schoolId: C.S } })).stripeConnectedAccountId);
await db.$disconnect();
