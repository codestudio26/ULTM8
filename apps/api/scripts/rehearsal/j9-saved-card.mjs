// Journey 9 (launch rehearsal 2, UK only): a member with a saved card.
//  - A saved-card purchase whose answer from Stripe is lost: the payment is
//    settled later by Stripe's own notice, and the member gets "Payment
//    confirmed" (Decision 448 item 19).
//  - A plan switch never charges more than its 7-day notice said, even when
//    the card surcharge goes up in between (Decision 448 item 3).
//  - A no-show fee taken from the saved card shows on Transactions
//    (Decision 448 item 18).
// The card is saved on Stripe's hosted page (the fake's save-card hook), then
// Stripe's signed checkout.session.completed arrives, as in production.
import { call, must, journey, ok, step, signUp, signIn, stepUp, stripeWebhook, runJob, FAKE_STRIPE, db, days } from './lib.mjs';
import { joinSchool } from './j3-members.mjs';

const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 300)); } };

export async function j9SavedCard(s) {
  const c = s.cfg;
  if (!c.cards || !s.school || !s.plans?.week) return;
  journey(c.key, '9', 'A saved card: late confirmation, plan-switch cap, no-show fee');
  const sid = s.school.id;
  const O = () => s.owner.tok;

  const m = await step('a member saves a card on Stripe\'s page', async () => {
    const p = await signUp({ first: 'Oscar', last: 'Reid', dob: '1991-06-06', country: c.country, language: c.language, currency: c.currency });
    await joinSchool(s, p); await signIn(p);
    await must('waiver', 'POST', `/waivers/${s.waiver.id}/sign`, p.tok, { signerFullName: 'Oscar Reid', signatureText: 'Oscar Reid' });
    const ss = await must('setup session', 'POST', `/schools/${sid}/payment-methods/setup-session`, p.tok, {});
    const cs = ss.checkoutUrl.split('/').pop();
    await (await fetch(`${FAKE_STRIPE}/__checkout/${cs}/save-card`, { method: 'POST' })).json();
    const wh = await stripeWebhook({ id: `evt_cs_${Date.now()}`, object: 'event', type: 'checkout.session.completed', account: s.acct, data: { object: { id: cs, object: 'checkout.session', mode: 'setup' } } });
    const card = await waitFor(async () => { const r = await call('GET', `/schools/${sid}/payment-methods/me`, p.tok); return r.status === 200 && r.body?.last4 ? r.body : null; });
    p.card = card;
    ok('a member saves a card on Stripe\'s page; the app shows it', wh.status === 200 && !!card, `webhook ${wh.status}; card ${card ? `${card.brand} …${card.last4}` : 'none'}`);
    return p;
  });
  if (!m?.card) return;

  // --- Stripe charges the card but its answer is lost (Decision 448 item 19) ---
  await fetch(`${FAKE_STRIPE}/__payment_intents/lose-next-answer`, { method: 'POST' });
  // Paying with the saved card asks for the passcode again (step-up).
  const buy = await call('POST', `/membership-plans/${s.plans.kids.id}/purchase`, m.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(m) });
  const pending = await db.transaction.findFirst({ where: { studentId: m.id, membershipPlanId: s.plans.kids.id }, orderBy: { createdAt: 'desc' } });
  const pis = await (await fetch(`${FAKE_STRIPE}/__payment_intents`)).json();
  const pi = pis.filter((x) => x.metadata?.transactionId === pending?.id).pop();
  ok('when Stripe\'s answer is lost, nothing is settled yet and the payment waits, not lost', buy.status >= 500 && pending?.status === 'PENDING' && pi?.status === 'succeeded', `purchase ${buy.status} ${buy.body?.error?.message ?? ''}; order ${pending?.status}; Stripe charged ${pi ? `${pi.amount} (${pi.status})` : 'nothing found'}`);
  if (pi && pending) {
    const before = await db.notification.count({ where: { userId: m.id, title: 'Payment confirmed' } });
    const wh = await stripeWebhook({ id: `evt_late_${Date.now()}`, object: 'event', type: 'payment_intent.succeeded', account: s.acct, data: { object: { ...pi, status: 'succeeded' } } });
    const settled = await waitFor(async () => { const t = await db.transaction.findUnique({ where: { id: pending.id } }); return t?.status === 'SUCCESSFUL' ? t : null; });
    await new Promise((r) => setTimeout(r, 1500));
    const after = await db.notification.count({ where: { userId: m.id, title: 'Payment confirmed' } });
    const mem = await db.membership.findFirst({ where: { studentId: m.id, membershipPlanId: s.plans.kids.id } });
    ok('Stripe\'s notice settles it later: the plan starts and the member is sent "Payment confirmed" once', wh.status === 200 && !!settled && !!mem && after - before === 1, `webhook ${wh.status}; order ${settled?.status}; plan ${mem ? 'started' : 'missing'}; "Payment confirmed" notices ${before} → ${after}`);
    // Stripe sends its notice again: nothing more happens.
    await stripeWebhook({ id: `evt_late2_${Date.now()}`, object: 'event', type: 'payment_intent.succeeded', account: s.acct, data: { object: { ...pi, status: 'succeeded' } } });
    await new Promise((r) => setTimeout(r, 2000));
    const again = await db.notification.count({ where: { userId: m.id, title: 'Payment confirmed' } });
    const mems = await db.membership.count({ where: { studentId: m.id, membershipPlanId: s.plans.kids.id } });
    ok('…and the same notice from Stripe again changes nothing', again === after && mems === 1, `notices ${again}; plans ${mems}`);
  }

  // --- A plan switch costs no more than its notice said (Decision 448 item 3) ---
  await step('plan switch: the notice\'s amount is the most charged', async () => {
    const r = await must('buy week', 'POST', `/membership-plans/${s.plans.week.id}/purchase`, m.tok, { payWithSavedCard: true, agreeToPlanSwitch: true }, { 'x-step-up-token': await stepUp(m) });
    let mem = await db.membership.findFirst({ where: { studentId: m.id, membershipPlanId: s.plans.week.id } });
    await db.membership.update({ where: { id: mem.id }, data: { expiryDate: new Date(Date.now() + days(3)) } });
    await runJob('plan-switch');
    mem = await db.membership.findUnique({ where: { id: mem.id } });
    const quoted = mem.switchNoticeAmount;
    // The owner raises the card surcharge from 2% to 3% before switch day.
    await must('surcharge 3%', 'PUT', `/schools/${sid}/card-surcharge`, O(), { enabled: true, bps: 300, legalConfirmed: true });
    await db.membership.update({ where: { id: mem.id }, data: { expiryDate: new Date(Date.now() - 60e3) } });
    await runJob('plan-switch');
    mem = await db.membership.findUnique({ where: { id: mem.id } });
    const tx = await db.transaction.findFirst({ where: { studentId: m.id, membershipPlanId: s.plans.next.id }, orderBy: { createdAt: 'desc' } });
    const charged = tx ? tx.amount + (tx.surchargeAmount ?? 0) : null;
    const uncapped = s.plans.next.price + Math.round(s.plans.next.price * 0.03);
    ok('the switch charges what the 7-day notice quoted, not the higher surcharge set since', r.outcome === 'active' && quoted === s.plans.next.price + Math.round(s.plans.next.price * 0.02) && mem.switchOutcome === 'SWITCHED' && charged === quoted && charged < uncapped,
      `bought ${r.outcome}; notice quoted ${quoted}; outcome ${mem.switchOutcome}; charged ${charged} (price ${tx?.amount} + surcharge ${tx?.surchargeAmount}); at 3% it would be ${uncapped}`);
    await must('surcharge 2%', 'PUT', `/schools/${sid}/card-surcharge`, O(), { enabled: true, bps: 200, legalConfirmed: true });
    return true;
  });

  // --- A no-show fee on Transactions (Decision 448 item 18) ---
  await step('a no-show fee from the saved card shows on Transactions', async () => {
    await must('no-show fee', 'PATCH', `/schools/${sid}`, O(), { noShowFee: 500 });
    const start = new Date(Date.now() + 15 * 60e3);
    const cls = await must('class', 'POST', `/schools/${sid}/classes`, O(), { branchId: s.branch.id, instructorId: s.owner.id, title: 'Evening fundamentals', styles: s.styles, startDate: start.toISOString(), endDate: new Date(start.getTime() + 3600e3).toISOString(), membershipInclusion: true, capacity: 20 });
    const b = await call('POST', `/classes/${cls.id}/book`, m.tok, {});
    // "After the class": its times move back, then the no-show job runs.
    await db.class.update({ where: { id: cls.id }, data: { startDate: new Date(Date.now() - 2 * 3600e3), endDate: new Date(Date.now() - 3600e3) } });
    await runJob('booking-no-show-processing');
    const bk = await waitFor(async () => { const x = await db.booking.findFirst({ where: { classId: cls.id, studentId: m.id } }); return x?.noShowFeeOutcome ? x : null; });
    const list = await call('GET', `/schools/${sid}/transactions?kind=NO_SHOW_FEE`, O());
    const rows = list.body?.items ?? [];
    ok('the no-show fee is charged to the saved card and listed on Transactions', b.status < 300 && bk?.status === 'NO_SHOW' && bk?.noShowFeeOutcome === 'CHARGED' && rows.some((x) => x.kind === 'NO_SHOW_FEE' && x.amount === 500),
      `booked ${b.status}; booking ${bk?.status}, fee ${bk?.noShowFeeOutcome} ${bk?.noShowFeeAmount}; Transactions (no-show fees) ${list.status}: ${rows.map((x) => `${x.kind} ${x.amount}+${x.surchargeAmount} ${x.status}`).join(', ') || 'none'}`);
    await must('no-show fee off', 'PATCH', `/schools/${sid}`, O(), { noShowFee: null });
    return true;
  });
}
