// Journey 3: an adult member signs up, signs the waiver and buys a plan; a
// parent adds a child, consents, signs the child's waiver and buys for them.
// School A pays by card through the fake Stripe Checkout (joining fee and the
// 2% surcharge on top); School B places a Cash/Bank (Pix) order that the
// School confirms.
import { call, must, journey, check, ok, step, signUp, signIn, stripeWebhook, FAKE_STRIPE, db } from './lib.mjs';

/** Sign the School's waiver as the member (or for a child, with studentId). */
async function signWaiver(s, person, studentId, name) {
  return must('sign waiver', 'POST', `/waivers/${s.waiver.id}/sign`, person.tok, { ...(studentId ? { studentId } : {}), signerFullName: name, signatureText: name });
}

/**
 * Buy a plan as the member (or for a child). Card: hosted Checkout, the member
 * pays on Stripe's page (the fake's pay hook), and Stripe sends its signed
 * webhook. Cash/Bank: an order waits for the School to confirm.
 * Returns { transactionId, lines, amount }.
 */
export async function buy(s, person, planId, extra = {}) {
  const card = s.cfg.cards;
  const r = await must('purchase', 'POST', `/membership-plans/${planId}/purchase`, person.tok, card ? { useHostedCheckout: true, ...extra } : { ...extra });
  if (!card) return { ...r, pending: r.outcome === 'pending_confirmation' };
  const cs = r.checkoutUrl?.split('/').pop();
  const paid = await (await fetch(`${FAKE_STRIPE}/__checkout/${cs}/pay`, { method: 'POST' })).json();
  const wh = await stripeWebhook({ id: `evt_${Date.now()}${Math.random().toString(16).slice(2, 8)}`, object: 'event', type: 'payment_intent.succeeded', account: s.acct, data: { object: paid.payment_intent } }); // Stripe sends the whole object
  // The webhook is processed on a queue; wait for the order to settle.
  let tx;
  for (let i = 0; i < 60; i++) {
    tx = await db.transaction.findUnique({ where: { id: r.transactionId } });
    if (tx?.status !== 'PENDING') break;
    await new Promise((res) => setTimeout(res, 250));
  }
  return { ...r, webhook: wh.status, lines: paid.lines, charged: paid.payment_intent.amount, tx };
}

export async function joinSchool(s, person, studentId) {
  return must('join', 'POST', `/schools/${s.school.id}/join`, person.tok, { branchId: s.branch.id, ...(studentId ? { studentId } : {}) });
}

export async function j3Members(s) {
  const c = s.cfg;
  if (!s.school || !s.plans?.pack) return;
  journey(c.key, '3', 'Members and parents: sign up, waiver, buy');
  const sid = s.school.id;
  const O = () => s.owner.tok;

  // --- Adult member ---
  const [af, al] = c.names.adult;
  s.adult = await step('adult member signs up', () => signUp({ first: af, last: al, dob: '1990-03-08', country: c.country, language: c.language, currency: c.currency }));
  if (!s.adult) return;
  check('adult member signs up', 'PASS', s.adult.email);
  const joined = await step('adult joins the School', () => joinSchool(s, s.adult));
  if (joined) check('adult joins the School', 'PASS', JSON.stringify(joined).slice(0, 160));
  await signIn(s.adult);

  // Decision 441 item 5: the School setting "Waiver must be signed before
  // booking or check-in" is on by default; buying is not blocked by it.
  const rule = await db.school.findUnique({ where: { id: sid } });
  const ruleKey = Object.keys(rule).find((k) => /waiver/i.test(k) && /book|checkin|check_in|required/i.test(k) && typeof rule[k] === 'boolean');
  ok('a new School has "Waiver must be signed before booking or check-in" on', ruleKey && rule[ruleKey] === true, `${ruleKey}=${ruleKey ? rule[ruleKey] : '?'}`);
  const earlyBook = await call('POST', `/classes/${s.smallClass.id}/book`, s.adult.tok, {});
  ok('booking a class before signing the waiver is refused (WAIVER_REQUIRED)', earlyBook.status === 403 && earlyBook.body?.error?.code === 'WAIVER_REQUIRED', `${earlyBook.status} ${earlyBook.body?.error?.code} ${earlyBook.body?.error?.message ?? ''}`);
  const blocked = await call('POST', `/membership-plans/${s.plans.pack.id}/purchase`, s.adult.tok, c.cards ? { useHostedCheckout: true } : {});
  ok('buying a plan before signing the waiver is allowed (Decision 441 item 5)', blocked.status < 300, `${blocked.status} ${blocked.body?.outcome ?? blocked.body?.error?.message ?? ''}`);
  if (blocked.status < 300 && !c.cards) {
    // A Cash/Bank order was placed: cancel it so the rehearsal starts clean.
    await call('PATCH', `/transactions/${blocked.body.transactionId}/cancel`, O(), { reason: 'Rehearsal: placed before the waiver' });
  }

  const pending = await call('GET', '/waivers/me', s.adult.tok);
  const mine = (pending.body?.items ?? pending.body ?? []).find?.((w) => (w.waiverId ?? w.id) === s.waiver.id);
  ok('the waiver shows as waiting for the member', pending.status === 200 && !!mine, `${pending.status}; ${JSON.stringify(mine ?? pending.body).slice(0, 200)}`);
  const signed = await step('adult signs the waiver', () => signWaiver(s, s.adult, null, `${af} ${al}`));
  if (signed) check('adult signs the waiver', 'PASS', `signature ${signed.id ?? JSON.stringify(signed).slice(0, 80)}`);

  const fee = await call('GET', `/membership-plans/${s.plans.pack.id}/joining-fee`, s.adult.tok);
  ok('the joining fee is shown before buying (first plan here)', fee.status === 200 && fee.body?.joiningFee === 2500, JSON.stringify(fee.body));

  if (c.cards) {
    const b = await step('adult buys the 10-class pack by card (Checkout)', () => buy(s, s.adult, s.plans.pack.id));
    if (b) {
      const want = 8000 + 2500 + Math.round((8000 + 2500) * 0.02);
      ok('adult buys the 10-class pack by card (Checkout)', b.webhook === 200 && b.tx?.status === 'SUCCESSFUL', `webhook ${b.webhook}; order ${b.tx?.status}`);
      ok('Checkout charges plan + joining fee + 2% surcharge', b.charged === want && b.lines?.length === 3,
        `lines ${JSON.stringify(b.lines)}; charged ${b.charged}, expected ${want}; order amount ${b.tx?.amount}, joining fee ${b.tx?.joiningFeeAmount}, surcharge ${b.tx?.surchargeAmount}`);
      s.adultPackTx = b.transactionId;
    }
  } else {
    const b = await step('adult places a Pix/cash order for the 10-class pack', () => buy(s, s.adult, s.plans.pack.id));
    if (b) {
      const tx = await db.transaction.findUnique({ where: { id: b.transactionId } });
      ok('adult places a Pix/cash order for the 10-class pack', b.pending && tx?.status === 'PENDING', `${b.outcome}; order ${tx?.status} ${tx?.paymentMethod}`);
      ok('the order includes the joining fee and no card surcharge', tx?.amount === 10500 && tx?.joiningFeeAmount === 2500 && (tx?.surchargeAmount ?? 0) === 0, `amount ${tx?.amount}, joining fee ${tx?.joiningFeeAmount}, surcharge ${tx?.surchargeAmount}`);
      // Decision 441 item 2 / 442 item 4: Branch Staff confirm with the School's
      // "Let Branch Staff record payments" switch, and are told of new orders.
      const staffNotes0 = await db.notification.count({ where: { userId: s.staff.id, title: { contains: 'Cash payment' } } });
      const staffTry = await call('PATCH', `/transactions/${b.transactionId}/confirm`, s.staff?.tok, {});
      ok('with the "record payments" switch off, Branch Staff can\'t confirm the Pix/cash order', staffTry.status >= 400 && staffTry.status < 500, `${staffTry.status} ${staffTry.body?.error?.code ?? ''} ${staffTry.body?.error?.message ?? ''}`);
      ok('…and aren\'t sent the "Cash payment waiting" notice', staffNotes0 === 0, `${staffNotes0} notices`);
      await must('record payments switch', 'PATCH', `/schools/${sid}`, O(), { branchStaffCanRecordPayments: true });
      const conf = await call('PATCH', `/transactions/${b.transactionId}/confirm`, s.staff?.tok, {});
      const after = await db.transaction.findUnique({ where: { id: b.transactionId } });
      const keys = Object.keys(conf.body ?? {}).sort();
      ok('with the switch on, Branch Staff confirm the Pix/cash order', conf.status < 300 && after?.status === 'SUCCESSFUL', `${conf.status}; order ${after?.status}`);
      ok('…and get back only the order\'s id, status, amount and membership (Decision 445 item 5)', conf.status < 300 && !keys.some((k) => /student|email|name|stripe|notes|invoice/i.test(k)) && keys.length <= 8, keys.join(','));
      s.adultPackTx = b.transactionId;
    }
  }
  const ms = await call('GET', '/memberships/me', s.adult.tok);
  const pack = (ms.body?.items ?? ms.body ?? []).find?.((m) => m.membershipPlanId === s.plans.pack.id);
  ok('the member has the pack with 10 classes', !!pack && pack.classesRemaining === 10, JSON.stringify(pack ?? ms.body).slice(0, 220));
  s.adultMembership = pack;


  // A second plan here: no joining fee again.
  const fee2 = await call('GET', `/membership-plans/${s.plans.week.id}/joining-fee`, s.adult.tok);
  ok('no joining fee on a second plan', fee2.status === 200 && !fee2.body?.joiningFee, JSON.stringify(fee2.body));

  // --- Parent and child ---
  const [pf, pl] = c.names.parent;
  s.parent = await step('parent signs up', () => signUp({ first: pf, last: pl, dob: '1984-11-30', country: c.country, language: c.language, currency: c.currency }));
  if (!s.parent) return;
  check('parent signs up', 'PASS', s.parent.email);
  await step('parent joins the School', () => joinSchool(s, s.parent));
  await signIn(s.parent);
  const [kf, kl] = c.names.child;
  const child = await step('parent adds a child (consent ticked)', () => must('add child', 'POST', '/guardians/me/minors', s.parent.tok, { firstName: kf, surname: kl, dateOfBirth: '2016-05-20', consentPolicyVersion: '1.0-placeholder' }));
  if (!child) return;
  s.child = { id: child.id ?? child.studentId, first: kf, last: kl };
  ok('parent adds a child (consent ticked)', !!s.child.id, JSON.stringify(child).slice(0, 200));
  const consent = await call('GET', `/guardians/me/minors/${s.child.id}/consent`, s.parent.tok);
  ok('the parent\'s consent is recorded with the child', consent.status === 200 && JSON.stringify(consent.body).includes('BASELINE'), JSON.stringify(consent.body).slice(0, 220));
  // Decision 444 item 7: saved with the Children notice version the server
  // publishes, whatever the app sends ("1.0-placeholder" here).
  const notice = await db.legalDocument.findUnique({ where: { slug: 'children-notice' } });
  const recs = await db.consentRecord.findMany({ where: { studentId: s.child.id } }).catch(() => null);
  const versions = recs ? [...new Set(recs.map((r) => r.policyVersion))] : (JSON.stringify(consent.body).match(/"policyVersion":"([^"]+)"/g) ?? []);
  ok('the consent is saved with the server\'s Children notice version, not the app\'s placeholder', !!notice && versions.length > 0 && versions.every((v) => String(v).includes(notice.version)) && !versions.some((v) => String(v).includes('1.0-placeholder')),
    `Children notice version "${notice?.version}"; consent saved with ${JSON.stringify(versions)}`);
  const cam = await call('POST', `/guardians/me/minors/${s.child.id}/consent`, s.parent.tok, { tier: 'CAMERA', policyVersion: '1.0-placeholder' });
  ok('parent gives camera consent too', cam.status < 300, `${cam.status}`);
  const cj = await step('parent adds the child to the School', () => joinSchool(s, s.parent, s.child.id));
  if (cj) check('parent adds the child to the School', 'PASS', JSON.stringify(cj).slice(0, 120));

  const kw = await call('GET', `/guardians/me/minors/${s.child.id}/waivers`, s.parent.tok);
  ok('the child\'s waiver shows for the parent', kw.status === 200 && JSON.stringify(kw.body).includes(s.waiver.id), JSON.stringify(kw.body).slice(0, 200));
  const ks = await step('parent signs the child\'s waiver', () => signWaiver(s, s.parent, s.child.id, `${pf} ${pl}`));
  if (ks) check('parent signs the child\'s waiver', 'PASS', JSON.stringify(ks).slice(0, 100));

  const kidBuy = await step('parent buys a plan for the child', () => buy(s, s.parent, s.plans.kids.id, { studentId: s.child.id }));
  if (kidBuy) {
    if (c.cards) {
      ok('parent buys a plan for the child', kidBuy.tx?.status === 'SUCCESSFUL' && kidBuy.tx?.studentId === s.child.id, `order ${kidBuy.tx?.status}; for ${kidBuy.tx?.studentId === s.child.id ? 'the child' : kidBuy.tx?.studentId}; lines ${JSON.stringify(kidBuy.lines)}`);
    } else {
      await new Promise((r) => setTimeout(r, 1500)); // the notice goes out through the notification queue
      const staffNote = await db.notification.findFirst({ where: { userId: s.staff.id, title: 'Cash payment waiting' }, orderBy: { createdAt: 'desc' } });
      ok('Branch Staff who may confirm get the "Cash payment waiting" notice, pointing to the student', !!staffNote && /Payments card/.test(staffNote.body) && staffNote.targetType === 'STUDENT', staffNote ? `"${staffNote.title}: ${staffNote.body.slice(0, 120)}" → ${staffNote.targetType}` : 'no notice');
      const conf = await call('PATCH', `/transactions/${kidBuy.transactionId}/confirm`, O(), {});
      const tx = await db.transaction.findUnique({ where: { id: kidBuy.transactionId } });
      ok('parent buys a plan for the child (Pix/cash, confirmed)', kidBuy.pending && conf.status < 300 && tx?.status === 'SUCCESSFUL' && tx?.studentId === s.child.id, `order ${tx?.status}, confirm ${conf.status}`);
    }
    const kms = await db.membership.findFirst({ where: { studentId: s.child.id, membershipPlanId: s.plans.kids.id } });
    ok('the child has the plan', !!kms, kms ? `${kms.classesRemaining} classes` : 'no membership');
    s.childMembership = kms;
  }

  // The plan that switches: agree when buying (opt-in, in the app).
  const sw = await call('POST', `/membership-plans/${s.plans.week.id}/purchase`, s.adult.tok, c.cards ? { useHostedCheckout: true, agreeToPlanSwitch: true } : { agreeToPlanSwitch: true });
  if (!c.cards) {
    // Decision 441 item 3: no plan here has a switch, so there is nothing to agree to.
    ok('at a School without cards no plan offers a switch, so "agree to switch" has nothing to agree to', sw.status === 400 && sw.body?.error?.code === 'PLAN_HAS_NO_SWITCH', `${sw.status} ${sw.body?.error?.code}`);
    if (sw.status < 300) await call('PATCH', `/transactions/${sw.body.transactionId}/cancel`, O(), { reason: 'Ensaio' });
  } else if (sw.status < 300) {
    const tx = await db.transaction.findUnique({ where: { id: sw.body.transactionId } });
    ok('buying the switching plan records the member\'s agreement', tx?.planSwitchToPlanId === s.plans.next.id, `${sw.body.outcome}; order switches to ${tx?.planSwitchToPlanId === s.plans.next.id ? s.plans.next.title : tx?.planSwitchToPlanId}`);
    s.switchTx = sw.body;
  } else {
    check('buying the switching plan records the member\'s agreement', 'FAIL', `${sw.status} ${JSON.stringify(sw.body)}`);
  }
}

/**
 * Decision 441 item 1, 442 item 5, 443 item 1: a monthly plan at a School
 * that takes no cards. The first month is a Pix/cash order (or a desk sale);
 * the months after are charges on the member's balance from a recurring
 * charge tied to the membership; a freeze moves the next charge.
 */
export async function monthlyWithoutCards(s, member, deskBuyer) {
  journey(s.cfg.key, '4', 'Monthly plan without cards');
  const sid = s.school.id;
  const O = () => s.owner.tok;
  const plan = s.plans.subNoCards;
  const RJ = (await import('./lib.mjs')).runJob;
  // a) the member's own order, confirmed by Branch Staff.
  const order = await call('POST', `/membership-plans/${plan.id}/purchase`, member.tok, {});
  const tx = order.status < 300 ? await db.transaction.findUnique({ where: { id: order.body.transactionId } }) : null;
  ok('a member orders the monthly plan; the first month is a Pix/cash order', order.status < 300 && order.body?.outcome === 'pending_confirmation' && tx?.status === 'PENDING' && tx?.amount === plan.price, `${order.status} ${order.body?.outcome ?? order.body?.error?.message}; ${tx?.status} ${tx?.amount} ${tx?.paymentMethod}`);
  if (!tx) return;
  const conf = await call('PATCH', `/transactions/${tx.id}/confirm`, s.staff.tok, {});
  let m = null, series = null;
  for (let i = 0; i < 40 && !series; i++) {
    m = await db.membership.findFirst({ where: { studentId: member.id, membershipPlanId: plan.id } });
    series = m ? await db.recurringCharge.findFirst({ where: { membershipId: m.id } }) : null;
    if (!series) await new Promise((r) => setTimeout(r, 250));
  }
  const day = (d) => d?.toISOString().slice(0, 10);
  ok('once confirmed, the membership is billed to the balance with a monthly charge from next month', conf.status < 300 && m?.billedToBalance === true && !m?.stripeSubscriptionId && series?.frequency === 'MONTHLY' && series?.unitAmount === plan.price && series?.nextIndex === 1,
    `confirm ${conf.status}; billedToBalance ${m?.billedToBalance}; series ${series?.frequency} ${series?.unitAmount} first ${day(series?.firstDate)} next ${day(series?.nextDate)}`);
  s.monthly = { membership: m, series };

  // b) a freeze moves the next monthly charge (Decision 443 item 1).
  if (m && series) {
    const start = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 32 * 86400e3).toISOString().slice(0, 10); // 30 days on (10 Mar to 9 Apr, Decision 443 item 1)
    const fr = await call('POST', `/schools/${sid}/memberships/${m.id}/freezes`, O(), { startsAt: start, endsAt: end });
    let moved = null;
    for (let i = 0; i < 40; i++) {
      moved = await db.recurringCharge.findUnique({ where: { id: series.id } });
      if (day(moved?.nextDate) !== day(series.nextDate)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const shift = moved?.nextDate && series.nextDate ? Math.round((moved.nextDate - series.nextDate) / 86400e3) : null;
    ok(`freezing the monthly plan from ${start} to ${end} moves its next charge 30 days later`, fr.status < 300 && shift === 30, `freeze ${fr.status} ${fr.body?.error?.message ?? fr.body?.status ?? ''}; next charge ${day(series.nextDate)} → ${day(moved?.nextDate)} (${shift} days)`);
  }

  // c) a desk sale of the monthly plan, then "a month later".
  const p = deskBuyer;
  const desk = await call('POST', `/schools/${sid}/students/${p.id}/memberships/sell`, O(), { membershipPlanId: plan.id, paymentMethod: 'PIX' });
  let dm = null, ds = null;
  for (let i = 0; i < 40 && !ds; i++) {
    dm = await db.membership.findFirst({ where: { studentId: p.id, membershipPlanId: plan.id } });
    ds = dm ? await db.recurringCharge.findFirst({ where: { membershipId: dm.id } }) : null;
    if (!ds) await new Promise((r) => setTimeout(r, 250));
  }
  ok('a desk sale of the monthly plan (Pix) also sets up the monthly balance charge', desk.status < 300 && dm?.billedToBalance === true && !!ds, `${desk.status} ${desk.body?.error?.message ?? ''}; series ${ds ? day(ds.nextDate) : 'none'}`);
  if (!ds) return;
  // "A month later": the membership, its series and its first date move back a month.
  const back = (d) => new Date(new Date(d).getTime() - 31 * 86400e3);
  await db.membership.update({ where: { id: dm.id }, data: { startDate: back(dm.startDate) } });
  await db.recurringCharge.update({ where: { id: ds.id }, data: { firstDate: back(ds.firstDate), nextDate: back(ds.nextDate) } });
  await RJ('charge-recurring');
  await new Promise((r) => setTimeout(r, 1500));
  const charge = await db.charge.findFirst({ where: { studentId: p.id, recurringChargeId: ds.id } });
  const inv = await db.notification.findFirst({ where: { userId: p.id }, orderBy: { createdAt: 'desc' } });
  ok('the next month becomes a charge on the member\'s balance, with the "New invoice" notice', !!charge && charge.grossAmount === plan.price && /invoice/i.test(inv?.title ?? ''), charge ? `charge #${charge.invoiceNumber} "${charge.description}" ${charge.grossAmount} for ${charge.occurrenceDate?.toISOString().slice(0, 10)}; last notice "${inv?.title}"` : 'no charge');
  if (charge) {
    const paid = await call('POST', `/schools/${sid}/students/${p.id}/charge-payments`, s.staff.tok, { chargeId: charge.id, amount: plan.price, paymentMethod: 'PIX' });
    const list = await call('GET', `/schools/${sid}/students/${p.id}/charges`, O());
    const after = list.body?.charges?.find?.((x) => x.id === charge.id);
    ok('Branch Staff record the Pix payment against it', paid.status < 300 && after?.status === 'PAID' && after?.owedAmount === 0, `${paid.status} ${paid.body?.error?.message ?? ''}; charge ${after?.status}, owed ${after?.owedAmount}`);
    s.monthlyCharge = charge;
  }
  // Decision 446 item 3: a desk refund that ends the membership ends the series.
  const saleTx = desk.body?.transactionId ?? desk.body?.transaction?.id;
  if (saleTx) {
    const rf = await call('POST', `/transactions/${saleTx}/refund`, O(), { amount: plan.price, notes: 'Desistiu', endMembership: true });
    const sr = await db.recurringCharge.findUnique({ where: { id: ds.id } });
    ok('a desk refund that ends the monthly plan stops its monthly charge too', rf.status < 300 && (!!sr?.stoppedAt || !!sr?.endDate), `refund ${rf.status} ${rf.body?.error?.message ?? ''}; series stopped ${sr?.stoppedAt?.toISOString().slice(0, 10) ?? '-'} end ${sr?.endDate?.toISOString().slice(0, 10) ?? '-'}`);
  }
}
