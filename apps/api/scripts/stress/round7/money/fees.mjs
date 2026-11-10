// Round 7, D check 1: the "Fees" revenue line (#530, Decision 449 item 10;
// Decision 450 items 6-7). A UK School (cards, 2% surcharge) whose time zone
// is Tokyo or São Paulo, so month boundaries differ from UTC. Fees are made
// for real through the API (late cancellation, no-show, freeze), with a saved
// card, without one, declined and paid later, refunded in full and in part in
// "Stripe's Dashboard" (the fake), then a second currency. Then the billing
// overview, the Transactions summary and the rows are reconciled to the cent.
//   TZ_SCHOOL=Asia/Tokyo node fees.mjs     (default Asia/Tokyo)
import crypto from 'crypto';
import { DateTime } from 'luxon';
import { call, must, db, rec, expect, saveOut, makeSchool, makeMember, plan, signIn, stepUp, stripeWebhook, runJob, FAKE } from './lib.mjs';

const A = 'fees';
const TZ = process.env.TZ_SCHOOL || 'Asia/Tokyo';
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 300)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await db.cardSurchargeCountry.upsert({ where: { countryCode: 'GB' }, create: { countryCode: 'GB' }, update: {} });
const s = await makeSchool('ready', `D7 Fees ${TZ.split('/')[1]}`, { tz: TZ });
const O = () => s.owner.tok;
await must('settings', 'PATCH', `/schools/${s.id}`, O(), { joiningFeesEnabled: true, noShowFee: 500, freezeFeeAmount: 700 });
await must('surcharge', 'PUT', `/schools/${s.id}/card-surcharge`, O(), { enabled: true, bps: 200, legalConfirmed: true });
// No waiver at this School: switch "waiver before booking" off so booking isn't refused for that.
const sch = await db.school.findUnique({ where: { id: s.id } });
const wKey = Object.keys(sch).find((k) => /waiver/i.test(k) && /book|checkin|required/i.test(k) && typeof sch[k] === 'boolean');
if (wKey) await db.school.update({ where: { id: s.id }, data: { [wKey]: false } });
await db.school.update({ where: { id: s.id }, data: { freezeMaxDaysPer12Months: 365 } });
const week = await plan(s, { type: 'WEEKLY_PASS', title: 'Week', price: 1500, expiryDurationDays: 30, joiningFee: 2500, joiningFeeRefundable: false });
rec(A, 'setup', 'NOTE', { school: s.id, tz: TZ, acct: s.acct, ready: s.readyResult });

async function saveCard(p) {
  const ss = await must('setup session', 'POST', `/schools/${s.id}/payment-methods/setup-session`, p.tok, {});
  const cs = ss.checkoutUrl.split('/').pop();
  await (await fetch(`${FAKE}/__checkout/${cs}/save-card`, { method: 'POST' })).json();
  await stripeWebhook({ id: `evt_cs_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'checkout.session.completed', account: s.acct, data: { object: { id: cs, object: 'checkout.session', mode: 'setup' } } });
  return waitFor(async () => { const r = await call('GET', `/schools/${s.id}/payment-methods/me`, p.tok); return r.status === 200 && r.body?.last4 ? r.body : null; });
}
async function buyWeek(p, card = true) {
  if (card) return call('POST', `/membership-plans/${week.id}/purchase`, p.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(p) });
  return call('POST', `/schools/${s.id}/students/${p.id}/memberships/sell`, O(), { membershipPlanId: week.id, paymentMethod: 'CASH' });
}
async function mkClass(title, startInMin, extra = {}) {
  const start = new Date(Date.now() + startInMin * 60e3);
  return must('class', 'POST', `/schools/${s.id}/classes`, O(), { branchId: s.branch.id, title, activities: ['BJJ'], startDate: start.toISOString(), endDate: new Date(start.getTime() + 3600e3).toISOString(), membershipInclusion: true, capacity: 30, ...extra });
}
/** A late cancellation: booked, the refund cutoff moved into the past, cancelled by the member. */
async function lateCancel(p, fee) {
  const cls = await mkClass(`Late ${fee}`, 180, { cancellationCharge: fee });
  const b = await call('POST', `/classes/${cls.id}/book`, p.tok, {});
  await db.class.update({ where: { id: cls.id }, data: { refundFeeDate: new Date(Date.now() - 60e3) } });
  const c = await call('PATCH', `/bookings/${b.body?.id}/cancel`, p.tok, {});
  const c2 = c.status === 404 ? await call('POST', `/bookings/${b.body?.id}/cancel`, p.tok, {}) : c;
  const bk = await db.booking.findUnique({ where: { id: b.body?.id ?? '00000000-0000-0000-0000-000000000000' } });
  const tx = await db.transaction.findFirst({ where: { bookingId: b.body?.id ?? '' } });
  return { book: b.status, bookErr: b.body?.error?.message, cancel: c2.status, cancelErr: c2.body?.error?.message, outcome: bk?.cancellationChargeOutcome, tx };
}
async function noShow(p) {
  const cls = await mkClass('No-show', 15);
  const b = await call('POST', `/classes/${cls.id}/book`, p.tok, {});
  await db.class.update({ where: { id: cls.id }, data: { startDate: new Date(Date.now() - 2 * 3600e3), endDate: new Date(Date.now() - 3600e3) } });
  await runJob('booking-no-show-processing');
  const bk = await waitFor(async () => { const x = await db.booking.findFirst({ where: { classId: cls.id, studentId: p.id } }); return x?.noShowFeeOutcome ? x : null; }, 8000);
  const tx = bk ? await db.transaction.findFirst({ where: { bookingId: bk.id } }) : null;
  return { book: b.status, bookErr: b.body?.error?.message, outcome: bk?.noShowFeeOutcome ?? null, bk, tx };
}
async function freeze(p, dayFrom, dayTo) {
  const mem = await db.membership.findFirst({ where: { studentId: p.id, membershipPlanId: week.id, status: 'ACTIVE' } });
  const d = (n) => DateTime.now().setZone(TZ).plus({ days: n }).toISODate();
  const f = await call('POST', `/schools/${s.id}/memberships/${mem.id}/freezes`, O(), { startsAt: d(dayFrom), endsAt: d(dayTo) });
  const fz = await waitFor(async () => { const x = await db.membershipFreeze.findFirst({ where: { membershipId: mem.id }, orderBy: { createdAt: 'desc' } }); return x?.feeTransactionId ? x : null; }, 8000);
  const tx = fz ? await waitFor(async () => { const t = await db.transaction.findUnique({ where: { id: fz.feeTransactionId } }); return t && t.status !== 'PENDING' || (t?.paymentMethod !== 'STRIPE') ? t : null; }, 8000) : null;
  return { status: f.status, err: f.body?.error?.message, mem, fz, tx };
}
async function dashboardRefund(tx, amount) {
  const pi = await (await fetch(`${FAKE}/v1/payment_intents/${tx.stripePaymentIntentId}`)).json();
  const chId = pi.latest_charge?.id ?? pi.latest_charge;
  let ch = await (await fetch(`${FAKE}/__charges/${chId}/refund`, { method: 'POST', body: JSON.stringify({ amount }) })).json().catch(() => null);
  if (!ch?.id) ch = { id: chId, object: 'charge', payment_intent: pi.id, amount: pi.amount, amount_refunded: amount, refunded: amount >= pi.amount, currency: pi.currency };
  const wh = await stripeWebhook({ id: `evt_rf_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'charge.refunded', account: s.acct, data: { object: ch } });
  await sleep(1500);
  return { webhook: wh.status, after: await db.transaction.findUnique({ where: { id: tx.id } }) };
}

// --- People ---
const carded = await makeMember(s, 'Cara', 'Card');
const card = await saveCard(carded);
const b1 = await buyWeek(carded);
const t1 = await db.transaction.findFirst({ where: { studentId: carded.id, kind: 'MEMBERSHIP' } });
expect(A, 'F0 saved-card purchase with a joining fee and 2% surcharge', b1.status < 300 && t1?.status === 'SUCCESSFUL' && t1.amount === 4000 && t1.joiningFeeAmount === 2500 && t1.surchargeAmount === 80, { card: card?.last4, buy: b1.status, err: b1.body?.error?.message, tx: t1 && { amount: t1.amount, jf: t1.joiningFeeAmount, sur: t1.surchargeAmount, status: t1.status } });

const cardless = await makeMember(s, 'Nora', 'Nocard');
const b2 = await buyWeek(cardless, false);
rec(A, 'F0b no-card member sold a week pass at the desk (cash)', b2.status < 300 ? 'PASS' : 'FAIL', { status: b2.status, err: b2.body?.error?.message });

// --- Fees ---
const lc1 = await lateCancel(carded, 300);
expect(A, 'F1 late cancellation with a saved card: LATE_CANCEL_FEE 300 Successful, no surcharge', lc1.outcome === 'CHARGED' && lc1.tx?.kind === 'LATE_CANCEL_FEE' && lc1.tx.status === 'SUCCESSFUL' && lc1.tx.amount === 300 && (lc1.tx.surchargeAmount ?? 0) === 0, { ...lc1, tx: lc1.tx && { kind: lc1.tx.kind, status: lc1.tx.status, amount: lc1.tx.amount, sur: lc1.tx.surchargeAmount } });
const lc2 = await lateCancel(carded, 313); // declined by the fake (amount ending in 13)
expect(A, 'F2 late cancellation declined: Failed row, not revenue', lc2.outcome === 'FAILED' && lc2.tx?.status === 'FAILED', { outcome: lc2.outcome, tx: lc2.tx && { status: lc2.tx.status, amount: lc2.tx.amount }, book: lc2.book, bookErr: lc2.bookErr });
const lc3 = await lateCancel(cardless, 400);
expect(A, 'F3 late cancellation without a saved card: no row', lc3.outcome === 'NO_SAVED_PAYMENT_METHOD' && !lc3.tx, { outcome: lc3.outcome, tx: !!lc3.tx, book: lc3.book, bookErr: lc3.bookErr, cancel: lc3.cancel, cancelErr: lc3.cancelErr });

const ns1 = await noShow(carded);
expect(A, 'F4 no-show with a saved card: NO_SHOW_FEE 500 Successful, no surcharge (Decision 449 item 4)', ns1.outcome === 'CHARGED' && ns1.tx?.kind === 'NO_SHOW_FEE' && ns1.tx.status === 'SUCCESSFUL' && ns1.tx.amount === 500 && (ns1.tx.surchargeAmount ?? 0) === 0, { book: ns1.book, err: ns1.bookErr, outcome: ns1.outcome, tx: ns1.tx && { status: ns1.tx.status, amount: ns1.tx.amount, sur: ns1.tx.surchargeAmount, billingDate: ns1.tx.billingDate } });
const ns2 = await noShow(cardless);
expect(A, 'F5 no-show without a saved card: no row (Decision 449 item 9)', !ns2.tx && ['NO_SAVED_PAYMENT_METHOD', null].includes(ns2.outcome), { book: ns2.book, err: ns2.bookErr, outcome: ns2.outcome, tx: !!ns2.tx });
// Declined, then Stripe says it was paid after all (the webhook on the same PaymentIntent).
await must('no-show 513', 'PATCH', `/schools/${s.id}`, O(), { noShowFee: 513 });
const ns3 = await noShow(carded);
let ns3paid = null;
if (ns3.bk?.stripeNoShowPaymentIntentId) {
  const pi = await (await fetch(`${FAKE}/v1/payment_intents/${ns3.bk.stripeNoShowPaymentIntentId}`)).json();
  await stripeWebhook({ id: `evt_ns_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'payment_intent.succeeded', account: s.acct, data: { object: { ...pi, status: 'succeeded' } } });
  ns3paid = await waitFor(async () => { const t = await db.transaction.findFirst({ where: { bookingId: ns3.bk.id } }); return t?.status === 'SUCCESSFUL' ? t : null; }, 8000);
}
expect(A, 'F6 no-show declined, then paid later: the row turns Successful (counted once)', ns3.outcome === 'FAILED' && ns3.tx?.status === 'FAILED' && ns3paid?.status === 'SUCCESSFUL', { first: ns3.outcome, row: ns3.tx?.status, pi: ns3.bk?.stripeNoShowPaymentIntentId, later: ns3paid?.status, rows: await db.transaction.count({ where: { bookingId: ns3.bk?.id ?? '' } }) });
await must('no-show 500', 'PATCH', `/schools/${s.id}`, O(), { noShowFee: 500 });

const fz1 = await freeze(carded, 1, 9);
expect(A, 'F7 freeze with a saved card: FREEZE_FEE 700 Successful by card', fz1.status < 300 && fz1.tx?.kind === 'FREEZE_FEE' && fz1.tx.status === 'SUCCESSFUL' && fz1.tx.paymentMethod === 'STRIPE', { status: fz1.status, err: fz1.err, tx: fz1.tx && { status: fz1.tx.status, pm: fz1.tx.paymentMethod, amount: fz1.tx.amount } });
const fz2 = await freeze(cardless, 1, 9);
let fz2paid = null;
if (fz2.tx) { await call('PATCH', `/transactions/${fz2.tx.id}/confirm`, O(), {}); fz2paid = await db.transaction.findUnique({ where: { id: fz2.tx.id } }); }
expect(A, 'F8 freeze without a card: pending desk FREEZE_FEE, then paid at the desk', fz2.status < 300 && fz2.tx?.status === 'PENDING' && fz2paid?.status === 'SUCCESSFUL', { status: fz2.status, err: fz2.err, first: fz2.tx?.status, pm: fz2.tx?.paymentMethod, paid: fz2paid?.status });
// Declined freeze fee (713), then the desk charge is paid.
await must('freeze 713', 'PATCH', `/schools/${s.id}`, O(), { freezeFeeAmount: 713 });
await call('POST', `/schools/${s.id}/freezes/${fz1.fz?.id}/end`, O(), {});
const fz3 = await freeze(carded, 20, 28);
const desk3 = fz3.fz ? await waitFor(async () => { const f = await db.membershipFreeze.findUnique({ where: { id: fz3.fz.id } }); const t = f?.feeTransactionId ? await db.transaction.findUnique({ where: { id: f.feeTransactionId } }) : null; return t && t.paymentMethod !== 'STRIPE' ? t : null; }, 8000) : null;
if (desk3) await call('PATCH', `/transactions/${desk3.id}/confirm`, O(), {});
const fz3rows = fz3.fz ? await db.transaction.findMany({ where: { membershipId: fz3.mem.id, kind: 'FREEZE_FEE', amount: 713 } }) : [];
expect(A, 'F9 freeze fee declined, then paid at the desk: one Failed attempt + one Successful desk row', fz3rows.length === 2 && fz3rows.filter((t) => t.status === 'SUCCESSFUL').length === 1 && fz3rows.some((t) => t.status === 'FAILED'), { status: fz3.status, err: fz3.err, rows: fz3rows.map((t) => `${t.paymentMethod} ${t.status}`) });
await must('freeze 700', 'PATCH', `/schools/${s.id}`, O(), { freezeFeeAmount: 700 });

// --- Refunds in "Stripe's Dashboard" ---
if (lc1.tx?.stripePaymentIntentId) {
  const r = await dashboardRefund(lc1.tx, 100);
  expect(A, 'F10 part refund of a late-cancellation fee (100 of 300): row stays Successful, refunded 100', r.webhook === 200 && r.after.refundedAmount === 100 && r.after.status === 'SUCCESSFUL', { webhook: r.webhook, status: r.after.status, refunded: r.after.refundedAmount });
}
if (ns1.tx?.stripePaymentIntentId) {
  const r = await dashboardRefund(ns1.tx, 500);
  expect(A, 'F11 full refund of a no-show fee: Refunded, kept 0', r.webhook === 200 && r.after.status === 'REFUNDED' && r.after.refundedAmount === 500, { webhook: r.webhook, status: r.after.status, refunded: r.after.refundedAmount });
}
if (fz1.tx?.stripePaymentIntentId) {
  const memBefore = await db.membership.findUnique({ where: { id: fz1.mem.id } });
  const r = await dashboardRefund(fz1.tx, 700);
  const memAfter = await db.membership.findUnique({ where: { id: fz1.mem.id } });
  expect(A, 'F12 full refund of a FREEZE fee: Refunded; the membership it froze is NOT ended', r.webhook === 200 && r.after.status === 'REFUNDED' && memAfter.status === memBefore.status, { webhook: r.webhook, status: r.after.status, refunded: r.after.refundedAmount, membership: `${memBefore.status} -> ${memAfter.status}` });
}
// Part refund of the plan purchase (plan first, then surcharge, joining fee last).
if (t1?.stripePaymentIntentId) {
  const r = await dashboardRefund(t1, 1000);
  expect(A, 'F13 part refund of the plan purchase (1000)', r.webhook === 200 && r.after.refundedAmount === 1000, { status: r.after.status, refunded: r.after.refundedAmount });
}

// --- Month boundaries in the School's zone: move two fee rows to just after
// local midnight on the 1st (previous month in UTC) and to the last minute of
// last month (local). ---
const z = DateTime.now().setZone(TZ);
const firstLocal = z.startOf('month').plus({ minutes: 20 });
const lastPrevLocal = z.startOf('month').minus({ minutes: 20 });
if (lc1.tx) await db.transaction.update({ where: { id: lc1.tx.id }, data: { billingDate: firstLocal.toJSDate() } });
if (fz2.tx) await db.transaction.update({ where: { id: fz2.tx.id }, data: { billingDate: lastPrevLocal.toJSDate() } });
rec(A, 'boundary rows', 'NOTE', { lateFeeAt: firstLocal.toISO(), lateFeeUtc: firstLocal.toUTC().toISO(), deskFreezeAt: lastPrevLocal.toISO(), deskFreezeUtc: lastPrevLocal.toUTC().toISO() });

// --- A second currency: the School changes to EUR, one more fee in EUR. ---
const cc = await call('PATCH', `/schools/${s.id}`, O(), { defaultCurrency: 'EUR' });
let eur = null;
if (cc.status < 300) {
  const weekE = await plan(s, { type: 'WEEKLY_PASS', title: 'Week EUR', price: 1200, expiryDurationDays: 30, currency: 'EUR' });
  const be = await call('POST', `/membership-plans/${weekE.id}/purchase`, carded.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(carded) });
  rec(A, 'F14a EUR plan bought with the saved card', be.status < 300 ? 'PASS' : 'FAIL', { status: be.status, err: be.body?.error?.message });
  const ns4 = await noShow(carded);
  eur = ns4.tx;
  rec(A, 'F14 School switched to EUR; a no-show fee after it', ns4.tx?.currency === 'EUR' ? 'PASS' : 'NOTE', { change: cc.status, outcome: ns4.outcome, tx: ns4.tx && { currency: ns4.tx.currency, amount: ns4.tx.amount, status: ns4.tx.status }, book: ns4.book, err: ns4.bookErr });
} else rec(A, 'F14 School currency change', 'NOTE', { status: cc.status, err: cc.body?.error?.message });

// --- Reconcile ---
function keptRevenue(t) {
  let refunded = Math.max(0, t.refundedAmount ?? 0);
  const fixed = t.joiningFeeRefundable ? 0 : t.joiningFeeAmount ?? 0;
  const fromPrice = Math.min(refunded, t.amount - fixed); refunded -= fromPrice;
  const fromSur = Math.min(refunded, t.surchargeAmount ?? 0); refunded -= fromSur;
  const fromFee = Math.min(refunded, fixed);
  return { price: t.amount - fromPrice - fromFee, surcharge: (t.surchargeAmount ?? 0) - fromSur };
}
const FEES = ['LATE_CANCEL_FEE', 'FREEZE_FEE', 'NO_SHOW_FEE'], MEMS = ['MEMBERSHIP', 'RENEWAL'];
const ov = await call('GET', `/schools/${s.id}/charge-reports/overview`, O());
const sum = await call('GET', `/schools/${s.id}/transactions/summary`, O());
const txs = await db.transaction.findMany({ where: { schoolId: s.id } });
const be = await db.balanceEntry.findMany({ where: { schoolId: s.id, kind: { in: ['PAYMENT', 'REFUND'] } } });
const truth = {};
for (const t of txs) {
  if (!['SUCCESSFUL', 'REFUNDED'].includes(t.status) || !t.currency) continue;
  const cur = t.currency.toUpperCase(), month = DateTime.fromJSDate(t.billingDate, { zone: TZ }).toFormat('yyyy-MM');
  const k = keptRevenue(t);
  const b = ((truth[cur] ||= {})[month] ||= { memberships: 0, fees: 0, surcharges: 0, chargePrice: 0 });
  if (FEES.includes(t.kind)) b.fees += k.price; else if (MEMS.includes(t.kind)) b.memberships += k.price; else b.chargePrice += k.price;
  b.surcharges += k.surcharge;
}
const mismatches = [];
for (const c of ov.body?.currencies ?? []) {
  for (const m of c.revenueByMonth) {
    const t = truth[c.currency]?.[m.month] ?? { memberships: 0, fees: 0, surcharges: 0 };
    if (m.memberships !== t.memberships || m.fees !== t.fees || m.surcharges !== t.surcharges) mismatches.push({ cur: c.currency, month: m.month, report: { mem: m.memberships, fees: m.fees, sur: m.surcharges }, rows: t });
    if (m.total !== m.net + m.memberships + m.fees + m.surcharges) mismatches.push({ cur: c.currency, month: m.month, totalWrong: m });
  }
  const sumF = c.revenueByMonth.reduce((n, m) => n + m.fees, 0);
  if (sumF !== c.fees || c.total !== c.paid + c.memberships + c.fees + c.surcharges) mismatches.push({ cur: c.currency, headline: { fees: c.fees, sumF, total: c.total, paid: c.paid, mem: c.memberships, sur: c.surcharges } });
}
for (const [cur, months] of Object.entries(truth)) for (const [month, t] of Object.entries(months)) {
  if ((t.memberships || t.fees || t.surcharges) && !ov.body?.currencies?.find((c) => c.currency === cur)?.revenueByMonth.find((m) => m.month === month)) mismatches.push({ missingInReport: { cur, month, t } });
}
expect(A, 'R1 overview per currency per month: memberships / fees / surcharges = the rows (kept after refunds), in the School zone', ov.status === 200 && mismatches.length === 0, { mismatches: mismatches.slice(0, 6), truth });
const feesOnly = (ov.body?.currencies ?? []).map((c) => ({ cur: c.currency, fees: c.fees, memberships: c.memberships, surcharges: c.surcharges, paid: c.paid, total: c.total }));
rec(A, 'R1b overview headline', 'NOTE', feesOnly);
// Transactions summary revenue (price only) = memberships + fees + charge payments; surcharges = surcharges.
const sumMis = [];
for (const r of sum.body?.revenue ?? []) {
  const months = Object.values(truth[r.currency] ?? {});
  const want = months.reduce((n, m) => n + m.memberships + m.fees + m.chargePrice, 0);
  const ovc = ov.body?.currencies?.find((c) => c.currency === r.currency);
  const sur = sum.body.surcharges.find((x) => x.currency === r.currency)?.amount ?? 0;
  if (r.amount !== want || (ovc && r.amount !== ovc.memberships + ovc.fees + ovc.paid) || (ovc && sur !== ovc.surcharges)) sumMis.push({ cur: r.currency, summary: r.amount, sumSur: sur, rows: want, overview: ovc && { mem: ovc.memberships, fees: ovc.fees, paid: ovc.paid, sur: ovc.surcharges } });
}
expect(A, 'R2 Transactions summary revenue = overview memberships + fees + charges paid; surcharges agree', sum.status === 200 && sumMis.length === 0, { sumMis, summary: sum.body });
// Transactions summary filtered to this month (School zone) vs the overview's month.
const thisMonth = z.toFormat('yyyy-MM');
const from = z.startOf('month').toISODate(), to = z.endOf('month').toISODate();
const sm = await call('GET', `/schools/${s.id}/transactions/summary?from=${from}&to=${to}`, O());
const gbpMonth = ov.body?.currencies?.find((c) => c.currency === 'GBP')?.revenueByMonth.find((m) => m.month === thisMonth);
const smG = sm.body?.revenue?.find((r) => r.currency === 'GBP')?.amount;
expect(A, 'R3 this month (School zone): Transactions summary from/to = overview month (memberships + fees + net)', smG === (gbpMonth?.memberships ?? 0) + (gbpMonth?.fees ?? 0) + (gbpMonth?.net ?? 0), { from, to, summary: smG, month: gbpMonth, status: sm.status, err: sm.body?.error?.message });
const prev = z.minus({ months: 1 });
const sp = await call('GET', `/schools/${s.id}/transactions/summary?from=${prev.startOf('month').toISODate()}&to=${prev.endOf('month').toISODate()}`, O());
const gbpPrev = ov.body?.currencies?.find((c) => c.currency === 'GBP')?.revenueByMonth.find((m) => m.month === prev.toFormat('yyyy-MM'));
expect(A, 'R4 last month (School zone): the desk freeze fee moved to 23:40 local on the last day counts in last month on both pages', (sp.body?.revenue?.find((r) => r.currency === 'GBP')?.amount ?? 0) === (gbpPrev?.fees ?? 0) + (gbpPrev?.memberships ?? 0) && gbpPrev?.fees === 700, { summary: sp.body?.revenue, month: gbpPrev });
// Late fee on a charge stays under Charges (Decision 450 item 7): no FEE-kind row is ever made for it.
const feeKindsOnCharges = txs.filter((t) => FEES.includes(t.kind) && t.chargeId);
expect(A, 'R5 no fee-kind Transaction is tied to a charge (late fees on charges stay under Charges)', feeKindsOnCharges.length === 0, feeKindsOnCharges.length);
rec(A, 'ledger', 'NOTE', { rows: txs.map((t) => `${t.kind} ${t.status} ${t.currency} ${t.amount}+${t.surchargeAmount} r${t.refundedAmount ?? 0} ${t.billingDate.toISOString()}`), balanceEntries: be.length });
saveOut(`fees-${TZ.replace('/', '_')}-out.json`);
await db.$disconnect();
process.exit(0);
