// MON review: JP-1 through the real card path (hosted checkout -> webhook -> school cancels each class -> AUTO_REFUND to Stripe).
// Run from this folder: source stack.env; CAST=../empty-cast.json node jp1.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { db, call, randomUUID, grant, tokenRca } from '../../round4/common.mjs';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const Stripe = require('stripe');
const stripe = new Stripe('sk_test_x');
const FAKE = 'http://localhost:12111';
const C = JSON.parse(fs.readFileSync(new URL('../jp/jp-cast.json', import.meta.url)));
const S = C.schoolId;
const O = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', S)]);
const fget = async (p) => (await fetch(FAKE + p)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const acct = await db.paymentAccount.findFirst({ where: { schoolId: S, provider: 'STRIPE' } });
async function webhook(type, objectId, metadata = {}) {
  const payload = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type, account: acct.stripeConnectedAccountId, data: { object: { id: objectId, object: type.split('.')[0], metadata } }, created: Math.floor(Date.now() / 1000) });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r = await fetch(`${process.env.API}/payments/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  return r.status;
}
async function until(fn, ms = 20000) { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await sleep(400); } }
const used = new Set((await db.membership.findMany({ where: { schoolId: S }, select: { studentId: true } })).map((m) => m.studentId));
const free = C.bulk.filter((b) => !used.has(b.id));
const out = {};
await db.school.update({ where: { id: S }, data: { schoolCancelledClassResolution: 'REFUND_ALL', classCancellationPolicy: 'AUTO_REFUND' } });
for (const [title, n] of [['回数券 3回', 3], ['回数券 7回', 7]]) {
  const st = free.shift();
  const g = await db.roleGrant.findFirst({ where: { userId: st.id, schoolId: S, role: 'STUDENT' } });
  const tok = tokenRca({ id: st.id, email: 'x' }, [grant('STUDENT', S, g.branchId)]);
  const buy = await call('buy', 'POST', `/membership-plans/${C.plans[title]}/purchase`, tok, { useHostedCheckout: true });
  if (buy.status >= 300) { console.log('buy failed', buy.status, JSON.stringify(buy.body)); continue; }
  const session = await fget(`/v1/checkout/sessions/${buy.body.checkoutUrl.split('/').pop()}`);
  const pi = await fget(`/v1/payment_intents/${session.payment_intent}`);
  const wh = await webhook('payment_intent.succeeded', pi.id, { transactionId: buy.body.transactionId });
  const tx = await until(async () => { const t = await db.transaction.findUnique({ where: { id: buy.body.transactionId } }); return t?.status === 'SUCCESSFUL' ? t : null; });
  if (!tx) { console.log('not settled', wh); continue; }
  const bookingIds = [];
  for (let k = 0; k < n; k++) {
    const start = Date.now() + (20 + k) * 86400e3 + Math.floor(Math.random() * 3600e3);
    const cl = await call('cl', 'POST', `/schools/${S}/classes`, O, { branchId: g.branchId ?? C.branches[0], instructorId: C.instr.id, title: `MON review ${title} ${k + 1}`, styles: [{ disciplineId: C.judo, classType: null }], startDate: new Date(start).toISOString(), endDate: new Date(start + 3600e3).toISOString(), membershipInclusion: true, capacity: 10 });
    const bk = await call('bk', 'POST', `/classes/${cl.body.id}/book`, tok, {});
    if (bk.status >= 300) { console.log('book', bk.status, JSON.stringify(bk.body)); break; }
    bookingIds.push(bk.body.id);
    const cc = await call('cc', 'POST', `/classes/${cl.body.id}/cancel`, O, { reason: 'MON review' });
    if (cc.status >= 300) console.log('cancel', cc.status, JSON.stringify(cc.body));
  }
  await sleep(2500);
  const bks = await db.booking.findMany({ where: { id: { in: bookingIds } }, select: { refundAmount: true, refundResolution: true, stripeRefundId: true } });
  const refunds = await Promise.all(bks.filter((b) => b.stripeRefundId).map((b) => fget(`/v1/refunds/${b.stripeRefundId}`)));
  const t2 = await db.transaction.findUnique({ where: { id: tx.id } });
  out[title] = { student: st.id, stripeCharged: pi.amount, piCurrency: pi.currency, recorded: tx.amount, shares: bks.map((b) => b.refundAmount), resolutions: bks.map((b) => b.refundResolution), stripeRefunds: refunds.map((r) => r.amount), stripeRefundSum: refunds.reduce((a, r) => a + r.amount, 0), txStatus: t2.status, txRefunded: t2.refundedAmount };
  console.log(title, JSON.stringify(out[title]));
}
fs.writeFileSync(new URL('./jp1-out.json', import.meta.url), JSON.stringify(out, null, 1));
await db.$disconnect();
