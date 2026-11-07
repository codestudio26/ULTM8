// Three Schools for the money attacks: UK with a ready Stripe account, UK
// whose Stripe account is not ready, Brazil without cards (Pix/cash).
// Writes cast.json (ids and sign-ins) for the attack scripts.
import fs from 'fs';
import { makeSchool, plan, db, rec, must } from './lib.mjs';

const cast = {};
for (const [k, kind, name] of [['ready', 'ready', 'M6 Ready Dojo'], ['notready', 'notready', 'M6 Pending Dojo'], ['br', 'br', 'M6 Academia']]) {
  const s = await makeSchool(kind, name);
  const pa = await db.paymentAccount.findUnique({ where: { id: s.payAcct.id } });
  rec('setup', `${k}: School made`, 'NOTE', `${s.school.id} provider ${pa.provider} acct ${pa.stripeConnectedAccountId} ready ${pa.stripeAccountReady}`);
  await must('fees on', 'PATCH', `/schools/${s.id}`, s.owner.tok, { joiningFeesEnabled: true });
  const price = kind === 'br' ? 18990 : 6500;
  s.plans = {
    monthly: await plan(s, { type: 'SUBSCRIPTION', title: 'Monthly', price, joiningFee: kind === 'br' ? 5000 : 2500, joiningFeeRefundable: false }),
    monthly2: await plan(s, { type: 'SUBSCRIPTION', title: 'Monthly B', price: kind === 'br' ? 9999 : 3333 }),
    pack: await plan(s, { type: 'CLASS_PACK', title: 'Pack 10', price: kind === 'br' ? 25050 : 8000, classesIncluded: 10, expiryDurationDays: 90 }),
    next: await plan(s, { type: 'CLASS_PACK', title: 'Pack 5', price: 4500, classesIncluded: 5, expiryDurationDays: 60 }),
  };
  cast[k] = { kind, c: s.c, schoolId: s.id, branchId: s.branch.id, payAcctId: s.payAcct.id, acct: s.acct ?? null, owner: { email: s.owner.email, passcode: s.owner.passcode, id: s.owner.id }, plans: Object.fromEntries(Object.entries(s.plans).map(([n, p]) => [n, p.id])) };
}
fs.writeFileSync(new URL('./cast.json', import.meta.url), JSON.stringify(cast, null, 1));
await db.$disconnect();
process.exit(0);
