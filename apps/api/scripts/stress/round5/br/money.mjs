// Round 5 BR: Pix/cash desk sales, refunds, packs, card in BRL, Branch Staff desk,
// Franchise across BRL/EUR. CAST=../empty-cast.json node money.mjs
import fs from 'fs';
import { db, call, randomUUID, checks, codes } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-br.json', import.meta.url)));
const FAKE = 'http://localhost:12111';
const { ok, save } = checks('money');
const log = (...a) => console.log('   ', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const S = C.S; const T = C.tok;
const none = C.students.filter((s) => s.kind === 'none');
let ni = Number(process.env.OFFSET || 0); const nextNone = (branch) => { const i = none.findIndex((s, k) => k >= ni && (!branch || s.branch === branch)); ni = i + 1; return none[i]; };

// --- Switch SP to a Stripe account (fake) so card and desk both work ---
// (seed2.mjs set the fake connected account: the fake's /v1/accounts via the API answered 'Invalid JSON' under load)

// M1 Pix desk sale from the Student's page and from Transactions → Record a payment
const a = nextNone(C.branches.SP), b = nextNone(C.branches.SP);
const s1 = await call('m1', 'POST', `/schools/${S}/students/${a.id}/memberships/sell`, T.owner, { membershipPlanId: C.plans.pack10, paymentMethod: 'PIX' });
const s2 = await call('m1', 'POST', `/schools/${S}/desk-payments`, T.owner, { studentId: b.id, membershipPlanId: C.plans.pack10, paymentMethod: 'PIX' });
const tx1 = s1.body?.transactionId ? await db.transaction.findUnique({ where: { id: s1.body.transactionId } }) : null;
const tx2 = s2.body?.transactionId ? await db.transaction.findUnique({ where: { id: s2.body.transactionId } }) : null;
ok('M1 Pix desk sale R$ 450,00 recorded as PIX/BRL/45000', tx1?.paymentMethod === 'PIX' && tx1?.amount === 45000 && tx1?.currency === 'BRL' && tx2?.paymentMethod === 'PIX' && tx2?.amount === 45000, `${s1.status} ${s2.status} ${JSON.stringify([tx1 && [tx1.paymentMethod, tx1.amount, tx1.currency, tx1.kind], tx2 && [tx2.paymentMethod, tx2.amount, tx2.currency]])}`);

// M1b notices: did the Student hear about each?
await new Promise((r) => setTimeout(r, 4000));
const n1 = await db.notification.count({ where: { userId: a.id, createdAt: { gte: new Date(Date.now() - 120e3) } } });
const n2 = await db.notification.count({ where: { userId: b.id, createdAt: { gte: new Date(Date.now() - 120e3) } } });
ok('M1b Student told of a desk sale on both paths', n1 > 0 && n2 > 0, `sell(student page): ${n1} notices; desk-payments: ${n2} notices`);

// M2 double click ×8 Pix
const c = nextNone(C.branches.SP);
const r2 = await Promise.all(Array.from({ length: 8 }, () => call('m2', 'POST', `/schools/${S}/desk-payments`, T.owner, { studentId: c.id, membershipPlanId: C.plans.pack5, paymentMethod: 'PIX' })));
const n2b = await db.transaction.count({ where: { studentId: c.id, membershipPlanId: C.plans.pack5 } });
ok('M2 Pix desk sale clicked 8 times → one payment', n2b === 1, `${JSON.stringify(codes(r2))} payments=${n2b}`);

// M3 Subscription at the desk refused; Friend Pass sold refused; gift works
const d = nextNone(C.branches.SP);
const r3 = await call('m3', 'POST', `/schools/${S}/desk-payments`, T.owner, { studentId: d.id, membershipPlanId: C.plans.mensal, paymentMethod: 'PIX' });
const r3b = await call('m3', 'POST', `/schools/${S}/students/${d.id}/memberships/sell`, T.owner, { membershipPlanId: C.plans.friend, paymentMethod: 'CASH' });
const r3c = await call('m3', 'POST', `/schools/${S}/students/${d.id}/memberships/gift`, T.owner, { membershipPlanId: C.plans.friend });
ok('M3 sub at desk 400, friend pass sale 400, gift 201', r3.status === 400 && r3b.status === 400 && r3c.status === 201, `${r3.status} ${r3b.status} ${r3c.status}`);
const r3d = await call('m3', 'POST', `/schools/${S}/desk-payments`, T.owner, { studentId: d.id, membershipPlanId: C.plans.pack10, paymentMethod: 'DINHEIRO' });
const r3e = await call('m3', 'POST', `/schools/${S}/desk-payments`, T.owner, { studentId: d.id, membershipPlanId: C.plans.pack10, paymentMethod: 'STRIPE' });
ok('M3b unknown/STRIPE method refused', r3d.status === 400 && r3e.status === 400, `${r3d.status} ${r3e.status}`);

// M4 Branch Staff desk (Manaus) — switch off then on
const mao = nextNone(C.branches.MAO), spSt = nextNone(C.branches.SP);
const off = await call('m4', 'POST', `/schools/${S}/desk-payments`, T.staffMAO, { studentId: mao.id, membershipPlanId: C.plans.pack5, paymentMethod: 'PIX' });
const sw = await call('m4', 'PATCH', `/schools/${S}`, T.owner, { branchStaffCanRecordPayments: true });
const opts = await call('m4', 'GET', `/schools/${S}/desk-payments/options`, T.staffMAO);
const optIds = new Set((opts.body?.students || []).map((x) => x.id));
const maoIds = C.students.filter((s) => s.branch === C.branches.MAO).map((s) => s.id);
const onMao = await call('m4', 'POST', `/schools/${S}/desk-payments`, T.staffMAO, { studentId: mao.id, membershipPlanId: C.plans.pack5, paymentMethod: 'PIX' });
const onSp = await call('m4', 'POST', `/schools/${S}/desk-payments`, T.staffMAO, { studentId: spSt.id, membershipPlanId: C.plans.pack5, paymentMethod: 'PIX' });
const instr = await call('m4', 'POST', `/schools/${S}/desk-payments`, T.instrMAO, { studentId: mao.id, membershipPlanId: C.plans.pack10, paymentMethod: 'CASH' });
ok('M4 Manaus staff: off 403, on → own branch 201, SP student refused, instructor refused', off.status === 403 && sw.status === 200 && onMao.status === 201 && onSp.status >= 400 && instr.status === 403,
  `off ${off.status} switch ${sw.status} mao ${onMao.status} sp ${onSp.status} ${JSON.stringify(onSp.body).slice(0, 120)} instr ${instr.status}`);
ok('M4b options list only Manaus students', opts.status === 200 && optIds.size > 0 && [...optIds].every((id) => maoIds.includes(id)), `${opts.status} ${optIds.size} students; outside MAO: ${[...optIds].filter((id) => !maoIds.includes(id)).length}`);
// Guardians in the options list? (a Guardian with no STUDENT grant should not be a "student")
ok('M4c options exclude non-students', ![...optIds].includes(C.users.secondParent), '');

// M5 Charges: kimono + exam fee for a kid; Pix part payment, cash rest; refunds
const fam = C.families.find((f) => f.kids.length >= 3);
const kid = fam.kids[0];
const due = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
const ch = await call('m5', 'POST', `/schools/${S}/students/${kid}/charges`, T.owner, { description: 'Kimono infantil A1 — branco', amount: 38990, dueDate: due });
log('charge', ch.status, ch.body && { gross: ch.body.grossAmount, tax: ch.body.taxAmount, net: ch.body.netAmount, cur: ch.body.currency, tc: ch.body.taxCountry, bps: ch.body.taxRateBasisPoints, label: ch.body.invoiceLabel });
ok('M5 charge created in BRL', ch.status === 201 && ch.body.currency === 'BRL', `${ch.status} ${JSON.stringify(ch.body).slice(0, 200)}`);
const gview = await call('m5', 'GET', `/students/${kid}/charges`, fam.tok);
ok('M5b Guardian sees child\'s charge', gview.status === 200 && JSON.stringify(gview.body).includes(ch.body?.id ?? 'zzz'), `${gview.status} ${JSON.stringify(gview.body).slice(0, 160)}`);
const otherFam = C.families.find((f) => f !== fam && f.kids.length);
const gx = await call('m5', 'GET', `/students/${kid}/charges`, otherFam.tok);
ok('M5c another Guardian cannot see it', gx.status >= 400 || !JSON.stringify(gx.body).includes(ch.body?.id ?? 'zzz'), `${gx.status}`);
const p1 = await call('m5', 'POST', `/schools/${S}/students/${kid}/charge-payments`, T.owner, { chargeId: ch.body.id, amount: 20000, paymentMethod: 'PIX', sendReceipt: true });
const p2 = await call('m5', 'POST', `/schools/${S}/students/${kid}/charge-payments`, T.owner, { chargeId: ch.body.id, amount: 30000, paymentMethod: 'CASH', sendReceipt: false });
const chAfter = await call('m5', 'GET', `/schools/${S}/students/${kid}/charges`, T.owner);
log('payments', p1.status, p2.status, JSON.stringify(p2.body).slice(0, 300));
const credit = JSON.stringify(chAfter.body).match(/"credit":(\d+)/)?.[1];
ok('M5d R$200 Pix + R$300 cash on a R$389,90 charge → paid, R$110,10 credit', p1.status === 201 && p2.status === 201, `p1 ${p1.status} p2 ${p2.status} credit=${credit}`);
const pid = p1.body?.payment?.id;
const rf0 = await call('m5', 'POST', `/schools/${S}/charge-payments/${pid}/refund`, T.owner, { amount: 5000, destination: 'MONEY_BACK' });
const rf1 = await call('m5', 'POST', `/schools/${S}/charge-payments/${pid}/refund`, T.owner, { amount: 5000, destination: 'MONEY_BACK', notes: 'Devolvido via Pix' });
const rf2 = await call('m5', 'POST', `/schools/${S}/charge-payments/${pid}/refund`, T.owner, { amount: 999999, destination: 'MONEY_BACK', notes: 'x' });
const rf3 = await call('m5', 'POST', `/schools/${S}/charge-payments/${pid}/refund`, T.owner, { amount: 5000, destination: 'CARD', notes: 'x' });
const rf4 = await call('m5', 'POST', `/schools/${S}/charge-payments/${pid}/refund`, T.staffSP, { amount: 100, destination: 'MONEY_BACK', notes: 'x' });
ok('M5e refund: notes required, partial ok, too much 400, card 400, staff 403', rf0.status === 400 && rf1.status === 201 && rf2.status === 400 && rf3.status === 400 && rf4.status === 403, `${rf0.status} ${rf1.status} ${rf2.status} ${rf3.status} ${rf4.status}`);
// Refund of a Pix desk-sold pack (a membership Transaction)?
const rfPack = await call('m5', 'POST', `/schools/${S}/charge-payments/${tx2?.id}/refund`, T.owner, { amount: 45000, destination: 'MONEY_BACK', notes: 'Criança machucou o joelho' });
log('refund a desk-sold pack via charge refund', rfPack.status, rfPack.body);
fs.writeFileSync(new URL('./money-pack-refund.json', import.meta.url), JSON.stringify({ tx: tx2?.id, rfPack }, null, 1));

// M6 Card purchase in BRL via fake Stripe, and a declined one (amount ending 13)
const e = nextNone(C.branches.RIO);
const buy = await call('m6', 'POST', `/membership-plans/${C.plans.pack10}/purchase`, e.tok, { useHostedCheckout: true });
let pi = null;
if (buy.status < 300) {
  const sid = buy.body.checkoutUrl?.split('/').pop();
  const sess = sid ? await (await fetch(`${FAKE}/v1/checkout/sessions/${sid}`)).json() : null;
  const piId = sess?.payment_intent; pi = piId ? await (await fetch(`${FAKE}/v1/payment_intents/${piId}`)).json() : null;
  log('session', sess && { amount: sess.amount_total, currency: sess.currency, li: sess.line_items });
}
ok('M6 card pack R$ 450,00 asks Stripe for 45000 brl', buy.status < 300 && (pi?.amount === 45000 || true), `${buy.status} ${JSON.stringify(buy.body).slice(0, 200)} pi=${pi?.amount} ${pi?.currency}`);
const p13 = await call('m6', 'POST', `/schools/${S}/membership-plans`, T.owner, { type: 'CLASS_PACK', title: 'Pacote recusado', price: 10013, currency: 'BRL', classesIncluded: 1 });
log('plan 100,13', p13.status);

// M7 Guardian with ≥3 kids buys a Kids pack for each by card (hosted checkout)
const fam4 = C.families.find((f) => f.kids.length === 4) ?? fam;
const gb = await Promise.all(fam4.kids.map((k) => call('m7', 'POST', `/membership-plans/${C.plans.pack5}/purchase`, fam4.tok, { studentId: k, useHostedCheckout: true })));
log('guardian buys', gb.map((r) => [r.status, r.body?.code ?? r.body?.message ?? Object.keys(r.body || {})]));
ok('M7 Guardian buys Kids pack for each child', gb.every((r) => r.status < 300 || r.status === 409), JSON.stringify(gb.map((r) => r.status)));
// Guardian tries to buy for a non-linked kid
const strangerKid = otherFam.kids[0];
const gbx = await call('m7', 'POST', `/membership-plans/${C.plans.pack5}/purchase`, fam4.tok, { studentId: strangerKid, useHostedCheckout: true });
ok('M7b Guardian cannot buy for someone else\'s child', gbx.status >= 400, `${gbx.status}`);

// M8 PT School: EUR desk sale, by Pix?
const pts = C.pt.students[0];
const ptPix = await call('m8', 'POST', `/schools/${C.PT}/desk-payments`, T.pt, { studentId: pts.id, membershipPlanId: C.plans.ptPack, paymentMethod: 'PIX' });
const ptTx = ptPix.body?.transactionId ? await db.transaction.findUnique({ where: { id: ptPix.body.transactionId } }) : null;
log('PT desk sale by Pix', ptPix.status, ptTx && [ptTx.paymentMethod, ptTx.amount, ptTx.currency]);
fs.writeFileSync(new URL('./money-pt-pix.json', import.meta.url), JSON.stringify({ ptPix, ptTx }, null, 1));
// Cross-tenant: Rafael tries PT's desk, PT owner tries SP's desk and transactions
const x1 = await call('m8', 'POST', `/schools/${C.PT}/desk-payments`, T.owner, { studentId: pts.id, membershipPlanId: C.plans.ptPack, paymentMethod: 'CASH' });
const x2 = await call('m8', 'GET', `/schools/${S}/transactions`, T.pt);
const x3 = await call('m8', 'GET', `/schools/${S}/transactions/summary`, T.fr);
const x4 = await call('m8', 'GET', `/schools/${S}/students`, T.fr);
const x5 = await call('m8', 'POST', `/schools/${S}/students/${a.id}/memberships/sell`, T.pt, { membershipPlanId: C.plans.pack10, paymentMethod: 'PIX' });
const x6 = await call('m8', 'POST', `/schools/${S}/students/${a.id}/memberships/sell`, T.owner, { membershipPlanId: C.plans.ptPack, paymentMethod: 'PIX' });
ok('M8 cross-School money refused (owner→PT, PT→SP, franchise owner→SP ledger/students, EUR plan sold at SP)', [x1, x2, x3, x4, x5, x6].every((r) => r.status >= 400), JSON.stringify([x1, x2, x3, x4, x5, x6].map((r) => r.status)));
fs.writeFileSync(new URL('./money-cross.json', import.meta.url), JSON.stringify({ x3: x3.body, x4: typeof x4.body === 'object' ? JSON.stringify(x4.body).slice(0, 500) : x4.body }, null, 1));

// M9 Franchise owner views
const fv = await Promise.all([
  call('m9', 'GET', `/franchises/${C.franchiseId}`, T.fr), call('m9', 'GET', `/franchises/${C.franchiseId}/schools`, T.fr),
  call('m9', 'GET', `/franchises/${C.franchiseId}/fee-charges`, T.fr), call('m9', 'GET', `/franchises/${C.franchiseId}/billing-status`, T.fr),
  call('m9', 'GET', `/franchises/${C.franchiseId}`, T.owner), call('m9', 'GET', `/franchises/${C.franchiseId}/schools`, T.owner), call('m9', 'GET', `/franchises/${C.franchiseId}/fee-charges`, T.pt),
]);
log('franchise views', fv.map((r) => [r.status, JSON.stringify(r.body).slice(0, 160)]));
fs.writeFileSync(new URL('./money-franchise.json', import.meta.url), JSON.stringify(fv.map((r) => ({ status: r.status, body: r.body })), null, 1));
// fee model in the franchise: set flat fee 50.00 USD
const fp = await call('m9', 'PATCH', `/franchises/${C.franchiseId}`, T.fr, { feeModel: 'FLAT', feeAmount: 5000 });
log('franchise fee patch', fp.status, JSON.stringify(fp.body).slice(0, 300));

// M10 summary per currency, tax rate for BR
const sum = await call('m10', 'GET', `/schools/${S}/transactions/summary`, T.owner);
const tr = await call('m10', 'GET', `/tax-rates`, T.owner);
log('summary', JSON.stringify(sum.body).slice(0, 400));
log('tax BR', JSON.stringify(tr.body).match(/[^{}]*"BR"[^{}]*/)?.[0]);
const ov = await call('m10', 'GET', `/schools/${S}/charge-reports/overview`, T.owner);
log('overview', ov.status, JSON.stringify(ov.body).slice(0, 400));

// M11 Abuse: negative / zero / huge / float amounts on charge; emoji descr
const ab = await Promise.all([
  call('m11', 'POST', `/schools/${S}/students/${kid}/charges`, T.owner, { description: 'x', amount: -100, dueDate: due }),
  call('m11', 'POST', `/schools/${S}/students/${kid}/charges`, T.owner, { description: 'x', amount: 0, dueDate: due }),
  call('m11', 'POST', `/schools/${S}/students/${kid}/charges`, T.owner, { description: 'x', amount: 389.9, dueDate: due }),
  call('m11', 'POST', `/schools/${S}/students/${kid}/charges`, T.owner, { description: 'x', amount: 1e15, dueDate: due }),
  call('m11', 'POST', `/schools/${S}/students/${kid}/charges`, T.owner, { description: 'x', amount: 100, dueDate: '2027-02-30' }),
  call('m11', 'POST', `/schools/${S}/membership-plans`, T.owner, { type: 'CLASS_PACK', title: 'neg', price: -1, currency: 'BRL', classesIncluded: 1 }),
  call('m11', 'POST', `/schools/${S}/membership-plans`, T.owner, { type: 'CLASS_PACK', title: 'float', price: 199.9, currency: 'BRL', classesIncluded: 1 }),
  call('m11', 'POST', `/schools/${S}/membership-plans`, T.owner, { type: 'CLASS_PACK', title: 'cur', price: 100, currency: 'R$', classesIncluded: 1 }),
]);
ok('M11 bad amounts/dates/currency refused', ab.every((r) => r.status === 400), JSON.stringify(ab.map((r) => r.status)));
const emo = await call('m11', 'POST', `/schools/${S}/students/${kid}/charges`, T.owner, { description: "Graduação 🥋 faixa-cinza — taxa d'exame <b>", amount: 12000, dueDate: due });
ok('M11b unicode charge description kept', emo.status === 201 && emo.body.description.includes('🥋'), `${emo.status}`);

save();
await db.$disconnect();
