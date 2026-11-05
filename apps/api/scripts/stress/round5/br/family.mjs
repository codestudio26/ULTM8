// Round 5 BR: Guardians with 3–4 children, divorced parents, parent booking for kids,
// notices to the right parents, consent (ECA/LGPD), carnival closures, Manaus time,
// week start Sunday, midnight class. CAST=../empty-cast.json node family.mjs
import fs from 'fs';
import { db, call, checks, codes } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-br.json', import.meta.url)));
const { ok, save } = checks('family');
const log = (...a) => console.log('   ', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const S = C.S; const T = C.tok; const B = C.branches;
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Upcoming classes
const kidsSlots = C.slots.filter((s) => s.title.startsWith('Kids 8')).map((s) => s.id);
const upcoming = async (branch, titlePrefix) => db.class.findMany({ where: { schoolId: S, branchId: branch, title: { startsWith: titlePrefix }, cancelledAt: null, startDate: { gt: new Date(Date.now() + 3600e3) } }, orderBy: { startDate: 'asc' }, take: 20 });
const kidsSP = await upcoming(B.SP, 'Kids 8');
const kidsMAO = await upcoming(B.MAO, 'Kids 8');
ok('setup classes generated', kidsSP.length > 3 && kidsMAO.length > 3, `${kidsSP.length} ${kidsMAO.length}`);

// F0 Manaus local time: 18:00 in Manaus = 22:00Z; São Paulo 18:00 = 21:00Z
const hm = (d, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
ok('F0 Manaus class at 18:00 Manaus time, SP at 18:00 São Paulo time', hm(kidsMAO[0].startDate, 'America/Manaus') === '18:00' && hm(kidsSP[0].startDate, 'America/Sao_Paulo') === '18:00', `${kidsMAO[0].startDate.toISOString()} ${kidsSP[0].startDate.toISOString()}`);

// F1 Guardians list their minors
const big = C.big;
const g1 = await call('f1', 'GET', '/guardians/me/minors', big.g1tok);
const g2 = await call('f1', 'GET', '/guardians/me/minors', big.g2tok);
const ids = (r) => (r.body?.items ?? r.body ?? []).map?.((x) => x.id ?? x.studentId) ?? [];
ok('F1 both divorced parents see all 4 children', g1.status === 200 && g2.status === 200 && big.kids.every((k) => ids(g1).includes(k) && ids(g2).includes(k)), `${g1.status} ${g2.status} ${ids(g1).length} ${ids(g2).length} ${JSON.stringify(g1.body).slice(0, 200)}`);

// F2 Parent books each of 4 kids into the same Kids class (various memberships)
const cls = kidsSP[1];
const kinds = Object.fromEntries(C.students.map((s) => [s.id, s.kind]));
const bk = await Promise.all(big.kids.map((k) => call('f2', 'POST', `/classes/${cls.id}/book`, big.g2tok, { studentId: k })));
// The other parent trains at the academy too (holds a STUDENT grant): can they book their kids?
const bkTrain = await Promise.all(big.kids.map((k) => call('f2t', 'POST', `/classes/${kidsSP[4].id}/book`, big.g1tok, { studentId: k })));
log('parent-who-trains books kids', bkTrain.map((r) => [r.status, r.body?.error?.message]));
out.parentTrains = { classId: kidsSP[4].id, results: bkTrain.map((r) => ({ status: r.status, body: r.body?.error ?? r.body?.id })) };
ok('F2t a parent who also trains here can book their own kids', bkTrain.every((r, i) => (kinds[big.kids[i]] === 'none' || kinds[big.kids[i]] === 'lapsed') ? true : r.status === 201), JSON.stringify(bkTrain.map((r) => r.status)));
const bkCoach = await call('f2t', 'POST', `/classes/${kidsSP[4].id}/book`, C.coachGuardianTok, { studentId: C.special.leap });
log('coach who is a parent books own child (leap-day kid, no membership)', bkCoach.status, bkCoach.body?.error?.message);
log('book 4 kids', big.kids.map((k, i) => [kinds[k], bk[i].status, bk[i].body?.error?.code ?? bk[i].body?.status]));
ok('F2 parent books kids who have a membership', bk.every((r, i) => (kinds[big.kids[i]] === 'none' || kinds[big.kids[i]] === 'lapsed') ? r.status >= 400 : r.status === 201), JSON.stringify(bk.map((r) => r.status)));
// Second parent sees those bookings; another parent can't
const k0 = big.kids[bk.findIndex((r) => r.status === 201)];
if (k0) {
  const v2 = await call('f2', 'GET', `/guardians/me/minors/${k0}/bookings`, big.g1tok);
  const other = C.families.find((f) => !f.kids.some((k) => big.kids.includes(k)));
  const vx = await call('f2', 'GET', `/guardians/me/minors/${k0}/bookings`, other.tok);
  const vb = await call('f2', 'POST', `/classes/${kidsSP[2].id}/book`, other.tok, { studentId: k0 });
  ok('F2b other parent sees bookings; a stranger parent cannot read or book', v2.status === 200 && JSON.stringify(v2.body).includes(cls.id) && vx.status >= 400 && vb.status >= 400, `${v2.status} ${vx.status} ${vb.status}`);
}
// Double-click booking for one kid ×6
const kSub = C.families.flatMap((f) => f.kids.map((k) => ({ k, f }))).find(({ k }) => kinds[k] === 'pack5' && !big.kids.includes(k));
if (kSub) {
  const before = await db.membership.findFirst({ where: { studentId: kSub.k, membershipPlanId: C.plans.pack5 } });
  const rr = await Promise.all(Array.from({ length: 6 }, () => call('f2c', 'POST', `/classes/${kidsSP[3].id}/book`, kSub.f.tok, { studentId: kSub.k })));
  const after = await db.membership.findUnique({ where: { id: before.id } });
  const nb = await db.booking.count({ where: { classId: kidsSP[3].id, studentId: kSub.k } });
  ok('F2c parent double-clicks Book ×6 → one booking, one credit', nb === 1 && before.classesRemaining - after.classesRemaining === 1, `${JSON.stringify(codes(rr))} bookings=${nb} credits ${before.classesRemaining}→${after.classesRemaining}`);
}

// F3 Guardian-who-is-coach books own linked child (turning 18 in 3 days)
const tb = await call('f3', 'POST', `/classes/${kidsSP[2].id}/book`, C.coachGuardianTok, { studentId: C.special.turning18 });
log('coach-guardian books turning-18 kid (no membership)', tb.status, tb.body?.error?.code);

// F4 Notices: owner cancels the Kids class → each booked kid's parents (both) told; nobody else
const booked = await db.booking.findMany({ where: { classId: cls.id, status: 'UPCOMING' }, select: { studentId: true } });
const t0 = new Date();
const cc = await call('f4', 'POST', `/classes/${cls.id}/cancel`, T.owner, { reason: 'Tatame em reforma — desculpem!' });
await sleep(8000);
const notes = await db.notification.findMany({ where: { createdAt: { gte: t0 } }, select: { userId: true, title: true, body: true } });
const recips = new Set(notes.map((n) => n.userId));
const parentsOf = new Set((await db.guardianLink.findMany({ where: { studentId: { in: booked.map((b) => b.studentId) }, revokedAt: null } })).map((l) => l.guardianId));
const expected = new Set([...booked.map((b) => b.studentId), ...parentsOf]);
const strangers = [...recips].filter((u) => !expected.has(u) && ![C.users.rafael, C.users.coOwner].includes(u));
// strangers may include notices from other testers' activity: limit to my School's people
const mine = new Set([...C.students.map((s) => s.id), ...C.families.map((f) => f.g), C.users.secondParent, C.users.guardianCoach]);
const myStrangers = strangers.filter((u) => mine.has(u));
ok('F4 class cancelled → booked kids and both their parents told, no other family', cc.status < 300 && booked.length > 0 && [...parentsOf].every((p) => recips.has(p)) && myStrangers.length === 0,
  `cancel ${cc.status}; booked ${booked.length}; parents ${parentsOf.size}, told ${[...parentsOf].filter((p) => recips.has(p)).length}; other families told ${myStrangers.length}`);
out.f4 = notes.filter((n) => parentsOf.has(n.userId)).slice(0, 3);
log('parent notice sample', out.f4[0]);
// Credits back to packs?
const g1n = await call('f4', 'GET', '/notifications/me', big.g2tok);
log('g1 /notifications/me', g1n.status, JSON.stringify(g1n.body).slice(0, 300));

// F5 Consent (ECA/LGPD): baseline + camera for a child, withdraw camera
const ck = big.kids[0];
const c1 = await call('f5', 'POST', `/guardians/me/minors/${ck}/consent`, big.g1tok, { tier: 'BASELINE', policyVersion: 'LGPD-2026-11 pt-BR' });
const c2 = await call('f5', 'POST', `/guardians/me/minors/${ck}/consent`, big.g2tok, { tier: 'CAMERA', policyVersion: 'LGPD-2026-11 pt-BR' });
const cl1 = await call('f5', 'GET', '/guardians/me/consent', big.g1tok);
const cl2 = await call('f5', 'GET', '/guardians/me/consent', big.g2tok);
log('consent', c1.status, c2.status, 'g1 sees', JSON.stringify(cl1.body).slice(0, 300), 'g2 sees', JSON.stringify(cl2.body).slice(0, 300));
out.consent = { c1: c1.body, c2: c2.body, cl1: cl1.body, cl2: cl2.body };
const other = C.families.find((f) => !f.kids.some((k) => big.kids.includes(k)));
const cx = await call('f5', 'POST', `/guardians/me/minors/${ck}/consent`, other.tok, { tier: 'BASELINE', policyVersion: 'x' });
ok('F5 stranger parent cannot consent for the child', cx.status >= 400, `${cx.status}`);
// Can parent 1 withdraw the consent parent 2 gave?
const camId = c2.body?.id;
if (camId) {
  const w1 = await call('f5', 'PATCH', `/guardians/me/consent/${camId}/withdraw`, big.g1tok, {});
  log('parent1 withdraws camera consent given by parent2', w1.status, JSON.stringify(w1.body).slice(0, 200));
  out.withdrawOther = w1;
}

// F6 Carnival: closure for the real Carnaval 2027 (Sat 6 – Wed 10 Feb) for the whole School
const car = await call('f6', 'POST', `/schools/${S}/closures`, T.owner, { startDate: '2027-02-06', endDate: '2027-02-10', reason: 'Carnaval 2027 🎭' });
const cal = await call('f6', 'GET', `/schools/${S}/timetable/calendar?from=2027-02-01&to=2027-02-14`, T.owner);
const laterDates = new Set((cal.body?.later ?? []).map((l) => l.date));
const closedShown = ['2027-02-08', '2027-02-09', '2027-02-10'].filter((d) => laterDates.has(d));
ok('F6 Carnaval closure: Feb 8–10 have no classes on the calendar, Feb 11 does', car.status === 201 && closedShown.length === 0 && laterDates.has('2027-02-11'), `${car.status} closed days shown: ${closedShown} later dates ${[...laterDates].sort().join(',')}`);
// Branch-only closure in Manaus for a day with bookings (next Kids class there)
const mk = kidsMAO[1];
const maoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(mk.startDate);
const maoKids = C.families.flatMap((f) => f.kids.map((k) => ({ k, f }))).filter(({ k }) => C.students.find((s) => s.id === k)?.branch === B.MAO && ['pack10', 'pack5', 'sub'].includes(kinds[k])).slice(0, 6);
const mb = await Promise.all(maoKids.map(({ k, f }) => call('f6', 'POST', `/classes/${mk.id}/book`, f.tok, { studentId: k })));
const packBefore = await db.membership.findMany({ where: { studentId: { in: maoKids.map((x) => x.k) }, classesRemaining: { not: null } }, select: { id: true, classesRemaining: true } });
const t1 = new Date();
const mc = await call('f6', 'POST', `/schools/${S}/closures`, T.owner, { startDate: maoDay, endDate: maoDay, branchId: B.MAO, reason: 'Festa do Boi — Manaus fechada' });
await sleep(6000);
const mkAfter = await db.class.findUnique({ where: { id: mk.id } });
const spSame = await db.class.findMany({ where: { schoolId: S, branchId: B.SP, cancelledAt: { gte: t1 } } });
const packAfter = await db.membership.findMany({ where: { id: { in: packBefore.map((p) => p.id) } }, select: { id: true, classesRemaining: true } });
const back = packAfter.filter((p) => p.classesRemaining > packBefore.find((q) => q.id === p.id).classesRemaining).length;
const n6 = await db.notification.count({ where: { createdAt: { gte: t1 }, userId: { in: maoKids.map((x) => x.f.g) } } });
ok('F6b Manaus-only closure cancels Manaus class, not São Paulo; credits back; parents told', mc.status === 201 && mkAfter.cancelledAt && spSame.length === 0 && n6 > 0,
  `closure ${mc.status} ${JSON.stringify(mc.body).slice(0, 120)}; booked ${JSON.stringify(codes(mb))}; MAO cancelled ${!!mkAfter.cancelledAt}; SP cancelled ${spSame.length}; packs credited back ${back}/${packBefore.length}; parent notices ${n6}`);
// One-off class during carnival: allowed?
const feb8 = await call('f6', 'POST', `/schools/${S}/classes`, T.owner, { branchId: B.SP, instructorId: C.users.instrSP, title: 'Treino de Carnaval', styles: C.styles.bjj, startDate: '2027-02-08T13:00:00.000Z', endDate: '2027-02-08T14:00:00.000Z', capacity: 20, membershipInclusion: true });
log('one-off class on a closed carnival day', feb8.status, feb8.body?.error?.message);
out.feb8 = { status: feb8.status, body: feb8.body };
// Closure abuse
const ca = await Promise.all([
  call('f6x', 'POST', `/schools/${S}/closures`, T.owner, { startDate: '2027-02-10', endDate: '2027-02-06', reason: 'x' }),
  call('f6x', 'POST', `/schools/${S}/closures`, T.owner, { startDate: '2027-02-29', endDate: '2027-03-01', reason: 'x' }),
  call('f6x', 'POST', `/schools/${S}/closures`, T.owner, { startDate: '2020-02-06', endDate: '2020-02-10', reason: 'x' }),
  call('f6x', 'POST', `/schools/${S}/closures`, T.owner, { startDate: '2027-02-06', endDate: '2029-02-10', reason: 'x' }),
  call('f6x', 'POST', `/schools/${S}/closures`, T.staffSP, { startDate: '2027-03-06', endDate: '2027-03-06', reason: 'x' }),
  call('f6x', 'POST', `/schools/${S}/closures`, T.pt, { startDate: '2027-03-06', endDate: '2027-03-06', reason: 'x' }),
  call('f6x', 'POST', `/schools/${S}/closures`, T.owner, { startDate: '2027-03-06', endDate: '2027-03-06', reason: '   ' }),
  call('f6x', 'POST', `/schools/${S}/closures`, T.owner, { startDate: '2027-03-06', endDate: '2027-03-06', reason: 'x', branchId: C.ptBranch }),
]);
ok('F6c bad closures refused (reversed, 29 Feb 2027, past, >1y, staff, other School, blank, other School\'s branch)', ca.every((r) => r.status >= 400), JSON.stringify(ca.map((r) => r.status)));

// F7 Week start Sunday: dashboard / bookings summary default week
const sch = await call('f7', 'GET', `/schools/${S}`, T.owner);
const sumw = await call('f7', 'GET', `/schools/${S}/bookings/summary`, T.owner);
log('weekStartsOn', sch.body?.weekStartsOn, 'bookings summary range', sumw.status, JSON.stringify(sumw.body).slice(0, 200));
out.week = { weekStartsOn: sch.body?.weekStartsOn, summary: sumw.body && { from: sumw.body.from, to: sumw.body.to, days: (sumw.body.days || []).map?.((d) => d.date) } };


// F8 Class across midnight (one-off): Friday 23:00 → Sat 00:30 São Paulo
const fri = new Date(Date.now() + 3 * 86400e3);
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(fri);
const mid = await call('f8', 'POST', `/schools/${S}/classes`, T.owner, { branchId: B.SP, instructorId: C.users.instrSP, title: 'Treino da Meia-Noite', styles: C.styles.bjj, startDate: `${day}T23:00:00-03:00`, endDate: new Date(new Date(`${day}T23:00:00-03:00`).getTime() + 90 * 60e3).toISOString(), capacity: 20, membershipInclusion: true });
const adult = C.students.find((s) => s.kind === 'sub' && s.branch === B.SP && new Date(s.dob) < new Date(Date.now() - 20 * 365.25 * 86400e3));
const mb2 = mid.status < 300 ? await call('f8', 'POST', `/classes/${mid.body.id}/book`, adult.tok, {}) : null;
ok('F8 one-off class across midnight created and bookable', mid.status === 201 && mb2?.status === 201, `${mid.status} ${mb2?.status} ${JSON.stringify(mb2?.body ?? mid.body).slice(0, 150)}`);

fs.writeFileSync(new URL('./family-out.json', import.meta.url), JSON.stringify(out, null, 1));
save();
await db.$disconnect();
