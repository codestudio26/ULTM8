// Round 5, Canada: subscriptions and money over time. ONLY=S1,S2 runs some sections.
import fs from 'fs';
import { C, call, db, webhook, waitFor, note, log, fakeObject, fakeGet, FAKE, sleep, randomUUID, checks, Queue } from './lib-ca.mjs';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const run = (id) => !ONLY.length || ONLY.includes(id);
const { ok, save } = checks('money-ca');
const O = C.owner.tok, S = C.schoolId;
const sec = (d = Date.now()) => Math.floor(d / 1000);
const state = fs.existsSync(new URL('./state.json', import.meta.url)) ? JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url))) : {};
const saveState = () => fs.writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify(state, null, 1));
const pi = async (amount) => (await (await fetch(`${FAKE}/v1/payment_intents`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'stripe-account': C.acct }, body: `amount=${amount}&currency=cad` })).json()).id;

// S0. School settings: tax (BC: GST 5% + PST 7%), late fees, freeze fee.
if (run('S0')) {
  const rates = await call('tax', 'GET', '/tax-rates', O);
  note('S0 tax-rates CA:', (rates.body?.items || rates.body || []).filter?.((r) => r.country === 'CA'));
  const p = await call('school', 'PATCH', `/schools/${S}`, O, { taxCountry: 'CA', taxRateBasisPoints: 1200, taxInclusive: false, taxId: 'GST 123456789 RT0001 / PST-1234-5678', freezeFeeAmount: 2500 });
  note('S0 school tax PATCH', p.status, p.body?.taxRateBasisPoints, p.body?.error);
  const lf = await call('latefee', 'PUT', `/schools/${S}/late-fees`, O, { enabled: true, type: 'FIXED', fixedAmount: 1500, graceDays: 3, legalConfirmed: true });
  note('S0 late fees', lf.status, JSON.stringify(lf.body).slice(0, 200));
  // Montréal: can the Branch take a different tax (QC: GST 5% + QST 9.975%)?
  const b = await call('branch', 'PATCH', `/branches/${C.mtl}`, O, { taxRateBasisPoints: 1498 });
  note('S0 branch tax PATCH', b.status, JSON.stringify(b.body).slice(0, 200));
  const tz = await call('branch-tz', 'PATCH', `/branches/${C.mtl}`, O, { timezone: 'America/Montreal' });
  note('S0 branch timezone America/Montreal', tz.status, JSON.stringify(tz.body).slice(0, 200));
  await call('branch-tz', 'PATCH', `/branches/${C.mtl}`, O, { timezone: 'America/Toronto' });
}

// S1. 60 monthly subscribers (DB, as world.mjs; the fake's Subscription shape is
// too old for the purchase path), each with a fake Stripe subscription + saved card.
if (run('S1')) {
  const subs = [];
  const OFF = Number(process.env.OFF || 0); const who = OFF ? C.adults.slice(OFF, OFF + 60) : [...C.specials.slice(0, 12), ...C.adults.slice(1, 49)];
  for (const st of who) {
    const sub = await fakeObject({ object: 'subscription', status: 'active', items: { object: 'list', data: [{ id: 'si_' + randomUUID().slice(0, 8), price: { id: 'price_x', product: 'prod_x' }, current_period_end: sec() + 20 * 86400 }] }, metadata: {} });
    const cus = await (await fetch(`${FAKE}/v1/customers`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=x' })).json();
    await fetch(`${FAKE}/v1/customers/${cus.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'invoice_settings[default_payment_method]=pm_card_visa' });
    const m = await db.membership.create({ data: { id: randomUUID(), studentId: st.id, schoolId: S, membershipPlanId: C.plans.monthly, frequency: 'RECURRING', stripeSubscriptionId: sub.id, startDate: new Date(Date.now() - 40 * 86400e3) } });
    const firstPi = await pi(18900);
    await db.transaction.create({ data: { id: randomUUID(), schoolId: S, studentId: st.id, paymentAccountId: C.paymentAccountId, membershipPlanId: C.plans.monthly, membershipId: m.id, kind: 'MEMBERSHIP', billingDate: new Date(Date.now() - 40 * 86400e3), amount: 18900, currency: 'CAD', status: 'SUCCESSFUL', paymentMethod: 'STRIPE', stripePaymentIntentId: firstPi, stripeSubscriptionId: sub.id } });
    await db.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: st.id, schoolId: S, stripeCustomerId: cus.id } });
    subs.push({ studentId: st.id, tok: st.tok, name: st.name, membershipId: m.id, sub: sub.id, customer: cus.id });
  }
  state.subs = subs; saveState();
  note('S1 subscribers', subs.length);
}

const invoice = async (sub, amount, { reason = 'subscription_cycle', piId, paid = true, created = sec() } = {}) => fakeObject({
  object: 'invoice', parent: { subscription_details: { subscription: sub, metadata: {} } }, billing_reason: reason, currency: 'cad',
  amount_paid: paid ? amount : 0, amount_due: amount, created, status_transitions: { paid_at: paid ? created : null },
  period_start: created, period_end: created + 30 * 86400, lines: { data: [] },
  payments: { data: piId ? [{ payment: { type: 'payment_intent', payment_intent: piId } }] : [] },
});
const renewals = (mId) => db.transaction.findMany({ where: { membershipId: mId, kind: 'RENEWAL' } });

// S2. Renewals: invoice.paid for 20 members, the same event redelivered 5x, a renewal invoice delivered as 2 events.
if (run('S2')) {
  const subs = state.subs.slice(0, 20);
  state.renewals = [];
  await Promise.all(subs.map(async (s) => {
    const p = await pi(18900);
    const inv = await invoice(s.sub, 18900, { piId: p });
    const evt = `evt_${randomUUID().replace(/-/g, '')}`;
    await Promise.all([1, 2, 3, 4, 5].map(() => webhook('invoice.paid', inv.id, C.acct, evt)));
    await webhook('invoice.paid', inv.id); // a second event for the same invoice
    state.renewals.push({ ...s, invoice: inv.id, pi: p });
  }));
  await sleep(4000);
  const rows = await Promise.all(subs.map((s) => renewals(s.membershipId)));
  const counts = rows.map((r) => r.length);
  ok('S2 one RENEWAL row per invoice (5 redeliveries + a second event)', counts.every((c) => c === 1), `rows per member ${JSON.stringify(counts)}`);
  ok('S2 renewal amount and currency', rows.flat().every((r) => r.amount === 18900 && r.currency === 'CAD' && r.status === 'SUCCESSFUL'), JSON.stringify(rows.flat().slice(0, 1).map((r) => ({ a: r.amount, c: r.currency, s: r.status }))));
  // Does a paid renewal move the membership's expiry / anything the member sees?
  const m = await db.membership.findUnique({ where: { id: subs[0].membershipId } });
  note('S2 membership after renewal', { status: m.status, expiryDate: m.expiryDate, cancelAt: m.cancelAt });
  saveState();
}

// S3. Failed card on renewal (Stripe's retry later succeeds), and out-of-order events.
if (run('S3')) {
  const [a, b] = state.subs.slice(32, 34);
  const invA = await invoice(a.sub, 18913, { paid: false });
  await webhook('invoice.payment_failed', invA.id);
  const failed = await waitFor(async () => (await renewals(a.membershipId)).find((r) => r.status === 'FAILED'));
  ok('S3 failed renewal → FAILED row', !!failed, failed ? `amount ${failed.amount}` : 'no row');
  const mA = await db.membership.findUnique({ where: { id: a.membershipId } });
  note('S3 membership after failed renewal', mA.status);
  // Retry pays it.
  const p = await pi(18913);
  await fetch(`${FAKE}/__disputes/${invA.id}`, { method: 'POST', body: JSON.stringify({ amount_paid: 18913, status_transitions: { paid_at: sec() }, payments: { data: [{ payment: { type: 'payment_intent', payment_intent: p } }] } }) });
  await webhook('invoice.paid', invA.id);
  const paid = await waitFor(async () => (await renewals(a.membershipId)).find((r) => r.status === 'SUCCESSFUL'));
  ok('S3 retry paid → same row SUCCESSFUL', !!paid && (await renewals(a.membershipId)).length === 1, paid ? `${paid.status} ${paid.amount}` : 'none');
  // Out of order: paid first, then a late failure for the same invoice.
  const p2 = await pi(18900);
  const invB = await invoice(b.sub, 18900, { piId: p2 });
  await webhook('invoice.paid', invB.id);
  await waitFor(async () => (await renewals(b.membershipId)).length);
  await webhook('invoice.payment_failed', invB.id);
  await sleep(2000);
  const rb = await renewals(b.membershipId);
  ok('S3 late failure after paid keeps SUCCESSFUL', rb.length === 1 && rb[0].status === 'SUCCESSFUL', JSON.stringify(rb.map((r) => r.status)));
  // A failure that stays unpaid: for the late fee section.
  const c = state.subs[34];
  const invC = await invoice(c.sub, 18900, { paid: false, created: sec(Date.now() - 6 * 86400e3) });
  await webhook('invoice.payment_failed', invC.id);
  const fc = await waitFor(async () => (await renewals(c.membershipId)).find((r) => r.status === 'FAILED'));
  state.failedRenewal = { ...c, invoice: invC.id, txId: fc?.id };
  note('S3 unpaid failed renewal billingDate', fc?.billingDate);
  saveState();
}

// S4. Late fee on the failed renewal and on an overdue charge (job run on the private Redis).
if (run('S4')) {
  const st = state.subs[23];
  // An overdue staff charge: due 6 days ago is refused? Due today then aged in the DB.
  const ch = await call('charge', 'POST', `/schools/${S}/students/${st.studentId}/charges`, O, { description: 'Kimono — Gi A2 (brodé « Académie »)', amount: 12000, dueDate: new Date().toISOString().slice(0, 10) });
  note('S4 charge', ch.status, ch.body && { net: ch.body.netAmount, tax: ch.body.taxAmount, gross: ch.body.grossAmount, rate: ch.body.taxRateBasisPoints, err: ch.body.error });
  if (ch.status < 300) await db.charge.update({ where: { id: ch.body.id }, data: { dueDate: new Date(Date.now() - 6 * 86400e3) } });
  await db.school.update({ where: { id: S }, data: { lateFeeEnabledAt: new Date(Date.now() - 30 * 86400e3) } });
  const q = new Queue('late-fee', { connection: { url: 'redis://localhost:6391' } });
  await q.add('run', {}); await q.close();
  await sleep(6000);
  const fees = await db.charge.findMany({ where: { schoolId: S, OR: [{ lateFeeForChargeId: { not: null } }, { lateFeeForTransactionId: { not: null } }] } });
  note('S4 late fees', fees.map((f) => ({ for: f.lateFeeForChargeId ? 'charge' : 'renewal', unit: f.unitAmount, net: f.netAmount, tax: f.taxAmount, gross: f.grossAmount, cur: f.currency, student: f.studentId === st.studentId ? 'charge-student' : f.studentId === state.failedRenewal?.studentId ? 'renewal-student' : f.studentId })));
  ok('S4 a late fee for the overdue charge and the failed renewal', fees.some((f) => f.lateFeeForChargeId) && fees.some((f) => f.lateFeeForTransactionId), `${fees.length} fees`);
  state.charge = ch.body?.id; saveState();
}

// S5. Medical freeze of a subscriber (injured), with bookings inside the freeze.
if (run('S5')) {
  const st = state.subs[24];
  const start = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 44 * 86400e3).toISOString().slice(0, 10);
  const before = await (await fetch(`${FAKE}/__calls`)).json();
  const r = await call('freeze', 'POST', `/schools/${S}/memberships/${st.membershipId}/freezes`, O, { startsAt: start, endsAt: end });
  const after = await (await fetch(`${FAKE}/__calls`)).json();
  note('S5 freeze', r.status, JSON.stringify(r.body).slice(0, 400));
  const diff = Object.fromEntries(Object.entries(after).filter(([k, v]) => v !== (before[k] || 0)).map(([k, v]) => [k, v - (before[k] || 0)]));
  note('S5 Stripe calls during freeze', diff);
  const fee = r.body?.feeTransactionId ? await db.transaction.findUnique({ where: { id: r.body.feeTransactionId } }) : null;
  const feeCharge = await db.charge.findFirst({ where: { studentId: st.studentId, schoolId: S, description: { contains: 'reeze' } } });
  note('S5 freeze fee', fee && { kind: fee.kind, amount: fee.amount, status: fee.status, method: fee.paymentMethod }, feeCharge && { gross: feeCharge.grossAmount, tax: feeCharge.taxAmount });
  const sub = await fakeGet(st.sub);
  note('S5 fake subscription after freeze', { trial_end: sub.trial_end, proration_behavior: sub.proration_behavior });
  // Second freeze overlapping, and a freeze of 91 days.
  const r2 = await call('freeze', 'POST', `/schools/${S}/memberships/${st.membershipId}/freezes`, O, { startsAt: start, endsAt: end });
  const st2 = state.subs[25];
  const r3 = await call('freeze', 'POST', `/schools/${S}/memberships/${st2.membershipId}/freezes`, O, { startsAt: start, endsAt: new Date(Date.now() + 94 * 86400e3).toISOString().slice(0, 10) });
  const r4 = await Promise.all([1, 2, 3, 4, 5].map(() => call('freeze', 'POST', `/schools/${S}/memberships/${state.subs[26].membershipId}/freezes`, O, { startsAt: start, endsAt: end })));
  const fz = await db.membershipFreeze.count({ where: { membershipId: state.subs[26].membershipId } });
  const feeTx = await db.transaction.count({ where: { membershipId: state.subs[26].membershipId, kind: 'FREEZE_FEE' } });
  ok('S5 overlapping freeze refused; > 90 days refused; 5 clicks make one freeze and one fee', r2.status >= 400 && r3.status >= 400 && fz === 1 && feeTx <= 1, `overlap ${r2.status}, 92 days ${r3.status}, 5 clicks ${JSON.stringify(r4.map((x) => x.status))} → ${fz} freezes, ${feeTx} fee rows`);
  state.frozen = st; saveState();
}

// S6. Plan price change with subscribers: no strategy, MIGRATE double-clicked, GRANDFATHER.
if (run('S6')) {
  const no = await call('price', 'PATCH', `/membership-plans/${C.plans.monthly}`, O, { price: 19900 });
  note('S6 no strategy', no.status, no.body?.error?.message);
  const before = await (await fetch(`${FAKE}/__calls`)).json();
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => call('price', 'PATCH', `/membership-plans/${C.plans.monthly}`, O, { price: 19900, priceChangeStrategy: 'MIGRATE' })));
  await sleep(8000);
  const after = await (await fetch(`${FAKE}/__calls`)).json();
  const diff = Object.fromEntries(Object.entries(after).filter(([k, v]) => v !== (before[k] || 0)).map(([k, v]) => [k, v - (before[k] || 0)]));
  const changes = await db.membershipPlanPriceChange.findMany({ where: { membershipPlanId: C.plans.monthly } });
  ok('S6 MIGRATE clicked 5x at once → one price change, one Stripe Price', changes.length === 1 && (diff['POST /v1/prices'] || 0) <= 1, `codes ${JSON.stringify(rs.map((r) => r.status))}; changes ${changes.length} ${JSON.stringify(changes.map((c) => [c.decision, c.status, c.affectedMembershipCount]))}; stripe ${JSON.stringify(diff)}`);
  const plan = await db.membershipPlan.findUnique({ where: { id: C.plans.monthly } });
  note('S6 plan after', { price: plan.price, stripePriceId: plan.stripePriceId });
  // A renewal after MIGRATE: what amount does ULTM8 record? (Stripe says 19900.)
  const s = state.subs[30];
  const p = await pi(19900);
  const inv = await invoice(s.sub, 19900, { piId: p });
  await webhook('invoice.paid', inv.id);
  const r = await waitFor(async () => (await renewals(s.membershipId))[0]);
  note('S6 renewal after migrate', r && { amount: r.amount, status: r.status });
  // GRANDFATHER on the family plan (no subscribers) and on monthly again.
  const g = await call('price', 'PATCH', `/membership-plans/${C.plans.monthly}`, O, { price: 20900, priceChangeStrategy: 'GRANDFATHER' });
  note('S6 grandfather', g.status, g.body?.price ?? g.body?.error);
  const list = await call('pc', 'GET', `/membership-plans/${C.plans.monthly}/price-changes`, O);
  note('S6 price-change log', list.status, (list.body || []).map?.((c) => `${c.decision} ${c.oldPrice}->${c.newPrice} ${c.status} n=${c.affectedMembershipCount}`));
}

// S7. Archive a plan with active members: renewals keep coming, purchase refused, list.
if (run('S7')) {
  const a = await call('archive', 'POST', `/membership-plans/${C.plans.monthly}/archive`, O, {});
  const cnt = await call('count', 'GET', `/membership-plans/${C.plans.monthly}/active-count`, O);
  note('S7 archive', a.status, 'active-count', cnt.body);
  const s = state.subs[31];
  const p = await pi(18900);
  const inv = await invoice(s.sub, 18900, { piId: p });
  await webhook('invoice.paid', inv.id);
  const r = await waitFor(async () => (await renewals(s.membershipId))[0]);
  ok('S7 a renewal on an archived plan is still recorded', !!r, r ? `${r.status} ${r.amount}` : 'none');
  const buy = await call('buy', 'POST', `/membership-plans/${C.plans.monthly}/purchase`, C.adults[60].tok, {});
  ok('S7 an archived plan cannot be bought', buy.status === 400, `${buy.status}`);
  await call('unarchive', 'POST', `/membership-plans/${C.plans.monthly}/unarchive`, O, {});
}

// S8. Refunds made in the Stripe dashboard on renewals: partial, then full.
if (run('S8')) {
  const [a, b] = state.renewals.slice(0, 2);
  const chA = await fakeObject({ object: 'charge', payment_intent: a.pi, amount: 18900, amount_refunded: 5000, currency: 'cad', refunded: false });
  await webhook('charge.refunded', chA.id);
  await sleep(2500);
  const tA = (await renewals(a.membershipId))[0];
  const mA = await db.membership.findUnique({ where: { id: a.membershipId } });
  ok('S8 partial dashboard refund: refundedAmount 5000, row Successful, membership live', tA.refundedAmount === 5000 && tA.status === 'SUCCESSFUL' && mA.status === 'ACTIVE', `${tA.status} refunded ${tA.refundedAmount}; membership ${mA.status}`);
  const chB = await fakeObject({ object: 'charge', payment_intent: b.pi, amount: 18900, amount_refunded: 18900, currency: 'cad', refunded: true });
  await webhook('charge.refunded', chB.id);
  await sleep(3000);
  const tB = (await renewals(b.membershipId))[0];
  const mB = await db.membership.findUnique({ where: { id: b.membershipId } });
  const subB = await fakeGet(b.sub);
  ok('S8 full dashboard refund of a renewal: Refunded, membership Expired, subscription cancelled', tB.status === 'REFUNDED' && mB.status === 'EXPIRED' && subB.status === 'canceled', `${tB.status}; membership ${mB.status}; stripe sub ${subB.status}`);
  // Refund that later fails: lower the total.
  await fetch(`${FAKE}/__disputes/${chA.id}`, { method: 'POST', body: JSON.stringify({ amount_refunded: 0 }) });
  await webhook('charge.refunded', chA.id);
  await sleep(2000);
  note('S8 after refund reversal', (await renewals(a.membershipId))[0].refundedAmount);
}

// S9. Chargeback on a renewal (lost).
if (run('S9')) {
  const c = state.renewals[2];
  const dp = await (await fetch(`${FAKE}/__disputes`, { method: 'POST', body: JSON.stringify({ payment_intent: c.pi, amount: 18900, currency: 'cad' }) })).json();
  await webhook('charge.dispute.created', dp.id);
  const opened = await waitFor(async () => (await renewals(c.membershipId))[0]?.status === 'DISPUTED');
  await fetch(`${FAKE}/__disputes/${dp.id}`, { method: 'POST', body: JSON.stringify({ status: 'lost' }) });
  await webhook('charge.dispute.closed', dp.id);
  await sleep(3000);
  const t = (await renewals(c.membershipId))[0];
  const m = await db.membership.findUnique({ where: { id: c.membershipId } });
  const sub = await fakeGet(c.sub);
  ok('S9 lost chargeback on a renewal: Disputed, membership ended, subscription cancelled', opened && t.status === 'DISPUTED' && m.status === 'EXPIRED' && sub.status === 'canceled', `opened ${opened}; ${t.status} disputed ${t.disputedAmount}; membership ${m.status}; stripe sub ${sub.status}`);
}

// S10. Cancel subscription (member asks), cancellation charge on a late-cancelled booking (Decision 389), declined card.
if (run('S10')) {
  const s = state.subs[40];
  const c = await call('cancel', 'POST', `/memberships/${s.membershipId}/cancel`, s.tok, {});
  note('S10 member cancels', c.status, c.body?.cancelAt, c.body?.error);
}

// S11. Transactions page: list, filters, summary, accents.
if (run('S11')) {
  const l = await call('tx', 'GET', `/schools/${S}/transactions?limit=100`, O);
  const items = l.body?.items || [];
  note('S11 transactions', l.status, items.length, 'kinds', [...new Set(items.map((i) => i.kind))]);
  const accent = items.filter((i) => /[^\x00-\x7F]/.test(i.studentFirstName + i.studentSurname)).slice(0, 4).map((i) => `${i.studentFirstName} ${i.studentSurname}`);
  note('S11 accented names on ledger', accent);
  const sm = await call('txs', 'GET', `/schools/${S}/transactions/summary`, O);
  note('S11 summary', sm.status, JSON.stringify(sm.body).slice(0, 600));
  const f = await call('txf', 'GET', `/schools/${S}/transactions?kind=RENEWAL&status=FAILED`, O);
  note('S11 failed renewals filter', f.status, (f.body?.items || []).length);
  const bad = await call('txf', 'GET', `/schools/${S}/transactions?from=2026-13-45&to=abc`, O);
  note('S11 bad dates', bad.status);
}

save();
fs.writeFileSync(new URL('./money-log.txt', import.meta.url), log.join('\n') + '\n', { flag: 'a' });
await db.$disconnect();
