// Round 4, phase 3: money across currencies, and the money features merged since
// round 3 (charges, refunds, credit, desk sales, card surcharge) under double
// clicks and at scale. PASS/FAIL per check, money-result.json.
//
// Amounts: the portal turns what the owner types into hundredths for every
// currency (apps/school-portal/src/lib/MoneyField.tsx, money.ts). Stripe wants
// its own minor unit: none for JPY/KRW, three decimals for KWD/BHD.
import { db, call, pool, cast, checks, codes, randomUUID } from './common.mjs';
const FAKE = `http://localhost:${process.env.FAKE_STRIPE_PORT ?? 12111}`;
const { ok, save } = checks('money');
const info = (id, detail) => ok(id, true, 'INFO ' + detail);
// ONLY=M2,M3 reruns some sections (on a cast that already ran the rest).
const RUN_START = new Date();
const run = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);

// Stripe's own lists (stripe.com/docs/currencies).
const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
const stripeAmountFor = (hundredths, cur) => (ZERO.has(cur) ? Math.round(hundredths / 100) : THREE.has(cur) ? hundredths * 10 : hundredths);

// One School per currency to test, not used by the other round 4 scripts (index 200+).
const pickCountry = (cc) => cast.schools.find((s) => s.country === cc && s.n >= 200 && s.size !== 'xlarge');
const testSchools = ['JP', 'KR', 'CL', 'KW', 'BH', 'US', 'BR', 'GB'].map(pickCountry).filter(Boolean);

// --- M1: what Stripe is asked to charge, per currency ---
for (const s of run('M1') ? testSchools : []) {
  const acct = await call('m1:payment-account', 'POST', `/schools/${s.id}/payment-accounts`, s.owner.tok, { provider: 'STRIPE', accountTitle: 'Main', country: s.country });
  // A rerun finds the account the first run set up (409) and reuses it.
  const existing = acct.status === 409 ? await db.paymentAccount.findFirst({ where: { schoolId: s.id, provider: 'STRIPE' } }) : null;
  if (acct.status >= 300 && !existing) { ok(`M1 ${s.currency} setup`, false, JSON.stringify(acct.body)); continue; }
  if (!existing) {
    const ob = await call('m1:onboard', 'POST', `/payment-accounts/${acct.body.id}/connect/onboard`, s.owner.tok, {});
    if (ob.status >= 300) { ok(`M1 ${s.currency} onboard`, false, JSON.stringify(ob.body)); continue; }
  }
  // The owner types 1,000 (yen, won, dinar, dollars...). The portal sends 100000.
  const typed = 1000, sent = typed * 100;
  const plan = await call('m1:plan', 'POST', `/schools/${s.id}/membership-plans`, s.owner.tok, { type: 'CLASS_PACK', title: `R4 ${s.currency} pack ${Date.now() % 100000}`, price: sent, currency: s.currency, classesIncluded: 5 });
  if (plan.status >= 300) { ok(`M1 ${s.currency} plan`, false, JSON.stringify(plan.body)); continue; }
  const st = s.students.find((x) => x.kind === 'none') ?? s.students[0];
  const buy = await call('m1:purchase-card', 'POST', `/membership-plans/${plan.body.id}/purchase`, st.tok, { useHostedCheckout: true });
  if (buy.status >= 300) { ok(`M1 ${s.currency} purchase`, false, JSON.stringify(buy.body)); continue; }
  const tx = await db.transaction.findUnique({ where: { id: buy.body.transactionId } });
  const sessionId = buy.body.checkoutUrl?.split('/').pop();
  const session = sessionId ? await (await fetch(`${FAKE}/v1/checkout/sessions/${sessionId}`)).json() : null;
  const piId = session?.payment_intent ?? tx?.stripePaymentIntentId;
  const pi = piId ? await (await fetch(`${FAKE}/v1/payment_intents/${piId}`)).json() : null;
  const want = stripeAmountFor(sent, s.currency);
  ok(`M1 ${s.currency}: the owner prices ${typed} ${s.currency}, Stripe is asked for ${typed} ${s.currency}`, pi?.amount === want,
    `Stripe amount ${pi?.amount} (${s.currency} ${ZERO.has(s.currency) ? 'has no decimals' : THREE.has(s.currency) ? 'has 3 decimals' : 'has 2 decimals'}, so ${typed} ${s.currency} = ${want}); stored ${tx?.amount}`);
  s.m1 = { planId: plan.body.id };
}

// --- M2: desk sale clicked 10 times at once (Decision 372 double-click guard) ---
if (run('M2')) {
  const s = cast.schools.find((x) => x.n === 210);
  const st = s.students.find((x) => x.kind === 'none' || x.kind === 'lapsed') ?? s.students[1];
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('m2:desk-x10', 'POST', `/schools/${s.id}/desk-payments`, s.owner.tok, { studentId: st.id, membershipPlanId: s.plans['10-class pack'], paymentMethod: 'CASH' })));
  const n = await db.transaction.count({ where: { studentId: st.id, membershipPlanId: s.plans['10-class pack'] } });
  ok('M2 a desk sale clicked 10 times records one payment', n === 1, `codes ${JSON.stringify(codes(rs))}; ${n} payments`);
}

// --- M3: charges, member balance, refunds and credit (#399–#407) ---
const S3 = run('M3') ? cast.schools.filter((x) => x.n >= 220 && x.n < 240) : [];
let m3 = { created: 0 };
for (const s of S3) {
  const st = s.students[2];
  const due = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
  // M3a double-clicked "Create charge"
  const cr = await Promise.all(Array.from({ length: 5 }, () => call('m3:charge-x5', 'POST', `/schools/${s.id}/students/${st.id}/charges`, s.owner.tok, { description: `Grading fee ${RUN_START.getTime()}`, amount: 5000, dueDate: due })));
  const nCh = await db.charge.count({ where: { studentId: st.id, schoolId: s.id, createdAt: { gte: RUN_START } } });
  m3.created += nCh;
  if (s === S3[0]) ok('M3a "Create charge" clicked 5 times at once', nCh === 1, `codes ${JSON.stringify(codes(cr))}; ${nCh} charges`);
  const charge = cr.find((r) => r.status < 300)?.body;
  if (!charge) { ok(`M3 ${s.n} create charge`, false, JSON.stringify(cr[0].body)); continue; }
  // M3b the same desk payment clicked 5 times at once
  const pay = await Promise.all(Array.from({ length: 5 }, () => call('m3:pay-x5', 'POST', `/schools/${s.id}/students/${st.id}/charge-payments`, s.owner.tok, { chargeId: charge.id, amount: 5000, paymentMethod: 'CASH', sendReceipt: false })));
  const paid = await db.transaction.findMany({ where: { studentId: st.id, schoolId: s.id, membershipPlanId: null, createdAt: { gte: RUN_START } }, select: { id: true, amount: true } });
  const sumPaid = paid.reduce((a, t) => a + t.amount, 0);
  if (s === S3[0] || paid.length > 1) ok(`M3b School ${s.n}: a 50.00 charge paid at the desk, clicked 5 times`, paid.length === 1, `codes ${JSON.stringify(codes(pay))}; ${paid.length} payments totalling ${sumPaid}`);
  // M3c refund the payment twice at once: money back once, never more than was paid
  const txId = paid[0]?.id;
  if (txId) {
    const rf = await Promise.all(Array.from({ length: 3 }, () => call('m3:refund-x3', 'POST', `/schools/${s.id}/charge-payments/${txId}/refund`, s.owner.tok, { amount: 5000, destination: 'MONEY_BACK', notes: 'Double click' })));
    const refunded = await db.chargeRefund.aggregate({ where: { schoolId: s.id, studentId: st.id, transactionId: txId }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: null } }));
    if (s === S3[0] || (refunded._sum.amount ?? 0) > 5000) ok(`M3c School ${s.n}: a refund clicked 3 times returns the money once`, (refunded._sum.amount ?? 0) <= 5000, `codes ${JSON.stringify(codes(rf))}; refunded ${refunded._sum.amount}`);
  }
  // M3d credit with a negative / zero / huge amount
  const bad = await Promise.all([0, -100, 1e12].map((a) => call('m3:credit-bad', 'POST', `/schools/${s.id}/students/${st.id}/credits`, s.owner.tok, { amount: a, note: 'x' })));
  if (s === S3[0]) ok('M3d credit of 0, -1.00 and 10 billion refused', bad.every((r) => r.status === 400), JSON.stringify(codes(bad)));
  // M3e another School's owner can't see, pay, refund or credit
  const o = cast.schools[(s.n + 7) % cast.schools.length];
  const xt = await Promise.all([
    call('m3:xt', 'GET', `/schools/${s.id}/students/${st.id}/charges`, o.owner.tok),
    call('m3:xt', 'POST', `/schools/${s.id}/students/${st.id}/charge-payments`, o.owner.tok, { chargeId: charge.id, amount: 100, paymentMethod: 'CASH' }),
    call('m3:xt', 'POST', `/schools/${o.id}/students/${st.id}/charge-payments`, o.owner.tok, { chargeId: charge.id, amount: 100, paymentMethod: 'CASH' }),
    call('m3:xt', 'POST', `/schools/${s.id}/students/${st.id}/credits`, o.owner.tok, { amount: 100, note: 'x' }),
    ...(txId ? [call('m3:xt', 'POST', `/schools/${o.id}/charge-payments/${txId}/refund`, o.owner.tok, { amount: 100, destination: 'MONEY_BACK' })] : []),
    call('m3:xt', 'POST', `/schools/${s.id}/charges/${charge.id}/cancel`, s.staff.tok, { reason: 'x' }),
  ]);
  if (s === S3[0] || xt.some((r) => r.status < 300)) ok(`M3e School ${s.n}: another School's owner and plain Branch Staff refused on charges`, xt.every((r) => r.status >= 400), JSON.stringify(xt.map((r) => r.status)));
}

// --- M4: the owner's billing pages with real volume: 5 charges each for 400 students of a large School ---
if (run('M4')) {
  const s = cast.schools.find((x) => x.size === 'large' && x.n >= 240);
  const due = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
  const studs = s.students.slice(0, 400);
  const t0 = Date.now();
  await pool(studs.flatMap((st) => Array.from({ length: 5 }, (_, k) => ({ st, k }))), 32, ({ st, k }) => call('m4:charge', 'POST', `/schools/${s.id}/students/${st.id}/charges`, s.owner.tok, { description: `Fee ${k}`, amount: 1000 + k, dueDate: due }));
  info('M4 2,000 charges created', `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const ov = await call('m4:overview', 'GET', `/schools/${s.id}/charge-reports/overview`, s.owner.tok);
  const mb2 = await call('m4:member-balances', 'GET', `/schools/${s.id}/charge-reports/member-balances`, s.owner.tok);
  info('M4 charges overview and member balances at 2,000 charges', `overview ${ov.status} ${ov.bytes} bytes; member balances ${mb2.status} ${mb2.bytes} bytes`);
  // Late fees on all of them (charges are 10 days overdue)
  const lf = await call('m4:late-fees-on', 'PUT', `/schools/${s.id}/late-fees`, s.owner.tok, { enabled: true, type: 'FIXED', fixedAmount: 500, graceDays: 3 });
  info('M4 switch late fees on', `${lf.status} ${JSON.stringify(lf.body).slice(0, 200)}`);
}

// --- M5: desk sales at scale: every School takes cash; every member with nothing live buys a pack ---
if (run('M5')) {
  const t0 = Date.now();
  const has = new Set((await db.paymentAccount.findMany({ select: { schoolId: true } })).map((p) => p.schoolId));
  const need = cast.schools.filter((s) => !has.has(s.id));
  const acc = await pool(need, 16, (s) => call('m5:cash-account', 'POST', `/schools/${s.id}/payment-accounts`, s.owner.tok, { provider: 'CASH', accountTitle: 'Front desk', country: s.country }));
  info('M5a cash payment accounts', `${need.length} Schools, ${JSON.stringify(codes(acc))}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const buyers = cast.schools.flatMap((s) => s.students.filter((st) => st.kind === 'none' || st.kind === 'lapsed').map((st) => ({ s, st })));
  const t1 = Date.now();
  const rs = await pool(buyers, 64, ({ s, st }) => call('m5:desk-sale', 'POST', `/schools/${s.id}/desk-payments`, s.owner.tok, { studentId: st.id, membershipPlanId: s.plans['5-class pack'], paymentMethod: ['CASH', 'CARD_TERMINAL', 'PIX'][st.id.charCodeAt(0) % 3] }));
  const secs = (Date.now() - t1) / 1000;
  const okIds = buyers.filter((_, i) => rs[i].status < 300).map((b) => b.st.id);
  const tx = await db.transaction.count({ where: { studentId: { in: okIds }, membershipPlanId: { in: cast.schools.map((s) => s.plans['5-class pack']) } } });
  const ms = await db.membership.count({ where: { studentId: { in: okIds }, membershipPlanId: { in: cast.schools.map((s) => s.plans['5-class pack']) }, classesRemaining: 5 } });
  const pixRefused = buyers.filter((b, i) => rs[i].status >= 400 && rs[i].status < 500 && ['CASH', 'CARD_TERMINAL', 'PIX'][b.st.id.charCodeAt(0) % 3] === 'PIX').map((b) => b.s.country);
  info('M5b desk sales', `${buyers.length} sales in ${secs.toFixed(0)}s (${(buyers.length / secs).toFixed(0)}/s): ${JSON.stringify(codes(rs))}; Pix refused outside Brazil: ${pixRefused.length} (${[...new Set(pixRefused)].slice(0, 8).join(',')})`);
  ok('M5c one payment and one 5-credit pack per accepted desk sale', tx === okIds.length && ms === okIds.length, `${okIds.length} accepted, ${tx} payments, ${ms} packs`);
}

save();
await db.$disconnect();
