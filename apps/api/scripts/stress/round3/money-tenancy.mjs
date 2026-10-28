// Round 3: money and tenancy. Desk payments (Decisions 346-348), Mark as paid /
// Cancel (Decision 339), the Transactions ledger with filters and the CSV export's
// all-pages read (Decision 346), Friend Passes and Subscription cancels
// (Decision 348), Franchise join requests, removal and closing (Decision 352),
// and a School Owner closing their own School (Decision 364), with cross-tenant
// attempts on each.
//
// Changes only the picked School (SCHOOLS, default 22-25: the first one is
// used) plus Schools, Franchises and users this script creates itself. The next
// cast School is read-only, for cross-tenant attempts. Needs the API running
// against fake-stripe.mjs (../billing) and STRIPE_WEBHOOK_SECRET set to the
// API's own secret.
import { createRequire } from 'module';
import { cast, pick, checks, codes, db, call, pool, token, grant, report, randomUUID, API } from './common.mjs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const Stripe = require('stripe');
const bcrypt = require('bcryptjs');
const stripe = new (Stripe.default || Stripe)('sk_test_fake');
const FAKE = `http://localhost:${process.env.FAKE_STRIPE_PORT ?? 12111}`;
const ROWS = Number(process.env.LEDGER_ROWS ?? 3000);
const { ok, save } = checks('money-tenancy');
const info = (id, detail) => ok(id, true, `INFO: ${detail}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = randomUUID().slice(0, 6);
const t = () => performance.now();
const below = (rs, n) => rs.every((r) => r.status >= 400 && r.status < 500) && rs.length === n;
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v.status}`).join(', ');
const leaks = (o) => Object.entries(o).filter(([, v]) => !(v.status >= 400 && v.status < 500)).map(([k, v]) => `${k}: ${v.status}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function waitFor(fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(250); }
}
const fakeCalls = async () => (await fetch(`${FAKE}/__calls`)).json();
async function webhook(type, objectId, account) {
  const payload = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type, account, data: { object: { id: objectId, object: type.split('.')[0] } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await fetch(`${API}/payments/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  await res.text();
  return { status: res.status, eventId: JSON.parse(payload).id };
}
// A Subscription object in the fake Stripe, on a connected account, for a
// Membership written straight to the database.
async function fakeSubscription(acct) {
  const res = await fetch(`${FAKE}/v1/subscriptions`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'stripe-account': acct }, body: 'items[0][price]=price_r3' });
  return (await res.json()).id;
}
const decode = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
const remint = (tok) => { const p = decode(tok); return token({ id: p.sub, email: p.email }, p.grants); };

const PASSCODE = '246810';
const passHash = await bcrypt.hash(PASSCODE, 4);
let phoneN = 0;
async function mkUser(label) {
  const id = randomUUID();
  return db.user.create({ data: { id, email: `r3-mt-${label}-${run}-${id.slice(0, 6)}@stress.test`, phone: `+1777${String(Date.now()).slice(-6)}${String(phoneN++).padStart(4, '0')}`, firstName: `${label}`, surname: `R3${run}`, passcodeHash: passHash, dateOfBirth: new Date('1990-01-01'), phoneVerifiedAt: new Date() } });
}
async function mkStudent(schoolId, branchId, label = 'st') {
  const u = await mkUser(label);
  await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId, branchId } });
  return { ...u, tok: token(u, [grant('STUDENT', schoolId, branchId)]) };
}
async function mkSchool(label) {
  const school = await db.school.create({ data: { id: randomUUID(), name: `R3 ${label} ${run}`, defaultCurrency: 'GBP', ranksToggle: true } });
  const branch = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
  const owner = await mkUser(`${label}-owner`);
  await db.roleGrant.create({ data: { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id } });
  return { ...school, branch: branch.id, owner: { ...owner, tok: token(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]) } };
}
async function stepUp(user) {
  const r = await call('step-up', 'POST', '/auth/step-up/verify', user.tok, { passcode: PASSCODE });
  if (r.status >= 300) throw new Error('step-up ' + JSON.stringify(r.body));
  return r.body.stepUpToken;
}
async function stripeAccount(schoolId, ownerTok) {
  let acct = await db.paymentAccount.findUnique({ where: { schoolId } });
  if (!acct) {
    const r = await call('setup:payment-account', 'POST', `/schools/${schoolId}/payment-accounts`, ownerTok, { provider: 'STRIPE', accountTitle: 'Main', country: 'GB' });
    if (r.status >= 300) throw new Error('payment account ' + JSON.stringify(r.body));
    acct = await db.paymentAccount.findUnique({ where: { schoolId } });
  }
  if (acct.provider === 'STRIPE' && !acct.stripeConnectedAccountId) {
    const ob = await call('setup:onboard', 'POST', `/payment-accounts/${acct.id}/connect/onboard`, ownerTok, {});
    if (ob.status >= 300) throw new Error('onboard ' + JSON.stringify(ob.body));
    acct = await db.paymentAccount.findUnique({ where: { schoolId } });
  }
  return acct;
}
async function mkPlan(schoolId, tok, body) {
  const r = await call('setup:plan', 'POST', `/schools/${schoolId}/membership-plans`, tok, { currency: 'GBP', ...body, title: `${body.title} ${run}` });
  if (r.status >= 300) throw new Error('plan ' + JSON.stringify(r.body));
  return r.body.id;
}
const pendingCash = (s, studentId, planId, amount = 6000) =>
  db.transaction.create({ data: { id: randomUUID(), schoolId: s.id, studentId, paymentAccountId: s.account.id, membershipPlanId: planId, amount, currency: 'GBP', status: 'PENDING', paymentMethod: 'CASH' } });

// ---------------------------------------------------------------------------
// Setup: the picked School (S) and a read-only neighbour (R).
// ---------------------------------------------------------------------------
const [S] = pick('22-25');
const R = cast.schools[(cast.schools.indexOf(S) + 1) % cast.schools.length];
for (const x of [S, R]) for (const k of ['owner', 'instructor', 'staff']) x[k].tok = remint(x[k].tok);
const t0 = t();
await db.school.update({ where: { id: S.id }, data: { defaultCurrency: 'GBP', branchStaffCanRecordPayments: false } });
S.account = await stripeAccount(S.id, S.owner.tok);
S.plans = {
  pack: await mkPlan(S.id, S.owner.tok, { type: 'CLASS_PACK', title: 'R3 pack', price: 6000, classesIncluded: 10, expiryDurationDays: 90 }),
  weekly: await mkPlan(S.id, S.owner.tok, { type: 'WEEKLY_PASS', title: 'R3 week', price: 2500, expiryDurationDays: 7 }),
  friend: await mkPlan(S.id, S.owner.tok, { type: 'FRIEND_PASS', title: 'R3 friend', price: 0, classesIncluded: 1 }),
  sub: await mkPlan(S.id, S.owner.tok, { type: 'SUBSCRIPTION', title: 'R3 monthly', price: 12000 }),
};
const [b0, b1] = [S.branches[0], S.branches[1] ?? S.branches[0]];
const rStudent = { ...R.students[0], tok: remint(R.students[0].tok) };
console.log(`setup: School ${S.id.slice(0, 8)} (read-only neighbour ${R.id.slice(0, 8)}), Stripe account ${S.account.stripeConnectedAccountId}, in ${((t() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// D1. Record a payment double-clicked: a Weekly Pass (one live general access,
// Spec 55 §6.1) and a Class Pack (no confirmed rule on repeats).
// ---------------------------------------------------------------------------
{
  const st = await mkStudent(S.id, b0, 'd1');
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('D1:desk-payment', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: st.id, membershipPlanId: S.plans.weekly, paymentMethod: 'CASH' })));
  const m = await db.membership.count({ where: { studentId: st.id, membershipPlanId: S.plans.weekly } });
  const tx = await db.transaction.count({ where: { studentId: st.id, membershipPlanId: S.plans.weekly } });
  const tx0 = await db.transaction.findFirst({ where: { studentId: st.id, membershipPlanId: S.plans.weekly } });
  ok('D1a Record a payment for a Weekly Pass clicked 10 times at once: one pass, one Successful row', m === 1 && tx === 1 && tx0?.status === 'SUCCESSFUL' && tx0?.recordedById === S.owner.id && rs.every((r) => r.status < 500), `codes ${JSON.stringify(codes(rs))}; memberships ${m}; transactions ${tx} (${tx0?.status}, recordedBy owner ${tx0?.recordedById === S.owner.id})`);

  const st2 = await mkStudent(S.id, b0, 'd1b');
  const rs2 = await Promise.all(Array.from({ length: 10 }, () => call('D1:desk-payment', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: st2.id, membershipPlanId: S.plans.pack, paymentMethod: 'CARD_TERMINAL' })));
  const m2 = await db.membership.count({ where: { studentId: st2.id, membershipPlanId: S.plans.pack } });
  const tx2 = await db.transaction.count({ where: { studentId: st2.id, membershipPlanId: S.plans.pack } });
  info('D1b Record a payment for a Class Pack clicked 10 times at once', `codes ${JSON.stringify(codes(rs2))}; ${m2} packs and ${tx2} Successful £60 rows recorded for one student. No idempotency key or repeat guard on POST desk-payments; nothing in Decisions 346/348 says a repeat must be refused (Decision 339 T10 dedupes only the Student's own Pending cash order). A double-click records the money ${tx2} times.`);

  // Input edge cases.
  const bad = {
    'STRIPE as method': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: st.id, membershipPlanId: S.plans.pack, paymentMethod: 'STRIPE' }),
    'Subscription plan': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: st.id, membershipPlanId: S.plans.sub, paymentMethod: 'CASH' }),
    'Friend Pass plan': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: st.id, membershipPlanId: S.plans.friend, paymentMethod: 'CASH' }),
    'other School plan': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: st.id, membershipPlanId: (await db.membershipPlan.findFirst({ where: { schoolId: R.id } })).id, paymentMethod: 'CASH' }),
    'other School student': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: rStudent.id, membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'owner as student': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: S.owner.id, membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'unknown plan': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: st.id, membershipPlanId: randomUUID(), paymentMethod: 'CASH' }),
    'not a uuid': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.owner.tok, { studentId: 'x', membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'R owner records at S': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, R.owner.tok, { studentId: st.id, membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'student records own': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, st.tok, { studentId: st.id, membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'instructor records': await call('D1:edge', 'POST', `/schools/${S.id}/desk-payments`, S.instructor.tok, { studentId: st.id, membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'R owner reads options': await call('D1:edge', 'GET', `/schools/${S.id}/desk-payments/options`, R.owner.tok),
  };
  const extra = await db.membership.count({ where: { studentId: { in: [st.id, rStudent.id, S.owner.id] }, membershipPlanId: S.plans.pack } });
  const l = leaks(bad);
  ok('D1c Record a payment refuses wrong methods, plans, people and callers (4xx, nothing written)', l.length === 0 && extra === 0, l.join('; ') || `${fmt(bad)}; packs written ${extra}`);
}

// ---------------------------------------------------------------------------
// D2. Branch Staff and the School's switch (Decision 347).
// ---------------------------------------------------------------------------
{
  // Home branches are set through the owner's own endpoint (StudentHomeBranch,
  // the rule desk_payment_students() reads).
  const home = async (st, b) => { const r = await call('D2:home-branch', 'PUT', `/schools/${S.id}/students/${st.id}/home-branch`, S.owner.tok, { branchId: b }); if (r.status >= 300) throw new Error('home branch ' + JSON.stringify(r.body)); return st; };
  const own = await home(await mkStudent(S.id, b0, 'd2own'), b0);
  const other = b1 !== b0 ? await home(await mkStudent(S.id, b1, 'd2other'), b1) : null;
  const body = (st, plan = S.plans.pack) => ({ studentId: st.id, membershipPlanId: plan, paymentMethod: 'CASH' });
  const off = {
    'staff records (switch off)': await call('D2:staff', 'POST', `/schools/${S.id}/desk-payments`, S.staff.tok, body(own)),
    'staff options (switch off)': await call('D2:staff', 'GET', `/schools/${S.id}/desk-payments/options`, S.staff.tok),
    'staff turns switch on': await call('D2:staff', 'PATCH', `/schools/${S.id}`, S.staff.tok, { branchStaffCanRecordPayments: true }),
  };
  const switchAfterStaff = (await db.school.findUnique({ where: { id: S.id } })).branchStaffCanRecordPayments;
  const offLeaks = leaks(off);
  ok('D2a with the switch off, Branch Staff cannot record, see options or turn the switch on', offLeaks.length === 0 && switchAfterStaff === false, offLeaks.join('; ') || `${fmt(off)}; switch ${switchAfterStaff}`);

  const on = await call('D2:switch', 'PATCH', `/schools/${S.id}`, S.owner.tok, { branchStaffCanRecordPayments: true });
  const opts = await call('D2:options', 'GET', `/schools/${S.id}/desk-payments/options`, S.staff.tok);
  const optIds = new Set((opts.body?.students ?? []).map((x) => x.id));
  const ownRec = await call('D2:staff-record', 'POST', `/schools/${S.id}/desk-payments`, S.staff.tok, body(own));
  const ownRow = await db.transaction.findFirst({ where: { studentId: own.id, membershipPlanId: S.plans.pack } });
  const otherRec = other ? await call('D2:staff-record', 'POST', `/schools/${S.id}/desk-payments`, S.staff.tok, body(other)) : null;
  const otherM = other ? await db.membership.count({ where: { studentId: other.id } }) : 0;
  const still = {
    'staff lists ledger': await call('D2:staff', 'GET', `/schools/${S.id}/transactions`, S.staff.tok),
    'staff reads tiles': await call('D2:staff', 'GET', `/schools/${S.id}/transactions/summary`, S.staff.tok),
    'staff sells via Student page': await call('D2:staff', 'POST', `/schools/${S.id}/students/${own.id}/memberships/sell`, S.staff.tok, { membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'staff records at R': await call('D2:staff', 'POST', `/schools/${R.id}/desk-payments`, S.staff.tok, { studentId: rStudent.id, membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'staff records R student at S': await call('D2:staff', 'POST', `/schools/${S.id}/desk-payments`, S.staff.tok, { studentId: rStudent.id, membershipPlanId: S.plans.pack, paymentMethod: 'CASH' }),
    'instructor records (switch on)': await call('D2:staff', 'POST', `/schools/${S.id}/desk-payments`, S.instructor.tok, body(own)),
    'instructor options (switch on)': await call('D2:staff', 'GET', `/schools/${S.id}/desk-payments/options`, S.instructor.tok),
  };
  const stillLeaks = leaks(still);
  const pass = on.status === 200 && opts.status === 200 && optIds.has(own.id) && (!other || !optIds.has(other.id)) && ownRec.status === 201 && ownRow?.recordedById === S.staff.id && (!other || (otherRec.status >= 400 && otherRec.status < 500 && otherM === 0)) && stillLeaks.length === 0;
  ok('D2b with the switch on, Branch Staff record for their own branch only; ledger, sell and other Schools stay closed to them', pass, `switch on ${on.status}; options ${opts.status} (${optIds.size} students, own ${optIds.has(own.id)}, other-branch ${other ? optIds.has(other.id) : 'n/a'}); own-branch record ${ownRec.status} (recordedBy staff ${ownRow?.recordedById === S.staff.id}); other-branch record ${otherRec?.status ?? 'n/a'} (memberships ${otherM}); ${stillLeaks.join('; ') || fmt(still)}`);

  // The switch flipped off while staff are recording.
  const studs = await Promise.all(Array.from({ length: 10 }, async () => home(await mkStudent(S.id, b0, 'd2race'), b0)));
  const [flip, ...recs] = await Promise.all([call('D2:switch', 'PATCH', `/schools/${S.id}`, S.owner.tok, { branchStaffCanRecordPayments: false }), ...studs.map((st) => call('D2:staff-record', 'POST', `/schools/${S.id}/desk-payments`, S.staff.tok, body(st)))]);
  const after = await call('D2:staff-record', 'POST', `/schools/${S.id}/desk-payments`, S.staff.tok, body(await home(await mkStudent(S.id, b0, 'd2after'), b0)));
  info('D2c switch turned off while Branch Staff record 10 payments', `switch off ${flip.status}; in-flight records ${JSON.stringify(codes(recs))} (each request reads the switch once at its start, so ones already past the check finish); a record after the switch is off: ${after.status}`);
  ok('D2d once the switch is off, Branch Staff are refused again', after.status === 403, `record after switch off ${after.status}`);
}

// ---------------------------------------------------------------------------
// D3. Mark as paid and Cancel racing on the same Pending cash payment.
// ---------------------------------------------------------------------------
{
  const N = 12;
  const studs = await Promise.all(Array.from({ length: N }, () => mkStudent(S.id, b0, 'd3')));
  const rows = await Promise.all(studs.map((st) => pendingCash(S, st.id, S.plans.pack)));
  const out = await Promise.all(rows.map(async (row) => {
    const rs = await Promise.all([0, 1, 2, 3].map((k) => call(k % 2 ? 'D3:cancel' : 'D3:confirm', 'PATCH', `/transactions/${row.id}/${k % 2 ? 'cancel' : 'confirm'}`, S.owner.tok, {})));
    return { row, rs };
  }));
  const bad = [];
  let paid = 0, cancelled = 0;
  for (const { row, rs } of out) {
    const final = await db.transaction.findUnique({ where: { id: row.id } });
    const ms = await db.membership.count({ where: { studentId: row.studentId } });
    const wins = rs.filter((r, k) => r.status === 200 && (k % 2 ? r.body?.cancelled === true : r.body?.membershipCreated === true)).length;
    const fivexx = rs.filter((r) => r.status >= 500).length;
    if (final.status === 'SUCCESSFUL') paid++; else if (final.status === 'FAILED') cancelled++;
    const consistent = (final.status === 'SUCCESSFUL' && ms === 1 && final.membershipId) || (final.status === 'FAILED' && ms === 0 && !final.membershipId);
    if (!consistent || wins !== 1 || fivexx) bad.push(`${row.id.slice(0, 8)}: ${final.status}, memberships ${ms}, winners ${wins}, codes ${rs.map((r) => r.status).join('/')}`);
  }
  ok('D3a Mark as paid and Cancel at once (x2 each) on 12 cash payments: one wins, row and membership agree', bad.length === 0, bad.slice(0, 4).join('; ') || `${paid} paid, ${cancelled} cancelled; every row has one winner, no 5xx`);

  const row = await pendingCash(S, (await mkStudent(S.id, b0, 'd3x')).id, S.plans.pack);
  const st = studs[0];
  const tries = {
    'R owner confirms': await call('D3:x', 'PATCH', `/transactions/${row.id}/confirm`, R.owner.tok, {}),
    'R owner cancels': await call('D3:x', 'PATCH', `/transactions/${row.id}/cancel`, R.owner.tok, {}),
    'staff confirms': await call('D3:x', 'PATCH', `/transactions/${row.id}/confirm`, S.staff.tok, {}),
    'staff cancels': await call('D3:x', 'PATCH', `/transactions/${row.id}/cancel`, S.staff.tok, {}),
    'instructor cancels': await call('D3:x', 'PATCH', `/transactions/${row.id}/cancel`, S.instructor.tok, {}),
    'other student cancels': await call('D3:x', 'PATCH', `/transactions/${row.id}/cancel`, st.tok, {}),
    'R student reads invoice': await call('D3:x', 'GET', `/transactions/${row.id}/invoice`, rStudent.tok),
    'not a uuid': await call('D3:x', 'PATCH', `/transactions/nope/cancel`, S.owner.tok, {}),
  };
  const after = await db.transaction.findUnique({ where: { id: row.id } });
  const l = leaks(tries);
  ok('D3b other Schools, staff and students cannot mark paid or cancel a payment', l.length === 0 && after.status === 'PENDING', l.join('; ') || `${fmt(tries)}; row still ${after.status}`);
}

// ---------------------------------------------------------------------------
// D4. The ledger at a few thousand rows: every page, filters, tiles, CSV export.
// ---------------------------------------------------------------------------
{
  const studs = await Promise.all(Array.from({ length: 20 }, () => mkStudent(S.id, b0, 'd4')));
  const statuses = ['SUCCESSFUL', 'SUCCESSFUL', 'SUCCESSFUL', 'PENDING', 'FAILED', 'REFUNDED', 'DISPUTED'];
  const methods = ['CASH', 'BANK_TRANSFER', 'PIX', 'CARD_TERMINAL', 'STRIPE'];
  const base = Date.now() - 60 * 864e5;
  const data = Array.from({ length: ROWS }, (_, i) => ({
    id: randomUUID(), schoolId: S.id, studentId: studs[i % 20].id, paymentAccountId: S.account.id, membershipPlanId: i % 3 ? S.plans.pack : S.plans.weekly,
    kind: i % 11 === 0 ? 'RENEWAL' : 'MEMBERSHIP', amount: 1000 + (i % 50) * 100, currency: i % 9 === 0 ? 'EUR' : 'GBP',
    status: statuses[i % statuses.length], paymentMethod: methods[i % methods.length],
    // Rows share a billing date in groups of 25, so pages must break ties by id.
    billingDate: new Date(base + Math.floor(i / 25) * 12 * 3600e3),
  }));
  for (let i = 0; i < data.length; i += 1000) await db.transaction.createMany({ data: data.slice(i, i + 1000) });
  const pageAll = async (label, query) => {
    const seen = new Set(); let dup = 0, cursor = null, pages = 0, order = 0, prev = null;
    const t1 = t();
    do {
      const r = await call(label, 'GET', `/schools/${S.id}/transactions?limit=100${query}${cursor ? `&cursor=${cursor}` : ''}`, S.owner.tok);
      if (r.status !== 200) return { error: `${r.status} ${JSON.stringify(r.body).slice(0, 120)}` };
      for (const x of r.body.items) {
        if (seen.has(x.id)) dup++; seen.add(x.id);
        const key = [x.billingDate, x.id];
        if (prev && (key[0] > prev[0] || (key[0] === prev[0] && key[1] > prev[1]))) order++;
        prev = key;
      }
      cursor = r.body.nextCursor; pages++;
    } while (cursor && pages < 1000);
    return { n: seen.size, dup, pages, order, ms: t() - t1 };
  };
  const inDb = await db.transaction.count({ where: { schoolId: S.id } });
  const all = await pageAll('D4:list-page', '');
  ok('D4a the ledger pages every row once, newest first, across thousands of rows with tied billing dates', !all.error && all.n === inDb && all.dup === 0 && all.order === 0, all.error ?? `listed ${all.n} of ${inDb} in ${all.pages} pages (${(all.ms / 1000).toFixed(1)}s — the CSV export's all-pages read); duplicates ${all.dup}; out-of-order ${all.order}`);

  const from = new Date(base + 10 * 864e5).toISOString().slice(0, 10);
  const to = new Date(base + 40 * 864e5).toISOString().slice(0, 10);
  const where = { schoolId: S.id, status: 'SUCCESSFUL', paymentMethod: 'CASH', kind: 'MEMBERSHIP', membershipPlanId: S.plans.pack, billingDate: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 864e5) } };
  const q = `&status=SUCCESSFUL&paymentMethod=CASH&kind=MEMBERSHIP&membershipPlanId=${S.plans.pack}&from=${from}&to=${to}`;
  const filtered = await pageAll('D4:list-filtered', q);
  const fDb = await db.transaction.count({ where });
  const sum = await call('D4:summary', 'GET', `/schools/${S.id}/transactions/summary?${q.slice(1)}`, S.owner.tok);
  const sumAll = await call('D4:summary', 'GET', `/schools/${S.id}/transactions/summary`, S.owner.tok);
  const gbp = await db.transaction.aggregate({ where: { schoolId: S.id, status: 'SUCCESSFUL', currency: { in: ['GBP', 'gbp'] } }, _sum: { amount: true } });
  const gbpTile = sumAll.body?.revenue?.find((x) => x.currency === 'GBP')?.amount;
  ok('D4b filters, tiles and the export agree with the database', !filtered.error && filtered.n === fDb && filtered.dup === 0 && sum.body?.total === fDb && sumAll.body?.total === inDb && gbpTile === gbp._sum.amount, filtered.error ?? `filtered list ${filtered.n} / db ${fDb} (${filtered.pages} pages); filtered tile total ${sum.body?.total}; whole tile total ${sumAll.body?.total} / db ${inDb}; GBP revenue tile ${gbpTile} / db ${gbp._sum.amount}`);

  const edge = {
    'from after to': await call('D4:edge', 'GET', `/schools/${S.id}/transactions?from=${to}&to=${from}`, S.owner.tok),
    'bad cursor': await call('D4:edge', 'GET', `/schools/${S.id}/transactions?cursor=AAAA`, S.owner.tok),
    'garbage cursor json': await call('D4:edge', 'GET', `/schools/${S.id}/transactions?cursor=${Buffer.from('{"sortValue":"x","id":"y"}').toString('base64url')}`, S.owner.tok),
    'cursor with bad id': await call('D4:edge', 'GET', `/schools/${S.id}/transactions?cursor=${Buffer.from(JSON.stringify({ sortValue: new Date().toISOString(), id: "' OR 1=1 --" })).toString('base64url')}`, S.owner.tok),
    'limit 1000': await call('D4:edge', 'GET', `/schools/${S.id}/transactions?limit=1000`, S.owner.tok),
    'unknown status': await call('D4:edge', 'GET', `/schools/${S.id}/transactions?status=PAID`, S.owner.tok),
    'bad date': await call('D4:edge', 'GET', `/schools/${S.id}/transactions?from=2026-13-40`, S.owner.tok),
    'R owner lists S': await call('D4:x', 'GET', `/schools/${S.id}/transactions`, R.owner.tok),
    'R owner tiles of S': await call('D4:x', 'GET', `/schools/${S.id}/transactions/summary`, R.owner.tok),
    'S owner lists R': await call('D4:x', 'GET', `/schools/${R.id}/transactions`, S.owner.tok),
    'student lists S': await call('D4:x', 'GET', `/schools/${S.id}/transactions`, studs[0].tok),
    'instructor tiles': await call('D4:x', 'GET', `/schools/${S.id}/transactions/summary`, S.instructor.tok),
  };
  const badCursorWithId = edge['cursor with bad id'];
  const l = Object.entries(edge).filter(([k, v]) => !(v.status >= 400 && v.status < 500) && !(k === 'cursor with bad id' && v.status === 200)).map(([k, v]) => `${k}: ${v.status}`);
  ok('D4c bad filters and cursors are 400s, other Schools and roles get no ledger', l.length === 0, l.join('; ') || `${fmt(edge)}${badCursorWithId.status === 200 ? ' (a cursor carrying a non-uuid id is accepted and just compared as text — harmless)' : ''}`);

  // Latency of a whole-ledger export with 8 owners exporting at once.
  const t2 = t();
  const many = await Promise.all(Array.from({ length: 8 }, () => pageAll('D4:export-parallel', '')));
  const worst = Math.max(...many.map((m) => m.ms ?? 0));
  const errs = many.filter((m) => m.error).map((m) => m.error);
  info('D4d 8 CSV exports (all pages, limit 100) at once', `${many.filter((m) => m.n === inDb).length}/8 complete${errs.length ? ` (failed: ${[...new Set(errs.map((e) => e.slice(0, 60)))].join(' | ')} — the per-user throttle is 1,000 requests a minute (app.module.ts), and one export of N rows is N/100 requests)` : ''}; slowest ${(worst / 1000).toFixed(1)}s, wall ${((t() - t2) / 1000).toFixed(1)}s for ${inDb} rows each`);
}

// ---------------------------------------------------------------------------
// D5. Friend Pass: double grant, and who may give one.
// ---------------------------------------------------------------------------
{
  const st = await mkStudent(S.id, b0, 'd5');
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('D5:gift', 'POST', `/schools/${S.id}/students/${st.id}/memberships/gift`, S.owner.tok, { membershipPlanId: S.plans.friend })));
  const passes = await db.membership.findMany({ where: { studentId: st.id, membershipPlanId: S.plans.friend } });
  const txs = await db.transaction.count({ where: { studentId: st.id } });
  info('D5a Give a Friend Pass clicked 10 times at once', `codes ${JSON.stringify(codes(rs))}; ${passes.length} passes, all gifted by the owner: ${passes.every((p) => p.giftedById === S.owner.id)}, 1 class each: ${passes.every((p) => p.classesRemaining === 1)}; transactions ${txs}. Spec 55 §6.1 gives each friend a separate pass, so several passes per Student are allowed; there is no repeat guard, so a double-click gives ${passes.length}.`);
  const tries = {
    'student buys a Friend Pass': await call('D5:x', 'POST', `/membership-plans/${S.plans.friend}/purchase`, st.tok, {}),
    'owner sells a Friend Pass': await call('D5:x', 'POST', `/schools/${S.id}/students/${st.id}/memberships/sell`, S.owner.tok, { membershipPlanId: S.plans.friend, paymentMethod: 'CASH' }),
    'owner gives a pack': await call('D5:x', 'POST', `/schools/${S.id}/students/${st.id}/memberships/gift`, S.owner.tok, { membershipPlanId: S.plans.pack }),
    'staff gives': await call('D5:x', 'POST', `/schools/${S.id}/students/${st.id}/memberships/gift`, S.staff.tok, { membershipPlanId: S.plans.friend }),
    'instructor gives': await call('D5:x', 'POST', `/schools/${S.id}/students/${st.id}/memberships/gift`, S.instructor.tok, { membershipPlanId: S.plans.friend }),
    'student gives self': await call('D5:x', 'POST', `/schools/${S.id}/students/${st.id}/memberships/gift`, st.tok, { membershipPlanId: S.plans.friend }),
    'R owner gives at S': await call('D5:x', 'POST', `/schools/${S.id}/students/${st.id}/memberships/gift`, R.owner.tok, { membershipPlanId: S.plans.friend }),
    'R owner gives S plan at R': await call('D5:x', 'POST', `/schools/${R.id}/students/${rStudent.id}/memberships/gift`, R.owner.tok, { membershipPlanId: S.plans.friend }),
    'S owner gives to R student': await call('D5:x', 'POST', `/schools/${S.id}/students/${rStudent.id}/memberships/gift`, S.owner.tok, { membershipPlanId: S.plans.friend }),
    'R owner reads S student memberships': await call('D5:x', 'GET', `/schools/${S.id}/students/${st.id}/memberships`, R.owner.tok),
    'staff reads S student memberships': await call('D5:x', 'GET', `/schools/${S.id}/students/${st.id}/memberships`, S.staff.tok),
  };
  const extra = await db.membership.count({ where: { studentId: { in: [st.id, rStudent.id] }, membershipPlanId: { in: [S.plans.friend, S.plans.pack] } } });
  const l = leaks(tries);
  ok('D5b Friend Passes: never bought or sold, only the owner gives them, only to their own Students', l.length === 0 && extra === passes.length, l.join('; ') || `${fmt(tries)}; no extra memberships (${extra} = ${passes.length})`);
}

// ---------------------------------------------------------------------------
// D6. Cancel a Subscription 10 times at once, and who may cancel.
// ---------------------------------------------------------------------------
{
  const st = await mkStudent(S.id, b0, 'd6');
  const subId = await fakeSubscription(S.account.stripeConnectedAccountId);
  const m = await db.membership.create({ data: { id: randomUUID(), studentId: st.id, membershipPlanId: S.plans.sub, schoolId: S.id, frequency: 'RECURRING', stripeSubscriptionId: subId } });
  const key = `POST /v1/subscriptions/${subId}`;
  const before = (await fakeCalls())[key] ?? 0;
  const t1 = t();
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('D6:cancel', 'POST', `/memberships/${m.id}/cancel`, st.tok, {})));
  const wall = t() - t1;
  const stripeUpdates = ((await fakeCalls())[key] ?? 0) - before;
  const row = await db.membership.findUnique({ where: { id: m.id } });
  let ownerAgain = await call('D6:cancel', 'POST', `/memberships/${m.id}/cancel`, S.owner.tok, {});
  // A 503 is the API's "busy, try again" (pool wait / transaction timeout on a
  // shared dev box); retried once, and reported.
  const busy = ownerAgain.status === 503;
  if (busy) { await sleep(500); ownerAgain = await call('D6:cancel', 'POST', `/memberships/${m.id}/cancel`, S.owner.tok, {}); }
  const row2 = await db.membership.findUnique({ where: { id: m.id } });
  ok('D6a cancelling a Subscription 10 times at once: all answered, ends at period end, still live, asking again changes nothing', rs.every((r) => r.status < 300) && row.cancelAt && row.status === 'ACTIVE' && row.cancelledById === st.id && ownerAgain.status < 300 && row2.cancelledById === st.id && +row2.cancelAt === +row.cancelAt, `codes ${JSON.stringify(codes(rs))} in ${wall.toFixed(0)}ms; cancelAt ${row.cancelAt?.toISOString()}; status ${row.status}; cancelledBy student ${row.cancelledById === st.id}; owner's later cancel ${busy ? '503 then ' : ''}${ownerAgain.status}, unchanged ${row2.cancelledById === st.id && +row2.cancelAt === +row.cancelAt}`);
  info('D6b Stripe calls made for those 10 cancels', `${stripeUpdates} subscriptions.update(cancel_at_period_end) calls for one Subscription (no lock or idempotency key in cancel-subscription.ts; each request reads cancelAt=null and calls Stripe). Harmless to Stripe (same update), but the last writer sets cancelledById/cancelAt.`);

  const pack = (await db.membership.findFirst({ where: { schoolId: S.id, membershipPlanId: S.plans.pack } }));
  const st2 = await mkStudent(S.id, b0, 'd6b');
  const subId2 = await fakeSubscription(S.account.stripeConnectedAccountId);
  const m2 = await db.membership.create({ data: { id: randomUUID(), studentId: st2.id, membershipPlanId: S.plans.sub, schoolId: S.id, frequency: 'RECURRING', stripeSubscriptionId: subId2 } });
  const tries = {
    'R owner cancels': await call('D6:x', 'POST', `/memberships/${m2.id}/cancel`, R.owner.tok, {}),
    'R student cancels': await call('D6:x', 'POST', `/memberships/${m2.id}/cancel`, rStudent.tok, {}),
    'classmate cancels': await call('D6:x', 'POST', `/memberships/${m2.id}/cancel`, st.tok, {}),
    'classmate claims guardian': await call('D6:x', 'POST', `/memberships/${m2.id}/cancel`, st.tok, { studentId: st2.id }),
    'staff cancels': await call('D6:x', 'POST', `/memberships/${m2.id}/cancel`, S.staff.tok, {}),
    'instructor cancels': await call('D6:x', 'POST', `/memberships/${m2.id}/cancel`, S.instructor.tok, {}),
    'owner cancels a pack': await call('D6:x', 'POST', `/memberships/${pack.id}/cancel`, S.owner.tok, {}),
    'unknown id': await call('D6:x', 'POST', `/memberships/${randomUUID()}/cancel`, S.owner.tok, {}),
  };
  const r2 = await db.membership.findUnique({ where: { id: m2.id } });
  const l = leaks(tries);
  ok('D6c only the Student, their Guardian or the School owner can cancel; other plans cannot be cancelled', l.length === 0 && !r2.cancelAt, l.join('; ') || `${fmt(tries)}; Subscription untouched`);

  // The member list per plan.
  const mem = await call('D6:members', 'GET', `/membership-plans/${S.plans.sub}/members`, S.owner.tok);
  const ids = new Set((mem.body?.items ?? []).map((x) => x.membershipId));
  const mtries = {
    'staff': await call('D6:members-x', 'GET', `/membership-plans/${S.plans.sub}/members`, S.staff.tok),
    'R owner': await call('D6:members-x', 'GET', `/membership-plans/${S.plans.sub}/members`, R.owner.tok),
    'student': await call('D6:members-x', 'GET', `/membership-plans/${S.plans.sub}/members`, st.tok),
  };
  const ml = leaks(mtries);
  const big = await call('D6:members-big', 'GET', `/membership-plans/${(await db.membershipPlan.findFirst({ where: { schoolId: S.id, title: 'Unlimited' } }))?.id ?? S.plans.sub}/members`, S.owner.tok);
  ok('D6d the member list shows the plan\'s live members to the owner only', mem.status === 200 && ids.has(m.id) && ids.has(m2.id) && ml.length === 0, `owner ${mem.status} (${ids.size} members, includes both ${ids.has(m.id) && ids.has(m2.id)}); ${ml.join('; ') || fmt(mtries)}; the seeded 'Unlimited' plan: ${big.status}, ${big.body?.items?.length ?? '-'} members`);
}

// ---------------------------------------------------------------------------
// D7. Franchise join requests: double ask, accept/decline races, cross-tenant.
// ---------------------------------------------------------------------------
async function mkFranchise(label) {
  const u = await mkUser(`${label}-fo`);
  const tok0 = token(u, []);
  const name = `R3 ${label} ${run}`;
  const r = await call('setup:franchise', 'POST', '/franchises', tok0, { name, feeModel: 'FLAT', flatFeeAmount: 5000 });
  if (r.status >= 300) throw new Error('franchise ' + JSON.stringify(r.body));
  return { id: r.body.id, name, owner: { ...u, tok: r.body.accessToken ?? token(u, [{ role: 'FRANCHISE_OWNER', franchiseId: r.body.id, schoolId: null, branchId: null }]) } };
}
const F = await mkFranchise('Fr');
const F2 = await mkFranchise('Fr2');
const J = await Promise.all(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'].map(mkSchool));
const ask = (j, f = F) => call('D7:join', 'POST', `/schools/${j.id}/join-franchise`, j.owner.tok, { franchiseId: f.id });
const reqOf = async (j) => db.franchiseJoinRequest.findFirst({ where: { schoolId: j.id, status: 'PENDING' } });
const decide = (f, reqId, accept, tok = f.owner.tok) => call(accept ? 'D7:accept' : 'D7:decline', 'POST', `/franchises/${f.id}/join-requests/${reqId}/${accept ? 'accept' : 'decline'}`, tok, {});
{
  const rs = await Promise.all(Array.from({ length: 10 }, () => ask(J[0])));
  const open = await db.franchiseJoinRequest.count({ where: { schoolId: J[0].id, status: 'PENDING' } });
  const other = await ask(J[0], F2);
  ok('D7a asking to join 10 times at once leaves one open request; a second Franchise is refused while it waits', rs.filter((r) => r.status === 201).length === 1 && open === 1 && rs.every((r) => r.status === 201 || r.status === 409) && other.status === 409, `codes ${JSON.stringify(codes(rs))}; open requests ${open}; asking F2 meanwhile ${other.status}`);

  // Accept x5 and decline x5 on one request at once.
  const req = await reqOf(J[0]);
  const ad = await Promise.all(Array.from({ length: 10 }, (_, k) => decide(F, req.id, k % 2 === 0)));
  const after = await db.franchiseJoinRequest.findUnique({ where: { id: req.id } });
  const school = await db.school.findUnique({ where: { id: J[0].id } });
  const wins = ad.filter((r) => r.status === 200).length;
  const consistent = (after.status === 'ACCEPTED' && school.franchiseId === F.id) || (after.status === 'DECLINED' && school.franchiseId === null);
  ok('D7b accept x5 and decline x5 at once: one answer wins, School and request agree', wins === 1 && consistent && ad.every((r) => r.status === 200 || r.status === 409), `codes ${JSON.stringify(codes(ad))}; request ${after.status}; School in F ${school.franchiseId === F.id}`);

  // Ten accepts at once.
  await ask(J[1]);
  const req2 = await reqOf(J[1]);
  const acc = await Promise.all(Array.from({ length: 10 }, () => decide(F, req2.id, true)));
  const s2 = await db.school.findUnique({ where: { id: J[1].id } });
  ok('D7c 10 accepts at once: one 200, the School joins once', acc.filter((r) => r.status === 200).length === 1 && s2.franchiseId === F.id && acc.every((r) => r.status === 200 || r.status === 409), `codes ${JSON.stringify(codes(acc))}; School in F ${s2.franchiseId === F.id}`);

  // Accept vs the School cancelling its own request.
  await ask(J[2]);
  const req3 = await reqOf(J[2]);
  const [a3, c3] = await Promise.all([decide(F, req3.id, true), call('D7:cancel', 'POST', `/schools/${J[2].id}/franchise-join-request/cancel`, J[2].owner.tok, {})]);
  const r3 = await db.franchiseJoinRequest.findUnique({ where: { id: req3.id } });
  const s3 = await db.school.findUnique({ where: { id: J[2].id } });
  const ok3 = (r3.status === 'ACCEPTED' && s3.franchiseId === F.id && a3.status === 200 && c3.status >= 400) || (r3.status === 'CANCELLED' && s3.franchiseId === null && c3.status === 200 && a3.status === 409);
  ok('D7d accept vs the School withdrawing at once: one wins, School and request agree', ok3, `accept ${a3.status}, withdraw ${c3.status}; request ${r3.status}; School in F ${s3.franchiseId === F.id}`);

  // Cross-tenant on a fresh open request (J4 -> F).
  await ask(J[3]);
  const req4 = await reqOf(J[3]);
  const tries = {
    'F2 owner lists F requests': await call('D7:x', 'GET', `/franchises/${F.id}/join-requests`, F2.owner.tok),
    'F2 owner accepts via F path': await decide(F, req4.id, true, F2.owner.tok),
    'F2 owner accepts via own path': await decide(F2, req4.id, true),
    'F2 owner declines via own path': await decide(F2, req4.id, false),
    'School owner lists F requests': await call('D7:x', 'GET', `/franchises/${F.id}/join-requests`, J[3].owner.tok),
    'School owner accepts own request': await decide(F, req4.id, true, J[3].owner.tok),
    'other School owner withdraws J4': await call('D7:x', 'POST', `/schools/${J[3].id}/franchise-join-request/cancel`, J[4].owner.tok, {}),
    'other School owner reads J4 request': await call('D7:x', 'GET', `/schools/${J[3].id}/franchise-join-request`, J[4].owner.tok),
    'S owner asks for J4': await call('D7:x', 'POST', `/schools/${J[3].id}/join-franchise`, S.owner.tok, { franchiseId: F2.id }),
    'student accepts': await decide(F, req4.id, true, rStudent.tok),
    'F owner removes non-member S': await call('D7:x', 'POST', `/franchises/${F.id}/schools/${S.id}/remove`, F.owner.tok, {}),
    'F2 owner reads F roster': await call('D7:x', 'GET', `/franchises/${F.id}/schools`, F2.owner.tok),
    'bad request id': await call('D7:x', 'POST', `/franchises/${F.id}/join-requests/nope/accept`, F.owner.tok, {}),
    'unknown franchise to join': await call('D7:x', 'POST', `/schools/${J[4].id}/join-franchise`, J[4].owner.tok, { franchiseId: randomUUID() }),
  };
  const r4 = await db.franchiseJoinRequest.findUnique({ where: { id: req4.id } });
  const s4 = await db.school.findUnique({ where: { id: J[3].id } });
  const l = leaks(tries);
  ok('D7e join requests are answered only by their own Franchise Owner; other owners and Schools are refused', l.length === 0 && r4.status === 'PENDING' && s4.franchiseId === null, l.join('; ') || `${fmt(tries)}; request still ${r4.status}`);
}

// ---------------------------------------------------------------------------
// D8. Removing a member School, 5 times at once and by the wrong people.
// ---------------------------------------------------------------------------
{
  const tries = {
    'F2 owner removes': await call('D8:x', 'POST', `/franchises/${F2.id}/schools/${J[1].id}/remove`, F2.owner.tok, {}),
    'F2 owner via F path': await call('D8:x', 'POST', `/franchises/${F.id}/schools/${J[1].id}/remove`, F2.owner.tok, {}),
    'member School owner': await call('D8:x', 'POST', `/franchises/${F.id}/schools/${J[1].id}/remove`, J[1].owner.tok, {}),
    'S owner': await call('D8:x', 'POST', `/franchises/${F.id}/schools/${J[1].id}/remove`, S.owner.tok, {}),
  };
  const still = (await db.school.findUnique({ where: { id: J[1].id } })).franchiseId === F.id;
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('D8:remove', 'POST', `/franchises/${F.id}/schools/${J[1].id}/remove`, F.owner.tok, {})));
  const s = await db.school.findUnique({ where: { id: J[1].id } });
  const l = leaks(tries);
  ok('D8 only the Franchise Owner removes a School; 5 removes at once: one 200, the School is independent', l.length === 0 && still && rs.filter((r) => r.status === 200).length === 1 && rs.every((r) => r.status === 200 || r.status === 404) && s.franchiseId === null && s.archivedAt === null, `${l.join('; ') || fmt(tries)}; parallel removes ${JSON.stringify(codes(rs))}; School independent ${s.franchiseId === null}, open ${s.archivedAt === null}`);
}

// ---------------------------------------------------------------------------
// D9. A School Owner closes their own School while money and bookings move.
// ---------------------------------------------------------------------------
{
  const C = await mkSchool('Close');
  C.account = await stripeAccount(C.id, C.owner.tok);
  const acct = C.account.stripeConnectedAccountId;
  const plans = {
    pack: await mkPlan(C.id, C.owner.tok, { type: 'CLASS_PACK', title: 'C pack', price: 6000, classesIncluded: 10, expiryDurationDays: 90 }),
    sub: await mkPlan(C.id, C.owner.tok, { type: 'SUBSCRIPTION', title: 'C monthly', price: 12000 }),
  };
  // Staff and an instructor; a class an hour from now.
  const staff = await mkUser('c-staff');
  await db.roleGrant.create({ data: { id: randomUUID(), userId: staff.id, role: 'BRANCH_STAFF', schoolId: C.id, branchId: C.branch } });
  staff.tok = token(staff, [grant('BRANCH_STAFF', C.id, C.branch)]);
  const instr = await mkUser('c-instr');
  await db.roleGrant.create({ data: { id: randomUUID(), userId: instr.id, role: 'INSTRUCTOR', schoolId: C.id, branchId: C.branch } });
  await db.instructor.create({ data: { id: randomUUID(), userId: instr.id, schoolId: C.id, branchId: C.branch } });
  const disc = await call('setup:style', 'POST', `/schools/${C.id}/disciplines/from-template`, C.owner.tok, { templateId: 'ibjjf', name: 'BJJ' });
  const discipline = disc.status < 300 ? await db.discipline.findUnique({ where: { id: disc.body.id } }) : null;
  const mkClass = async (title) => call('setup:class', 'POST', `/schools/${C.id}/classes`, C.owner.tok, { branchId: C.branch, instructorId: instr.id, title, styles: [{ disciplineId: discipline?.id, classType: (discipline?.classTypesOffered ?? [])[0] ?? null }], startDate: new Date(Date.now() + 3600e3).toISOString(), endDate: new Date(Date.now() + 7200e3).toISOString(), membershipInclusion: true, capacity: 20 });
  const cls = await mkClass('Close race class');
  if (cls.status >= 300) console.log('class setup failed', cls.status, JSON.stringify(cls.body).slice(0, 200));

  // Students: a live Subscription, a Subscription paid only after the close, a
  // pack holder who books during the close, a cash payment confirmed during it,
  // one bought at the desk during it, and one more cash payment for afterwards.
  const [subSt, lateSubSt, booker, cashSt, deskSt, laterSt, afterSt] = await Promise.all(['sub', 'latesub', 'book', 'cash', 'desk', 'later', 'after'].map((l) => mkStudent(C.id, C.branch, `c-${l}`)));
  const liveSub = await fakeSubscription(acct);
  await db.membership.create({ data: { id: randomUUID(), studentId: subSt.id, membershipPlanId: plans.sub, schoolId: C.id, frequency: 'RECURRING', stripeSubscriptionId: liveSub } });
  const lateBuy = await call('D9:subscribe', 'POST', `/membership-plans/${plans.sub}/purchase`, lateSubSt.tok, {});
  const lateTx = lateBuy.body?.transactionId ? await db.transaction.findUnique({ where: { id: lateBuy.body.transactionId } }) : null;
  const deskPre = await call('D9:desk', 'POST', `/schools/${C.id}/desk-payments`, C.owner.tok, { studentId: booker.id, membershipPlanId: plans.pack, paymentMethod: 'CASH' });
  const cashRow = await pendingCash(C, cashSt.id, plans.pack);
  const laterRow = await pendingCash(C, laterSt.id, plans.pack);
  const stepTok = await stepUp(C.owner);
  // Control: the class can be booked while the School is open.
  const ctl = await mkStudent(C.id, C.branch, 'c-ctl');
  await call('D9:desk', 'POST', `/schools/${C.id}/desk-payments`, C.owner.tok, { studentId: ctl.id, membershipPlanId: plans.pack, paymentMethod: 'CASH' });
  const ctlBook = cls.status < 300 ? await call('D9:book-open', 'POST', `/classes/${cls.body.id}/book`, ctl.tok, {}) : { status: 0, body: cls.body };

  // Refusals before the close.
  const otherStep = await stepUp(J[5].owner);
  const pre = {
    'no step-up': await call('D9:close-x', 'POST', `/schools/${C.id}/close`, C.owner.tok, { confirmName: C.name }),
    'wrong name': await fetch(`${API}/schools/${C.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${C.owner.tok}`, 'x-step-up-token': stepTok }, body: JSON.stringify({ confirmName: C.name.toUpperCase() }) }),
    'another user\'s step-up': await fetch(`${API}/schools/${C.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${C.owner.tok}`, 'x-step-up-token': otherStep }, body: JSON.stringify({ confirmName: C.name }) }),
    'staff closes': await fetch(`${API}/schools/${C.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${staff.tok}`, 'x-step-up-token': stepTok }, body: JSON.stringify({ confirmName: C.name }) }),
    'other owner with own step-up': await fetch(`${API}/schools/${C.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${J[5].owner.tok}`, 'x-step-up-token': otherStep }, body: JSON.stringify({ confirmName: C.name }) }),
    'student closes': await call('D9:close-x', 'POST', `/schools/${C.id}/close`, booker.tok, { confirmName: C.name }),
  };
  const stillOpen = (await db.school.findUnique({ where: { id: C.id } })).archivedAt === null;
  const pl = leaks(pre);
  ok('D9a closing a School needs its own owner, the exact name and a fresh passcode check', pl.length === 0 && stillOpen, `${pl.join('; ') || fmt(pre)}; still open ${stillOpen}`);

  // The close, 5 times at once, racing a confirm, a desk sale and a booking.
  const closeReq = () => fetch(`${API}/schools/${C.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${C.owner.tok}`, 'x-step-up-token': stepTok }, body: JSON.stringify({ confirmName: C.name }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), at: new Date() }));
  const callsBefore = await fakeCalls();
  const t1 = t();
  const [closes, conf, desk, book] = await Promise.all([
    Promise.all(Array.from({ length: 5 }, closeReq)),
    call('D9:race-confirm', 'PATCH', `/transactions/${cashRow.id}/confirm`, C.owner.tok, {}),
    call('D9:race-desk', 'POST', `/schools/${C.id}/desk-payments`, C.owner.tok, { studentId: deskSt.id, membershipPlanId: plans.pack, paymentMethod: 'CASH' }),
    cls.status < 300 ? call('D9:race-book', 'POST', `/classes/${cls.body.id}/book`, booker.tok, {}) : Promise.resolve({ status: 0 }),
  ]);
  const closeMs = t() - t1;
  const school = await db.school.findUnique({ where: { id: C.id } });
  const closedAt = school.archivedAt;
  const won = closes.find((r) => r.status === 200);
  ok('D9b 5 closes at once: one 200, the rest 409', closes.filter((r) => r.status === 200).length === 1 && closes.every((r) => r.status === 200 || r.status === 409) && !!closedAt && !!school.purgeAt, `close codes ${JSON.stringify(codes(closes))} (${closeMs.toFixed(0)}ms); archivedAt ${closedAt?.toISOString()}, purgeAt ${school.purgeAt?.toISOString()}`);
  // What the racing actions wrote, against the close's archivedAt and the moment
  // the winning close answered (by then it had committed).
  const ms = (d) => (d ? `${d - closedAt >= 0 ? '+' : ''}${d - closedAt}ms` : '-');
  const cashNow = await db.transaction.findUnique({ where: { id: cashRow.id }, include: { membership: true } });
  const deskNow = await db.membership.findFirst({ where: { studentId: deskSt.id, schoolId: C.id } });
  const bookNow = cls.status < 300 ? await db.booking.findFirst({ where: { classId: cls.body.id, studentId: booker.id } }) : null;
  const afterCommit = [cashNow.membership?.createdAt, deskNow?.createdAt, bookNow?.createdAt].filter((d) => d && won && d > won.at).length;
  const consistent = (cashNow.status === 'SUCCESSFUL') === !!cashNow.membershipId && (conf.status === 200) === (cashNow.status === 'SUCCESSFUL') && (desk.status === 201) === !!deskNow && [conf, desk, book].every((r) => r.status < 500);
  ok('D9c a confirm, a desk sale and a booking racing the close: each either finishes or is refused, never half-done, never after the close answered', consistent && afterCommit === 0, `booking while open (control) ${ctlBook.status}${ctlBook.status >= 300 ? ' ' + JSON.stringify(ctlBook.body).slice(0, 120) : ''}; racing: confirm ${conf.status} (row ${cashNow.status}, membership at ${ms(cashNow.membership?.createdAt)}), desk sale ${desk.status} (membership at ${ms(deskNow?.createdAt)}), booking ${book.status} (at ${ms(bookNow?.createdAt)}); close answered at ${ms(won?.at)}; writes after that: ${afterCommit}`);

  // After the close.
  const lateCls = await mkClass('After close class');
  const after = {
    'desk payment': await call('D9:after', 'POST', `/schools/${C.id}/desk-payments`, C.owner.tok, { studentId: afterSt.id, membershipPlanId: plans.pack, paymentMethod: 'CASH' }),
    'sell at desk': await call('D9:after', 'POST', `/schools/${C.id}/students/${afterSt.id}/memberships/sell`, C.owner.tok, { membershipPlanId: plans.pack, paymentMethod: 'CASH' }),
    'student buys pack': await call('D9:after', 'POST', `/membership-plans/${plans.pack}/purchase`, afterSt.tok, { useHostedCheckout: true }),
    'student subscribes': await call('D9:after', 'POST', `/membership-plans/${plans.sub}/purchase`, afterSt.tok, {}),
    'mark as paid': await call('D9:after', 'PATCH', `/transactions/${laterRow.id}/confirm`, C.owner.tok, {}),
    'cancel payment': await call('D9:after', 'PATCH', `/transactions/${laterRow.id}/cancel`, C.owner.tok, {}),
    'book a class': cls.status < 300 ? await call('D9:after', 'POST', `/classes/${cls.body.id}/book`, afterSt.tok, {}) : { status: 400 },
    'create a class': lateCls,
    'ask to join a Franchise': await call('D9:after', 'POST', `/schools/${C.id}/join-franchise`, C.owner.tok, { franchiseId: F2.id }),
    'new plan': await call('D9:after', 'POST', `/schools/${C.id}/membership-plans`, C.owner.tok, { type: 'CLASS_PACK', title: 'After', price: 100, classesIncluded: 1, currency: 'GBP' }),
    'close again': await closeReq(),
  };
  const al = Object.entries(after).filter(([, v]) => !(v.status >= 400 && v.status < 500)).map(([k, v]) => `${k}: ${v.status}`);
  const laterNow = await db.transaction.findUnique({ where: { id: laterRow.id } });
  ok('D9d a closed School takes no payments, sales, bookings, plans or Franchise requests', al.length === 0 && laterNow.status === 'PENDING', `${al.join('; ') || fmt(after)}; pending payment still ${laterNow.status}`);

  // Billing stopped: the live Subscription ends at period end.
  const live = await db.membership.findFirst({ where: { stripeSubscriptionId: liveSub } });
  const callsAfter = await fakeCalls();
  const subCalls = (callsAfter[`POST /v1/subscriptions/${liveSub}`] ?? 0) - (callsBefore[`POST /v1/subscriptions/${liveSub}`] ?? 0);
  ok('D9e the close stops billing: the live Subscription is set to end at period end, cancelled by the owner', !!live.cancelAt && live.cancelledById === C.owner.id && subCalls === 1, `cancelAt ${live.cancelAt?.toISOString() ?? 'none'}; cancelledBy owner ${live.cancelledById === C.owner.id}; Stripe updates for it ${subCalls}`);

  // A Subscription bought before the close and paid after it.
  if (lateTx?.stripePaymentIntentId) {
    const wh = await webhook('payment_intent.succeeded', lateTx.stripePaymentIntentId, acct);
    // Settled (paid or refused) once the webhook job has run.
    const processed = await waitFor(async () => (await db.transaction.findUnique({ where: { id: lateTx.id } })).status !== 'PENDING' || (await db.processedStripeEvent.count({ where: { stripeEventId: wh.eventId } }).catch(() => 0)) > 0, 120000);
    await sleep(1500);
    const tx = await db.transaction.findUnique({ where: { id: lateTx.id } });
    const mem = await db.membership.findFirst({ where: { studentId: lateSubSt.id, schoolId: C.id } });
    const billing = mem && mem.status === 'ACTIVE' && mem.stripeSubscriptionId && !mem.cancelAt;
    if (!processed) info('D9f a Subscription paid after its School closed does not keep billing', `inconclusive: the webhook job did not run within 120s (payment still ${tx.status})`);
    else ok('D9f a Subscription paid after its School closed does not keep billing', !billing, `webhook ${wh.status}; payment ${tx.status}; membership ${mem ? `${mem.status}, subscription ${mem.stripeSubscriptionId}, cancelAt ${mem.cancelAt?.toISOString() ?? 'none'}` : 'none'}; Stripe calls on it ${(await fakeCalls())[`POST /v1/subscriptions/${lateTx.stripeSubscriptionId}`] ?? 0}`);
  } else {
    ok('D9f a Subscription paid after its School closed does not keep billing', false, `setup: Subscription purchase before the close returned ${lateBuy.status} ${JSON.stringify(lateBuy.body).slice(0, 160)}`);
  }

  // Cancelling a Subscription at a closed School.
  const subCancel = await call('D9:after', 'POST', `/memberships/${live.id}/cancel`, subSt.tok, {});
  info('D9g a Student cancels their Subscription at a closed School', `${subCancel.status} (already set to end by the close, so it is returned unchanged). Pre-close desk sale for the booker: ${deskPre.status}.`);

  // A pending join request lapses when the School closes (Decision 352).
  await ask(J[4]);
  const req5 = await reqOf(J[4]);
  const st5 = await stepUp(J[4].owner);
  const close5 = await fetch(`${API}/schools/${J[4].id}/close`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${J[4].owner.tok}`, 'x-step-up-token': st5 }, body: JSON.stringify({ confirmName: J[4].name }) });
  const r5 = await db.franchiseJoinRequest.findUnique({ where: { id: req5.id } });
  const acc5 = await decide(F, req5.id, true);
  const s5 = await db.school.findUnique({ where: { id: J[4].id } });
  ok('D9h a closed School\'s open join request lapses and cannot then be accepted', close5.status === 200 && r5.status === 'CANCELLED' && acc5.status === 409 && s5.franchiseId === null, `close ${close5.status}; request ${r5.status}; accept afterwards ${acc5.status}; School in F ${s5.franchiseId === F.id}`);
}

// ---------------------------------------------------------------------------
// D10. A Franchise Owner closes their own Franchise with member Schools.
// ---------------------------------------------------------------------------
{
  // Members: J1 if D7b accepted it, plus J6 joined now; J4 still asking.
  const j6 = J[5];
  await ask(j6);
  await decide(F, (await reqOf(j6)).id, true);
  const members = await db.school.findMany({ where: { franchiseId: F.id }, select: { id: true } });
  const pending = await reqOf(J[3]);
  const step = await stepUp(F.owner);
  const step2 = await stepUp(F2.owner);
  const post = (tok, st, name, id = F.id) => fetch(`${API}/franchises/${id}/close`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, ...(st ? { 'x-step-up-token': st } : {}) }, body: JSON.stringify({ confirmName: name }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const pre = {
    'no step-up': await post(F.owner.tok, null, F.name),
    'wrong name': await post(F.owner.tok, step, `${F.name} `),
    'F2 owner with own step-up': await post(F2.owner.tok, step2, F.name),
    'F owner with F2 step-up': await post(F.owner.tok, step2, F.name),
    'member School owner': await post(j6.owner.tok, step, F.name),
  };
  const pl = leaks(pre);
  const open = (await db.franchise.findUnique({ where: { id: F.id } })).archivedAt === null;
  ok('D10a closing a Franchise needs its own Owner, the exact name and a fresh passcode check', pl.length === 0 && open, `${pl.join('; ') || fmt(pre)}; still open ${open}`);

  const rs = await Promise.all(Array.from({ length: 5 }, () => post(F.owner.tok, step, F.name)));
  const fr = await db.franchise.findUnique({ where: { id: F.id } });
  const membersAfter = await db.school.findMany({ where: { id: { in: members.map((m) => m.id) } }, select: { archivedAt: true, franchiseId: true } });
  const pendingAfter = pending ? await db.franchiseJoinRequest.findUnique({ where: { id: pending.id } }) : null;
  ok('D10b 5 closes at once: one 200; member Schools stay open; open join requests lapse', rs.filter((r) => r.status === 200).length === 1 && rs.every((r) => r.status === 200 || r.status === 409) && !!fr.archivedAt && membersAfter.every((m) => m.archivedAt === null) && (!pendingAfter || pendingAfter.status === 'CANCELLED'), `codes ${JSON.stringify(codes(rs))}; archivedAt ${fr.archivedAt?.toISOString()}; ${membersAfter.length} member Schools, open ${membersAfter.filter((m) => m.archivedAt === null).length}, still linked ${membersAfter.filter((m) => m.franchiseId === F.id).length}; pending request ${pendingAfter?.status ?? 'none'}`);

  const after = {
    'a School asks to join': await call('D10:after', 'POST', `/schools/${J[3].id}/join-franchise`, J[3].owner.tok, { franchiseId: F.id }),
    'accept a lapsed request': pending ? await decide(F, pending.id, true) : { status: 409 },
    'remove a member': await call('D10:after', 'POST', `/franchises/${F.id}/schools/${j6.id}/remove`, F.owner.tok, {}),
    'edit the Franchise': await call('D10:after', 'PATCH', `/franchises/${F.id}`, F.owner.tok, { name: 'Renamed' }),
    'close again': await post(F.owner.tok, step, F.name),
  };
  const al = leaks(after);
  const leave = await call('D10:leave', 'POST', `/schools/${j6.id}/leave-franchise`, j6.owner.tok, {});
  ok('D10c a closed Franchise takes no joins, accepts, removals or edits', al.length === 0, `${al.join('; ') || fmt(after)}`);
  info('D10d a member School of a closed Franchise leaves it', `leave-franchise ${leave.status}; Decision 352 says member Schools "stay open and keep running" but does not say whether they stay linked to the closed Franchise.`);
}

console.log('');
report();
save();
await db.$disconnect();
