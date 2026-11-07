// Round 5 GB, part 2: money for children (needs a Stripe account against the
// fake), reruns of two probes from tests.mjs, notifications for an adult
// former child, Kid Mode for an 18-year-old.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';

const C = JSON.parse(fs.readFileSync(new URL('./gb-cast.json', import.meta.url)));
const U = C.users; const A = C.schoolA;
const ev = []; const res = [];
const short = (b) => { const s = JSON.stringify(b); return s && s.length > 400 ? s.slice(0, 400) + '…' : s; };
async function req(id, method, path, tok, body, headers) { const r = await call(id, method, path, tok, body, headers); ev.push({ id, req: `${method} ${path}`, body, status: r.status, resp: short(r.body) }); return r; }
const ok = (id, pass, detail) => { res.push({ id, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? ' — ' + detail : ''}`); };
const g = (u) => tokenRca(u, []);
const tOwner = tokenRca(U.owner, [grant('SCHOOL_OWNER_MANAGER', A)]);
const tStaffDid = tokenRca(U.staffDid, [grant('BRANCH_STAFF', A, C.branches.did)]);
const tLiam = tokenRca(U.liam, [grant('STUDENT', A, C.branches.lev)]);
const tPatrick = tokenRca(U.patrick, [grant('STUDENT', A, C.branches.lev)]);

// Stripe account (fake Stripe).
let acct = await req('setup acct', 'POST', `/schools/${A}/payment-accounts`, tOwner, { provider: 'STRIPE', accountTitle: 'Red Rose', country: 'GB' });
if (acct.status === 409) acct = { status: 200, body: await db.paymentAccount.findFirst({ where: { schoolId: A } }) };
// onboarding is done in the DB (the shared API has no STRIPE_CONNECT_REFRESH_URL)
// Plans need to be on sale through the API to be purchasable: make a fresh one.
const plan = await req('setup plan', 'POST', `/schools/${A}/membership-plans`, tOwner, { type: 'CLASS_PACK', title: `Juniors 5-class ${Date.now() % 1e5}`, price: 4500, currency: 'GBP', classesIncluded: 5 });
if (plan.status >= 300) throw new Error('plan ' + JSON.stringify(plan.body));
const pid = plan.body.id;

// Liam, 10, no Guardian, buys for himself.
const l1 = await req('P1 Liam hosted checkout', 'POST', `/membership-plans/${pid}/purchase`, tLiam, { useHostedCheckout: true });
ok('P1 a 10-year-old cannot buy a plan himself (Decision 67)', l1.status === 403 || l1.status === 400, `${l1.status} ${short(l1.body)}`);
const l2 = await req('P1 Liam PaymentIntent', 'POST', `/membership-plans/${pid}/purchase`, tLiam, {});
ok('P1 a 10-year-old cannot buy (PaymentIntent)', l2.status === 403 || l2.status === 400, `${l2.status} ${short(l2.body)}`);
// Ann buys for Ronan (18 yesterday).
const r1 = await req('P2 Ann buys for Ronan', 'POST', `/membership-plans/${pid}/purchase`, g(U.ann), { studentId: U.ronan.id, useHostedCheckout: true });
ok('P2 parent buys for an adult (18 yesterday) is refused', r1.status >= 400, `${r1.status} ${short(r1.body)}`);
// Máire buys for Cian; saved card refused; Patrick can't buy for Cian; Patrick buys for Oisín.
const m1 = await req('P3 Máire buys for Cian', 'POST', `/membership-plans/${pid}/purchase`, g(U.maire), { studentId: U.cian.id, useHostedCheckout: true });
ok('P3 parent buys child plan (Decision 428)', m1.status === 201, `${m1.status} ${short(m1.body)}`);
const m2 = await req('P3 Máire saved card for Cian', 'POST', `/membership-plans/${pid}/purchase`, g(U.maire), { studentId: U.cian.id, payWithSavedCard: true });
ok('P3 saved card refused for a child', m2.status === 400, `${m2.status}`);
const m3 = await req('P3 Patrick buys for Cian', 'POST', `/membership-plans/${pid}/purchase`, tPatrick, { studentId: U.cian.id, useHostedCheckout: true });
ok('P3 non-parent cannot buy for a child', m3.status === 403, `${m3.status}`);
const m4 = await req('P3 Patrick buys for Oisín', 'POST', `/membership-plans/${pid}/purchase`, tPatrick, { studentId: U.oisin.id, useHostedCheckout: true });
ok('P3 Guardian-who-trains buys child plan', m4.status === 201, `${m4.status} ${short(m4.body)}`);
const tx = await db.transaction.findMany({ where: { schoolId: A, studentId: { in: [U.liam.id, U.ronan.id, U.cian.id, U.oisin.id] } }, select: { studentId: true, amount: true, currency: true, status: true } });
ev.push({ id: 'P transactions', db: tx });

// Race rerun: 8 parallel Kid Mode bookings into a fresh class.
const cls = await req('R class', 'POST', `/schools/${A}/classes`, tOwner, { branchId: C.branches.lev, instructorId: U.instrLev.id, title: 'Race class', styles: [{ disciplineId: C.disciplineId, classType: null }], startDate: new Date(Date.now() + 8 * 86400e3).toISOString(), endDate: new Date(Date.now() + 8 * 86400e3 + 3600e3).toISOString(), membershipInclusion: true, capacity: 20 });
await req('R delegation Cian', 'POST', `/guardians/me/minors/${U.cian.id}/booking-delegation`, g(U.maire));
const kt = (await req('R mint Cian', 'POST', `/guardians/me/minors/${U.cian.id}/kid-mode-token`, g(U.maire))).body?.accessToken;
const before = await db.membership.findFirst({ where: { studentId: U.cian.id, schoolId: A, classesRemaining: { not: null } }, select: { id: true, classesRemaining: true } });
const race = await Promise.all(Array.from({ length: 8 }, () => call('R race', 'POST', `/classes/${cls.body.id}/book`, kt, { studentId: U.cian.id })));
const after = await db.membership.findUnique({ where: { id: before.id }, select: { classesRemaining: true } });
ok('R Kid Mode 8 parallel bookings → one, one credit', race.filter((r) => r.status === 201).length === 1 && before.classesRemaining - after.classesRemaining === 1, `${race.map((r) => r.status).sort().join(',')} credits ${before.classesRemaining}→${after.classesRemaining}`);

// Roster rerun without a limit param.
const rl = await req('R Did staff roster', 'GET', `/schools/${A}/students`, tStaffDid);
const rlTxt = JSON.stringify(rl.body);
ok('R Did staff roster excludes Levenshulme children', rl.status === 200 && !rlTxt.includes(U.aoife.id), `${rl.status} ${short(rl.body).slice(0, 150)}`);

// Kid Mode for Ronan (adult, still linked).
await req('K Ann delegation Ronan', 'POST', `/guardians/me/minors/${U.ronan.id}/booking-delegation`, g(U.ann));
const kr = await req('K Ann mint for Ronan', 'POST', `/guardians/me/minors/${U.ronan.id}/kid-mode-token`, g(U.ann));
ok('K Kid Mode refused for an 18-year-old', kr.status >= 400, `${kr.status}`);

// Notification about an adult goes to the parent.
const tag = `Squad news ${randomUUID().slice(0, 6)}`;
await req('N broadcast open1', 'POST', `/schools/${A}/notifications/broadcast`, tOwner, { title: tag, body: 'Bring your gi.', audience: 'CLASS', classId: C.classes.open1, classAudience: ['BOOKED'] });
let rows = [];
for (let i = 0; i < 40; i++) { rows = await db.notification.findMany({ where: { title: tag }, select: { userId: true, body: true } }); if (rows.some((r) => r.userId === U.ann.id)) break; await new Promise((r) => setTimeout(r, 3000)); }
const annRows = rows.filter((r) => r.userId === U.ann.id).map((r) => r.body);
ev.push({ id: 'N rows', total: rows.length, ann: annRows, kieran: rows.filter((r) => r.userId === U.instrDid.id).map((r) => r.body) });
ok('N an 18-year-old\'s notices stop going to the parent', annRows.length === 0, JSON.stringify(annRows));

fs.writeFileSync(new URL('./tests2-evidence.json', import.meta.url), JSON.stringify({ res, ev }, null, 1));
console.log(`\n${res.filter((r) => r.pass).length}/${res.length} passed`);
await db.$disconnect();
process.exit(0);
