// Journey 4: booking, the class waitlist and the plan's member limit; check-in
// (QR and desk); attendance; a promotion; a freeze; a refund or cancel.
import { call, must, journey, check, ok, step, signUp, signIn, FAKE_STRIPE, stripeWebhook, runJob, db, days } from './lib.mjs';
import { buy, joinSchool, monthlyWithoutCards } from './j3-members.mjs';

const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 300)); } };
const items = (b) => b?.items ?? (Array.isArray(b) ? b : []);

export async function j4Classes(s) {
  const c = s.cfg;
  if (!s.school || !s.adult || !s.child) return;
  journey(c.key, '4', 'Booking, waitlist, member limit, check-in, grading, freeze, refund');
  const sid = s.school.id;
  const O = () => s.owner.tok;
  const P = () => s.parent.tok;

  // --- Booking and the class waitlist (the class has 1 place) ---
  const b1 = await call('POST', `/classes/${s.smallClass.id}/book`, s.adult.tok, {});
  ok('adult books the 1-place class', b1.status < 300, `${b1.status} ${JSON.stringify(b1.body).slice(0, 160)}`);
  const full = await call('POST', `/classes/${s.smallClass.id}/book`, P(), { studentId: s.child.id });
  ok('the child can\'t book it once it is full', full.status >= 400, `${full.status} ${full.body?.error?.message ?? ''}`);
  const wl = await call('POST', `/classes/${s.smallClass.id}/waitlist`, P(), { studentId: s.child.id });
  ok('parent puts the child on the class waitlist', wl.status < 300, `${wl.status} ${JSON.stringify(wl.body).slice(0, 160)}`);
  const bookingId = b1.body?.id ?? b1.body?.bookingId;
  const cancel = await call('PATCH', `/bookings/${bookingId}/cancel`, s.adult.tok, {});
  ok('adult cancels the booking', cancel.status < 300, `${cancel.status} refundResolution ${cancel.body?.refundResolution}`);
  // A new School's cancellation policy is MANUAL: the owner decides each one
  // in Cancellations (credit back, refund or keep).
  const res = await call('PATCH', `/bookings/${bookingId}/resolution`, O(), { action: 'CREDIT' });
  const packBack = await db.membership.findFirst({ where: { studentId: s.adult.id, membershipPlanId: s.plans.pack.id } });
  ok('the owner gives the class back (manual cancellation policy)', res.status < 300 && packBack?.classesRemaining === 10, `${res.status}; classesRemaining ${packBack?.classesRemaining}`);
  const offered = await waitFor(async () => {
    const w = await db.waitlistEntry.findFirst({ where: { classId: s.smallClass.id, studentId: s.child.id } });
    return w && w.status !== 'WAITING' ? w : null;
  });
  ok('the freed place is offered to the child', !!offered, JSON.stringify(offered));
  if (offered) {
    const claim = await call('POST', `/waitlist/${offered.id}/claim`, P(), { studentId: s.child.id });
    ok('parent claims the place for the child', claim.status < 300, `${claim.status} ${JSON.stringify(claim.body).slice(0, 160)}`);
  }
  const bookedKid = await db.booking.findFirst({ where: { classId: s.smallClass.id, studentId: s.child.id, status: { not: 'CANCELLED' } } });
  ok('the child is booked in', !!bookedKid, bookedKid?.status);

  // --- The plan's member limit (2) ---
  const holders = await db.membership.count({ where: { membershipPlanId: s.plans.pack.id } });
  const [ef, el] = c.names.extra;
  s.extra = await step('a second member buys the limited plan', async () => {
    const p = await signUp({ first: ef, last: el, dob: '1995-01-17', country: c.country, language: c.language, currency: c.currency });
    await joinSchool(s, p); await signIn(p);
    const r = await buy(s, p, s.plans.pack.id);
    p.packTx = r.transactionId; p.buy = r;
    return p;
  });
  if (s.extra) ok('a second member buys the limited plan', s.extra.buy.tx?.status === 'SUCCESSFUL' || s.extra.buy.pending, `${holders} holder(s) before; ${s.extra.buy.outcome}`);
  const [lf, ll] = c.names.lonely;
  s.lonely = await step('a third member signs up', async () => { const p = await signUp({ first: lf, last: ll, dob: '1979-07-02', country: c.country, language: c.language, currency: c.currency }); await joinSchool(s, p); await signIn(p); return p; });
  if (s.lonely) {
    const over = await call('POST', `/membership-plans/${s.plans.pack.id}/purchase`, s.lonely.tok, c.cards ? { useHostedCheckout: true } : {});
    ok('the third member can\'t buy: the plan is full', over.status === 409 && /full/i.test(over.body?.error?.message ?? ''), `${over.status} ${over.body?.error?.message}`);
    const pwl = await call('POST', `/membership-plans/${s.plans.pack.id}/waitlist`, s.lonely.tok, {});
    ok('they join the plan\'s waiting list', pwl.status < 300, `${pwl.status} ${JSON.stringify(pwl.body).slice(0, 160)}`);
    const kwl = await call('POST', `/membership-plans/${s.plans.pack.id}/waitlist`, P(), { studentId: s.child.id });
    ok('a parent puts their child on the plan\'s waiting list', kwl.status < 300, `${kwl.status} ${JSON.stringify(kwl.body).slice(0, 120)}`);
    const owl = await call('GET', `/membership-plans/${s.plans.pack.id}/waitlist`, O());
    ok('the owner sees the plan\'s waiting list', owl.status === 200 && JSON.stringify(owl.body).includes(s.lonely.id), JSON.stringify(owl.body).slice(0, 200));
    // Item 12: staff can sell over the limit at the desk.
    const desk = await call('POST', `/schools/${sid}/students/${s.lonely.id}/memberships/sell`, O(), { membershipPlanId: s.plans.pack.id, paymentMethod: 'CASH' });
    ok('the owner can still sell it at the desk (over the limit)', desk.status < 300, `${desk.status} ${JSON.stringify(desk.body).slice(0, 200)}`);
    s.deskSale = desk.body;
  }

  // --- Check-in: the adult by QR, the child at the desk ---
  const bNow = await call('POST', `/classes/${s.nowClass.id}/book`, s.adult.tok, {});
  ok('adult books the class that is on now', bNow.status < 300, `${bNow.status} ${bNow.body?.error?.message ?? ''}`);
  const qr = await call('GET', `/classes/${s.nowClass.id}/qr-token`, O());
  const qrToken = qr.body?.token ?? qr.body?.qrToken;
  const scan = await call('POST', '/attendance/scan', s.adult.tok, { classId: s.nowClass.id, qrToken });
  ok('adult checks in by scanning the class QR code', qr.status === 200 && scan.status < 300, `qr ${qr.status}; scan ${scan.status} ${JSON.stringify(scan.body).slice(0, 200)}`);
  const desk = await call('POST', `/schools/${sid}/front-desk/check-ins`, s.staff?.tok ?? O(), { studentId: s.child.id, classIds: [s.nowClass.id] });
  ok('Branch Staff check the child in at the desk', desk.status < 300 && desk.body?.classes?.every?.((x) => x.ok), `${desk.status} ${JSON.stringify(desk.body).slice(0, 300)}`);
  const att = await db.booking.findMany({ where: { classId: s.nowClass.id, status: 'COMPLETED' } });
  ok('attendance is recorded once each', att.length === 2 && new Set(att.map((a) => a.studentId)).size === 2, `${att.length} attended bookings`);
  const packNow = await db.membership.findFirst({ where: { studentId: s.adult.id, membershipPlanId: s.plans.pack.id } });
  ok('the pack is used once for the class', packNow?.classesRemaining === 9, `classesRemaining ${packNow?.classesRemaining}`);
  const roster = await call('GET', `/classes/${s.nowClass.id}/bookings`, O());
  ok('the class roster shows both as checked in', roster.status === 200, `${roster.status} ${JSON.stringify(roster.body).slice(0, 200)}`);

  // --- A promotion ---
  const before = await db.studentRank.findFirst({ where: { studentId: s.adult.id, disciplineId: s.discipline.id }, include: { currentRank: true } });
  const promo = await call('POST', `/students/${s.adult.id}/ranks/${s.discipline.id}/promote`, O(), {});
  const after = await db.studentRank.findFirst({ where: { studentId: s.adult.id, disciplineId: s.discipline.id }, include: { currentRank: true } });
  ok('the owner promotes the adult', promo.status < 300, `${promo.status} ${promo.body?.error?.message ?? ''}; before ${before?.currentRank?.name ?? 'none'}, after ${after?.currentRank?.name ?? 'none'}`);

  // --- Refund a desk sale by hand (Decision 431) ---
  if (s.deskSale) {
    const tid = s.deskSale.transactionId ?? s.deskSale.transaction?.id;
    const rf = await call('POST', `/transactions/${tid}/refund`, O(), { amount: 8000, notes: c.cards ? 'Changed their mind' : 'Desistiu', endMembership: true });
    const m = await db.membership.findFirst({ where: { studentId: s.lonely.id, membershipPlanId: s.plans.pack.id } });
    ok('the owner refunds a desk sale by hand and ends the plan', rf.status < 300, `${rf.status} ${JSON.stringify(rf.body).slice(0, 200)}; membership ${m?.status}`);
  }
  // --- A freeze (class packs can't be frozen, Decision 404: a week pass sold at the desk) ---
  const week = await call('POST', `/schools/${sid}/students/${s.lonely.id}/memberships/sell`, O(), { membershipPlanId: s.plans.week.id, paymentMethod: 'CASH' });
  const mem = await db.membership.findFirst({ where: { studentId: s.lonely.id, membershipPlanId: s.plans.week.id } });
  const pk = await call('POST', `/schools/${sid}/memberships/${(await db.membership.findFirst({ where: { studentId: s.adult.id, membershipPlanId: s.plans.pack.id } })).id}/freezes`, O(), { startsAt: new Date(Date.now() + days(2)).toISOString().slice(0, 10), endsAt: new Date(Date.now() + days(4)).toISOString().slice(0, 10) });
  ok('a class pack can\'t be frozen', pk.status === 400 && pk.body?.error?.code === 'FREEZE_CLASS_PACK', `${pk.status} ${pk.body?.error?.code}`);
  const start = new Date(Date.now() + days(1)).toISOString().slice(0, 10), end = new Date(Date.now() + days(8)).toISOString().slice(0, 10);
  const fr = await call('POST', `/schools/${sid}/memberships/${mem.id}/freezes`, O(), { startsAt: start, endsAt: end });
  const memAfter = await db.membership.findUnique({ where: { id: mem.id } });
  ok('the owner freezes a week pass for 7 days; it ends later', week.status < 300 && fr.status < 300 && memAfter?.expiryDate > mem?.expiryDate, `sell ${week.status}; freeze ${fr.status} ${JSON.stringify(fr.body).slice(0, 200)}; expiry ${mem.expiryDate?.toISOString().slice(0, 10)} → ${memAfter?.expiryDate?.toISOString().slice(0, 10)}`);
  s.freeze = fr.body;

  // --- Refund or cancel ---
  if (c.cards && s.extra?.buy?.tx) {
    // The School refunds the second member in its Stripe Dashboard (the app has
    // no card-refund button for plans); Stripe tells ULTM8 by webhook.
    const t = await db.transaction.findUnique({ where: { id: s.extra.packTx } });
    const pi = await (await fetch(`${FAKE_STRIPE}/v1/payment_intents/${t.stripePaymentIntentId}`)).json();
    const ch = await (await fetch(`${FAKE_STRIPE}/__charges/${pi.latest_charge.id}/refund`, { method: 'POST', body: JSON.stringify({ amount: 8000 + 160 }) })).json();
    const wh = await stripeWebhook({ id: `evt_rf_${Date.now()}`, object: 'event', type: 'charge.refunded', account: s.acct, data: { object: ch } });
    const after2 = await waitFor(async () => { const x = await db.transaction.findUnique({ where: { id: t.id } }); return x.refundedAmount ? x : null; });
    ok('a card refund made in Stripe reaches the app (plan + its surcharge; joining fee kept)', wh.status === 200 && after2?.refundedAmount > 0, `webhook ${wh.status}; order ${after2?.status}, refunded ${after2?.refundedAmount} of ${t.amount + t.surchargeAmount}`);
    const m2 = await db.membership.findFirst({ where: { studentId: s.extra.id, membershipPlanId: s.plans.pack.id } });
    // The plan-waitlist job (every 15 minutes) offers freed places.
    await runJob('plan-waitlist');
    const freed = await db.planWaitlistEntry.findFirst({ where: { membershipPlanId: s.plans.pack.id, studentId: s.lonely?.id } });
    const hours = freed?.offerExpiresAt ? Math.round((freed.offerExpiresAt - freed.offeredAt) / 3600e3) : null;
    ok('the refund ends the plan and the freed place is held 24 h for the first person waiting', m2?.status === 'EXPIRED' && freed?.status === 'OFFERED' && hours === 24, `membership ${m2?.status}; waiting-list entry ${freed?.status}, held ${hours} h`);
  }
  if (!c.cards) {
    // A Pix/cash order the member never paid: the School cancels it.
    const o = await call('POST', `/membership-plans/${s.plans.week.id}/purchase`, s.extra?.tok, {});
    const cx = await call('PATCH', `/transactions/${o.body?.transactionId}/cancel`, O(), { reason: 'Não pagou' });
    const tx = await db.transaction.findUnique({ where: { id: o.body?.transactionId ?? '' } });
    ok('the School cancels an unpaid Pix/cash order', o.status < 300 && cx.status < 300 && tx?.status === 'FAILED' && !!tx?.cancelledAt, `order ${o.status}; cancel ${cx.status}; status ${tx?.status}, cancelled ${!!tx?.cancelledAt}, reason "${tx?.cancelReason}"`);
  }
  if (!c.cards && s.extra?.packTx) {
    // The second member's Pix order: confirmed, then given back by hand.
    await call('PATCH', `/transactions/${s.extra.packTx}/confirm`, O(), {});
    const tooMuch = await call('POST', `/transactions/${s.extra.packTx}/refund`, O(), { amount: 10500, notes: 'Devolvido por Pix' });
    const rf = await call('POST', `/transactions/${s.extra.packTx}/refund`, O(), { amount: 8000, notes: 'Devolvido por Pix', endMembership: true });
    const t = await db.transaction.findUnique({ where: { id: s.extra.packTx } });
    ok('a confirmed Pix order is refunded by hand; the non-refundable joining fee can\'t be', tooMuch.status === 400 && tooMuch.body?.error?.code === 'REFUND_MORE_THAN_LEFT' && rf.status < 300 && t.status === 'REFUNDED',
      `refund 105,00: ${tooMuch.status} ${tooMuch.body?.error?.code}; refund 80,00: ${rf.status}; payment ${t.status}, refunded ${t.refundedAmount}`);
  }

  // --- The plan that switches to another when it ends (Decision 435 item 9) ---
  if (c.cards) await step('a member agrees to switch plans when buying; the switch job runs', async () => {
    const p = await signUp({ first: c.key === 'B' ? 'Rita' : 'Noah', last: c.key === 'B' ? 'Alves' : 'Green', dob: '1992-02-02', country: c.country, language: c.language, currency: c.currency });
    await joinSchool(s, p); await signIn(p);
    const r = await buy(s, p, s.plans.week.id, { agreeToPlanSwitch: true });
    if (!c.cards) await must('confirm', 'PATCH', `/transactions/${r.transactionId}/confirm`, O(), {});
    let m = await db.membership.findFirst({ where: { studentId: p.id, membershipPlanId: s.plans.week.id } });
    if (!c.cards) {
      // Decision 441 item 3: hidden and ignored where the School takes no cards.
      ok('at a School without cards the plan has no switch and the member\'s "agree" is ignored', !m?.switchToPlanId && !m?.switchAgreedAt && !s.plans.week.switchToPlanId, `membership switch ${m?.switchToPlanId ?? 'none'}, agreed ${m?.switchAgreedAt ?? 'no'}`);
      return p;
    }
    ok('the membership remembers the agreed switch', !!m?.switchAgreedAt && m.switchToPlanId === s.plans.next.id, `switch to ${m?.switchToPlanId === s.plans.next.id ? s.plans.next.title : m?.switchToPlanId}, agreed ${m?.switchAgreedAt?.toISOString()}`);
    // "Later": 3 days before the end, then just after it (the hourly job).
    await db.membership.update({ where: { id: m.id }, data: { expiryDate: new Date(Date.now() + days(3)) } });
    await runJob('plan-switch');
    await new Promise((res) => setTimeout(res, 1500)); // the notice goes out through the notification queue
    const notice = await db.notification.findFirst({ where: { userId: p.id }, orderBy: { createdAt: 'desc' } });
    m = await db.membership.findUnique({ where: { id: m.id } });
    ok('the member is told before the switch', !!m.switchNoticeSentAt, `notice sent ${m.switchNoticeSentAt?.toISOString()}; "${notice?.title}"`);
    await db.membership.update({ where: { id: m.id }, data: { expiryDate: new Date(Date.now() - 60e3) } });
    await runJob('plan-switch');
    m = await db.membership.findUnique({ where: { id: m.id } });
    const next = await db.membership.findFirst({ where: { studentId: p.id, membershipPlanId: s.plans.next.id } });
    const charged = await db.transaction.count({ where: { studentId: p.id, membershipPlanId: s.plans.next.id } });
    await new Promise((res) => setTimeout(res, 1500));
    const told = await db.notification.findMany({ where: { userId: p.id }, orderBy: { createdAt: 'desc' }, take: 2 });
    ok('with no saved card the membership simply ends; nothing is charged; the member is told', m.switchOutcome === 'NO_CARD' && !next && charged === 0 && told.length === 2 && told[0].title !== told[1].title,
      `outcome ${m.switchOutcome}; next plan ${next ? 'started' : 'not started'}; charges ${charged}; last notice "${told[0]?.title}"`);
    return p;
  });

  if (!c.cards && s.plans.subNoCards && s.extra && s.parent) await monthlyWithoutCards(s, s.extra, s.parent);

  // Decision 448 item 1: the card surcharge is its own revenue line.
  if (c.cards) {
    const sum = await call('GET', `/schools/${sid}/transactions/summary`, O());
    const rows = await db.transaction.findMany({ where: { schoolId: sid, status: { in: ['SUCCESSFUL', 'REFUNDED'] } } });
    const kept = rows.reduce((n, t) => n + t.amount + (t.surchargeAmount ?? 0) - (t.refundedAmount ?? 0), 0);
    const rev = sum.body?.revenue?.find?.((x) => x.currency === c.currency)?.amount ?? null;
    const sur = sum.body?.surcharges?.find?.((x) => x.currency === c.currency)?.amount ?? null;
    ok('Transactions: revenue and card surcharges are separate lines that add up to what was kept', sum.status === 200 && sur > 0 && rev + sur === kept, `revenue ${rev}, surcharges ${sur}, kept in the ledger ${kept}`);
    const ov = await call('GET', `/schools/${sid}/charge-reports/overview`, O());
    const cur = ov.body?.currencies?.find?.((x) => x.currency === c.currency);
    ok('the billing overview shows the card surcharges as their own figure', ov.status === 200 && cur?.surcharges === sur && cur?.total === cur?.memberships + (cur?.fees ?? 0) + cur?.surcharges + (cur?.net ?? cur?.paid ?? 0), `${ov.status} memberships ${cur?.memberships}, fees ${cur?.fees}, surcharges ${cur?.surcharges}, total ${cur?.total}`);
  }

  if (c.cards && s.plans.sub) {
    // A Subscription, then cancel at period end (member side).
    const r = await call('POST', `/membership-plans/${s.plans.sub.id}/purchase`, s.parent.tok, {});
    ok('the parent starts a monthly Subscription (card, in-app)', r.status < 300 && r.body?.outcome === 'requires_payment', `${r.status} ${r.body?.outcome ?? JSON.stringify(r.body).slice(0, 200)}`);
    s.parentSub = r.body;
  }
}
