// Attack R: card payments wait for a ready Stripe account (Decision 442
// item 2, #514; Decision 443 item 4). UK School whose Stripe account is not
// ready, and a UK School whose account flips ready -> not ready -> ready
// through the account.updated webhook.
import { call, must, db, rec, expect, makeMember, job, series, charges, d, todayIn, backdate, setStripeReady, fakeCalls, stripeWebhook, saveOut, signIn, stepUp, FAKE } from './lib.mjs';
import { school, done } from './common.mjs';

const A = 'ready';
const nr = await school('notready');
const rd = await school('ready');
const code = (r) => r.body?.error?.code ?? r.body?.code;
await db.cardSurchargeCountry.upsert({ where: { countryCode: 'GB' }, create: { countryCode: 'GB' }, update: {} });

// --- Not ready School -------------------------------------------------------
const sur = await call('PUT', `/schools/${nr.id}/card-surcharge`, nr.owner.tok, { enabled: true, bps: 200, legalConfirmed: true });
rec(A, 'R0 a not-ready School turns the 2% card surcharge on', sur.status < 300 ? 'NOTE' : 'NOTE', { status: sur.status, body: sur.body?.error?.message ?? sur.body });
const u = await makeMember(nr, 'James', 'Wait');
const hosted = await call('POST', `/membership-plans/${nr.plans.pack}/purchase`, u.tok, { useHostedCheckout: true });
expect(A, 'R1 not ready: hosted Checkout card purchase refused CARD_PAYMENTS_NOT_READY', hosted.status === 400 && code(hosted) === 'CARD_PAYMENTS_NOT_READY', { status: hosted.status, code: code(hosted), msg: hosted.body?.error?.message });
const saved = await call('POST', `/membership-plans/${nr.plans.pack}/purchase`, u.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(u) });
expect(A, 'R2 not ready: saved-card purchase refused CARD_PAYMENTS_NOT_READY', saved.status === 400 && code(saved) === 'CARD_PAYMENTS_NOT_READY', { status: saved.status, code: code(saved), msg: saved.body?.error?.message });
const before = await fakeCalls();
const plain = await call('POST', `/membership-plans/${nr.plans.pack}/purchase`, u.tok, {});
const after = await fakeCalls();
const tp = plain.body?.transactionId ? await db.transaction.findUnique({ where: { id: plain.body.transactionId } }) : null;
expect(A, 'R3 not ready: a plain purchase becomes a cash order, no Stripe call, no surcharge', plain.body?.outcome === 'pending_confirmation' && tp?.paymentMethod === 'CASH' && tp?.surchargeAmount === 0 && (after['POST /v1/payment_intents'] ?? 0) === (before['POST /v1/payment_intents'] ?? 0), { status: plain.status, outcome: plain.body?.outcome, method: tp?.paymentMethod, surcharge: tp?.surchargeAmount, amount: tp?.amount });
const mon = await call('POST', `/membership-plans/${nr.plans.monthly}/purchase`, u.tok, {});
const tm = mon.body?.transactionId ? await db.transaction.findUnique({ where: { id: mon.body.transactionId } }) : null;
let monMem = null;
if (tm) {
  await must('confirm', 'PATCH', `/transactions/${tm.id}/confirm`, nr.owner.tok, {});
  await new Promise((r) => setTimeout(r, 800));
  monMem = await db.membership.findFirst({ where: { studentId: u.id, membershipPlanId: nr.plans.monthly, status: 'ACTIVE' } });
}
const monSr = monMem ? await series(monMem.id) : null;
expect(A, 'R4 not ready: a monthly plan is a cash order, then billed to the balance (like a no-card School)', mon.body?.outcome === 'pending_confirmation' && monMem?.billedToBalance && !!monSr && monSr.unitAmount === 6500, { outcome: mon.body?.outcome, err: mon.body?.error?.message, amount: tm?.amount, billed: monMem?.billedToBalance, series: monSr && { unit: monSr.unitAmount, cur: monSr.currency, next: d(monSr.nextDate) } });
const setup = await call('POST', `/schools/${nr.id}/payment-methods/setup-session`, u.tok, {});
expect(A, 'R5 not ready: saving a card refused', setup.status === 400 && code(setup) === 'CARD_PAYMENTS_NOT_READY', { status: setup.status, code: code(setup) });
const ap = await call('PUT', `/students/${u.id}/charge-auto-pay`, u.tok, { schoolId: nr.id, enabled: true }, { 'x-step-up-token': await stepUp(u) });
rec(A, 'R6 not ready: member turns charge auto-pay on', ap.status < 300 ? 'NOTE' : 'NOTE', { status: ap.status, code: code(ap), msg: ap.body?.error?.message });
const ch = await call('POST', `/schools/${nr.id}/students/${u.id}/charges`, nr.owner.tok, { description: 'Gi', amount: 3000, dueDate: todayIn('Europe/London') });
const co = await call('POST', `/students/${u.id}/charges/checkout`, u.tok, { schoolId: nr.id, chargeId: ch.body?.id });
expect(A, 'R7 not ready: paying charges by card in the app refused', co.status === 400 && code(co) === 'CARD_PAYMENTS_NOT_READY', { charge: ch.status, chargeErr: ch.body?.error?.message, status: co.status, code: code(co), msg: co.body?.error?.message });
const sw = await call('POST', `/schools/${nr.id}/membership-plans`, nr.owner.tok, { type: 'WEEKLY_PASS', title: 'Wk', price: 1500, currency: 'GBP', expiryDurationDays: 7, switchToPlanId: nr.plans.next });
expect(A, 'R8 not ready: a plan can\'t be set to switch (SWITCH_NEEDS_CARDS)', sw.status === 400 && code(sw) === 'SWITCH_NEEDS_CARDS', { status: sw.status, code: code(sw) });
const bps = (await db.$queryRawUnsafe(`SELECT card_surcharge_bps('${nr.id}') AS bps`))[0]?.bps;
const prof = (await db.$queryRawUnsafe(`SELECT * FROM school_card_payments('${nr.id}')`))[0];
expect(A, 'R9 not ready: the surcharge reads 0 and the public profile says no cards', Number(bps ?? 0) === 0 && prof && Object.values(prof).includes(false), { bps, profile: prof });
const u2 = await makeMember(nr, 'Desk', 'Buyer');
const desk = await call('POST', `/schools/${nr.id}/students/${u2.id}/memberships/sell`, nr.owner.tok, { membershipPlanId: nr.plans.monthly2, paymentMethod: 'CASH' });
const deskSr = desk.body?.membership?.id ? await series(desk.body.membership.id) : null;
expect(A, 'R10 not ready: the owner sells a monthly plan at the desk, billed to the balance after', desk.status < 300 && !!deskSr, { status: desk.status, err: desk.body?.error?.message, series: deskSr && d(deskSr.nextDate) });

// --- Ready School: card things made while ready, then Stripe stops being ready -----
const v = await makeMember(rd, 'Ava', 'Card');
const h = await must('hosted', 'POST', `/membership-plans/${rd.plans.pack}/purchase`, v.tok, { useHostedCheckout: true });
const cs = h.checkoutUrl.split('/').pop();
const paid = await (await fetch(`${FAKE}/__checkout/${cs}/pay`, { method: 'POST' })).json();
await stripeWebhook({ id: `evt_${Date.now()}a`, object: 'event', type: 'payment_intent.succeeded', account: rd.acct, data: { object: paid.payment_intent } });
let packTx;
for (let i = 0; i < 40 && packTx?.status !== 'SUCCESSFUL'; i++) { packTx = await db.transaction.findUnique({ where: { id: h.transactionId } }); await new Promise((r) => setTimeout(r, 250)); }
expect(A, 'R11 ready: a hosted Checkout card purchase goes through', packTx?.status === 'SUCCESSFUL', { status: packTx?.status, amount: packTx?.amount, surcharge: packTx?.surchargeAmount });
// A card Subscription while ready.
const sub = await call('POST', `/membership-plans/${rd.plans.monthly2}/purchase`, v.tok, {});
const subTx = sub.body?.transactionId ? await db.transaction.findUnique({ where: { id: sub.body.transactionId } }) : null;
if (subTx?.stripePaymentIntentId) {
  const pi = await (await fetch(`${FAKE}/v1/payment_intents/${subTx.stripePaymentIntentId}`)).json();
  pi.status = 'succeeded';
  await stripeWebhook({ id: `evt_${Date.now()}b`, object: 'event', type: 'payment_intent.succeeded', account: rd.acct, data: { object: pi } });
  for (let i = 0; i < 40; i++) { const t = await db.transaction.findUnique({ where: { id: subTx.id } }); if (t.status !== 'PENDING') break; await new Promise((r) => setTimeout(r, 250)); }
}
const subMem = await db.membership.findFirst({ where: { studentId: v.id, membershipPlanId: rd.plans.monthly2, status: 'ACTIVE' } });
rec(A, 'R12 ready: a card Subscription bought', subMem?.stripeSubscriptionId ? 'PASS' : 'FAIL', { purchase: sub.status, err: sub.body?.error?.message, mem: !!subMem, sub: subMem?.stripeSubscriptionId });
// A saved card (as Stripe's setup Checkout would leave it): a customer with a default card.
const cus = await (await fetch(`${FAKE}/v1/customers`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=x%40y.test' })).json();
await fetch(`${FAKE}/__accounts/${cus.id}`.replace('__accounts', '__accounts'), { method: 'POST', body: '{}' });
await fetch(`${FAKE}/v1/customers/${cus.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'invoice_settings[default_payment_method]=pm_fake123' });
await db.studentPaymentMethod.create({ data: { studentId: v.id, schoolId: rd.id, stripeCustomerId: cus.id } });

// Flip to not ready through account.updated.
const flip1 = await setStripeReady(rd.acct, false);
const pa1 = await call('GET', `/schools/${rd.id}/payment-account`, rd.owner.tok);

expect(A, 'R13 account.updated (not ready): the School stops taking cards', flip1.ready === false && pa1.body?.cardPayments === false, { flip: flip1, cardPayments: pa1.body?.cardPayments });
const h2 = await call('POST', `/membership-plans/${rd.plans.pack}/purchase`, v.tok, { useHostedCheckout: true });
expect(A, 'R14 after the flip: new card purchase refused', h2.status === 400 && code(h2) === 'CARD_PAYMENTS_NOT_READY', { status: h2.status, code: code(h2) });
const sv2 = await call('POST', `/membership-plans/${rd.plans.next}/purchase`, v.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(v) });
expect(A, 'R15 after the flip: saved-card purchase refused (card on file)', sv2.status === 400 && code(sv2) === 'CARD_PAYMENTS_NOT_READY', { status: sv2.status, code: code(sv2) });
const pm = await call('GET', `/schools/${rd.id}/payment-methods/me`, v.tok);
rec(A, 'R16 after the flip: member still sees their saved card', pm.status === 200 ? 'PASS' : 'FAIL', { status: pm.status, body: pm.body });
// Refund the card pack while not ready: through the app's refund (Decision 291 path) — the owner refund endpoint.
const rf = await call('POST', `/transactions/${packTx?.id}/refund`, rd.owner.tok, { amount: 1000, notes: 'partial back' });
rec(A, 'R17 after the flip: refund of an earlier card payment', rf.status < 300 ? 'PASS' : 'NOTE', { status: rf.status, code: code(rf), msg: rf.body?.error?.message });
const pi0 = await (await fetch(`${FAKE}/v1/payment_intents/${packTx?.stripePaymentIntentId}`)).json();
const chg = pi0?.latest_charge?.id ? await (await fetch(`${FAKE}/__charges/${pi0.latest_charge.id}/refund`, { method: 'POST', body: JSON.stringify({ amount: 1000 }) })).json() : null;
const wr = chg ? await stripeWebhook({ id: `evt_rf_${Date.now()}`, object: 'event', type: 'charge.refunded', account: rd.acct, data: { object: chg } }) : null;
let packAfter; for (let i = 0; i < 40; i++) { packAfter = await db.transaction.findUnique({ where: { id: packTx.id } }); if (packAfter.refundedAmount) break; await new Promise((r) => setTimeout(r, 250)); }
expect(A, 'R17b after the flip: a refund made in Stripe for an earlier card payment still reaches the app', wr?.status === 200 && packAfter?.refundedAmount === 1000, { pi: packTx?.stripePaymentIntentId, charge: !!chg, webhook: wr?.status, refunded: packAfter?.refundedAmount });
// Cancel the existing card Subscription while not ready.
const cn = subMem ? await call('POST', `/memberships/${subMem.id}/cancel`, v.tok, {}) : null;
expect(A, 'R18 after the flip: an existing card Subscription can still be cancelled', cn?.status < 300 && !!cn.body?.cancelAt, { status: cn?.status, err: cn?.body?.error?.message });
// Freeze fee while not ready, with a saved card: Decision 443 item 4 says it isn't charged.
await db.school.update({ where: { id: rd.id }, data: { freezeFeeAmount: 500 } });
const callsB = await fakeCalls();
const wk = await must('wk', 'POST', `/schools/${rd.id}/membership-plans`, rd.owner.tok, { type: 'WEEKLY_PASS', title: `Week ${Date.now()}`, price: 1500, currency: 'GBP', expiryDurationDays: 30 });
const w2 = await makeMember(rd, 'Fred', 'Freeze');
const sold = await must('sell', 'POST', `/schools/${rd.id}/students/${w2.id}/memberships/sell`, rd.owner.tok, { membershipPlanId: wk.id, paymentMethod: 'CASH' });
const fz = await call('POST', `/schools/${rd.id}/memberships/${sold.membership.id}/freezes`, rd.owner.tok, { startsAt: todayIn('Europe/London'), endsAt: new Date(Date.now() + 8 * 86400e3).toISOString().slice(0, 10) });
const fzRow = fz.body?.id ? await db.membershipFreeze.findUnique({ where: { id: fz.body.id } }) : null;
const feeTx = fzRow?.feeTransactionId ? await db.transaction.findUnique({ where: { id: fzRow.feeTransactionId } }) : null;
const callsA = await fakeCalls();
rec(A, 'R19 after the flip: the freeze fee (Decision 443 item 4: fees normally taken from a saved card aren\'t charged)', 'NOTE', { freeze: fz.status, err: fz.body?.error?.message, feeTx: feeTx && { status: feeTx.status, method: feeTx.paymentMethod, amount: feeTx.amount }, stripePIcalls: (callsA['POST /v1/payment_intents'] ?? 0) - (callsB['POST /v1/payment_intents'] ?? 0) });
await db.school.update({ where: { id: rd.id }, data: { freezeFeeAmount: null } });
// The monthly plan while not ready: a cash order billed to the balance, at a School that had cards.
const w3 = await makeMember(rd, 'Nina', 'Later');
const mx = await call('POST', `/membership-plans/${rd.plans.monthly}/purchase`, w3.tok, {});
rec(A, 'R20 after the flip: a new member buys the monthly plan (no-card fallback)', mx.body?.outcome === 'pending_confirmation' ? 'PASS' : 'FAIL', { status: mx.status, outcome: mx.body?.outcome, err: mx.body?.error?.message });
let mxMem = null;
if (mx.body?.transactionId) { await call('PATCH', `/transactions/${mx.body.transactionId}/confirm`, rd.owner.tok, {}); await new Promise((r) => setTimeout(r, 800)); mxMem = await db.membership.findFirst({ where: { studentId: w3.id, membershipPlanId: rd.plans.monthly, status: 'ACTIVE' } }); }

// Flip back to ready.
const flip2 = await setStripeReady(rd.acct, true);
const pa2 = await call('GET', `/schools/${rd.id}/payment-account`, rd.owner.tok);
const h3 = await call('POST', `/membership-plans/${rd.plans.pack}/purchase`, v.tok, { useHostedCheckout: true });
expect(A, 'R21 account.updated (ready again): card purchases work again', flip2.ready === true && pa2.body?.cardPayments === true && h3.status < 300 && !!h3.body?.checkoutUrl, { flip: flip2, cardPayments: pa2.body?.cardPayments, purchase: h3.status, code: code(h3) });
const mxSr = mxMem ? await series(mxMem.id) : null;
expect(A, 'R22 the member who joined while not ready stays billed to the balance (kept as built)', !!mxMem?.billedToBalance && !!mxSr && !mxSr.stoppedAt, { billed: mxMem?.billedToBalance, series: mxSr && { next: d(mxSr.nextDate), stopped: mxSr.stoppedAt } });
// An old account.updated delivered late (not ready) after the newer ready one: Stripe can send events out of order.
const evOld = { id: `evt_old_${Date.now()}`, object: 'event', type: 'account.updated', account: rd.acct, created: Math.floor(Date.now() / 1000) - 3600, data: { object: { id: rd.acct, object: 'account', details_submitted: false, charges_enabled: false } } };
await stripeWebhook(evOld);
await new Promise((r) => setTimeout(r, 1500));
const paLate = await db.paymentAccount.findUnique({ where: { id: rd.payAcctId } });
expect(A, 'R23 a late, older account.updated (saying not ready) doesn\'t turn cards off: the state is read live from Stripe', paLate.stripeAccountReady === true, { ready: paLate.stripeAccountReady });

saveOut('ready-out.json');
await done();
