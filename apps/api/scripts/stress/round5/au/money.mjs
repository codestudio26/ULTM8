// Round 5 AU: AUD money through the Student app's purchase and the desk (brief), and ST9 notices.
import fs from 'fs';
import { db, call, grant, tokenRca, randomUUID } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const sid = A.schoolId;
const owner = tokenRca({ id: A.owner, email: 'o' }, [grant('SCHOOL_OWNER_MANAGER', sid)]);
const FAKE = 'http://localhost:12111';
let acct = await call('m', 'POST', `/schools/${sid}/payment-accounts`, owner, { provider: 'STRIPE', accountTitle: "Jack's BJJ", country: 'AU' });
if (acct.status === 409) acct = { status: 200, body: await db.paymentAccount.findFirst({ where: { schoolId: sid } }) };
console.log('account', acct.status, acct.body?.id);
if (!acct.body.stripeConnectedAccountId) { const ob = await call('m', 'POST', `/payment-accounts/${acct.body.id}/connect/onboard`, owner, {}); console.log('onboard', ob.status); }
const stud = (s) => tokenRca({ id: s.id, email: 'x' }, [grant('STUDENT', sid, A.branches[s.b])]);
const free = A.students.filter((s) => s.tag === 'adult' && !A.memberships[s.id]);
// Plans made through the API (the seeded ones have no Stripe price).
const mkPlan = async (body) => { const r = await call('m', 'POST', `/schools/${sid}/membership-plans`, owner, { currency: 'AUD', ...body }); if (r.status >= 300) console.log('plan', JSON.stringify(r.body)); return r.body?.id; };
const pack = await mkPlan({ type: 'CLASS_PACK', title: `AU 10-pack ${Date.now() % 1e5}`, price: 25000, classesIncluded: 10 });
const drop = await mkPlan({ type: 'CLASS_PACK', title: `AU drop-in ${Date.now() % 1e5}`, price: 3013, classesIncluded: 1 });
const sub = await mkPlan({ type: 'SUBSCRIPTION', title: `AU unlimited ${Date.now() % 1e5}`, price: 18900 });
for (const [label, plan, s] of [['10-pack A$250.00', pack, free[0]], ['drop-in A$30.13 (decline)', drop, free[1]], ['monthly A$189.00', sub, free[2]]]) {
  const buy = await call('m', 'POST', `/membership-plans/${plan}/purchase`, stud(s), { useHostedCheckout: true });
  const tx = buy.body?.transactionId ? await db.transaction.findUnique({ where: { id: buy.body.transactionId } }) : null;
  const sessionId = buy.body?.checkoutUrl?.split('/').pop();
  const session = sessionId ? await (await fetch(`${FAKE}/v1/checkout/sessions/${sessionId}`)).json().catch(() => null) : null;
  const li = session?.line_items?.data?.[0] ?? session?.line_items?.[0];
  console.log(`${label}: ${buy.status} tx ${tx?.amount} ${tx?.currency}; session amount_total ${session?.amount_total} ${session?.currency} ${li ? JSON.stringify(li).slice(0, 160) : ''} ${buy.status >= 300 ? JSON.stringify(buy.body).slice(0, 160) : ''}`);
}
// Desk sale in cash, with GST.
const deskStud = free[4 + (Date.now() % Math.max(1, free.length - 5))];
const desk = await call('m', 'POST', `/schools/${sid}/desk-payments`, owner, { studentId: deskStud.id, membershipPlanId: pack, paymentMethod: 'CASH' });
console.log('desk sale', desk.status, JSON.stringify(desk.body).slice(0, 300));
await db.$disconnect();
