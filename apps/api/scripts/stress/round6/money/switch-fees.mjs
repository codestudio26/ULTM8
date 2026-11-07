// Attack S: plan switch (Decisions 435 item 9, 436 items 8 and 13, 438
// item 2, 441 item 3, 443 item 4), joining fees (435 items 1-6, 436 item 10),
// the card surcharge (406), refunds of the new plan types, BRL rounding.
import { call, must, db, rec, expect, makeMember, job, series, charges, d, todayIn, backdate, buyMonthly, setStripeReady, fakeCalls, stripeWebhook, saveOut, FAKE } from './lib.mjs';
import { school, done } from './common.mjs';

const A = 'switch-fees';
const rd = await school('ready');
const br = await school('br');
const code = (r) => r.body?.error?.code ?? r.body?.code;
const wait = async (fn, n = 40) => { for (let i = 0; i < n; i++) { const x = await fn(); if (x) return x; await new Promise((r) => setTimeout(r, 250)); } return null; };
await db.cardSurchargeCountry.upsert({ where: { countryCode: 'GB' }, create: { countryCode: 'GB' }, update: {} });
await must('surcharge', 'PUT', `/schools/${rd.id}/card-surcharge`, rd.owner.tok, { enabled: true, bps: 200, legalConfirmed: true });

/** A saved card, as Stripe's setup Checkout leaves it (a customer with a
 *  default card), written where the setup webhook writes it. */
async function saveCard(member, s) {
  const cus = await (await fetch(`${FAKE}/v1/customers`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=x%40y.test' })).json();
  await fetch(`${FAKE}/v1/customers/${cus.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'invoice_settings[default_payment_method]=pm_fake123' });
  await db.studentPaymentMethod.create({ data: { studentId: member.id, schoolId: s.id, stripeCustomerId: cus.id } });
}
async function payHosted(s, member, planId, extra = {}) {
  const h = await must('hosted', 'POST', `/membership-plans/${planId}/purchase`, member.tok, { useHostedCheckout: true, ...extra });
  const cs = h.checkoutUrl.split('/').pop();
  const paid = await (await fetch(`${FAKE}/__checkout/${cs}/pay`, { method: 'POST' })).json();
  await stripeWebhook({ id: `evt_${Date.now()}${Math.random().toString(16).slice(2, 7)}`, object: 'event', type: 'payment_intent.succeeded', account: s.acct, data: { object: paid.payment_intent } });
  const tx = await wait(async () => { const t = await db.transaction.findUnique({ where: { id: h.transactionId } }); return t?.status !== 'PENDING' ? t : null; });
  return { h, paid, tx };
}

// --- Plan switch into a full plan, at the card School ---------------------------
const tag = Date.now().toString(36);
const full = await must('full', 'POST', `/schools/${rd.id}/membership-plans`, rd.owner.tok, { type: 'CLASS_PACK', title: `Full pack ${tag}`, price: 4000, currency: 'GBP', classesIncluded: 5, expiryDurationDays: 60, memberLimit: 1 });
const roomy = await must('roomy', 'POST', `/schools/${rd.id}/membership-plans`, rd.owner.tok, { type: 'CLASS_PACK', title: `Roomy pack ${tag}`, price: 4001, currency: 'GBP', classesIncluded: 5, expiryDurationDays: 60 });
const weekFull = await must('wf', 'POST', `/schools/${rd.id}/membership-plans`, rd.owner.tok, { type: 'WEEKLY_PASS', title: `Week to full ${tag}`, price: 1500, currency: 'GBP', expiryDurationDays: 7, switchToPlanId: full.id });
const weekRoomy = await must('wr', 'POST', `/schools/${rd.id}/membership-plans`, rd.owner.tok, { type: 'WEEKLY_PASS', title: `Week to roomy ${tag}`, price: 1500, currency: 'GBP', expiryDurationDays: 7, switchToPlanId: roomy.id });
const filler = await makeMember(rd, 'Filler', 'Full');
await must('sell full', 'POST', `/schools/${rd.id}/students/${filler.id}/memberships/sell`, rd.owner.tok, { membershipPlanId: full.id, paymentMethod: 'CASH' });
const x = await makeMember(rd, 'Xena', 'Switch');
const y = await makeMember(rd, 'Yuri', 'Switch');
const z = await makeMember(rd, 'Zara', 'Switch');
for (const p of [x, y, z]) await saveCard(p, rd);
const bx = await payHosted(rd, x, weekFull.id, { agreeToPlanSwitch: true });
const by = await payHosted(rd, y, weekRoomy.id, { agreeToPlanSwitch: true });
const bz = await payHosted(rd, z, weekRoomy.id, { agreeToPlanSwitch: true });
const memOf = (p, planId) => db.membership.findFirst({ where: { studentId: p.id, membershipPlanId: planId }, orderBy: { createdAt: 'desc' } });
const mx = await memOf(x, weekFull.id); const my = await memOf(y, weekRoomy.id); const mz = await memOf(z, weekRoomy.id);
rec(A, 'S0 three members bought a week that switches (agreed), with a saved card', mx?.switchToPlanId && my?.switchToPlanId && mz?.switchToPlanId ? 'PASS' : 'FAIL', { x: mx?.switchToPlanId === full.id, y: my?.switchToPlanId === roomy.id, z: !!mz?.switchToPlanId, lines: bx.paid?.lines });
// Seven days before: the notice.
for (const m of [mx, my, mz]) await db.membership.update({ where: { id: m.id }, data: { expiryDate: new Date(Date.now() + 3 * 86400e3) } });
await job('plan-switch');
await new Promise((r) => setTimeout(r, 1500));
const notes = await db.notification.findMany({ where: { userId: x.id, title: { not: 'Payment confirmed' } }, select: { title: true, body: true } });
const nb = notes.find((n) => /saved card/.test(n.body))?.body ?? '';
expect(A, 'S1 the 7-day notice says a full next plan ends it with nothing charged, with the surcharge in the amount', /if .* is full, it simply ends and nothing is charged/.test(nb) && /40\.80 GBP/.test(nb), nb || notes);
// Z's School stops being ready before the switch day (Decision 443 item 4).
// (Same School: flip, switch, flip back. X and Y are switched in the same run.)
for (const m of [mx, my, mz]) await db.membership.update({ where: { id: m.id }, data: { expiryDate: new Date(Date.now() - 60e3), switchNoticeSentAt: new Date(Date.now() - 86400e3) } });
const piBefore = (await fakeCalls())['POST /v1/payment_intents'] ?? 0;
await job('plan-switch');
const ax = await db.membership.findUnique({ where: { id: mx.id } }); const ay = await db.membership.findUnique({ where: { id: my.id } });
const piAfter = (await fakeCalls())['POST /v1/payment_intents'] ?? 0;
const xNew = await db.membership.findFirst({ where: { studentId: x.id, membershipPlanId: full.id } });
const yTx = await db.transaction.findFirst({ where: { studentId: y.id, membershipPlanId: roomy.id } });
expect(A, 'S2 switch into a full plan: the membership simply ends, nothing charged, no new membership', ax.switchOutcome === 'NOT_SOLD' && !xNew, { outcome: ax.switchOutcome, newMembership: !!xNew });
expect(A, 'S3 switch into a plan with room: switched, charged price + 2% surcharge to the saved card', ay.switchOutcome === 'SWITCHED' && yTx?.amount === 4001 && yTx?.surchargeAmount === 80 && yTx?.status === 'SUCCESSFUL', { outcome: ay.switchOutcome, tx: yTx && { amount: yTx.amount, surcharge: yTx.surchargeAmount, status: yTx.status }, offSessionCalls: piAfter - piBefore });
const az0 = await db.membership.findUnique({ where: { id: mz.id } });
rec(A, 'S3b (Z was switched in the same run, ready)', 'NOTE', az0.switchOutcome);

// Not ready on switch day: a fresh member Z2.
const z2 = await makeMember(rd, 'Zed', 'Late');
await saveCard(z2, rd);
await payHosted(rd, z2, weekRoomy.id, { agreeToPlanSwitch: true });
const mz2 = await memOf(z2, weekRoomy.id);
await setStripeReady(rd.acct, false);
await db.membership.update({ where: { id: mz2.id }, data: { expiryDate: new Date(Date.now() + 3 * 86400e3) } });
await job('plan-switch');
await new Promise((r) => setTimeout(r, 2000));
const n2 = (await db.notification.findMany({ where: { userId: z2.id }, select: { title: true, body: true } })).find((n) => /saved card/.test(n.body));
rec(A, 'S4a not ready 7 days before the switch: the notice the member gets', n2 && /charged to your saved card/.test(n2.body) ? 'NOTE' : 'NOTE', n2?.body ?? 'no notice');
await db.membership.update({ where: { id: mz2.id }, data: { expiryDate: new Date(Date.now() - 60e3), switchNoticeSentAt: new Date(Date.now() - 86400e3) } });
const pi2b = (await fakeCalls())['POST /v1/payment_intents'] ?? 0;
await job('plan-switch');
const pi2a = (await fakeCalls())['POST /v1/payment_intents'] ?? 0;
const az2 = await db.membership.findUnique({ where: { id: mz2.id } });
expect(A, 'S4 not ready on switch day: ends NO_CARD, the saved card isn\'t charged', az2.switchOutcome === 'NO_CARD' && pi2a === pi2b, { outcome: az2.switchOutcome, stripeCalls: pi2a - pi2b });
await setStripeReady(rd.acct, true);

// --- Plan switch at the no-card School is hidden / ignored ----------------------
const brSw = await call('POST', `/schools/${br.id}/membership-plans`, br.owner.tok, { type: 'WEEKLY_PASS', title: 'Semana', price: 3990, currency: 'BRL', expiryDurationDays: 7, switchToPlanId: br.plans.next });
expect(A, 'S5 no-card School: a plan can\'t be set to switch', brSw.status === 400 && code(brSw) === 'SWITCH_NEEDS_CARDS', { status: brSw.status, code: code(brSw) });
const legacy = await must('wk', 'POST', `/schools/${br.id}/membership-plans`, br.owner.tok, { type: 'WEEKLY_PASS', title: `Semana ${tag}`, price: 3990, currency: 'BRL', expiryDurationDays: 7 });
await db.membershipPlan.update({ where: { id: legacy.id }, data: { switchToPlanId: br.plans.next } }); // set before #509 hid it
const lm = await makeMember(br, 'Lia', 'Legado');
const lb = await must('buy', 'POST', `/membership-plans/${legacy.id}/purchase`, lm.tok, { agreeToPlanSwitch: true });
const lt = await db.transaction.findUnique({ where: { id: lb.transactionId } });
await must('confirm', 'PATCH', `/transactions/${lb.transactionId}/confirm`, br.owner.tok, {});
const lmem = await db.membership.findFirst({ where: { studentId: lm.id, membershipPlanId: legacy.id } });
expect(A, 'S6 no-card School: an old plan with a next plan, bought with "agree", never switches', !lt.planSwitchToPlanId && !lmem?.switchToPlanId, { txSwitch: lt.planSwitchToPlanId, memSwitch: lmem?.switchToPlanId });
const pv = await call('GET', `/membership-plans/${legacy.id}`, lm.tok);
rec(A, 'S6b what the member app reads for that plan', 'NOTE', { switchToPlanId: pv.body?.switchToPlanId, switchToPlan: pv.body?.switchToPlan ?? null });

// --- Joining fee + surcharge on a card one-off, at the card School ----------------
const jf = await must('jf', 'POST', `/schools/${rd.id}/membership-plans`, rd.owner.tok, { type: 'CLASS_PACK', title: `Fee pack ${tag}`, price: 4999, currency: 'GBP', classesIncluded: 5, expiryDurationDays: 60, joiningFee: 1999, joiningFeeRefundable: false });
const jm = await makeMember(rd, 'Jo', 'Fee');
const jb = await payHosted(rd, jm, jf.id);
const lines = jb.paid?.lines ?? [];
const sum = lines.reduce((n, l) => n + l.amount, 0);
expect(A, 'S7 card one-off with a joining fee: lines plan 49.99 + fee 19.99 + 2% surcharge on both (1.40), total charged = sum', lines.length === 3 && lines[0].amount === 4999 && lines[1].amount === 1999 && lines[2].amount === 140 && jb.paid.payment_intent.amount === sum && jb.tx?.amount === 6998 && jb.tx?.surchargeAmount === 140, { lines, charged: jb.paid?.payment_intent?.amount, tx: jb.tx && { amount: jb.tx.amount, fee: jb.tx.joiningFeeAmount, sur: jb.tx.surchargeAmount } });
const jfee2 = await call('GET', `/membership-plans/${jf.id}/joining-fee`, jm.tok);
expect(A, 'S8 a second plan at the same School: no joining fee', jfee2.status === 200 && (jfee2.body?.amount ?? jfee2.body?.joiningFee ?? 0) === 0, jfee2.body);
// Card Subscription with a joining fee: the first invoice carries the fee once.
const subFee = await must('subfee', 'POST', `/schools/${rd.id}/membership-plans`, rd.owner.tok, { type: 'SUBSCRIPTION', title: `Monthly fee ${tag}`, price: 3999, currency: 'GBP', joiningFee: 1001, joiningFeeRefundable: true });
const sm = await makeMember(rd, 'Sue', 'Sub');
const sb = await call('POST', `/membership-plans/${subFee.id}/purchase`, sm.tok, {});
const st = sb.body?.transactionId ? await db.transaction.findUnique({ where: { id: sb.body.transactionId } }) : null;
expect(A, 'S9 card Subscription with a joining fee: order = price + fee; surcharge = 2% of each (80 + 20)', st?.amount === 3999 + 1001 && st?.joiningFeeAmount === 1001 && st?.surchargeAmount === 100, { status: sb.status, err: sb.body?.error?.message, tx: st && { amount: st.amount, fee: st.joiningFeeAmount, sur: st.surchargeAmount } });

// --- Desk refunds on the new plan type, at the no-card School --------------------
const rm = await makeMember(br, 'Rui', 'Reembolso');
const { m: rmem, txId: rtx } = await buyMonthly(br, rm, br.plans.monthly);
const rtxRow = await db.transaction.findUnique({ where: { id: rtx } });
const tooMuch = await call('POST', `/transactions/${rtx}/refund`, br.owner.tok, { amount: rtxRow.amount, notes: 'tudo' });
const ok1 = await call('POST', `/transactions/${rtx}/refund`, br.owner.tok, { amount: rtxRow.amount - rtxRow.joiningFeeAmount, notes: 'mensalidade', endMembership: true });
const rmem2 = await db.membership.findUnique({ where: { id: rmem.id } });
const rsr = await series(rmem.id);
expect(A, 'S10 desk refund of a monthly first payment: the non-refundable joining fee can\'t be refunded', tooMuch.status === 400 && code(tooMuch) === 'REFUND_MORE_THAN_LEFT' && ok1.status < 300, { amount: rtxRow.amount, fee: rtxRow.joiningFeeAmount, tooMuch: [tooMuch.status, code(tooMuch)], ok: [ok1.status, code(ok1), ok1.body?.error?.message] });
const rsrNow = await series(rmem.id);
const rsch = await call('GET', `/schools/${br.id}/students/${rm.id}/recurring-charges`, br.owner.tok);
const rrow = (Array.isArray(rsch.body) ? rsch.body : rsch.body?.items ?? rsch.body?.recurringCharges ?? []).find?.((r) => r.id === rsrNow?.id);
rec(A, 'S11a right after "refund and end the membership": the monthly series on the member\'s page', rsrNow?.endDate || rsrNow?.stoppedAt || !rsrNow?.nextDate ? 'PASS' : 'NOTE', { membership: rmem2.status, series: rsrNow && { next: d(rsrNow.nextDate), end: d(rsrNow.endDate), stopped: rsrNow.stoppedReason }, screen: rrow ? { nextDate: rrow.nextDate, status: rrow.status, endDate: rrow.endDate } : rsch.status });
// The next billing day comes (the job runs on that day: runSeries with that day's clock).
const { runSeries } = (await import('./common.mjs')).dist('charges/recurring-occurrences');
const { jobsDb } = await import('./common.mjs');
if (rsrNow?.nextDate) await runSeries(jobsDb, rsrNow.id, new Date(rsrNow.nextDate.getTime() + 15 * 3600e3));
const rch = rsrNow ? await charges(rsrNow.id) : [];
expect(A, 'S11 refunded with "end the membership": the next month is not billed to the balance', rmem2.status === 'EXPIRED' && rch.length === 0, { membership: rmem2.status, charged: rch.map((c) => d(c.occurrenceDate)), after: await series(rmem.id).then((r) => r && { next: d(r.nextDate), end: d(r.endDate) }) });

// --- BRL rounding with an inclusive tax, and a % late fee --------------------------
const taxSet = await call('PATCH', `/schools/${br.id}`, br.owner.tok, { taxRateBasisPoints: 500, taxInclusive: true, taxCountry: 'BR' });
const tm = await makeMember(br, 'Tita', 'Imposto');
const { m: tmem } = await buyMonthly(br, tm, br.plans.monthly);
await backdate(tmem.id, 32);
await job('charge-recurring');
const tch = await charges((await series(tmem.id)).id);
const c0 = tch[0];
expect(A, 'S12 BRL month with 5% tax included: net + tax = 189.90, whole centavos', !!c0 && c0.grossAmount === 18990 && c0.netAmount + c0.taxAmount === c0.grossAmount && Number.isInteger(c0.taxAmount), { taxPatch: taxSet.status, err: taxSet.body?.error?.message, charge: c0 && { gross: c0.grossAmount, net: c0.netAmount, tax: c0.taxAmount, lines: c0.taxLines } });
await call('PUT', `/schools/${br.id}/late-fees`, br.owner.tok, { enabled: true, type: 'PERCENT', percentBps: 250, graceDays: 0, legalConfirmed: true });
await db.school.update({ where: { id: br.id }, data: { lateFeeEnabledAt: new Date(Date.now() - 200 * 86400e3) } });
await job('late-fee');
const lfee = c0 ? await db.charge.findFirst({ where: { lateFeeForChargeId: c0.id } }) : null;
expect(A, 'S13 2.5% late fee on 189.90 = 4.75 (whole centavos, BRL)', lfee?.grossAmount === 475 && lfee?.currency === 'BRL', { fee: lfee && { gross: lfee.grossAmount, net: lfee.netAmount, tax: lfee.taxAmount, cur: lfee.currency, overdue: lfee.lateFeeOverdueAmount } });
await call('PATCH', `/schools/${br.id}`, br.owner.tok, { taxRateBasisPoints: 0 });
await call('PUT', `/schools/${br.id}/late-fees`, br.owner.tok, { enabled: true, type: 'FIXED', fixedAmount: 1000, graceDays: 3, legalConfirmed: true });

saveOut('switch-fees-out.json');
await done();
