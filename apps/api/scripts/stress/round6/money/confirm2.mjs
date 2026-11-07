// M-5 on a brand-new UK card School: a part refund made in Stripe, and what
// the Transactions summary and the billing overview count.
import { call, must, db, expect, makeSchool, makeMember, plan, stripeWebhook, saveOut, FAKE } from './lib.mjs';
import { done } from './common.mjs';

const A = 'confirm2';
const s = await makeSchool('ready', 'M6 Clean UK');
const p = await plan(s, { type: 'CLASS_PACK', title: 'Pack', price: 8000, classesIncluded: 10, expiryDurationDays: 90 });
const u = await makeMember(s, 'Pat', 'Card');
const h = await must('hosted', 'POST', `/membership-plans/${p.id}/purchase`, u.tok, { useHostedCheckout: true });
const paid = await (await fetch(`${FAKE}/__checkout/${h.checkoutUrl.split('/').pop()}/pay`, { method: 'POST' })).json();
await stripeWebhook({ id: `evt_${Date.now()}c`, object: 'event', type: 'payment_intent.succeeded', account: s.acct, data: { object: paid.payment_intent } });
await new Promise((r) => setTimeout(r, 2000));
const ch = await (await fetch(`${FAKE}/__charges/${paid.payment_intent.latest_charge.id}/refund`, { method: 'POST', body: JSON.stringify({ amount: 3000 }) })).json();
await stripeWebhook({ id: `evt_rf_${Date.now()}`, object: 'event', type: 'charge.refunded', account: s.acct, data: { object: ch } });
await new Promise((r) => setTimeout(r, 2000));
const t = await db.transaction.findUnique({ where: { id: h.transactionId } });
const sum = (await call('GET', `/schools/${s.id}/transactions/summary`, s.owner.tok)).body;
const ov = (await call('GET', `/schools/${s.id}/charge-reports/overview`, s.owner.tok)).body?.currencies?.find((x) => x.currency === 'GBP');
const rev = sum?.revenue?.find((x) => x.currency === 'GBP')?.amount;
expect(A, 'M-5 clean: £80 pack, £30 refunded in Stripe: Transactions "Revenue" = £50 like the overview', rev === 5000 && ov?.memberships === 5000, { payment: { amount: t.amount, refunded: t.refundedAmount, status: t.status }, summaryRevenue: rev, overviewMemberships: ov?.memberships });
saveOut('confirm2-out.json');
await done();
