// Billing stress run: membership purchases (cash/bank and card), owner
// confirmations, Stripe webhooks, promotion fees and the transactions list,
// then attacks on each. Uses the cast from ../booking-schedule/seed.mjs and
// needs the API started against fake-stripe.mjs (see README.md).
import fs from 'fs';
import { createRequire } from 'module';
import { db, call, pool, report, randomUUID, token, grant } from '../booking-schedule/lib.mjs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const Stripe = require('stripe');
const stripe = new (Stripe.default || Stripe)('sk_test_fake');
const FAKE = `http://localhost:${process.env.FAKE_STRIPE_PORT ?? 12111}`;

const cast = JSON.parse(fs.readFileSync(new URL('../booking-schedule/cast.json', import.meta.url)));
const S = cast.schools;
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const codes = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const C = Number(process.env.CONCURRENCY ?? 64);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Webhooks, signed with the API's own secret.
// ---------------------------------------------------------------------------
async function webhook(label, type, objectId, account, eventId = `evt_${randomUUID().replace(/-/g, '')}`, opts = {}) {
  const payload = JSON.stringify({ id: eventId, object: 'event', type, account, data: { object: { id: objectId, object: type.split('.')[0] } } });
  const header = opts.badSignature ? 't=1,v1=deadbeef' : stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET, timestamp: opts.timestamp });
  const t0 = t();
  const res = await fetch(`${process.env.API || 'http://localhost:3200/v1'}/payments/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', ...(opts.noSignature ? {} : { 'stripe-signature': header }) }, body: payload });
  await res.text();
  (globalThis.__wh ||= []).push({ label, ms: t() - t0, status: res.status });
  return { status: res.status, eventId };
}
async function waitFor(fn, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(250); }
}

// ---------------------------------------------------------------------------
// Setup: a payment account and plans per School. Even Schools take cards
// (Stripe Connect, against the fake), odd Schools take cash.
// ---------------------------------------------------------------------------
const t0 = t();
for (const [i, s] of S.entries()) {
  s.card = i % 2 === 0;
  await db.school.update({ where: { id: s.id }, data: { defaultCurrency: 'GBP' } });
  const acct = await call('setup:payment-account', 'POST', `/schools/${s.id}/payment-accounts`, s.owner.tok, { provider: s.card ? 'STRIPE' : 'CASH', accountTitle: 'Main', country: 'GB' });
  if (acct.status >= 300) throw new Error('payment account ' + JSON.stringify(acct.body));
  s.paymentAccountId = acct.body.id;
  if (s.card) {
    const ob = await call('setup:onboard', 'POST', `/payment-accounts/${acct.body.id}/connect/onboard`, s.owner.tok, {});
    if (ob.status >= 300) throw new Error('onboard ' + JSON.stringify(ob.body));
    s.acct = (await db.paymentAccount.findUnique({ where: { id: acct.body.id } })).stripeConnectedAccountId;
  }
  const mk = async (body) => {
    const r = await call('setup:plan', 'POST', `/schools/${s.id}/membership-plans`, s.owner.tok, { currency: 'GBP', ...body });
    if (r.status >= 300) throw new Error('plan ' + JSON.stringify(r.body));
    return r.body.id;
  };
  s.plans = {
    pack: await mk({ type: 'CLASS_PACK', title: '10-class pack', price: 6000, classesIncluded: 10, expiryDurationDays: 90 }),
    weekly: await mk({ type: 'WEEKLY_PASS', title: 'Week pass', price: 2500, expiryDurationDays: 7 }),
  };
  if (s.card) s.plans.sub = await mk({ type: 'SUBSCRIPTION', title: 'Monthly', price: 12000 });
}
console.log(`setup: ${S.length} payment accounts and plans in ${((t() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// B1. Load: every student buys a class pack. Cash: Pending, then the owner
// confirms. Card: hosted Checkout, then Stripe's payment_intent.succeeded.
// ---------------------------------------------------------------------------
const all = S.flatMap((s) => s.students.map((st) => ({ s, st })));
let tb = t();
const buys = await pool(all, C, async ({ s, st }) => ({ s, st, r: await call(s.card ? 'buy:pack:card' : 'buy:pack:cash', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, s.card ? { useHostedCheckout: true } : {}) }));
console.log(`purchases: ${buys.length} in ${((t() - tb) / 1000).toFixed(1)}s`);
const cashTx = buys.filter((b) => !b.s.card && b.r.status < 300).map((b) => ({ s: b.s, id: b.r.body.transactionId }));
const cardTx = buys.filter((b) => b.s.card && b.r.status < 300).map((b) => ({ s: b.s, id: b.r.body.transactionId }));
tb = t();
await pool(cashTx, C, ({ s, id }) => call('confirm:cash', 'PATCH', `/transactions/${id}/confirm`, s.owner.tok, {}));
console.log(`cash confirmations: ${cashTx.length} in ${((t() - tb) / 1000).toFixed(1)}s`);
const cardRows = await db.transaction.findMany({ where: { id: { in: cardTx.map((x) => x.id) } }, select: { id: true, stripePaymentIntentId: true, schoolId: true } });
const acctOf = Object.fromEntries(S.map((s) => [s.id, s.acct]));
tb = t();
await pool(cardRows, C, (row) => webhook('webhook:pi.succeeded', 'payment_intent.succeeded', row.stripePaymentIntentId, acctOf[row.schoolId]));
const settled = await waitFor(async () => (await db.transaction.count({ where: { id: { in: cardRows.map((r) => r.id) }, status: 'PENDING' } })) === 0, 300000);
console.log(`card webhooks: ${cardRows.length} accepted and processed in ${((t() - tb) / 1000).toFixed(1)}s (all settled: ${settled})`);

const ids = [...cashTx, ...cardTx].map((x) => x.id);
const txs = await db.transaction.findMany({ where: { id: { in: ids } } });
const byStatus = txs.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
const noMembership = txs.filter((x) => x.status === 'SUCCESSFUL' && !x.membershipId).length;
const memberships = await db.membership.count({ where: { membershipPlanId: { in: S.map((s) => s.plans.pack) } } });
ok('B1a every purchase settles: one membership per successful payment', noMembership === 0 && memberships === (byStatus.SUCCESSFUL ?? 0), `purchase codes ${JSON.stringify(codes(buys.map((b) => b.r)))}; transactions ${JSON.stringify(byStatus)}; packs created ${memberships}; successful with no membership ${noMembership}`);
const packs = await db.membership.findMany({ where: { membershipPlanId: { in: S.map((s) => s.plans.pack) } }, select: { classesRemaining: true, expiryDate: true } });
ok('B1b each pack has 10 credits and a 90-day expiry', packs.every((m) => m.classesRemaining === 10 && m.expiryDate && Math.abs(m.expiryDate - Date.now() - 90 * 864e5) < 864e5), `${packs.length} packs checked`);

// Transactions list: every page, per School, matches the database.
tb = t();
let listMismatch = [];
await pool(S, 8, async (s) => {
  const seen = new Set(); let cursor; let pages = 0; let dup = 0;
  do {
    const r = await call('list:transactions', 'GET', `/schools/${s.id}/transactions?limit=100${cursor ? `&cursor=${cursor}` : ''}`, s.owner.tok);
    if (r.status !== 200) { listMismatch.push(`${s.id}: ${r.status}`); return; }
    for (const x of r.body.items) { if (seen.has(x.id)) dup++; seen.add(x.id); }
    cursor = r.body.nextCursor; pages++;
  } while (cursor && pages < 200);
  const inDb = await db.transaction.count({ where: { schoolId: s.id } });
  if (seen.size !== inDb || dup) listMismatch.push(`${s.id.slice(0, 8)}: listed ${seen.size}, db ${inDb}, dup ${dup}`);
});
ok('B1c the transactions list shows every payment once, across pages', listMismatch.length === 0, listMismatch.slice(0, 5).join('; ') || `${S.length} Schools paged in ${((t() - tb) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------
const cash = S.filter((s) => !s.card);
const card = S.filter((s) => s.card);
const nth = (s, i) => s.students[i];
// Students with no general-access membership (a class pack, or nothing), so a
// week pass or subscription is theirs to buy.
const free = (s, i) => s.students.filter((x) => x.kind === 'pack' || x.kind === 'none')[i];

// C1. Double-click a cash purchase.
{
  const s = cash[0]; const st = free(s, 1);
  const rs = await Promise.all(Array.from({ length: 20 }, () => call('C1:buy', 'POST', `/membership-plans/${s.plans.weekly}/purchase`, st.tok, {})));
  const pending = await db.transaction.count({ where: { studentId: st.id, membershipPlanId: s.plans.weekly, status: 'PENDING' } });
  ok('C1 double-clicking a cash purchase leaves one order waiting', pending === 1, `20 clicks: ${JSON.stringify(codes(rs))}; Pending orders ${pending}`);
}

// C2. Twenty parallel confirmations of one cash payment.
{
  const s = cash[1]; const st = free(s, 2);
  const r = await call('C2:buy', 'POST', `/membership-plans/${s.plans.weekly}/purchase`, st.tok, {});
  const rs = await Promise.all(Array.from({ length: 20 }, () => call('C2:confirm', 'PATCH', `/transactions/${r.body.transactionId}/confirm`, s.owner.tok, {})));
  const m = await db.membership.count({ where: { studentId: st.id, membershipPlanId: s.plans.weekly } });
  ok('C2 confirming one payment 20 times at once makes one membership', m === 1, `confirm codes ${JSON.stringify(codes(rs))}; memberships ${m}`);
}

// C3. Two Pending week passes for one student, both confirmed at once.
{
  const s = cash[2]; const st = free(s, 3);
  const a = await db.transaction.create({ data: { id: randomUUID(), schoolId: s.id, studentId: st.id, paymentAccountId: s.paymentAccountId, membershipPlanId: s.plans.weekly, amount: 2500, currency: 'GBP', status: 'PENDING', paymentMethod: 'CASH' } });
  const b = await db.transaction.create({ data: { id: randomUUID(), schoolId: s.id, studentId: st.id, paymentAccountId: s.paymentAccountId, membershipPlanId: s.plans.weekly, amount: 2500, currency: 'GBP', status: 'PENDING', paymentMethod: 'CASH' } });
  const rs = await Promise.all([a, b].map((x) => call('C3:confirm', 'PATCH', `/transactions/${x.id}/confirm`, s.owner.tok, {})));
  const live = await db.membership.count({ where: { studentId: st.id, membershipPlanId: s.plans.weekly, status: 'ACTIVE' } });
  const after = await db.transaction.findMany({ where: { id: { in: [a.id, b.id] } }, select: { status: true, membershipId: true } });
  const orphan = after.filter((x) => x.status === 'SUCCESSFUL' && !x.membershipId).length;
  ok('C3 two week passes confirmed at once: one membership, no paid order without one', live === 1 && orphan === 0, `codes ${JSON.stringify(codes(rs))}; live passes ${live}; orders ${JSON.stringify(after)}`);
}

// C4. One webhook event delivered 20 times at once.
{
  const s = card[0]; const st = nth(s, 4);
  const r = await call('C4:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, { useHostedCheckout: true });
  const pi = (await db.transaction.findUnique({ where: { id: r.body.transactionId } })).stripePaymentIntentId;
  const evt = `evt_${randomUUID().replace(/-/g, '')}`;
  const rs = await Promise.all(Array.from({ length: 20 }, () => webhook('C4', 'payment_intent.succeeded', pi, s.acct, evt)));
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: r.body.transactionId } })).status !== 'PENDING', 30000);
  await sleep(2000);
  const m = await db.membership.count({ where: { studentId: st.id, membershipPlanId: s.plans.pack } });
  ok('C4 one Stripe event delivered 20 times makes one membership', m === 2, `webhook codes ${JSON.stringify(codes(rs))}; packs ${m} (1 from B1 + 1 now)`);
}

// C5. Ten different events for the same payment.
{
  const s = card[1]; const st = nth(s, 5);
  const r = await call('C5:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, { useHostedCheckout: true });
  const pi = (await db.transaction.findUnique({ where: { id: r.body.transactionId } })).stripePaymentIntentId;
  await Promise.all(Array.from({ length: 10 }, () => webhook('C5', 'payment_intent.succeeded', pi, s.acct)));
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: r.body.transactionId } })).status !== 'PENDING', 30000);
  await sleep(3000);
  const m = await db.membership.count({ where: { studentId: st.id, membershipPlanId: s.plans.pack } });
  ok('C5 ten different success events for one payment make one membership', m === 2, `packs ${m} (1 from B1 + 1 now)`);
}

// C6. Forged, unsigned and stale webhooks.
{
  const pi = 'pi_forged';
  const bad = await webhook('C6', 'payment_intent.succeeded', pi, undefined, undefined, { badSignature: true });
  const none = await webhook('C6', 'payment_intent.succeeded', pi, undefined, undefined, { noSignature: true });
  const stale = await webhook('C6', 'payment_intent.succeeded', pi, undefined, undefined, { timestamp: Math.floor(Date.now() / 1000) - 3600 });
  ok('C6 forged, unsigned and hour-old webhooks are refused', bad.status === 400 && none.status === 400 && stale.status === 400, `forged ${bad.status}, unsigned ${none.status}, stale ${stale.status}`);
}

// C7. A card payment for a second week pass: the student already holds one.
// A repeat click within a couple of minutes now reuses the first Checkout page
// (C11b), so the second payment stands for a second tab opened later: a second
// order with its own PaymentIntent, both paid.
{
  const s = card[2]; const st = free(s, 6);
  const first = await call('C7:buy', 'POST', `/membership-plans/${s.plans.weekly}/purchase`, st.tok, { useHostedCheckout: true });
  const firstRow = await db.transaction.findUnique({ where: { id: first.body.transactionId } });
  const secondRow = await db.transaction.create({ data: { ...firstRow, id: randomUUID(), stripePaymentIntentId: `pi_c7_${randomUUID().replace(/-/g, '')}`, createdAt: undefined, updatedAt: undefined } });
  const rows = [firstRow, secondRow];
  await Promise.all(rows.map((x) => webhook('C7', 'payment_intent.succeeded', x.stripePaymentIntentId, s.acct)));
  await waitFor(async () => (await db.transaction.count({ where: { id: { in: rows.map((x) => x.id) }, status: 'PENDING' } })) === 0, 30000);
  const after = await db.transaction.findMany({ where: { id: { in: rows.map((x) => x.id) } }, select: { status: true, membershipId: true, refundedAmount: true } });
  const live = await db.membership.count({ where: { studentId: st.id, membershipPlanId: s.plans.weekly } });
  ok('C7 paying twice for a week pass: one pass, the second payment refunded', live === 1 && after.some((x) => x.status === 'REFUNDED'), `first purchase ${first.status}; orders ${JSON.stringify(after)}; passes ${live}`);
}

// C8. Stripe says the payment failed, then (the member retried in Checkout) that it succeeded.
{
  const s = card[3]; const st = nth(s, 7);
  const r = await call('C8:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, { useHostedCheckout: true });
  const pi = (await db.transaction.findUnique({ where: { id: r.body.transactionId } })).stripePaymentIntentId;
  await webhook('C8', 'payment_intent.payment_failed', pi, s.acct);
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: r.body.transactionId } })).status !== 'PENDING', 20000);
  await webhook('C8', 'payment_intent.succeeded', pi, s.acct);
  await sleep(3000);
  const tx = await db.transaction.findUnique({ where: { id: r.body.transactionId } });
  ok('C8 a payment that fails and then succeeds still gives the membership', tx.status === 'SUCCESSFUL' && !!tx.membershipId, `order ${tx.status}, membership ${tx.membershipId ?? 'none'}`);
}

// C9. Cross-tenant and wrong-role attempts on payments.
{
  const A = cash[3], B = cash[4];
  const stB = free(B, 8);
  const r = await call('C9:buy', 'POST', `/membership-plans/${B.plans.weekly}/purchase`, stB.tok, {});
  const txB = r.body.transactionId;
  const tries = {
    'owner A confirms B': await call('C9', 'PATCH', `/transactions/${txB}/confirm`, A.owner.tok, {}),
    'B instructor confirms': await call('C9', 'PATCH', `/transactions/${txB}/confirm`, B.instructor.tok, {}),
    'B staff confirms': await call('C9', 'PATCH', `/transactions/${txB}/confirm`, B.staff.tok, {}),
    'student confirms own': await call('C9', 'PATCH', `/transactions/${txB}/confirm`, stB.tok, {}),
    'owner A lists B': await call('C9', 'GET', `/schools/${B.id}/transactions`, A.owner.tok),
    'student lists school': await call('C9', 'GET', `/schools/${B.id}/transactions`, stB.tok),
    'other student reads invoice': await call('C9', 'GET', `/transactions/${txB}/invoice`, nth(B, 9).tok),
    'student A buys B plan': await call('C9', 'POST', `/membership-plans/${B.plans.pack}/purchase`, nth(A, 9).tok, {}),
    'student buys for another student': await call('C9', 'POST', `/membership-plans/${B.plans.pack}/purchase`, stB.tok, { studentId: nth(B, 10).id }),
    'owner A edits B plan': await call('C9', 'PATCH', `/membership-plans/${B.plans.pack}`, A.owner.tok, { price: 1 }),
  };
  const st = await db.transaction.findUnique({ where: { id: txB } });
  const leaks = Object.entries(tries).filter(([, v]) => v.status < 400).map(([k, v]) => `${k}: ${v.status}`);
  ok('C9 cross-tenant and wrong-role payment actions are refused', leaks.length === 0 && st.status === 'PENDING', leaks.join('; ') || Object.entries(tries).map(([k, v]) => `${k} ${v.status}`).join(', '));
}

// C10. Plan edge cases at purchase.
{
  const s = cash[5]; const st = nth(s, 11);
  const huge = await call('C10:plan', 'POST', `/schools/${s.id}/membership-plans`, s.owner.tok, { type: 'CLASS_PACK', title: 'Huge', price: 2 ** 31, classesIncluded: 1, currency: 'GBP' });
  const neg = await call('C10:plan', 'POST', `/schools/${s.id}/membership-plans`, s.owner.tok, { type: 'CLASS_PACK', title: 'Negative', price: -500, classesIncluded: 1, currency: 'GBP' });
  const zeroClasses = await call('C10:plan', 'POST', `/schools/${s.id}/membership-plans`, s.owner.tok, { type: 'CLASS_PACK', title: 'No classes', price: 500, classesIncluded: 0, currency: 'GBP' });
  const arch = await call('C10:archive', 'POST', `/membership-plans/${s.plans.weekly}/archive`, s.owner.tok, {});
  const buyArchived = await call('C10:buy', 'POST', `/membership-plans/${s.plans.weekly}/purchase`, st.tok, {});
  await call('C10:unarchive', 'POST', `/membership-plans/${s.plans.weekly}/unarchive`, s.owner.tok, {});
  const fake = await call('C10:buy', 'POST', `/membership-plans/${randomUUID()}/purchase`, st.tok, {});
  const notUuid = await call('C10:buy', 'POST', `/membership-plans/not-a-uuid/purchase`, st.tok, {});
  const bad = [huge.status >= 500 && 'huge price 5xx', neg.status < 400 && 'negative price accepted', zeroClasses.status < 400 && 'pack with 0 classes accepted', buyArchived.status < 400 && 'archived plan bought', fake.status >= 500 && 'unknown plan 5xx', notUuid.status >= 500 && 'bad id 5xx'].filter(Boolean);
  ok('C10 plan edge cases are refused cleanly (no 5xx, no nonsense plans)', bad.length === 0, bad.join('; ') || `huge ${huge.status}, negative ${neg.status}, 0 classes ${zeroClasses.status}, archived ${buyArchived.status}, unknown ${fake.status}, bad id ${notUuid.status}`);
}

// C11. A card subscription double-clicked: how many Stripe subscriptions?
{
  const s = card[4]; const st = free(s, 12);
  const before = await (await fetch(`${FAKE}/__calls`)).json();
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('C11:subscribe', 'POST', `/membership-plans/${s.plans.sub}/purchase`, st.tok, {})));
  const after = await (await fetch(`${FAKE}/__calls`)).json();
  // Every request is counted; ones Stripe answers again from the same idempotency key
  // are also counted as replayed, and create nothing.
  const made = (calls, key) => (calls[key] ?? 0) - (calls[`${key} (replayed)`] ?? 0);
  const subs = made(after, 'POST /v1/subscriptions') - made(before, 'POST /v1/subscriptions');
  const pend = await db.transaction.count({ where: { studentId: st.id, membershipPlanId: s.plans.sub, status: 'PENDING' } });
  ok('C11 double-clicking Subscribe opens one Stripe subscription', subs <= 1 && pend <= 1, `5 clicks: ${JSON.stringify(codes(rs))}; Stripe subscriptions created ${subs}; Pending orders ${pend}`);
  // The same for a pack bought through hosted Checkout.
  const st2 = free(s, 13);
  const before2 = await (await fetch(`${FAKE}/__calls`)).json();
  const rs2 = await Promise.all(Array.from({ length: 5 }, () => call('C11:checkout', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st2.tok, { useHostedCheckout: true })));
  const after2 = await (await fetch(`${FAKE}/__calls`)).json();
  const sessions = made(after2, 'POST /v1/checkout/sessions') - made(before2, 'POST /v1/checkout/sessions');
  const pend2 = await db.transaction.count({ where: { studentId: st2.id, membershipPlanId: s.plans.pack, status: 'PENDING' } });
  const urls = new Set(rs2.map((r) => r.body?.checkoutUrl));
  ok('C11b double-clicking Buy (Checkout) opens one Checkout and one order', pend2 === 1 && urls.size === 1 && sessions === 1, `5 clicks: ${JSON.stringify(codes(rs2))}; Checkout sessions created ${sessions}; Pending orders ${pend2}; distinct checkout links ${urls.size}`);
}

// C12. Promotion fees: accept, waive and cancel races, and other Schools.
{
  const s = S[10];
  await call('C12:settings', 'PUT', `/schools/${s.id}/promotion-fee-settings`, s.owner.tok, { promotionFeeEnabled: true, gradeBeforeFeePaid: false });
  await db.rankStripeTier.updateMany({ where: { rank: { disciplineId: s.disciplineId } }, data: { promotionFeeMinor: 3000 } });
  const members = s.students.filter((x) => x.kind === 'sub').slice(200, 206);
  const reqOf = async (st) => db.promotionFeeRequest.findFirst({ where: { studentId: st.id }, orderBy: { createdAt: 'desc' } });
  const promote = async (st) => {
    return call('C12:promote', 'POST', `/students/${st.id}/ranks/${s.disciplineId}/promote`, s.owner.tok, { acknowledgeWithoutSkillSignoff: true });
  };
  const first = await db.rank.findFirst({ where: { disciplineId: s.disciplineId, archivedAt: null }, orderBy: { order: 'asc' }, include: { stripeTiers: { orderBy: { order: 'asc' }, take: 1 } } });
  await Promise.all(members.map((st) => call('C12:declare', 'POST', `/students/${st.id}/ranks/${s.disciplineId}/declare`, st.tok, { rankId: first.id, stripeTierId: first.stripeTiers[0].id })));
  const ps = await Promise.all(members.map(promote));
  const reqs = await Promise.all(members.map(reqOf));
  const made = reqs.filter(Boolean).length;
  // a) 10 parallel accepts.
  const acc = await Promise.all(Array.from({ length: 10 }, () => call('C12:accept', 'POST', `/promotion-fee-requests/${reqs[0].id}/accept`, members[0].tok, {})));
  // b) accept and owner cancel at the same time.
  const race = await Promise.all([call('C12:accept', 'POST', `/promotion-fee-requests/${reqs[1].id}/accept`, members[1].tok, {}), call('C12:cancel', 'POST', `/promotion-fee-requests/${reqs[1].id}/cancel`, s.owner.tok, {})]);
  // c) 10 parallel waives of a waiting promotion: it applies once.
  const rankBefore = await db.promotionEvent.count({ where: { studentId: members[2].id } });
  const waives = await Promise.all(Array.from({ length: 10 }, () => call('C12:waive', 'POST', `/promotion-fee-requests/${reqs[2].id}/waive`, s.owner.tok, {})));
  const rankAfter = await db.promotionEvent.count({ where: { studentId: members[2].id } });
  // d) waive and cancel at the same time.
  const wc = await Promise.all([call('C12:waive', 'POST', `/promotion-fee-requests/${reqs[3].id}/waive`, s.owner.tok, {}), call('C12:cancel', 'POST', `/promotion-fee-requests/${reqs[3].id}/cancel`, s.owner.tok, {})]);
  const r3 = await db.promotionFeeRequest.findUnique({ where: { id: reqs[3].id } });
  const ev3 = await db.promotionEvent.count({ where: { studentId: members[3].id } });
  // e) another School's owner and student.
  const O = S[11];
  const other = {
    'other owner waives': await call('C12', 'POST', `/promotion-fee-requests/${reqs[4].id}/waive`, O.owner.tok, {}),
    'other student accepts': await call('C12', 'POST', `/promotion-fee-requests/${reqs[4].id}/accept`, nth(O, 1).tok, {}),
    'classmate accepts': await call('C12', 'POST', `/promotion-fee-requests/${reqs[4].id}/accept`, members[5].tok, {}),
    'instructor waives': await call('C12', 'POST', `/promotion-fee-requests/${reqs[4].id}/waive`, s.instructor.tok, {}),
    'other owner lists': await call('C12', 'GET', `/schools/${s.id}/promotion-fee-requests`, O.owner.tok),
  };
  const leaks = Object.entries(other).filter(([, v]) => v.status < 400).map(([k, v]) => `${k}: ${v.status}`);
  // f) promote again while a fee is waiting.
  const again = await promote(members[4]);
  const open4 = await db.promotionFeeRequest.count({ where: { studentId: members[4].id, status: { in: ['PENDING', 'ACCEPTED'] } } });
  ok('C12a priced promotions ask for a fee', made === members.length, `promote codes ${JSON.stringify(codes(ps))}; requests ${made}`);
  ok('C12b 10 parallel accepts: one answer', codes(acc)[201] + (codes(acc)[200] ?? 0) === 1 || (acc.filter((x) => x.status < 300).length === 1), `accept codes ${JSON.stringify(codes(acc))}`);
  ok('C12c accept vs cancel at once: one wins, the other is refused', race.filter((x) => x.status < 300).length === 1, `accept ${race[0].status}, cancel ${race[1].status}`);
  ok('C12d 10 parallel waives apply the waiting promotion once', rankAfter - rankBefore === 1 && waives.filter((x) => x.status < 300).length === 1, `waive codes ${JSON.stringify(codes(waives))}; promotions added ${rankAfter - rankBefore}`);
  ok('C12e waive vs cancel at once: one wins, state consistent', wc.filter((x) => x.status < 300).length === 1 && ((r3.status === 'WAIVED' && ev3 >= 1) || r3.status === 'CANCELLED'), `waive ${wc[0].status}, cancel ${wc[1].status}; request ${r3.status}; promotions ${ev3}`);
  ok('C12f other Schools, classmates and instructors cannot answer, waive or list fees', leaks.length === 0, leaks.join('; ') || Object.entries(other).map(([k, v]) => `${k} ${v.status}`).join(', '));
  ok('C12g promoting again while a fee waits does not open a second fee', open4 <= 1, `second promote ${again.status}; open fees ${open4}`);
}

// C13. A Guardian-less student buying for someone else, and a removed student.
{
  const s = cash[6]; const st = nth(s, 13);
  await db.roleGrant.updateMany({ where: { userId: st.id, schoolId: s.id }, data: { revokedAt: new Date() } }).catch(() => {});
  const r = await call('C13:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, {});
  ok('C13 a student removed from the School cannot buy there', r.status >= 400, `purchase ${r.status}`);
}

// C14. Confirm after the plan is archived, and confirm a FAILED order.
{
  const s = cash[7]; const st = free(s, 14);
  const r = await call('C14:buy', 'POST', `/membership-plans/${s.plans.weekly}/purchase`, st.tok, {});
  await call('C14:archive', 'POST', `/membership-plans/${s.plans.weekly}/archive`, s.owner.tok, {});
  const c = await call('C14:confirm', 'PATCH', `/transactions/${r.body.transactionId}/confirm`, s.owner.tok, {});
  await call('C14:unarchive', 'POST', `/membership-plans/${s.plans.weekly}/unarchive`, s.owner.tok, {});
  const failed = await db.transaction.create({ data: { id: randomUUID(), schoolId: s.id, studentId: st.id, paymentAccountId: s.paymentAccountId, membershipPlanId: s.plans.pack, amount: 6000, currency: 'GBP', status: 'FAILED', paymentMethod: 'CASH' } });
  const cf = await call('C14:confirm-failed', 'PATCH', `/transactions/${failed.id}/confirm`, s.owner.tok, {});
  const fm = await db.transaction.findUnique({ where: { id: failed.id } });
  ok('C14 a payment taken before the plan was archived can still be confirmed; a failed one cannot, and says so', c.status < 300 && cf.status === 409 && fm.status === 'FAILED' && !fm.membershipId, `confirm after archive ${c.status}; confirm FAILED ${cf.status} → ${fm.status}`);
  // A cash order the owner cancelled (Decision 339) can't then be confirmed.
  const st3 = free(s, 21);
  const m3Before = await db.membership.count({ where: { studentId: st3.id, membershipPlanId: s.plans.pack } });
  const r3 = await call('C14:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st3.tok, {});
  const cancel = await call('C14:cancel', 'PATCH', `/transactions/${r3.body.transactionId}/cancel`, s.owner.tok, {});
  const after = await call('C14:confirm-cancelled', 'PATCH', `/transactions/${r3.body.transactionId}/confirm`, s.owner.tok, {});
  const m3 = (await db.membership.count({ where: { studentId: st3.id, membershipPlanId: s.plans.pack } })) - m3Before;
  const o3 = await db.transaction.findUnique({ where: { id: r3.body.transactionId } });
  ok('C14b confirming a cancelled cash order is refused (409), no membership', cancel.status < 300 && after.status === 409 && m3 === 0 && o3.status === 'FAILED' && !o3.membershipId, `cancel ${cancel.status}; confirm ${after.status} → ${o3.status}; new memberships ${m3}`);
}


// C15. A chargeback: the card payment behind a pack is disputed, then lost.
{
  const s = card[5]; const st = free(s, 15);
  const r = await call('C15:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, { useHostedCheckout: true });
  const tx0 = await db.transaction.findUnique({ where: { id: r.body.transactionId } });
  await webhook('C15', 'payment_intent.succeeded', tx0.stripePaymentIntentId, s.acct);
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: tx0.id } })).membershipId, 20000);
  const dp = await (await fetch(`${FAKE}/__disputes`, { method: 'POST', body: JSON.stringify({ payment_intent: tx0.stripePaymentIntentId, amount: 6000 }) })).json();
  await webhook('C15', 'charge.dispute.created', dp.id, s.acct);
  const opened = await waitFor(async () => (await db.transaction.findUnique({ where: { id: tx0.id } })).status === 'DISPUTED', 20000);
  await fetch(`${FAKE}/__disputes/${dp.id}`, { method: 'POST', body: JSON.stringify({ status: 'lost' }) });
  await webhook('C15', 'charge.dispute.closed', dp.id, s.acct);
  await sleep(3000);
  const tx1 = await db.transaction.findUnique({ where: { id: tx0.id } });
  const m = tx1.membershipId ? await db.membership.findUnique({ where: { id: tx1.membershipId } }) : null;
  ok('C15 a lost chargeback is recorded on the payment', opened && tx1.status === 'DISPUTED', `after open: ${opened ? 'DISPUTED' : 'not recorded'}; after lost: payment ${tx1.status}, disputed amount ${tx1.disputedAmount ?? '-'}; membership ${m?.status ?? 'none'} credits ${m?.classesRemaining ?? '-'}`);
}

// C16. Guardians buying for their child, and for a child who isn't theirs.
{
  const s = cash[8]; const child = free(s, 16); const other = free(s, 17);
  const g = await db.user.create({ data: { id: randomUUID(), email: `guardian-${randomUUID()}@stress.test`, firstName: 'Guardian', surname: 'Test', passcodeHash: 'x', phone: `+1555${Math.floor(1e9 + Math.random() * 9e9)}`, dateOfBirth: new Date('1985-01-01') } });
  await db.guardianLink.create({ data: { id: randomUUID(), guardianId: g.id, studentId: child.id } });
  const gt = token(g, []);
  const mine = await call('C16:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, gt, { studentId: child.id });
  const notMine = await call('C16:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, gt, { studentId: other.id });
  await db.guardianLink.updateMany({ where: { guardianId: g.id }, data: { revokedAt: new Date() } });
  const revoked = await call('C16:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, gt, { studentId: child.id });
  const order = mine.body?.transactionId ? await db.transaction.findUnique({ where: { id: mine.body.transactionId } }) : null;
  ok('C16 a Guardian can buy for their own child only, and not after the link is removed', mine.status === 201 && order?.studentId === child.id && notMine.status === 403 && revoked.status === 403, `own child ${mine.status} (order for the child: ${order?.studentId === child.id}); other child ${notMine.status}; after unlinking ${revoked.status}`);
}

// C17. The School's ULTM8 subscription has lapsed (read-only portal, Spec 55 §10.2: no new payments).
{
  const s = cash[9]; const st = free(s, 18);
  await db.school.update({ where: { id: s.id }, data: { platformSubscriptionStatus: 'CANCELED' } });
  const buy = await call('C17:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, {});
  await db.school.update({ where: { id: s.id }, data: { platformSubscriptionStatus: null } });
  ok('C17 a School with a lapsed ULTM8 subscription takes no new payments', buy.status >= 400, `purchase ${buy.status}`);
}

// C18. A closed School: no purchases, no confirmations.
{
  const s = cash[10]; const st = free(s, 19);
  const pending = await call('C18:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, st.tok, {});
  await db.school.update({ where: { id: s.id }, data: { archivedAt: new Date() } });
  const buy = await call('C18:buy', 'POST', `/membership-plans/${s.plans.pack}/purchase`, free(s, 20).tok, {});
  const confirm = await call('C18:confirm', 'PATCH', `/transactions/${pending.body.transactionId}/confirm`, s.owner.tok, {});
  await db.school.update({ where: { id: s.id }, data: { archivedAt: null } });
  ok('C18 a closed School takes no purchases and no confirmations', buy.status >= 400 && confirm.status >= 400, `purchase ${buy.status}; confirm ${confirm.status}`);
}

console.log(`webhooks:`, JSON.stringify(Object.entries((globalThis.__wh || []).reduce((m, w) => { (m[w.label] ||= {})[w.status] = ((m[w.label] ||= {})[w.status] || 0) + 1; return m; }, {}))));
report();
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} checks pass`);
fs.writeFileSync(new URL('./billing-results.json', import.meta.url), JSON.stringify(results, null, 1));
await db.$disconnect();
