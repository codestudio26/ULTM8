// Round 6 T: races on features since round 5 (Decisions 441-444), each on a
// clean School made for it.
//   ONLY=R1,R2 node races.mjs
// R1 confirm vs cancel of the same Pix order        (Decision 441 item 2)
// R2 owner and Branch Staff confirming at once         (Decision 441 item 2, 443 item 2)
// R3 booking vs waiver signing                          (Decision 441 item 5)
// R4 freeze approval vs the charge-recurring job        (Decision 443 item 1)
// R5 account.updated out of order and duplicated        (Decision 441 item 6, 442 item 2)
// R6 two parents acting on one child at once
// R7 purchase while the plan is archived / price changed (Decision 442: "keeps the price they bought at")
// R8 last place on a plan with a member limit, two cash orders at once (Decision 435 item 10)
import { DateTime } from 'luxon';
import { call, must, db, signUp, signIn, burst, pool, FAKE, stripeWebhook, runJob, sleep, ok, note, sectionOf } from './lib.mjs';
import { seedSchool } from './seed.mjs';

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const TAG = process.env.RUN_TAG || `r${Date.now().toString(36)}`;
let seq = 0;
const person = (first, extra = {}) => signUp({ first, last: 'Race', tag: `${TAG}${seq++}`, ...extra });

/** A clean School (seed.mjs, no imported members) plus a coach and a style. */
async function cleanSchool(planIndex, label) {
  const s = await seedSchool(planIndex, { members: 0, tag: `${TAG}${label}` });
  const T = s.owner.tok;
  const style = await must('style', 'POST', `/schools/${s.sid}/disciplines/from-template`, T, { templateId: 'ibjjf', name: 'BJJ' });
  const d = await db.discipline.findUnique({ where: { id: style.id } });
  s.styles = [{ disciplineId: style.id, classType: (d.classTypesOffered || [])[0] ?? null }];
  await must('instructor role', 'POST', `/users/${s.owner.id}/role-grants`, T, { role: 'INSTRUCTOR', schoolId: s.sid, branchId: s.branchId });
  await signIn(s.owner);
  await must('instructor', 'POST', `/schools/${s.sid}/instructors`, s.owner.tok, { userId: s.owner.id, branchId: s.branchId, specializationStyleIds: [style.id] });
  s.mkClass = (title, startMs, endMs, extra = {}) => must(`class ${title}`, 'POST', `/schools/${s.sid}/classes`, s.owner.tok, {
    branchId: s.branchId, instructorId: s.owner.id, title, styles: s.styles, startDate: new Date(startMs).toISOString(), endDate: new Date(endMs).toISOString(), membershipInclusion: true, ...extra,
  });
  note(`clean School for ${label}`, `${s.ck} ${s.provider} ${s.sid}`);
  return s;
}
const join = async (s, p, studentId) => { const r = await must('join', 'POST', `/schools/${s.sid}/join`, p.tok, { branchId: s.branchId, ...(studentId ? { studentId } : {}) }); await signIn(p); return r; };
const sign = (s, p, studentId) => call('POST', `/waivers/${s.waiverId}/sign`, p.tok, { ...(studentId ? { studentId } : {}), signerFullName: `${p.first} ${p.last}`, signatureText: `${p.first} ${p.last}` });
const order = (planId, p, extra = {}) => must('purchase', 'POST', `/membership-plans/${planId}/purchase`, p.tok, extra);
const S = (r) => `${r.status}${r.body?.error?.code ? ' ' + r.body.error.code : ''}`;

async function staffFor(s) {
  const st = await person('Staff');
  await must('grant staff', 'POST', `/users/${st.id}/role-grants`, s.owner.tok, { role: 'BRANCH_STAFF', schoolId: s.sid, branchId: s.branchId });
  await must('record payments on', 'PATCH', `/schools/${s.sid}`, s.owner.tok, { branchStaffCanRecordPayments: true });
  await signIn(st);
  return st;
}

async function orderState(txId) {
  const tx = await db.transaction.findUnique({ where: { id: txId } });
  const ms = await db.membership.findMany({ where: { studentId: tx.studentId, schoolId: tx.schoolId }, select: { id: true, status: true, billedToBalance: true } });
  const series = ms.length ? await db.recurringCharge.count({ where: { membershipId: { in: ms.map((m) => m.id) } } }) : 0;
  return { status: tx?.status, memberships: ms.length, active: ms.filter((m) => m.status === 'ACTIVE').length, series };
}

// ---------------------------------------------------------------------------
if (want('R1') || want('R2') || want('R7') || want('R8')) {
  const s = await cleanSchool(10, 'pix'); // BR, CASH (no cards)
  const staff = await staffFor(s);
  // Members who joined and signed the waiver.
  const members = await pool(Array.from({ length: 12 }, (_, k) => k), 3, async (k) => { const p = await person(`Ana${k}`); await join(s, p); await sign(s, p); return p; });

  if (want('R1')) {
    sectionOf('R1 confirm vs cancel of the same Pix/cash order');
    const rows = [];
    for (let k = 0; k < 6; k++) {
      const plan = k % 2 ? s.plans.sub : s.plans.pack;
      const o = await order(plan, members[k]);
      const [c1, c2] = await burst([
        () => call('PATCH', `/transactions/${o.transactionId}/confirm`, s.owner.tok, {}),
        () => call('PATCH', `/transactions/${o.transactionId}/cancel`, s.owner.tok, { reason: 'race' }),
      ]);
      await sleep(300);
      const st = await orderState(o.transactionId);
      const consistent = (c1.status < 300) !== (c2.status < 300) && ((c1.status < 300 && st.status === 'SUCCESSFUL' && st.active === 1) || (c2.status < 300 && st.status !== 'SUCCESSFUL' && st.active === 0)) && st.series === (plan === s.plans.sub && c1.status < 300 ? 1 : 0);
      rows.push({ plan: k % 2 ? 'monthly' : 'pack', confirm: S(c1), cancel: S(c2), ...st, consistent });
    }
    ok('R1: exactly one of confirm/cancel wins, and the order, membership and monthly series agree', rows.every((r) => r.consistent), rows);
  }

  if (want('R2')) {
    sectionOf('R2 owner and Branch Staff confirming the same order at once');
    const rows = [];
    for (let k = 6; k < 10; k++) {
      const plan = k % 2 ? s.plans.sub : s.plans.pack;
      const o = await order(plan, members[k]);
      const rs = await burst([s.owner.tok, staff.tok, s.owner.tok, staff.tok].map((t) => () => call('PATCH', `/transactions/${o.transactionId}/confirm`, t, {})));
      await sleep(300);
      const st = await orderState(o.transactionId);
      const pays = await db.transaction.count({ where: { studentId: members[k].id, schoolId: s.sid, status: 'SUCCESSFUL' } });
      rows.push({ plan: k % 2 ? 'monthly' : 'pack', results: rs.map(S).join(','), wins: rs.filter((r) => r.status < 300).length, ...st, successfulTx: pays });
    }
    ok('R2: one confirm wins; one membership, one payment, at most one monthly series', rows.every((r) => r.wins === 1 && r.active === 1 && r.successfulTx === 1 && r.series <= 1), rows);
  }

  if (want('R7')) {
    sectionOf('R7 purchase vs plan price change / archive');
    // (a) not a race: the order is placed at the old price, the owner raises the
    // price, staff confirm: the member keeps the price they bought at (Decision 442).
    const p = members[10];
    const plan2 = await must('plan', 'POST', `/schools/${s.sid}/membership-plans`, s.owner.tok, { currency: s.cur, type: 'SUBSCRIPTION', title: 'Monthly R7', price: 10000 });
    const o = await order(plan2.id, p);
    const tx0 = await db.transaction.findUnique({ where: { id: o.transactionId } });
    const ch = await call('PATCH', `/membership-plans/${plan2.id}`, s.owner.tok, { price: 15000 });
    const cf = await call('PATCH', `/transactions/${o.transactionId}/confirm`, s.owner.tok, {});
    await sleep(500);
    const m = await db.membership.findFirst({ where: { studentId: p.id, membershipPlanId: plan2.id }, include: { recurringCharge: true } });
    ok('R7a: an order placed before a price rise keeps its price on the monthly series', m?.recurringCharge?.unitAmount === tx0.amount,
      `order ${tx0.amount}; price change ${S(ch)} ${JSON.stringify(ch.body).slice(0, 160)}; confirm ${S(cf)}; series unitAmount ${m?.recurringCharge?.unitAmount}`);
    // (b) the race: purchases while the owner changes the price.
    const plan3 = await must('plan', 'POST', `/schools/${s.sid}/membership-plans`, s.owner.tok, { currency: s.cur, type: 'SUBSCRIPTION', title: 'Monthly R7b', price: 20000 });
    const buyers = await pool([0, 1, 2], 3, async (k) => { const q = await person(`Bia${k}`); await join(s, q); await sign(s, q); return q; });
    const rs = await burst([...buyers.map((q) => () => call('POST', `/membership-plans/${plan3.id}/purchase`, q.tok, {})), () => call('PATCH', `/membership-plans/${plan3.id}`, s.owner.tok, { price: 25000 })]);
    const rows = [];
    for (let k = 0; k < buyers.length; k++) {
      if (rs[k].status >= 300) { rows.push({ buy: S(rs[k]) }); continue; }
      await call('PATCH', `/transactions/${rs[k].body.transactionId}/confirm`, s.owner.tok, {});
      await sleep(300);
      const tx = await db.transaction.findUnique({ where: { id: rs[k].body.transactionId } });
      const mm = await db.membership.findFirst({ where: { studentId: buyers[k].id, membershipPlanId: plan3.id }, include: { recurringCharge: true } });
      rows.push({ buy: S(rs[k]), paid: tx.amount, series: mm?.recurringCharge?.unitAmount });
    }
    ok('R7b: each racing buyer\'s monthly charge equals what they paid', rows.every((r) => !r.paid || r.paid === r.series), { priceChange: S(rs[3]), rows });
    // (c) purchase vs archive.
    const plan4 = await must('plan', 'POST', `/schools/${s.sid}/membership-plans`, s.owner.tok, { currency: s.cur, type: 'CLASS_PACK', title: 'Pack R7c', price: 5000, classesIncluded: 5, expiryDurationDays: 30 });
    const buyers2 = await pool([0, 1, 2, 3], 4, async (k) => { const q = await person(`Cai${k}`); await join(s, q); await sign(s, q); return q; });
    const archive = () => call('POST', `/membership-plans/${plan4.id}/archive`, s.owner.tok, {});
    const rs2 = await burst([...buyers2.map((q) => () => call('POST', `/membership-plans/${plan4.id}/purchase`, q.tok, {})), archive]);
    const after = await db.membershipPlan.findUnique({ where: { id: plan4.id } });
    const conf = [];
    for (let k = 0; k < buyers2.length; k++) if (rs2[k].status < 300) conf.push(S(await call('PATCH', `/transactions/${rs2[k].body.transactionId}/confirm`, s.owner.tok, {})));
    note('R7c: purchases racing an archive', { buys: rs2.slice(0, 4).map(S), archive: S(rs2[4]), archivedAt: after.archivedAt ?? after.status, confirmsAfter: conf });
  }

  if (want('R8')) {
    sectionOf('R8 last place on a plan with a member limit, two cash orders at once');
    const lim = await must('plan', 'POST', `/schools/${s.sid}/membership-plans`, s.owner.tok, { currency: s.cur, type: 'CLASS_PACK', title: 'Limited', price: 4000, classesIncluded: 4, expiryDurationDays: 30, memberLimit: 1 });
    const two = await pool([0, 1, 2, 3], 4, async (k) => { const q = await person(`Dan${k}`); await join(s, q); await sign(s, q); return q; });
    const rs = await burst(two.map((q) => () => call('POST', `/membership-plans/${lim.id}/purchase`, q.tok, {})));
    const pending = await db.transaction.count({ where: { membershipPlanId: lim.id, status: 'PENDING' } }).catch(() => -1);
    ok('R8: one cash order takes the last place; the others are refused', rs.filter((r) => r.status < 300).length === 1, { results: rs.map(S), pendingOrders: pending });
  }
}

// ---------------------------------------------------------------------------
if (want('R3')) {
  sectionOf('R3 booking vs waiver signing (waiver before booking, on by default)');
  const s = await cleanSchool(17, 'waiver'); // AU, CASH
  const cls = await s.mkClass('Race class', Date.now() + 86400e3, Date.now() + 86400e3 + 3600e3, { capacity: 30 });
  const rows = [];
  const ppl = await pool(Array.from({ length: 8 }, (_, k) => k), 4, async (k) => { const p = await person(`Eve${k}`); await join(s, p); await must('desk sale', 'POST', `/schools/${s.sid}/students/${p.id}/memberships/sell`, s.owner.tok, { membershipPlanId: s.plans.pack, paymentMethod: 'CASH' }); return p; });
  for (const p of ppl) {
    const [w, b] = await burst([() => sign(s, p), () => call('POST', `/classes/${cls.id}/book`, p.tok, {})]);
    const sig = await db.waiverSignature.findFirst({ where: { studentId: p.id }, select: { createdAt: true, status: true }, orderBy: { createdAt: "asc" } }).then((x) => x && { signedAt: x.createdAt, status: x.status });
    const bk = await db.booking.findFirst({ where: { studentId: p.id, classId: cls.id }, select: { createdAt: true, status: true } });
    rows.push({ sign: S(w), book: S(b), signedAt: sig?.signedAt, bookedAt: bk?.createdAt, bad: !!bk && (!sig || sig.signedAt > bk.createdAt) });
  }
  ok('R3: never booked without a signed waiver', rows.every((r) => !r.bad), rows);
}

// ---------------------------------------------------------------------------
if (want('R4')) {
  sectionOf('R4 freeze approval vs the charge-recurring job, on the billing day');
  const s = await cleanSchool(8, 'freeze'); // BR, BANK_TRANSFER
  const ppl = await pool(Array.from({ length: 10 }, (_, k) => k), 4, async (k) => { const p = await person(`Fer${k}`); await join(s, p); await must('desk sale', 'POST', `/schools/${s.sid}/students/${p.id}/memberships/sell`, s.owner.tok, { membershipPlanId: s.plans.sub, paymentMethod: 'CASH' }); return p; });
  const today = DateTime.now().setZone(s.tz).toISODate();
  const monthAgo = DateTime.fromISO(today).minus({ months: 1 }).toISODate();
  const ms = await db.membership.findMany({ where: { schoolId: s.sid, billedToBalance: true }, include: { recurringCharge: true } });
  // Shortcut: a month later (the series' first date and next date moved back a month).
  for (const m of ms) await db.recurringCharge.update({ where: { id: m.recurringCharge.id }, data: { firstDate: new Date(monthAgo + 'T00:00:00Z'), nextDate: new Date(today + 'T00:00:00Z') } });
  const end = DateTime.fromISO(today).plus({ days: 14 }).toISODate();
  const rs = await burst([
    () => runJob('charge-recurring'),
    ...ms.map((m) => () => call('POST', `/schools/${s.sid}/memberships/${m.id}/freezes`, s.owner.tok, { startsAt: today, endsAt: end })),
  ]);
  await sleep(1000);
  const rows = [];
  for (const m of ms) {
    const rc = await db.recurringCharge.findUnique({ where: { membershipId: m.id } });
    const chs = await db.charge.findMany({ where: { recurringChargeId: rc.id }, select: { dueDate: true } });
    const next = rc.nextDate?.toISOString().slice(0, 10);
    const chargedToday = chs.some((c) => c.dueDate.toISOString().slice(0, 10) === today);
    const okRow = chs.length <= 1 && (chargedToday ? next === DateTime.fromISO(today).plus({ months: 1, days: 14 }).toISODate() : next === end);
    rows.push({ chargedToday, charges: chs.length, next, okRow });
  }
  const fr = rs.slice(1).map(S);
  ok('R4: each member is charged today and moved a month+14 days, or not charged and moved to the day back; never both or neither', rows.every((r) => r.okRow), { freezes: fr, rows });
  // Approving the same request twice at once.
  const p = ppl[0];
  const m0 = ms.find((m) => m.studentId === p.id);
  const req = await call('POST', `/memberships/${m0.id}/freeze-requests`, p.tok, { startsAt: DateTime.fromISO(today).plus({ days: 60 }).toISODate(), endsAt: DateTime.fromISO(today).plus({ days: 74 }).toISODate() });
  if (req.status < 300) {
    const before = await db.recurringCharge.findUnique({ where: { membershipId: m0.id } });
    const ap = await burst([0, 1, 2].map(() => () => call('POST', `/schools/${s.sid}/freezes/${req.body.id}/approve`, s.owner.tok, {})));
    await sleep(500);
    const after = await db.recurringCharge.findUnique({ where: { membershipId: m0.id } });
    ok('R4b: a request approved three times at once is approved once', ap.filter((r) => r.status < 300).length === 1, { approve: ap.map(S), nextBefore: before.nextDate, nextAfter: after.nextDate });
  } else note('R4b: freeze request', S(req) + ' ' + JSON.stringify(req.body).slice(0, 200));
}

// ---------------------------------------------------------------------------
if (want('R5')) {
  sectionOf('R5 account.updated out of order and duplicated');
  const s = await cleanSchool(0, 'acct'); // GB STRIPE (ready after seed)
  const acct = s.stripeAcct;
  const ready = async () => (await db.paymentAccount.findUnique({ where: { id: s.acctId } })).stripeAccountReady;
  const waitProcessed = async (evId) => { for (let k = 0; k < 80; k++) { if (await db.processedStripeEvent.findUnique({ where: { stripeEventId: evId } })) return true; await sleep(100); } return false; };
  const ev = (id) => ({ id, object: 'event', type: 'account.updated', account: acct, data: { object: { id: acct, object: 'account' } } });
  // (a) duplicates: the same event five times at once.
  await fetch(`${FAKE}/__accounts/${acct}`, { method: 'POST', body: JSON.stringify({ charges_enabled: false }) });
  const dupId = `evt_dup_${TAG}`;
  const d = await burst([0, 1, 2, 3, 4].map(() => () => stripeWebhook(ev(dupId))));
  await waitProcessed(dupId); await sleep(500);
  const rows = await db.processedStripeEvent.count({ where: { stripeEventId: dupId } });
  ok('R5a: a duplicated account.updated is processed once and saves what Stripe says (not ready)', rows === 1 && (await ready()) === false, { http: d.map((x) => x.status), rows, ready: await ready() });
  // (b) out of order: an older event's read of Stripe is slow and says "not
  // ready"; Stripe then says ready and a newer event is processed first.
  // Needs two workers (a second API instance: clock.cjs --serve).
  await fetch(`${FAKE}/__delay`, { method: 'POST', body: JSON.stringify({ path: `/v1/accounts/${acct}`, ms: 2500 }) });
  const old = `evt_old_${TAG}`, neu = `evt_new_${TAG}`;
  await stripeWebhook(ev(old));
  await sleep(700); // the old event's worker has asked Stripe (snapshot: not ready)
  await fetch(`${FAKE}/__delay`, { method: 'POST', body: JSON.stringify({ path: `/v1/accounts/${acct}`, ms: 0 }) });
  await fetch(`${FAKE}/__accounts/${acct}`, { method: 'POST', body: JSON.stringify({ charges_enabled: true, details_submitted: true }) });
  await stripeWebhook(ev(neu));
  await waitProcessed(neu); const afterNew = await ready();
  await waitProcessed(old); await sleep(300); const afterOld = await ready();
  ok('R5b: after both events the School shows what Stripe says now (ready)', afterOld === true, { readyAfterNewEvent: afterNew, readyAfterOldEventFinished: afterOld, stripeSaysNow: true });
  // (c) does the School recover? A card purchase now, and the owner opening the payment account.
  const p = await person('Gus'); await join(s, p); await sign(s, p);
  const buy = await call('POST', `/membership-plans/${s.plans.pack}/purchase`, p.tok, { useHostedCheckout: true });
  const status = await call('GET', `/schools/${s.sid}/payment-account/connect-status`, s.owner.tok);
  note('R5c: with the stale flag: a card purchase, then the owner reading the Connect status', { purchase: S(buy), connectStatus: S(status), readyAfterStatusRead: await ready() });
}

// ---------------------------------------------------------------------------
if (want('R6')) {
  sectionOf('R6 two parents acting on one child at once');
  const s = await cleanSchool(11, 'parents'); // JP, CASH
  const cls = await s.mkClass('Kids race', Date.now() + 2 * 86400e3, Date.now() + 2 * 86400e3 + 3600e3, { capacity: 1 });
  const A = await person('Hana', { dob: '1985-01-01' });
  const B = await person('Ken', { dob: '1984-01-01' });
  const child = await must('add child', 'POST', '/guardians/me/minors', A.tok, { firstName: 'Yui', surname: 'Race', dateOfBirth: '2016-05-20', consentPolicyVersion: '1.0-placeholder' });
  const childId = child.id ?? child.studentId ?? child.userId;
  await join(s, A, childId);
  const add = await call('POST', `/schools/${s.sid}/students/${childId}/guardians`, s.owner.tok, { firstName: B.first, surname: B.last, email: B.email });
  note('R6: owner adds the second parent', `${S(add)} ${JSON.stringify(add.body).slice(0, 300)}`);
  // The second parent accepts the School's invite (consent ticked), then signs in again.
  if (add.body?.inviteId) { const acc = await call('POST', `/child-invites/${add.body.inviteId}/accept`, B.tok, { consentPolicyVersion: '1.0-placeholder' }); note('R6: second parent accepts', S(acc)); await signIn(B); }
  const linked = await db.guardianLink.findMany({ where: { studentId: childId }, select: { guardianId: true, revokedAt: true } });
  note('R6: links', JSON.stringify(linked)?.slice(0, 400));
  await signIn(A);
  const both = [A, B];
  // Two freeze requests and two cancellations of the same booking at once come after.
  const w = await burst(both.map((p) => () => sign(s, p, childId)));
  const sigs = await db.waiverSignature.count({ where: { studentId: childId } });
  const buys = await burst(both.map((p) => () => call('POST', `/membership-plans/${s.plans.pack}/purchase`, p.tok, { studentId: childId })));
  const pend = await db.transaction.count({ where: { studentId: childId, status: 'PENDING' } });
  for (const b of buys) if (b.status < 300) await call('PATCH', `/transactions/${b.body.transactionId}/confirm`, s.owner.tok, {});
  await sleep(300);
  const act = await db.membership.count({ where: { studentId: childId, schoolId: s.sid, status: 'ACTIVE' } });
  const bk = await burst(both.map((p) => () => call('POST', `/classes/${cls.id}/book`, p.tok, { studentId: childId })));
  const bookings = await db.booking.count({ where: { studentId: childId, classId: cls.id, status: { not: 'CANCELLED' } } }).catch(() => -1);
  const bkId = bk.find((r) => r.status < 300)?.body?.id;
  const cx = bkId ? await burst(both.map((p) => () => call('PATCH', `/bookings/${bkId}/cancel`, p.tok, {}))) : [];
  const m = await db.membership.findFirst({ where: { studentId: childId, schoolId: s.sid, status: 'ACTIVE' }, select: { id: true, classesRemaining: true } }).catch(() => null);
  note('R6: both parents cancel the same booking at once', { cancel: cx.map(S), membership: m });
  ok('R6: two parents at once: one booking for the child', bookings <= 1, { waiver: w.map(S), signatures: sigs, buys: buys.map(S), pendingOrders: pend, activeMemberships: act, book: bk.map(S), bookings });
}

// ---------------------------------------------------------------------------
if (want('R9')) {
  sectionOf('R9 signing back in at the moment the daily erasure job runs (Decision 436 item 2, 440)');
  const s = await cleanSchool(9, 'erase'); // BR, CASH
  const ppl = await pool(Array.from({ length: 8 }, (_, k) => k), 4, async (k) => { const p = await person(`Ivo${k}`); await join(s, p); return p; });
  const rows = [];
  for (const p of ppl) {
    const su = await must('step-up', 'POST', '/auth/step-up/verify', p.tok, { passcode: p.passcode });
    const del = await call('POST', '/users/me/deletion', p.tok, undefined, { 'x-step-up-token': su.stepUpToken ?? su.token });
    const u0 = await db.user.findUnique({ where: { id: p.id }, select: { deletionDueAt: true, deletionRequestedAt: true } });
    const n = await db.notification.findFirst({ where: { userId: p.id, title: 'Account deletion requested' }, select: { body: true } });
    rows.push({ del: S(del), dueAt: u0?.deletionDueAt, notice: n?.body?.slice(0, 80) });
  }
  // Shortcut: "30 days later" (the due date moved back, as the rehearsal does).
  await db.user.updateMany({ where: { id: { in: ppl.map((p) => p.id) } }, data: { deletionDueAt: new Date(Date.now() - 60e3) } });
  const results = await burst([() => runJob('account-erasure'), ...ppl.map((p) => () => call('POST', '/auth/login', null, { email: p.email, passcode: p.passcode }))]);
  await sleep(1500);
  const out = [];
  for (let k = 0; k < ppl.length; k++) {
    const u = await db.user.findUnique({ where: { id: ppl[k].id }, select: { erasedAt: true, deletionRequestedAt: true, email: true } });
    const login = results[k + 1].status;
    const consistent = login < 300 ? (!u.erasedAt && !u.deletionRequestedAt) : !!u.erasedAt;
    out.push({ login, erased: !!u.erasedAt, pending: !!u.deletionRequestedAt, consistent });
  }
  ok('R9: each person is either signed in with the deletion cancelled, or erased and refused, never both', out.every((r) => r.consistent), { job: results[0], out });
  note('R9: the deletion notice text and due time', rows.slice(0, 2));
}
await db.$disconnect();
process.exit(0);
