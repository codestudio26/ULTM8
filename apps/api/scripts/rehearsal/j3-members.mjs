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

  const blocked = await call('POST', `/membership-plans/${s.plans.pack.id}/purchase`, s.adult.tok, c.cards ? { useHostedCheckout: true } : {});
  check('buying before signing the waiver', blocked.status >= 400 ? 'PASS' : 'NOTE', `${blocked.status} ${blocked.body?.error?.message ?? ''} (the plan has no "waiver required" flag; see report)`);
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
      const staffTry = await call('PATCH', `/transactions/${b.transactionId}/confirm`, s.staff?.tok, {});
      check('Branch Staff confirm the Pix/cash order', staffTry.status < 300 ? 'PASS' : 'NOTE', `${staffTry.status} ${staffTry.body?.error?.message ?? ''} (only owners confirm today; see report)`);
      const conf = await step('the School confirms the Pix/cash order', () => must('confirm', 'PATCH', `/transactions/${b.transactionId}/confirm`, O(), {}));
      const after = await db.transaction.findUnique({ where: { id: b.transactionId } });
      if (conf) ok('the School confirms the Pix/cash order', after?.status === 'SUCCESSFUL', `order ${after?.status}`);
      s.adultPackTx = b.transactionId;
    }
  }
  const ms = await call('GET', '/memberships/me', s.adult.tok);
  const pack = (ms.body?.items ?? ms.body ?? []).find?.((m) => m.membershipPlanId === s.plans.pack.id);
  ok('the member has the pack with 10 classes', !!pack && pack.classesRemaining === 10, JSON.stringify(pack ?? ms.body).slice(0, 220));
  s.adultMembership = pack;

  if (s.plans.subNoCards) {
    const t = await call('POST', `/membership-plans/${s.plans.subNoCards.id}/purchase`, s.adult.tok, {});
    const desk = await call('POST', `/schools/${sid}/students/${s.adult.id}/memberships/sell`, O(), { membershipPlanId: s.plans.subNoCards.id, paymentMethod: 'CASH' });
    const { serverText } = await import('./j1-setup.mjs');
    const ptMsg = (await serverText('pt-BR'))[t.body?.error?.message] ?? null;
    check('a monthly Subscription can\'t be sold at a School without card payments', 'NOTE',
      `member buys: ${t.status}, member sees (pt-BR) "${ptMsg ?? t.body?.error?.message}"; desk sale: ${desk.status} ${desk.body?.error?.message ?? ''}`);
  }

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
  check('consent policy version the app sends', 'NOTE', 'The member app sends "1.0-placeholder" (ConsentTierRow.tsx CURRENT_POLICY_VERSION): a real policy version is needed before launch.');
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
  if (sw.status < 300) {
    const tx = await db.transaction.findUnique({ where: { id: sw.body.transactionId } });
    ok('buying the switching plan records the member\'s agreement', tx?.planSwitchToPlanId === s.plans.next.id, `${sw.body.outcome}; order switches to ${tx?.planSwitchToPlanId === s.plans.next.id ? s.plans.next.title : tx?.planSwitchToPlanId}`);
    s.switchTx = sw.body;
  } else {
    check('buying the switching plan records the member\'s agreement', 'FAIL', `${sw.status} ${JSON.stringify(sw.body)}`);
  }
}
