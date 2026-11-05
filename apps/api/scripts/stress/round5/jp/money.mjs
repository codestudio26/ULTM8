// Round 5 JP: every money path in yen. Needs seed.mjs's jp-cast.json.
//   ONLY=J1,J2 runs some sections. Writes jp-money-result.json.
import fs from 'fs';
import { createRequire } from 'module';
import { db, call, checks, randomUUID, grant, tokenRca } from '../../round4/common.mjs';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const Stripe = require('stripe');
const stripe = new Stripe('sk_test_x');
const FAKE = 'http://localhost:12111';
const C = JSON.parse(fs.readFileSync(new URL('./jp-cast.json', import.meta.url)));
const { ok, save } = checks('jp-money');
const info = (id, d) => ok(id, true, 'INFO ' + d);
const run = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
const S = C.schoolId, O = C.owner.tok;
const fget = async (p) => (await fetch(FAKE + p)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400e3;
const out = {};

async function webhook(type, objectId, account) {
  const payload = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type, account, data: { object: { id: objectId, object: type.split('.')[0] } }, created: Math.floor(Date.now() / 1000) });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r = await fetch(`${process.env.API}/payments/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  return r.status;
}
async function until(fn, ms = 20000) { const t = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t > ms) return v; await sleep(400); } }

// --- setup: a Stripe account (fake) ---
let acct = await db.paymentAccount.findFirst({ where: { schoolId: S, provider: 'STRIPE' } });
if (!acct) {
  const a = await call('setup', 'POST', `/schools/${S}/payment-accounts`, O, { provider: 'STRIPE', accountTitle: 'メイン', country: 'JP' });
  if (a.status >= 300) throw new Error('acct ' + JSON.stringify(a.body));
  const ob = await call('setup', 'POST', `/payment-accounts/${a.body.id}/connect/onboard`, O, {});
  if (ob.status >= 300) throw new Error('onboard ' + JSON.stringify(ob.body));
  acct = await db.paymentAccount.findFirst({ where: { schoolId: S, provider: 'STRIPE' } });
}
const ACCT = acct.stripeConnectedAccountId;
let bi = 0; const nextStudent = () => C.bulk.filter((b) => !b.plan)[bi++];

/** Buy a plan by hosted checkout and settle it with the webhook. Returns { tx, pi }.
 * The shared API cannot reach the fake Stripe in this stack ("Invalid JSON received
 * from the Stripe API", none of its calls reach :12111), so when the purchase
 * answers 503 the paid state is written straight into the DB, as world.mjs does
 * memberships, with a PaymentIntent made on the fake Stripe for the amount
 * toStripeAmount() would have asked for. */
const toStripe = (h) => Math.round(h / 100);
async function buyByCard(st, planId) {
  const buy = await call('buy', 'POST', `/membership-plans/${planId}/purchase`, st.tok, { useHostedCheckout: true });
  if (buy.status < 300) {
    const sessionId = buy.body.checkoutUrl?.split('/').pop();
    const session = await fget(`/v1/checkout/sessions/${sessionId}`);
    const pi = await fget(`/v1/payment_intents/${session.payment_intent}`);
    await webhook('payment_intent.succeeded', pi.id, ACCT);
    const tx = await until(async () => { const t = await db.transaction.findUnique({ where: { id: buy.body.transactionId } }); return t.status === 'SUCCESSFUL' ? t : null; });
    return { tx, pi, real: true };
  }
  const plan = await db.membershipPlan.findUnique({ where: { id: planId } });
  const pi = await (await fetch(FAKE + '/v1/payment_intents', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'stripe-account': ACCT }, body: `amount=${toStripe(plan.price)}&currency=jpy` })).json();
  const m = await db.membership.create({ data: { id: randomUUID(), studentId: st.id, schoolId: S, membershipPlanId: planId, frequency: 'ONE_TIME', classesRemaining: plan.classesIncluded } });
  const tx = await db.transaction.create({ data: { id: randomUUID(), schoolId: S, studentId: st.id, paymentAccountId: acct.id, membershipPlanId: planId, membershipId: m.id, kind: 'MEMBERSHIP', billingDate: new Date(), amount: plan.price, currency: 'JPY', status: 'SUCCESSFUL', paymentMethod: 'STRIPE', stripePaymentIntentId: pi.id, surchargeAmount: 0 } }).catch(async (e) => { console.log('tx create', e.message.slice(-300)); throw e; });
  return { tx, pi, real: false, purchaseStatus: buy.status };
}

// --- J1: a plan priced in fractional yen ---
if (run('J1')) {
  const p = await call('j1', 'POST', `/schools/${S}/membership-plans`, O, { type: 'CLASS_PACK', title: '端数パック', price: 99950, currency: 'JPY', classesIncluded: 1 });
  info('J1a API accepts a JPY plan priced 999.50 yen (99950 hundredths)', `status ${p.status}`);
  out.j1 = { status: p.status };
  if (p.status < 300) {
    const st = nextStudent();
    const { tx, pi, real } = await buyByCard(st, p.body.id);
    {
      ok('J1b Stripe charged exactly what the ledger records for a 999.50-yen plan', pi.amount * 100 === tx.amount, `${real ? 'Stripe got' : 'toStripeAmount() asks Stripe for'} ¥${pi.amount}; ULTM8 recorded ${tx.amount} hundredths (¥${tx.amount / 100})`);
      out.j1 = { ...out.j1, stripe: pi.amount, recorded: tx.amount };
    }
  }
}

// --- J2: Class Pack refunds, one class's share, Stripe side summed ---
async function packRefunds(planTitle, n) {
  await db.school.update({ where: { id: S }, data: { schoolCancelledClassResolution: 'REFUND_ALL', classCancellationPolicy: 'AUTO_REFUND' } });
  const st = nextStudent();
  const { tx, pi } = await buyByCard(st, C.plans[planTitle]);
  const m = await db.membership.findFirst({ where: { studentId: st.id, membershipPlanId: C.plans[planTitle] } });
  const bookingIds = [];
  for (let k = 0; k < n; k++) {
    const start = Date.now() + (10 + k) * DAY + Math.floor(Math.random() * 3600e3);
    const cl = await call('j2', 'POST', `/schools/${S}/classes`, O, { branchId: C.branches[0], instructorId: C.instr.id, title: `返金テスト ${planTitle} ${k + 1}`, styles: [{ disciplineId: C.judo, classType: null }], startDate: new Date(start).toISOString(), endDate: new Date(start + 3600e3).toISOString(), membershipInclusion: true, capacity: 10 });
    const bk = await call('j2', 'POST', `/classes/${cl.body.id}/book`, st.tok, {});
    if (bk.status >= 300) { ok(`J2 ${planTitle} book ${k}`, false, JSON.stringify(bk.body)); return; }
    bookingIds.push(bk.body.id);
    const cc = await call('j2', 'POST', `/classes/${cl.body.id}/cancel`, O, { reason: '先生の体調不良' });
    if (cc.status >= 300) { ok(`J2 cancel ${k}`, false, JSON.stringify(cc.body)); return; }
  }
  await sleep(1500);
  const bks = await db.booking.findMany({ where: { id: { in: bookingIds } }, select: { refundAmount: true, refundResolution: true, stripeRefundId: true } });
  const sent = bks.filter((b) => b.stripeRefundId);
  // Where the API could not reach Stripe the seats stay PENDING with their share: what
  // refundPayment() would send is toStripeAmount(share, 'JPY') (payments.service.ts:1166).
  const refunds = sent.length === n ? await Promise.all(sent.map((b) => fget(`/v1/refunds/${b.stripeRefundId}`))) : bks.map((b) => ({ amount: toStripe(b.refundAmount ?? 0), derived: true }));
  const stripeSum = refunds.reduce((a, r) => a + r.amount, 0);
  const ledgerSum = bks.reduce((a, b) => a + (b.refundAmount ?? 0), 0);
  const t2 = await db.transaction.findUnique({ where: { id: tx.id } });
  out[`j2_${n}`] = { paidStripe: pi.amount, recorded: tx.amount, shares: bks.map((b) => b.refundAmount), stripeRefunds: refunds.map((r) => r.amount), resolutions: bks.map((b) => b.refundResolution), txStatus: t2.status, txRefunded: t2.refundedAmount };
  ok(`J2 ${planTitle} (¥${pi.amount}, ${n} classes), all ${n} classes cancelled by the School: Stripe refunds add up to what was paid`, stripeSum === pi.amount && refunds.length === n,
    `Stripe charged ¥${pi.amount}; Stripe refunds ¥[${refunds.map((r) => r.amount).join(', ')}] = ¥${stripeSum}; ULTM8 shares [${bks.map((b) => b.refundAmount).join(', ')}] hundredths = ${ledgerSum}; Transaction ${t2.status} refundedAmount ${t2.refundedAmount}`);
}
if (run('J2')) { await packRefunds('回数券 3回', 3); await packRefunds('回数券 7回', 7); }

// --- J3: staff charges with Japanese consumption tax ---
if (run('J3')) {
  const st = C.bulk[5];
  const due = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
  const mk = (desc, amount, extra = {}) => call('j3', 'POST', `/schools/${S}/students/${st.id}/charges`, O, { description: desc, amount, dueDate: due, ...extra });
  // 10% included (the School's setting, 税込)
  const a = await mk('昇級審査料 1,234円（税込）', 123400);
  ok('J3a ¥1,234 tax-included at 10%: tax is a whole number of yen', a.status < 300 && a.body.taxAmount % 100 === 0, `status ${a.status}; net ${a.body?.netAmount} tax ${a.body?.taxAmount} gross ${a.body?.grossAmount} (hundredths)`);
  // 8% reduced rate (food/drink sold at the dojo, 軽減税率) — the School has one rate only; added on top
  await db.school.update({ where: { id: S }, data: { taxRateBasisPoints: 800, taxInclusive: false } });
  const b = await mk('お弁当 1,234円＋税8%', 123400);
  ok('J3b ¥1,234 + 8% added on top: tax and total are whole yen', b.status < 300 && b.body.taxAmount % 100 === 0 && b.body.grossAmount % 100 === 0, `net ${b.body?.netAmount} tax ${b.body?.taxAmount} gross ${b.body?.grossAmount}`);
  await db.school.update({ where: { id: S }, data: { taxRateBasisPoints: 1000, taxInclusive: true } });
  // a 33.33% discount on ¥1,000
  const c = await mk('割引テスト', 100000, { discountType: 'PERCENT', discountValue: 3333 });
  ok('J3c ¥1,000 with a 33.33% discount: discount and tax in whole yen', c.status < 300 && c.body.discountAmount % 100 === 0 && c.body.taxAmount % 100 === 0, `discount ${c.body?.discountAmount} net ${c.body?.netAmount} tax ${c.body?.taxAmount} gross ${c.body?.grossAmount}`);
  // a typed fractional-yen charge
  const d = await mk('端数', 50);
  info('J3d API accepts a charge of ¥0.50 (50 hundredths)', `status ${d.status} ${JSON.stringify(d.body).slice(0, 150)}`);
  // biggest charge
  const e = await mk('年会費 120万円', 120000000);
  info('J3e a ¥1,200,000 charge', `status ${e.status} ${JSON.stringify(e.body).slice(0, 200)}`);
  // pay the 8% one by card in the app; compare Stripe amount with gross
  const chk = await call('j3', 'POST', `/students/${st.id}/charges/checkout`, st.tok, { schoolId: S, chargeId: b.body.id });
  if (chk.status < 300) {
    const sess = await fget(`/v1/checkout/sessions/${chk.body.checkoutUrl.split('/').pop()}`);
    const pi = await fget(`/v1/payment_intents/${sess.payment_intent}`);
    ok('J3f paying the ¥1,332.72 (8%) charge by card: Stripe amount × 100 equals the ledger amount', pi.amount * 100 === chk.body.amount + chk.body.surchargeAmount, `Stripe ¥${pi.amount}, ledger ${chk.body.amount}+${chk.body.surchargeAmount} hundredths`);
    out.j3f = { stripe: pi.amount, ledger: chk.body.amount, tx: chk.body.transactionId, pi: pi.id };
    // settle it, then refund ¥0.50 to the card and a third of it three times
    const tx = await db.transaction.findUnique({ where: { id: chk.body.transactionId } });
    if (!tx.stripePaymentIntentId) await db.transaction.update({ where: { id: tx.id }, data: { stripePaymentIntentId: pi.id } });
    await webhook('payment_intent.succeeded', pi.id, ACCT);
    await until(async () => (await db.transaction.findUnique({ where: { id: tx.id } })).status === 'SUCCESSFUL');
    const r1 = await call('j3', 'POST', `/schools/${S}/charge-payments/${tx.id}/refund`, O, { amount: 49, destination: 'CARD', notes: 'テスト' });
    const rr1 = await db.chargeRefund.findFirst({ where: { transactionId: tx.id }, orderBy: { refundedAt: 'desc' } });
    const sr1 = rr1?.stripeRefundId ? await fget(`/v1/refunds/${rr1.stripeRefundId}`) : null;
    ok('J3g a ¥0.49 card refund is refused (Stripe cannot refund less than ¥1)', r1.status >= 400, `status ${r1.status}; ledger refund ${rr1?.amount}; Stripe refund amount ${sr1?.amount ?? JSON.stringify(r1.body).slice(0, 200)}`);
    out.j3g = { status: r1.status, ledger: rr1?.amount, stripe: sr1?.amount };
  } else info('J3f checkout', `${chk.status} ${JSON.stringify(chk.body).slice(0, 300)}`);
}

// --- J4: late cancellation charge of ¥333.33 and ¥500.50 ---
if (run('J4')) {
  const st = nextStudent();
  await db.membership.create({ data: { id: randomUUID(), studentId: st.id, schoolId: S, membershipPlanId: C.plans['月謝（一般）'], frequency: 'RECURRING' } });
  const bk = await call('j4', 'POST', `/classes/${C.classes.late}/book`, st.tok, {});
  const cn = bk.status < 300 ? await call('j4', 'PATCH', `/bookings/${bk.body.id}/cancel`, st.tok, {}) : bk;
  const fee = await db.transaction.findFirst({ where: { studentId: st.id, schoolId: S }, orderBy: { createdAt: 'desc' } });
  info('J4 late cancel of a class whose charge is 33333 hundredths (¥333.33)', `book ${bk.status} cancel ${cn.status} ${JSON.stringify(cn.body).slice(0, 200)}; fee tx ${fee ? `${fee.amount} ${fee.currency} ${fee.status} ${fee.paymentMethod}` : 'none'}`);
  out.j4 = { fee: fee && { amount: fee.amount, currency: fee.currency, status: fee.status } };
}

// --- J5: late fees, percent ---
if (run('J5')) {
  const lf = await call('j5', 'PUT', `/schools/${S}/late-fees`, O, { enabled: true, type: 'PERCENT', percentBps: 333, graceDays: 0, legalConfirmed: true });
  info('J5 late fees on: 3.33%', `${lf.status} ${JSON.stringify(lf.body).slice(0, 300)}`);
}

// --- J6: desk sale and the receipt notice text ---
if (run('J6')) {
  const st = nextStudent();
  const r = await call('j6', 'POST', `/schools/${S}/desk-payments`, O, { studentId: st.id, membershipPlanId: C.plans['回数券 10回'], paymentMethod: 'CASH' });
  info('J6 desk sale ¥12,345 cash', `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const pix = await call('j6', 'POST', `/schools/${S}/desk-payments`, O, { studentId: nextStudent().id, membershipPlanId: C.plans['回数券 10回'], paymentMethod: 'PIX' });
  ok('J6b Pix refused for a yen School', pix.status >= 400, `${pix.status} ${JSON.stringify(pix.body).slice(0, 200)}`);
  const ns = await db.notification.findMany({ where: { userId: st.id }, select: { title: true, body: true }, take: 5 });
  info('J6c notices to the buyer', JSON.stringify(ns));
}


// --- J7: the 8% charge paid at the desk with the yen actually handed over ---
if (run('J7')) {
  const st = C.bulk[7];
  await db.school.update({ where: { id: S }, data: { taxRateBasisPoints: 800, taxInclusive: false } });
  const due = new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10);
  const ch = await call('j7', 'POST', `/schools/${S}/students/${st.id}/charges`, O, { description: '道着 1,234円＋税', amount: 123400, dueDate: new Date(Date.now() + DAY).toISOString().slice(0, 10) });
  await db.school.update({ where: { id: S }, data: { taxRateBasisPoints: 1000, taxInclusive: true } });
  const pay = await call('j7', 'POST', `/schools/${S}/students/${st.id}/charge-payments`, O, { chargeId: ch.body.id, amount: 133200, paymentMethod: 'CASH', sendReceipt: true });
  const list = await call('j7', 'GET', `/schools/${S}/students/${st.id}/charges`, O);
  const c = list.body.charges.find((x) => x.id === ch.body.id);
  ok('J7a ¥1,234 + 8% paid in full with ¥1,332 cash (all a customer can hand over) leaves nothing owed', c.owedAmount === 0, `gross ${c.grossAmount}; paid ${c.paidAmount}; owed ${c.owedAmount}; status ${c.status}; balances ${JSON.stringify(list.body.balances)}`);
  const st2 = C.bulk[8];
  const ch2 = await call('j7', 'POST', `/schools/${S}/students/${st2.id}/charges`, O, { description: '道着 1,234円＋税8%', amount: 123400, dueDate: due, taxExempt: false });
  const pay2 = await call('j7', 'POST', `/schools/${S}/students/${st2.id}/charge-payments`, O, { chargeId: ch2.body.id, amount: 123400, paymentMethod: 'CASH', sendReceipt: true });
  const l2 = await call('j7', 'GET', `/schools/${S}/students/${st2.id}/charges`, O);
  info('J7b ¥1,234 tax-included charge paid with ¥1,234: owed', JSON.stringify(l2.body.charges.find((x) => x.id === ch2.body.id) && { owed: l2.body.charges.find((x) => x.id === ch2.body.id).owedAmount, tax: l2.body.charges.find((x) => x.id === ch2.body.id).taxAmount }));
  const mb = await call('j7', 'GET', `/schools/${S}/charge-reports/member-balances`, O);
  info('J7c member balances report rows for these two', JSON.stringify(mb.body.items?.filter((r) => [st.id, st2.id].includes(r.studentId))));
  const ns = await db.notification.findMany({ where: { userId: st.id }, select: { title: true, body: true } });
  info('J7d notices to the payer', JSON.stringify(ns));
  out.j7 = { charge: ch.body.id, student: st.id, owed: c.owedAmount, pay: pay.status };
}

fs.writeFileSync(new URL('./jp-money-out.json', import.meta.url), JSON.stringify(out, null, 1));
save();
await db.$disconnect();
