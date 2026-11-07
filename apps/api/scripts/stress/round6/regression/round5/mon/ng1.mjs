// MON review: NG-1 through the card path at a School with a Stripe account (CA), plus MONEY_BACK and CREDIT.
// Run from this folder: source stack.env; CAST=../empty-cast.json node ng1.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { db, call, randomUUID, grant, tokenRca, codes } from '../../round4/common.mjs';
const require = createRequire(new URL('../../../../../../package.json', import.meta.url));
const Stripe = require('stripe');
const stripe = new Stripe('sk_test_x');
const FAKE = 'http://localhost:12111';
const C = JSON.parse(fs.readFileSync(new URL('../ca/cast-ca.json', import.meta.url)));
const S = C.schoolId;
const O = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', S)]);
const fget = async (p) => (await fetch(FAKE + p)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function webhook(type, objectId, metadata = {}) {
  const payload = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type, account: C.acct, data: { object: { id: objectId, object: type.split('.')[0], metadata } }, created: Math.floor(Date.now() / 1000) });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return (await fetch(`${process.env.API}/payments/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload })).status;
}
async function until(fn, ms = 20000) { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await sleep(400); } }
const withCharges = new Set((await db.charge.findMany({ where: { schoolId: S }, select: { studentId: true } })).map((c) => c.studentId));
const free = C.adults.filter((a) => !withCharges.has(a.id)).slice(-40);
const due = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
const out = {};
async function stud(a) { const g = await db.roleGrant.findFirst({ where: { userId: a.id, schoolId: S, role: 'STUDENT' } }); return tokenRca({ id: a.id, email: a.email }, [grant('STUDENT', S, g?.branchId ?? C.van)]); }

// 1. CARD: ¥-free, CAD 150.00 charge paid by card in the app; refund 50.00 to the card, 10 at once.
{
  const a = free.pop(); const tok = await stud(a);
  const ch = await call('ch', 'POST', `/schools/${S}/students/${a.id}/charges`, O, { description: 'MON review card', amount: 15000, dueDate: due, taxExempt: true });
  const co = await call('co', 'POST', `/students/${a.id}/charges/checkout`, tok, { schoolId: S, chargeId: ch.body.id });
  if (co.status >= 300) { console.log('checkout', co.status, JSON.stringify(co.body)); }
  else {
    const session = await fget(`/v1/checkout/sessions/${co.body.checkoutUrl.split('/').pop()}`);
    await webhook('payment_intent.succeeded', session.payment_intent, { transactionId: co.body.transactionId });
    const tx = await until(async () => { const t = await db.transaction.findUnique({ where: { id: co.body.transactionId } }); return t?.status === 'SUCCESSFUL' ? t : null; });
    const before = (await fget('/__calls'))['POST /v1/refunds'] ?? 0;
    const rs = await Promise.all(Array.from({ length: 10 }, () => call('rf', 'POST', `/schools/${S}/charge-payments/${tx.id}/refund`, O, { amount: 5000, destination: 'CARD', notes: 'MON review partial' })));
    const after = (await fget('/__calls'))['POST /v1/refunds'] ?? 0;
    const rows = await db.chargeRefund.findMany({ where: { transactionId: tx.id }, orderBy: { createdAt: 'asc' } });
    const refunds = await Promise.all(rows.filter((r) => r.stripeRefundId).map((r) => fget(`/v1/refunds/${r.stripeRefundId}`)));
    out.card = { paid: tx.amount, codes: codes(rs), refundRows: rows.length, rowAmounts: rows.map((r) => r.amount), stripeRefundCalls: after - before, stripeRefundAmounts: refunds.map((r) => r.amount), distinctStripeRefundIds: new Set(rows.map((r) => r.stripeRefundId)).size, errs: rs.filter((r) => r.status >= 300).map((r) => r.body?.code ?? r.body?.message).slice(0, 3) };
    console.log('CARD', JSON.stringify(out.card));
    // Sequential retry 2 s later, as a flaky-network resend would arrive.
  }
}
// 2. MONEY_BACK on a cash payment, 10 at once.
for (const dest of ['MONEY_BACK', 'CREDIT']) {
  const a = free.pop();
  const ch = await call('ch', 'POST', `/schools/${S}/students/${a.id}/charges`, O, { description: `MON review ${dest}`, amount: 15000, dueDate: due, taxExempt: true });
  const pay = await call('pay', 'POST', `/schools/${S}/students/${a.id}/charge-payments`, O, { chargeId: ch.body.id, amount: 15000, paymentMethod: 'CASH' });
  const txId = pay.body?.transactionId ?? pay.body?.payment?.id ?? pay.body?.id;
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('rf', 'POST', `/schools/${S}/charge-payments/${txId}/refund`, O, { amount: 5000, destination: dest, notes: 'MON review partial' })));
  const rows = await db.chargeRefund.findMany({ where: { transactionId: txId } });
  const notices = await db.notification.count({ where: { userId: a.id, schoolId: S, title: { contains: 'efund' } } }).catch(() => 'n/a');
  out[dest] = { pay: pay.status, codes: codes(rs), refundRows: rows.length, total: rows.reduce((s, r) => s + r.amount, 0), notices };
  console.log(dest, JSON.stringify(out[dest]), pay.status >= 300 ? JSON.stringify(pay.body) : '');
}
fs.writeFileSync(new URL('./ng1-out.json', import.meta.url), JSON.stringify(out, null, 1));
await db.$disconnect();
