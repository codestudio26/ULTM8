// Round 7, D check 3: the late saved-card "Payment confirmed" notice
// (#530/#533; Decisions 449 item 11, 450 items 6 and 8). Stripe charges the
// saved card but the answer is lost (the fake's lose-next-answer); the
// purchase is then settled by Stripe's webhook, by the stale-attempt sweep
// (charge-auto-pay), or by both at the same moment. Checks: exactly one
// CARD_PAYMENT_CONFIRMED notice, the "charged only once" wording, the School
// switch chargeNoticeCardConfirmed, the Guardian audience, and none on the
// on-screen path.
//   Shortcut named: the row's createdAt is moved back 2 hours so the sweep
//   treats it as stale ("an hour later"); a GuardianLink for an adult buyer is
//   written directly (a Guardian can't pay by saved card for a minor, so a
//   linked buyer with a saved card can't be made through the API).
import crypto from 'crypto';
import { call, must, db, rec, expect, saveOut, makeSchool, makeMember, plan, stepUp, stripeWebhook, runJob, FAKE } from './lib.mjs';

const A = 'notice';
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 300)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await makeSchool('ready', 'D7 Notice');
const O = () => s.owner.tok;
const pack = await plan(s, { type: 'CLASS_PACK', title: 'Pack N', price: 6000, classesIncluded: 5, expiryDurationDays: 60 });

async function saveCard(p) {
  const ss = await must('setup session', 'POST', `/schools/${s.id}/payment-methods/setup-session`, p.tok, {});
  const cs = ss.checkoutUrl.split('/').pop();
  await (await fetch(`${FAKE}/__checkout/${cs}/save-card`, { method: 'POST' })).json();
  await stripeWebhook({ id: `evt_cs_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'checkout.session.completed', account: s.acct, data: { object: { id: cs, object: 'checkout.session', mode: 'setup' } } });
  return waitFor(async () => { const r = await call('GET', `/schools/${s.id}/payment-methods/me`, p.tok); return r.status === 200 && r.body?.last4 ? r.body : null; });
}
const notices = (userId) => db.notification.findMany({ where: { userId, schoolId: s.id } });
const confirmed = async (userId) => (await notices(userId)).filter((n) => n.type === 'CARD_PAYMENT_CONFIRMED' || n.title === 'Payment confirmed');

/** A saved-card purchase whose answer from Stripe is lost. Returns the Pending row and Stripe's PaymentIntent. */
async function lostAnswerPurchase(p) {
  await fetch(`${FAKE}/__payment_intents/lose-next-answer`, { method: 'POST' });
  const buy = await call('POST', `/membership-plans/${pack.id}/purchase`, p.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(p) });
  const row = await db.transaction.findFirst({ where: { studentId: p.id, membershipPlanId: pack.id }, orderBy: { createdAt: 'desc' } });
  const pis = await (await fetch(`${FAKE}/__payment_intents`)).json();
  const pi = pis.filter((x) => x.metadata?.transactionId === row?.id).pop();
  return { buy, row, pi };
}
const webhookPaid = (pi) => stripeWebhook({ id: `evt_pi_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'payment_intent.succeeded', account: s.acct, data: { object: { ...pi, status: 'succeeded' } } });
const makeStale = (row) => db.transaction.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 2 * 3600e3) } });

const people = [];
for (let i = 0; i < 6; i++) { const p = await makeMember(s, `Pia${'abcdef'[i]}`, 'Late'); p.card = await saveCard(p); people.push(p); }
rec(A, 'setup', 'NOTE', { school: s.id, cards: people.map((p) => !!p.card) });

// N1: on-screen path: the purchase saves the answer itself -> no CARD_PAYMENT_CONFIRMED notice.
{
  const p = people[0];
  const b = await call('POST', `/membership-plans/${pack.id}/purchase`, p.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(p) });
  await sleep(2000);
  const n = await confirmed(p.id);
  expect(A, 'N1 on-screen answer: plan bought, no "Payment confirmed" notice', b.status < 300 && n.length === 0, { buy: b.status, outcome: b.body?.outcome, notices: n.map((x) => x.type) });
}
// N2: settled by the webhook only.
{
  const p = people[1];
  const { buy, row, pi } = await lostAnswerPurchase(p);
  await webhookPaid(pi);
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: row.id } }))?.status === 'SUCCESSFUL');
  await sleep(2000);
  await webhookPaid(pi); // Stripe sends it again
  await sleep(2000);
  const n = await confirmed(p.id);
  const body = n[0]?.body ?? '';
  expect(A, 'N2 webhook settles it: exactly one notice, type CARD_PAYMENT_CONFIRMED, "charged only once"', buy.status >= 500 && n.length === 1 && n[0].type === 'CARD_PAYMENT_CONFIRMED' && /charged only once/.test(body) && body.includes('60.00'), { buy: buy.status, row: row?.status, n: n.map((x) => ({ type: x.type, title: x.title, body: x.body })) });
}
// N3: settled by the sweep only.
{
  const p = people[2];
  const { row } = await lostAnswerPurchase(p);
  await makeStale(row);
  await runJob('charge-auto-pay');
  const t = await waitFor(async () => { const x = await db.transaction.findUnique({ where: { id: row.id } }); return x?.status === 'SUCCESSFUL' ? x : null; }, 8000);
  await sleep(2000);
  const n = await confirmed(p.id);
  expect(A, 'N3 the sweep settles it: exactly one notice', t?.status === 'SUCCESSFUL' && n.length === 1 && n[0].type === 'CARD_PAYMENT_CONFIRMED', { row: t?.status, n: n.map((x) => x.type), mems: await db.membership.count({ where: { studentId: p.id, membershipPlanId: pack.id } }) });
}
// N4: race: the webhook and the sweep at the same moment (twice, two members).
for (const p of [people[3], people[4]]) {
  const { row, pi } = await lostAnswerPurchase(p);
  await makeStale(row);
  await Promise.all([webhookPaid(pi), runJob('charge-auto-pay'), webhookPaid(pi)]);
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: row.id } }))?.status === 'SUCCESSFUL', 8000);
  await sleep(3000);
  const n = await confirmed(p.id);
  const mems = await db.membership.count({ where: { studentId: p.id, membershipPlanId: pack.id } });
  expect(A, `N4 race webhook x2 + sweep (${p.first}): one notice, one membership`, n.length === 1 && mems === 1, { n: n.length, mems, row: (await db.transaction.findUnique({ where: { id: row.id } }))?.status });
}
// N5: the School switch off -> none sent; the cash notice switch untouched.
{
  const off = await call('PATCH', `/schools/${s.id}`, O(), { chargeNoticeCardConfirmed: false });
  const sch = await db.school.findUnique({ where: { id: s.id } });
  const p = people[5];
  const { row, pi } = await lostAnswerPurchase(p);
  await webhookPaid(pi);
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: row.id } }))?.status === 'SUCCESSFUL');
  await sleep(2500);
  const n = await confirmed(p.id);
  expect(A, 'N5 chargeNoticeCardConfirmed off: payment settles, no notice', off.status < 300 && sch.chargeNoticeCardConfirmed === false && n.length === 0, { patch: off.status, err: off.body?.error?.message, flag: sch.chargeNoticeCardConfirmed, n: n.length });
  const get = await call('GET', `/schools/${s.id}`, O());
  rec(A, 'N5b the switch reads back on the School', get.body?.chargeNoticeCardConfirmed === false ? 'PASS' : 'FAIL', { value: get.body?.chargeNoticeCardConfirmed });
  await call('PATCH', `/schools/${s.id}`, O(), { chargeNoticeCardConfirmed: true });
}
// N6: Guardian audience (link written directly, see the header).
{
  const kid = await makeMember(s, 'Teo', 'Linked');
  kid.card = await saveCard(kid);
  const g1 = await makeMember(s, 'Gina', 'Guard');
  const g2 = await makeMember(s, 'Gus', 'Guard');
  for (const g of [g1, g2]) await db.guardianLink.create({ data: { id: crypto.randomUUID(), guardianId: g.id, studentId: kid.id } }).catch((e) => rec(A, 'N6 link', 'NOTE', e.message.slice(0, 300)));
  const { row, pi } = await lostAnswerPurchase(kid);
  await webhookPaid(pi);
  await waitFor(async () => (await db.transaction.findUnique({ where: { id: row.id } }))?.status === 'SUCCESSFUL');
  await sleep(2500);
  const [nk, n1, n2] = [await confirmed(kid.id), await confirmed(g1.id), await confirmed(g2.id)];
  expect(A, 'N6 linked buyer: each Guardian gets one notice naming the child; the child none', nk.length === 0 && n1.length === 1 && n2.length === 1 && n1[0].body.startsWith('Teo') && /only one charge/.test(n1[0].body), { kid: nk.length, g1: n1.map((x) => x.body), g2: n2.length });
}
saveOut('notice-out.json');
await db.$disconnect();
process.exit(0);
