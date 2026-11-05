// S10: cancelling a subscription, and the plan's cancellation charge on a late cancel (Decision 389), in CAD.
import fs from 'fs';
import { C, call, db, note, log, fakeObject, FAKE, sleep, randomUUID, checks } from './lib-ca.mjs';
const { ok, save } = checks('s10-ca');
const O = C.owner.tok, S = C.schoolId;
const sec = () => Math.floor(Date.now() / 1000);
const state = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url)));
const subObj = () => fakeObject({ object: 'subscription', status: 'active', items: { object: 'list', data: [{ id: 'si_x', price: { id: 'price_x', product: 'prod_x' }, current_period_end: sec() + 20 * 86400 }] }, metadata: {} });
async function member(st, planId) {
  const sub = await subObj();
  const cus = await (await fetch(`${FAKE}/v1/customers`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=x' })).json();
  await fetch(`${FAKE}/v1/customers/${cus.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'invoice_settings[default_payment_method]=pm_card_visa' });
  const m = await db.membership.create({ data: { id: randomUUID(), studentId: st.id, schoolId: S, membershipPlanId: planId, frequency: 'RECURRING', stripeSubscriptionId: sub.id } });
  await db.studentPaymentMethod.upsert({ where: { studentId_schoolId: { studentId: st.id, schoolId: S } }, create: { id: randomUUID(), studentId: st.id, schoolId: S, stripeCustomerId: cus.id }, update: { stripeCustomerId: cus.id } });
  return { ...st, membershipId: m.id, sub: sub.id };
}

if (!process.env.SKIP_A) {
// A. Cancel a subscription: the member, and 5 clicks at once from member + owner.
{
  const a = await member(C.adults[100], C.plans.family);
  const r = await call('cancel', 'POST', `/memberships/${a.membershipId}/cancel`, a.tok, {});
  note('S10A member cancels', r.status, r.body?.cancelAt);
  const b = await member(C.adults[101], C.plans.family);
  const rs = await Promise.all([...[1, 2, 3].map(() => call('cancel', 'POST', `/memberships/${b.membershipId}/cancel`, b.tok, {})), ...[1, 2].map(() => call('cancel', 'POST', `/memberships/${b.membershipId}/cancel`, O, {}))]);
  const m = await db.membership.findUnique({ where: { id: b.membershipId } });
  ok('S10A cancel x5 (member+owner) → one cancelAt, no 5xx', rs.every((x) => x.status < 500) && m.cancelAt, `${JSON.stringify(rs.map((x) => x.status))} cancelAt ${m.cancelAt?.toISOString()} by ${m.cancelledById === b.id ? 'member' : 'owner'}`);
}

}
// B. Late cancellation: a plan saved without its own currency (the School's CAD applies).
await call('school', 'PATCH', `/schools/${S}`, O, { defaultRefundCutoffHours: 24 });
const p = await call('plan', 'POST', `/schools/${S}/membership-plans`, O, { type: 'SUBSCRIPTION', title: 'Mensuel (devise de l’école)', price: 17500, cancellationCharge: 1500 });
note('S10B plan without currency', p.status, p.body?.currency, p.body?.error);
const cls = await call('class', 'POST', `/schools/${S}/classes`, O, { branchId: C.van, instructorId: C.instr[0].id, title: 'No-Gi — fin de journée', styles: [{ disciplineId: C.disciplineId, classType: 'Adult Fundamentals' }], startDate: new Date(Date.now() + 3 * 3600e3).toISOString(), endDate: new Date(Date.now() + 4 * 3600e3).toISOString(), capacity: 30, membershipInclusion: true });
note('S10B class', cls.status, cls.body?.error);
async function lateCancel(st, label) {
  const bk = await call('book', 'POST', `/classes/${cls.body.id}/book`, st.tok, {});
  if (bk.status >= 300) { note(label, 'book', bk.status, JSON.stringify(bk.body)); return null; }
  const before = await (await fetch(`${FAKE}/__calls`)).json();
  const c = await call('cancel', 'PATCH', `/bookings/${bk.body.id}/cancel`, st.tok, {});
  await sleep(500);
  const tx = await db.transaction.findFirst({ where: { bookingId: bk.body.id, kind: 'LATE_CANCEL_FEE' } });
  const booking = await db.booking.findUnique({ where: { id: bk.body.id } });
  const piRow = tx?.stripePaymentIntentId ? await (await fetch(`${FAKE}/v1/payment_intents/${tx.stripePaymentIntentId}`)).json() : null;
  note(label, 'cancel', c.status, 'outcome', booking.cancellationChargeOutcome, 'tx', tx && { amount: tx.amount, currency: tx.currency, status: tx.status }, 'stripe PI', piRow && { amount: piRow.amount, currency: piRow.currency });
  return { tx, piRow, booking };
}
if (p.status < 300 && cls.status < 300) {
  const st = await member(C.adults[109], p.body.id);
  const r = await lateCancel(st, 'S10B plan without currency:');
  ok('S10B late-cancel fee on a School-currency plan is charged in CAD', r?.tx?.currency === 'CAD' && r?.piRow?.currency === 'cad', r ? `Transaction ${r.tx?.amount} ${r.tx?.currency}; Stripe PaymentIntent ${r.piRow?.amount} ${r.piRow?.currency}` : 'no booking');
  // C. Same with a declined card (fee ends in 13).
  await call('plan', 'PATCH', `/membership-plans/${C.plans.family}`, O, { cancellationCharge: 1513 });
  const st2 = await member(C.adults[112], C.plans.family);
  const r2 = await lateCancel(st2, 'S10C declined card:');
  ok('S10C a declined late-cancel fee is a FAILED row and the booking says FAILED', r2?.tx?.status === 'FAILED' && r2?.booking?.cancellationChargeOutcome === 'FAILED', r2 ? `${r2.tx?.status} / ${r2.booking?.cancellationChargeOutcome}` : 'no booking');
  // Is a FAILED late-cancel fee ever collected again or does it just sit?
  state.failedLateCancel = r2?.tx?.id;
}
save();
fs.writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify(state, null, 1));
fs.writeFileSync(new URL('./money-log.txt', import.meta.url), log.join('\n') + '\n', { flag: 'a' });
await db.$disconnect();
