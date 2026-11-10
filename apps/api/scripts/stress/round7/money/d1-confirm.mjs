// D-1 confirmation on a brand-new School: a freeze fee refunded in full in
// Stripe's Dashboard, or lost in a dispute, ends the plan it froze and cancels
// the member's future bookings.
import crypto from 'crypto';
import { DateTime } from 'luxon';
import { call, must, db, rec, saveOut, makeSchool, makeMember, plan, stepUp, stripeWebhook, FAKE } from './lib.mjs';

const A = 'd1';
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 300)); } };
const s = await makeSchool('ready', 'D7 D1 Confirm');
const O = () => s.owner.tok;
await must('settings', 'PATCH', `/schools/${s.id}`, O(), { freezeFeeAmount: 700 });
const sch = await db.school.findUnique({ where: { id: s.id } });
const wKey = Object.keys(sch).find((k) => /waiver/i.test(k) && /book|checkin|required/i.test(k) && typeof sch[k] === 'boolean');
if (wKey) await db.school.update({ where: { id: s.id }, data: { [wKey]: false, freezeMaxDaysPer12Months: 365 } });
const week = await plan(s, { type: 'WEEKLY_PASS', title: 'Month', price: 4000, expiryDurationDays: 30 });

async function member(name) {
  const p = await makeMember(s, name, 'Frozen');
  const ss = await must('setup', 'POST', `/schools/${s.id}/payment-methods/setup-session`, p.tok, {});
  const cs = ss.checkoutUrl.split('/').pop();
  await fetch(`${FAKE}/__checkout/${cs}/save-card`, { method: 'POST' });
  await stripeWebhook({ id: `evt_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'checkout.session.completed', account: s.acct, data: { object: { id: cs, object: 'checkout.session', mode: 'setup' } } });
  await waitFor(async () => (await call('GET', `/schools/${s.id}/payment-methods/me`, p.tok)).body?.last4);
  await must('buy', 'POST', `/membership-plans/${week.id}/purchase`, p.tok, { payWithSavedCard: true }, { 'x-step-up-token': await stepUp(p) });
  const start = new Date(Date.now() + 20 * 86400e3);
  const cls = await must('class', 'POST', `/schools/${s.id}/classes`, O(), { branchId: s.branch.id, title: `Later ${name}`, activities: ['BJJ'], startDate: start.toISOString(), endDate: new Date(start.getTime() + 3600e3).toISOString(), membershipInclusion: true, capacity: 10 });
  const b = await must('book', 'POST', `/classes/${cls.id}/book`, p.tok, {});
  const mem = await db.membership.findFirst({ where: { studentId: p.id, membershipPlanId: week.id } });
  const d = (n) => DateTime.now().setZone(s.c.tz).plus({ days: n }).toISODate();
  await must('freeze', 'POST', `/schools/${s.id}/memberships/${mem.id}/freezes`, O(), { startsAt: d(2), endsAt: d(9) });
  const fz = await waitFor(async () => { const f = await db.membershipFreeze.findFirst({ where: { membershipId: mem.id } }); const t = f?.feeTransactionId && await db.transaction.findUnique({ where: { id: f.feeTransactionId } }); return t?.status === 'SUCCESSFUL' ? t : null; });
  return { p, mem, booking: b.id, fee: fz };
}
const state = async (x) => ({ membership: (await db.membership.findUnique({ where: { id: x.mem.id } })).status, booking: (await db.booking.findUnique({ where: { id: x.booking } })).status, fee: (await db.transaction.findUnique({ where: { id: x.fee.id } })).status });

// Refund in the Dashboard.
const a = await member('Rae');
const before = await state(a);
const pi = await (await fetch(`${FAKE}/v1/payment_intents/${a.fee.stripePaymentIntentId}`)).json();
const ch = await (await fetch(`${FAKE}/__charges/${pi.latest_charge.id}/refund`, { method: 'POST', body: JSON.stringify({ amount: 700 }) })).json();
await stripeWebhook({ id: `evt_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'charge.refunded', account: s.acct, data: { object: ch } });
await new Promise((r) => setTimeout(r, 2500));
const after = await state(a);
rec(A, 'D1a full Dashboard refund of the 7.00 freeze fee: the 40.00 plan and a booking in 20 days', after.membership === 'ACTIVE' && after.booking === before.booking ? 'PASS' : 'FAIL', { before, after });

// Dispute lost.
const b = await member('Dee');
const before2 = await state(b);
const pi2 = await (await fetch(`${FAKE}/v1/payment_intents/${b.fee.stripePaymentIntentId}`)).json();
const dp = await (await fetch(`${FAKE}/__disputes`, { method: 'POST', body: JSON.stringify({ payment_intent: pi2.id, amount: 700, status: 'lost' }) })).json();
await stripeWebhook({ id: `evt_${crypto.randomBytes(6).toString('hex')}`, object: 'event', type: 'charge.dispute.closed', account: s.acct, data: { object: dp } });
await new Promise((r) => setTimeout(r, 2500));
const after2 = await state(b);
rec(A, 'D1b freeze fee lost in a dispute: the plan and booking', after2.membership === 'ACTIVE' ? 'PASS' : 'FAIL', { before: before2, after: after2 });
saveOut('d1-confirm-out.json');
await db.$disconnect();
process.exit(0);
