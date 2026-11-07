// Round 3: waivers, guests on a booking, the Class page (Add student / Cancel booking)
// and whole-class cancellations, under load and attack.
//   Decisions 340, 354 (waivers), 366 (guest waivers), 349 (Class page), 291/292 (cancellations).
// Changes only the first school picked (default cast schools 18-21 → 18); the school
// after the last picked one is used read-only for cross-tenant attempts.
// Every check that has no confirmed rule behind it is reported as INFO (pass, "INFO: ...").
import { db, call, pool, report, stats, randomUUID, token, grant, cast, pick, checks, codes } from './common.mjs';

const { ok, save } = checks('waivers-classes');
const info = (id, detail) => ok(id, true, 'INFO: ' + detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const is4xx = (s) => s >= 400 && s < 500;
const okPost = (s) => s === 200 || s === 201; // Nest answers 201 to a POST without @HttpCode
const now = Date.now();

const picks = pick('18-21');
const S = picks[0];
const O = cast.schools[(cast.schools.indexOf(picks[picks.length - 1]) + 1) % cast.schools.length];
if (O.id === S.id) throw new Error('need a second school for cross-tenant attempts');
const B0 = S.branches[0];
const RUN = randomUUID().slice(0, 6);
console.log(`school ${S.id} (changes), other school ${O.id} (read-only), run ${RUN}`);

// Fresh tokens (cast tokens live 6 h).
async function retoken(school) {
  const ids = [school.owner.id, school.instructor.id, school.staff.id, ...school.students.map((s) => s.id)];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, dateOfBirth: true } });
  const by = new Map(users.map((u) => [u.id, u]));
  const t = (id, g) => token(by.get(id), g);
  school.owner.tok = t(school.owner.id, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
  school.instructor.tok = t(school.instructor.id, [grant('INSTRUCTOR', school.id, school.branches[0])]);
  school.staff.tok = t(school.staff.id, [grant('BRANCH_STAFF', school.id, school.branches[0])]);
  for (const st of school.students) { st.tok = t(st.id, [grant('STUDENT', school.id, st.branch)]); st.dob = by.get(st.id)?.dateOfBirth; }
}
await retoken(S); await retoken(O);
const adultCut = new Date(now - 18.2 * 365.25 * 86400e3);
const isAdult = (st) => st.dob && st.dob < adultCut;

// ---------------------------------------------------------------- fixtures
const plans = {
  sub: (await db.membershipPlan.findFirst({ where: { schoolId: S.id, type: 'SUBSCRIPTION' } }))?.id,
  pack: (await db.membershipPlan.findFirst({ where: { schoolId: S.id, type: 'CLASS_PACK' } }))?.id,
  fp: (await db.membershipPlan.findFirst({ where: { schoolId: S.id, type: 'FRIEND_PASS' } }))?.id,
};
if (!plans.fp) plans.fp = (await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: S.id, type: 'FRIEND_PASS', title: 'Friend Pass (stress)', price: 0, classesIncluded: 1 } })).id;
let phoneN = 10_000_000 + Math.floor(Math.random() * 80_000_000);

/** Students made in the database (as the round-1 seed does): adult, home branch 1,
 *  `kind` sub | pack (packCredits) | none, plus `fp` Friend Passes of one credit each. */
async function mkStudents(n, label, { kind = 'sub', packCredits = 3, fp = 0, dob = '1990-03-01' } = {}) {
  const users = Array.from({ length: n }, (_, i) => ({ id: randomUUID(), email: `r3wc-${RUN}-${label}-${i}@stress.test`, phone: '+1777' + String(phoneN++), firstName: `${label}${i}`, surname: 'R3', passcodeHash: 'x', dateOfBirth: new Date(dob), phoneVerifiedAt: new Date() }));
  await db.user.createMany({ data: users });
  await db.roleGrant.createMany({ data: users.map((u) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: S.id, branchId: B0 })) });
  const ms = [];
  const out = users.map((u) => {
    const st = { id: u.id, tok: token(u, [grant('STUDENT', S.id, B0)]), fp: [] };
    if (kind === 'sub') ms.push({ id: randomUUID(), studentId: u.id, membershipPlanId: plans.sub, schoolId: S.id, frequency: 'RECURRING' });
    if (kind === 'pack') { st.pack = randomUUID(); ms.push({ id: st.pack, studentId: u.id, membershipPlanId: plans.pack, schoolId: S.id, frequency: 'ONE_TIME', classesRemaining: packCredits }); }
    for (let k = 0; k < fp; k++) { const id = randomUUID(); st.fp.push(id); ms.push({ id, studentId: u.id, membershipPlanId: plans.fp, schoolId: S.id, frequency: 'ONE_TIME', classesRemaining: 1 }); }
    return st;
  });
  if (ms.length) await db.membership.createMany({ data: ms });
  return out;
}
/** Extra staff users, so the 20-a-minute booking throttle per user doesn't mask results. */
async function mkStaff(role, branchId, label) {
  const u = { id: randomUUID(), email: `r3wc-${RUN}-${label}@stress.test`, phone: '+1777' + String(phoneN++), firstName: label, surname: 'R3', passcodeHash: 'x', dateOfBirth: new Date('1985-01-01'), phoneVerifiedAt: new Date() };
  await db.user.create({ data: u });
  await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role, schoolId: S.id, branchId } });
  return { id: u.id, tok: token(u, [grant(role, S.id, branchId)]) };
}
const credits = async (id) => (await db.membership.findUnique({ where: { id }, select: { classesRemaining: true } }))?.classesRemaining;
const occupied = async (classId) => (await db.booking.count({ where: { classId, status: 'UPCOMING' } })) + (await db.bookingAttendee.count({ where: { booking: { classId, status: 'UPCOMING' } } }));
let kc = 0;
async function mkClass(cap, extra = {}, branchId = B0) {
  let r;
  for (let i = 0; i < 4 && (!r || r.status === 503); i++) r = await call('setup:mk-class', 'POST', `/schools/${S.id}/classes`, S.owner.tok, { branchId, ...(branchId === B0 ? { instructorId: S.instructor.id } : {}), title: `R3 WC ${RUN} ${kc++}`, styles: [{ disciplineId: S.disciplineId, classType: S.classType }], startDate: new Date(Date.now() + 5 * 60e3).toISOString(), endDate: new Date(Date.now() + 65 * 60e3).toISOString(), membershipInclusion: true, ...(cap === null ? {} : { capacity: cap }), ...extra }).then(async (x) => { if (x.status === 503) await sleep(1000); return x; });
  if (r.status >= 300) throw new Error('mkClass ' + JSON.stringify(r.body));
  return r.body.id;
}
const waivers = [];
async function mkWaiver(label) {
  const r = await call('setup:mk-waiver', 'POST', `/schools/${S.id}/waivers`, S.owner.tok, { title: `R3 ${RUN} ${label}`, body: `Stress waiver ${label}, version one.` });
  if (r.status >= 300) throw new Error('mkWaiver ' + JSON.stringify(r.body));
  waivers.push(r.body.id);
  return { id: r.body.id, version: r.body.version ?? 1 };
}
const sign = (label, w, st, extra = {}) => call(label, 'POST', `/waivers/${w.id}/sign`, st.tok, { signerFullName: 'Stress Signer', signatureText: 'Stress Signer', waiverVersion: w.version, ...extra });
const book = (label, cls, st, body = {}) => call(label, 'POST', `/classes/${cls}/book`, st.tok, body);
async function step(name, fn) {
  try { await fn(); } catch (e) { ok(name, false, 'SCRIPT ERROR: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
}
const setPolicy = (data) => call('setup:school-settings', 'PATCH', `/schools/${S.id}`, S.owner.tok, data);

// Known starting state: the seed's Auto-credit (Decision 292 migration), cutoff none,
// "credit everyone back" when the School cancels a class; no Branch override; waiver
// settings at their defaults for the checks below. Previous runs' waivers retired.
{
  const r = await setPolicy({ classCancellationPolicy: 'AUTO_CREDIT', classCancellationPolicyWindow: 'BEFORE_CUTOFF', schoolCancelledClassResolution: 'CREDIT_ALL', defaultRefundCutoffHours: null });
  if (r.status >= 300) throw new Error('school settings ' + JSON.stringify(r.body));
  await db.branch.updateMany({ where: { schoolId: S.id }, data: { cancellationSettingsOverride: false } });
  const w = await call('setup:waiver-settings', 'PATCH', `/schools/${S.id}/waiver-settings`, S.owner.tok, { waiverArchivedSignaturesCount: true });
  if (w.status >= 300) throw new Error('waiver settings ' + JSON.stringify(w.body));
  const old = await db.waiver.findMany({ where: { schoolId: S.id, archivedAt: null }, select: { id: true } });
  await pool(old, 5, (x) => call('setup:archive-old', 'POST', `/waivers/${x.id}/archive`, S.owner.tok, {}));
}

// ======================================================================== WAIVERS
let Wmass;
await step('W1 mass sign', async () => {
  Wmass = await mkWaiver('mass');
  const adults = S.students.filter(isAdult), minors = S.students.filter((s) => !isAdult(s));
  const t0 = performance.now();
  const rs = await pool(adults, 200, (st) => sign('W1:mass-sign', Wmass, st));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const signed = await db.waiverSignature.count({ where: { waiverId: Wmass.id, status: 'SIGNED' } });
  const live = await db.waiverSignature.groupBy({ by: ['studentId'], where: { waiverId: Wmass.id, status: { not: 'EXPIRED' } }, _count: true });
  const dup = live.filter((g) => g._count > 1).length;
  const c = codes(rs);
  ok('W1a mass sign: every adult student signs a required waiver at once, one signature each, no 5xx', c[201] === adults.length && signed === adults.length && dup === 0 && !Object.keys(c).some((k) => k >= 500 || k === '0'),
    `${adults.length} signers (200 in flight) in ${secs}s; codes ${JSON.stringify(c)}; SIGNED rows ${signed}; students with >1 live row ${dup}`);
  const rm = await pool(minors.slice(0, 40), 40, (st) => sign('W1:minor-sign', Wmass, st));
  ok('W1b under-18 students cannot sign for themselves (Decision 340 W13, SKILL §13)', rm.every((r) => r.status === 403), `${rm.length} minors: ${JSON.stringify(codes(rm))}`);
});

// Fresh students for the rest of the waiver checks (created after Wmass: no row on it).
const F = await mkStudents(12, 'w');
let W2;
await step('W2 double-click', async () => {
  W2 = await mkWaiver('double');
  // F[0]: has an Unsigned row on W2 (update path); F[1]: has no row on Wmass (create path).
  const a = await Promise.all(Array.from({ length: 15 }, () => sign('W2:double-sign', W2, F[0])));
  const b = await Promise.all(Array.from({ length: 15 }, () => sign('W2:double-sign', Wmass, F[1])));
  const na = await db.waiverSignature.count({ where: { waiverId: W2.id, studentId: F[0].id, status: 'SIGNED' } });
  const nb = await db.waiverSignature.count({ where: { waiverId: Wmass.id, studentId: F[1].id, status: { not: 'EXPIRED' } } });
  const ca = codes(a), cb = codes(b);
  ok('W2 double-click sign ×15 (unsigned-row and no-row paths): one signature, the rest 409, no 5xx', na === 1 && nb === 1 && ca[201] === 1 && cb[201] === 1 && ca[409] === 14 && cb[409] === 14,
    `update path ${JSON.stringify(ca)} → ${na} row; create path ${JSON.stringify(cb)} → ${nb} row`);
});

await step('W3 versioning', async () => {
  const W3 = await mkWaiver('version');
  const st = F[2];
  const e1 = await call('W3:edit', 'PATCH', `/waivers/${W3.id}`, S.owner.tok, { body: 'Stress waiver, version two (a small fix).', resign: false });
  const stale = await sign('W3:sign-stale', W3, st);
  const fresh = await sign('W3:sign', { id: W3.id, version: e1.body.version }, st);
  const e2 = await call('W3:edit', 'PATCH', `/waivers/${W3.id}`, S.owner.tok, { body: 'Stress waiver, version two (another small fix).', resign: false });
  const keptAfterFix = await db.waiverSignature.count({ where: { waiverId: W3.id, studentId: st.id, status: 'SIGNED' } });
  ok('W3a signing a version the owner has since edited is refused (409); the current version signs (Decision 340 §2)', e1.body.version === 2 && stale.status === 409 && fresh.status === 201 && fresh.body.signedWaiverVersion !== 1,
    `edit → version ${e1.body.version}; stale sign ${stale.status}; sign v2 ${fresh.status}`);
  ok('W3b a small fix (resign:false) keeps the signature (Decision 354 §2)', e2.status === 200 && keptAfterFix === 1, `edit ${e2.status} → v${e2.body.version}; SIGNED rows ${keptAfterFix}`);
  const e3 = await call('W3:edit-resign', 'PATCH', `/waivers/${W3.id}`, S.owner.tok, { body: 'Stress waiver, NEW TERMS.', resign: true });
  const rows = await db.waiverSignature.findMany({ where: { waiverId: W3.id, studentId: st.id }, select: { status: true, signedWaiverVersion: true } });
  const resign = await sign('W3:re-sign', { id: W3.id, version: e3.body.version }, st);
  const rows2 = await db.waiverSignature.findMany({ where: { waiverId: W3.id, studentId: st.id }, select: { status: true, signedWaiverVersion: true } });
  ok('W3c new terms (resign:true) expire the signature, add an unsigned entry, and re-signing works (Decision 354 §2)',
    e3.status === 200 && rows.filter((r) => r.status === 'EXPIRED').length === 1 && rows.filter((r) => r.status === 'UNSIGNED').length === 1 && resign.status === 201 && rows2.filter((r) => r.status === 'SIGNED' && r.signedWaiverVersion === e3.body.version).length === 1,
    `after edit: ${rows.map((r) => r.status).sort().join(',')}; re-sign ${resign.status}; after: ${rows2.map((r) => `${r.status}@v${r.signedWaiverVersion ?? '-'}`).sort().join(',')}`);
});

await step('W4 resign race', async () => {
  // Owner saves new terms while 120 students are signing the old version.
  const adults = S.students.filter(isAdult);
  let stale = 0, total = 0, detail = [];
  for (let round = 0; round < 3; round++) {
    const W = await mkWaiver(`race${round}`);
    const signers = adults.slice(round * 120, round * 120 + 120);
    const signs = pool(signers, 120, (st) => sign('W4:sign-old-version', W, st));
    await sleep(25 + round * 25);
    const edit = await call('W4:edit-resign', 'PATCH', `/waivers/${W.id}`, S.owner.tok, { body: `New terms ${round}`, resign: true });
    const rs = await signs;
    const left = await db.waiverSignature.count({ where: { waiverId: W.id, status: 'SIGNED', OR: [{ signedWaiverVersion: { lt: edit.body.version } }, { signedWaiverVersion: null }] } });
    const live = await db.waiverSignature.groupBy({ by: ['studentId'], where: { waiverId: W.id, status: { not: 'EXPIRED' } }, _count: true });
    const noRow = signers.length - live.filter((g) => signers.some((s) => s.id === g.studentId)).length;
    stale += left; total += rs.length;
    detail.push(`r${round}: edit ${edit.status}→v${edit.body.version}, signs ${JSON.stringify(codes(rs))}, old-version SIGNED left ${left}, signers with no live row ${noRow}`);
  }
  ok('W4 new terms saved while students sign the old version: no Signed entry on the old version survives (Decision 354 §2)', stale === 0, detail.join('; '));
});

await step('W5 waiver gate', async () => {
  const st = F[3];
  const staffA = await mkStaff('BRANCH_STAFF', B0, 'staffW5');
  const cls = await mkClass(40, { termsWaiverRequired: true });
  const r1 = await book('W5:book-unsigned', cls, st);
  const r2 = await book('W5:staff-add-unsigned', cls, staffA, { studentId: st.id });
  const wl = await call('W5:waitlist-unsigned', 'POST', `/classes/${cls}/waitlist`, st.tok, {});
  const s = await sign('W5:sign', W2, st);
  const r3 = await book('W5:book-signed', cls, st);
  ok('W5a a class that requires a waiver refuses the booking (self and staff Add student) until the student has signed (SKILL §13, Decision 349)', r1.status === 400 && r2.status === 400 && s.status === 201 && r3.status === 201,
    `unsigned: self ${r1.status}, staff ${r2.status}, waitlist ${wl.status}; sign ${s.status}; then book ${r3.status}`);
  // New terms on that waiver expire the only signature: the next waiver class is refused again.
  const e = await call('W5:edit-resign', 'PATCH', `/waivers/${W2.id}`, S.owner.tok, { body: 'Double waiver, new terms.', resign: true });
  const cls2 = await mkClass(40, { termsWaiverRequired: true });
  const r4 = await book('W5:book-after-resign', cls2, st);
  ok('W5b after new terms expire the signature, a waiver class is refused until re-signed (Decision 354 §2: Expired never counts)', e.status === 200 && r4.status === 400, `edit ${e.status}; book ${r4.status}`);
});

await step('W6 archived waivers', async () => {
  const st = F[4];
  const W = await mkWaiver('archived');
  const s = await sign('W6:sign', W, st);
  const a = await call('W6:archive', 'POST', `/waivers/${W.id}/archive`, S.owner.tok, {});
  const a2 = await call('W6:archive', 'POST', `/waivers/${W.id}/archive`, S.owner.tok, {});
  const late = await sign('W6:sign-archived', W, F[5]);
  const cls = await mkClass(40, { termsWaiverRequired: true });
  const r1 = await book('W6:book-archived-counts', cls, st);
  const off = await call('W6:settings', 'PATCH', `/schools/${S.id}/waiver-settings`, S.owner.tok, { waiverArchivedSignaturesCount: false });
  const cls2 = await mkClass(40, { termsWaiverRequired: true });
  const r2 = await book('W6:book-archived-off', cls2, st);
  await call('W6:settings', 'PATCH', `/schools/${S.id}/waiver-settings`, S.owner.tok, { waiverArchivedSignaturesCount: true });
  const kept = await db.waiverSignature.count({ where: { waiverId: W.id, studentId: st.id, status: 'SIGNED' } });
  ok('W6 archive is always allowed and keeps signatures; an archived waiver cannot be signed; its signatures count unless the School turns that off (Decisions 340 §4, 354 §1/§4)',
    s.status === 201 && okPost(a.status) && okPost(a2.status) && kept === 1 && late.status === 409 && r1.status === 201 && off.status === 200 && r2.status === 400,
    `sign ${s.status}; archive ${a.status}/${a2.status}; sign archived ${late.status}; book (setting on) ${r1.status}; setting off ${off.status} → book ${r2.status}; signature kept ${kept}`);
});

await step('W7 remind', async () => {
  const W = await mkWaiver('remind');
  const due = await db.waiverSignature.count({ where: { waiverId: W.id, status: { in: ['UNSIGNED', 'PENDING'] } } });
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('W7:remind', 'POST', `/schools/${S.id}/waivers/${W.id}/remind`, S.owner.tok, {})));
  const sum = rs.reduce((a, r) => a + (r.body?.reminded ?? 0), 0);
  const again = await call('W7:remind', 'POST', `/schools/${S.id}/waivers/${W.id}/remind`, S.owner.tok, {});
  ok('W7 "Remind everyone" pressed 5× at once reminds each unsigned student at most once a day (Decision 354 §5)', rs.every((r) => r.status === 201) && sum <= due && again.body?.reminded === 0,
    `unsigned entries ${due}; per call ${rs.map((r) => (r.status === 201 ? `${r.body.reminded} reminded` : `HTTP ${r.status}`)).join(' / ')} (sum ${sum}); a 6th press later reminded ${again.body?.reminded}`);
});

await step('W8 waiver cross-tenant', async () => {
  const W = await mkWaiver('xt');
  const before = await db.waiver.findUnique({ where: { id: W.id } });
  const oSt = O.students.find(isAdult);
  const sSt = S.students.find(isAdult);
  const att = {
    'other owner GET waiver': await call('W8:xt', 'GET', `/waivers/${W.id}`, O.owner.tok),
    'other owner PATCH waiver': await call('W8:xt', 'PATCH', `/waivers/${W.id}`, O.owner.tok, { body: 'hijacked', resign: true }),
    'other owner archive': await call('W8:xt', 'POST', `/waivers/${W.id}/archive`, O.owner.tok, {}),
    'other owner signatures list': await call('W8:xt', 'GET', `/schools/${S.id}/waivers/${W.id}/signatures`, O.owner.tok),
    'other owner waiver-settings GET': await call('W8:xt', 'GET', `/schools/${S.id}/waiver-settings`, O.owner.tok),
    'other owner waiver-settings PATCH': await call('W8:xt', 'PATCH', `/schools/${S.id}/waiver-settings`, O.owner.tok, { waiverArchivedSignaturesCount: false }),
    'other owner remind': await call('W8:xt', 'POST', `/schools/${S.id}/waivers/${W.id}/remind`, O.owner.tok, {}),
    'other owner creates waiver here': await call('W8:xt', 'POST', `/schools/${S.id}/waivers`, O.owner.tok, { title: 'x', body: 'x' }),
    'other school student signs': await sign('W8:xt', W, oSt),
    'student signs for another student': await sign('W8:xt', W, sSt, { studentId: F[6].id }),
    'student PATCH waiver': await call('W8:xt', 'PATCH', `/waivers/${W.id}`, sSt.tok, { body: 'hijacked' }),
    'student archive': await call('W8:xt', 'POST', `/waivers/${W.id}/archive`, sSt.tok, {}),
    'branch staff waiver-settings PATCH': await call('W8:xt', 'PATCH', `/schools/${S.id}/waiver-settings`, S.staff.tok, { waiverArchivedSignaturesCount: false }),
    'branch staff signatures list': await call('W8:xt', 'GET', `/schools/${S.id}/waivers/${W.id}/signatures`, S.staff.tok),
    'instructor PATCH waiver': await call('W8:xt', 'PATCH', `/waivers/${W.id}`, S.instructor.tok, { body: 'hijacked' }),
  };
  const after = await db.waiver.findUnique({ where: { id: W.id } });
  const school = await db.school.findUnique({ where: { id: S.id }, select: { waiverArchivedSignaturesCount: true } });
  const oSigned = await db.waiverSignature.count({ where: { waiverId: W.id, studentId: { in: [oSt.id, F[6].id] }, status: 'SIGNED' } });
  const bad = Object.entries(att).filter(([, r]) => !is4xx(r.status));
  ok('W8 waiver cross-tenant / wrong-role attempts all refused, nothing changed', bad.length === 0 && after.body === before.body && !after.archivedAt && school.waiverArchivedSignaturesCount === true && oSigned === 0,
    Object.entries(att).map(([k, r]) => `${k} ${r.status}`).join('; '));
});

// ========================================================================= GUESTS
await step('G1 guests vs capacity', async () => {
  const cls = await mkClass(12);
  const subs = await mkStudents(16, 'g1s');
  for (const st of subs.slice(0, 6)) await book('G1:prefill', cls, st);
  const members = await mkStudents(3, 'g1', { fp: 2 });
  const singles = subs.slice(6, 16);
  const rs = await Promise.all([
    ...members.map((m) => book('G1:book-with-guests', cls, m, { attendeeMembershipIds: m.fp })),
    ...singles.map((st) => book('G1:book-single', cls, st)),
  ]);
  const seats = await occupied(cls);
  let fpBad = 0;
  for (let i = 0; i < members.length; i++) {
    const want = rs[i].status === 201 ? 0 : 1;
    for (const id of members[i].fp) if ((await credits(id)) !== want) fpBad++;
  }
  ok('G1 members with 2 guests each and single bookers race for the last 6 seats: seats never exceed capacity counting guests, passes spent only on success', seats <= 12 && fpBad === 0,
    `capacity 12, prefilled 6; group codes ${rs.slice(0, 3).map((r) => r.status).join(',')}; single codes ${JSON.stringify(codes(rs.slice(3)))}; seats taken ${seats}; wrong Friend Pass balances ${fpBad}`);
});

await step('G2 friend pass double spend', async () => {
  const [m] = await mkStudents(1, 'g2', { fp: 1 });
  const classes = await Promise.all(Array.from({ length: 6 }, () => mkClass(40)));
  const rs = await Promise.all(classes.map((c) => book('G2:same-pass-6-classes', c, m, { attendeeMembershipIds: m.fp })));
  const guests = await db.bookingAttendee.count({ where: { membershipId: m.fp[0] } });
  const left = await credits(m.fp[0]);
  const rep = await book('G2:same-pass-twice', classes[0], m, { attendeeMembershipIds: [m.fp[0], m.fp[0]] });
  ok('G2 one Friend Pass sent to 6 classes at once pays for one guest only', guests === 1 && left === 0 && rs.filter((r) => r.status === 201).length === 1,
    `codes ${JSON.stringify(codes(rs))}; guest seats ${guests}; pass credits left ${left}; same pass twice in one request ${rep.status}`);
});

await step('G3 guest links', async () => {
  const members = await mkStudents(3, 'g3', { fp: 2 });
  const [mg, mc, mo] = members;
  // The booker must hold a signed waiver for a waiver class: sign Wmass (no row → create path).
  for (const m of members) await sign('G3:member-sign', Wmass, m);
  const cls = await mkClass(40, { termsWaiverRequired: true });
  const b = await book('G3:book-guests', cls, mg, { attendeeMembershipIds: mg.fp });
  const bc = await book('G3:book-guest-to-cancel', cls, mc, { attendeeMembershipIds: [mc.fp[0]] });
  if (b.status !== 201 || bc.status !== 201) throw new Error(`guest bookings failed: ${b.status} ${JSON.stringify(b.body)} / ${bc.status}`);
  const g = await call('G3:booking-guests', 'GET', `/bookings/${b.body.id}/guests`, mg.tok);
  const tokOf = (link) => link?.split('/guest-waiver/')[1];
  const t1 = tokOf(g.body?.guests?.[0]?.link), t2 = tokOf(g.body?.guests?.[1]?.link);
  ok('G3a the booker gets a signing link per guest; each guest starts Unsigned on a waiver class (Decision 366 §2)', g.status === 200 && g.body.waiverRequired === true && t1 && t2 && g.body.guests.every((x) => x.waiverStatus === 'UNSIGNED'),
    `GET ${g.status}; waiverRequired ${g.body?.waiverRequired}; guests ${g.body?.guests?.map((x) => `${x.waiverStatus}${x.link ? '+link' : ''}`).join(',')}`);
  const insView = await call('G3:class-guests', 'GET', `/classes/${cls}/guest-waivers`, S.instructor.tok);
  const ownView = await call('G3:class-guests', 'GET', `/classes/${cls}/guest-waivers`, S.owner.tok);
  const staffView = await call('G3:class-guests', 'GET', `/classes/${cls}/guest-waivers`, S.staff.tok);
  const links = (r) => (r.body?.bookings ?? []).flatMap((x) => x.guests.map((y) => !!y.link));
  ok('G3b the class page: Owner and Branch Staff can copy links, Instructors see only signed / not signed (Decision 366 §2)',
    insView.status === 200 && links(insView).length === 3 && links(insView).every((x) => !x) && links(ownView).every((x) => x) && links(staffView).every((x) => x),
    `instructor ${insView.status} links ${links(insView).join(',')}; owner ${ownView.status} ${links(ownView).join(',')}; staff ${staffView.status} ${links(staffView).join(',')}`);

  // Attacks on the link and the booking's guests.
  const forged = 'A'.repeat(43);
  const flipped = t1.slice(0, -1) + (t1.endsWith('A') ? 'B' : 'A');
  const page = await call('G3:page', 'GET', `/guest-waiver-links/${t1}`);
  const unsigned = (page.body?.waivers ?? []).filter((w) => !w.signed).map((w) => ({ waiverId: w.id, version: w.version }));
  // The other school's waivers (random ids when it has none): not this link's waivers.
  const oW0 = await db.waiver.findMany({ where: { schoolId: O.id }, select: { id: true, version: true }, take: unsigned.length });
  const oW = unsigned.map((w, i) => oW0[i] ?? { id: randomUUID(), version: 1 });
  const body = (waiverList, extra = {}) => ({ guestFullName: 'Guest Adult', guestDateOfBirth: '1990-06-15', signerFullName: 'Guest Adult', signatureText: 'Guest Adult', waivers: waiverList, ...extra });
  const cancel = await call('G3:cancel-guest-booking', 'PATCH', `/bookings/${bc.body.id}/cancel`, mc.tok, {});
  const gc = await call('G3:booking-guests', 'GET', `/bookings/${bc.body.id}/guests`, mc.tok);
  const tc = tokOf(gc.body?.guests?.[0]?.link);
  // The sign route allows 10 a minute per IP: wait until this IP has budget again.
  for (let i = 0; i < 3; i++) { const probe = await call('G3:throttle-probe', 'POST', `/guest-waiver-links/${forged}/sign`, null, body(unsigned)); if (probe.status !== 429) break; await sleep(61_000); }
  const att = {
    'forged token page': await call('G3:attack', 'GET', `/guest-waiver-links/${forged}`),
    'one char changed page': await call('G3:attack', 'GET', `/guest-waiver-links/${flipped}`),
    'malformed token page': await call('G3:attack', 'GET', `/guest-waiver-links/..%2F..%2Fadmin`),
    'forged token sign': await call('G3:attack-sign', 'POST', `/guest-waiver-links/${forged}/sign`, null, body(unsigned)),
    'other school waivers on this link': await call('G3:attack-sign', 'POST', `/guest-waiver-links/${t2}/sign`, null, body(oW.map((w) => ({ waiverId: w.id, version: w.version })))),
    'stale version': await call('G3:attack-sign', 'POST', `/guest-waiver-links/${t2}/sign`, null, body(unsigned.map((w) => ({ ...w, version: w.version + 1 })))),
    'under-18 guest signing for themselves': await call('G3:attack-sign', 'POST', `/guest-waiver-links/${t2}/sign`, null, body(unsigned, { guestFullName: 'Kid Guest', guestDateOfBirth: '2015-02-02', signerFullName: 'kid guest' })),
    'cancelled booking link sign': await call('G3:attack-sign', 'POST', `/guest-waiver-links/${tc}/sign`, null, body(unsigned)),
    'another student reads the guests': await call('G3:attack', 'GET', `/bookings/${b.body.id}/guests`, mo.tok),
    'other school owner reads the guests': await call('G3:attack', 'GET', `/bookings/${b.body.id}/guests`, O.owner.tok),
    'other school owner class guests': await call('G3:attack', 'GET', `/classes/${cls}/guest-waivers`, O.owner.tok),
    'other school owner guest signatures': await call('G3:attack', 'GET', `/schools/${S.id}/waivers/${Wmass.id}/guest-signatures`, O.owner.tok),
    'student reads guest signatures': await call('G3:attack', 'GET', `/schools/${S.id}/waivers/${Wmass.id}/guest-signatures`, mg.tok),
  };
  const closedPage = await call('G3:page', 'GET', `/guest-waiver-links/${tc}`);
  const want = { 'forged token page': [404], 'one char changed page': [404], 'malformed token page': [404], 'forged token sign': [404, 429], 'other school waivers on this link': [409, 429], 'stale version': [409, 429], 'under-18 guest signing for themselves': [400, 429], 'cancelled booking link sign': [410, 429] };
  const bad = Object.entries(att).filter(([k, r]) => (want[k] ? !want[k].includes(r.status) : !is4xx(r.status)));
  const sigs = await db.guestWaiverSignature.count({ where: { bookingAttendeeId: { in: [g.body.guests[1].attendeeId, gc.body.guests[0].attendeeId] } } });
  const fpBack = await credits(mc.fp[0]);
  ok('G3c forged, altered, cross-school, stale, under-18-self and cancelled-booking guest links are refused; other people cannot read a booking\'s guests',
    bad.length === 0 && sigs === 0 && page.status === 200 && page.body.status === 'OPEN' && closedPage.body?.status === 'CLOSED' && cancel.status === 200 && fpBack === 1,
    Object.entries(att).map(([k, r]) => `${k} ${r.status}`).join('; ') + `; link page ${page.status}/${page.body?.status}; cancelled link page ${closedPage.body?.status}; Friend Pass back after cancel ${fpBack}; signatures written ${sigs}`);

  // 20 parallel signs on one link → one signature per current waiver.
  const rs = await Promise.all(Array.from({ length: 20 }, () => call('G3:guest-sign-x20', 'POST', `/guest-waiver-links/${t1}/sign`, null, body(unsigned))));
  const rows = await db.guestWaiverSignature.groupBy({ by: ['waiverId'], where: { bookingAttendeeId: g.body.guests[0].attendeeId }, _count: true });
  const c = codes(rs);
  ok('G3d the same guest link signed 20× at once: one signature per waiver, no 5xx (Decision 366 §3/§7)', rows.length === unsigned.length && rows.every((r) => r._count === 1) && c[200] === 1 && !Object.keys(c).some((k) => k >= 500),
    `codes ${JSON.stringify(c)} (sign is limited to 10 a minute per IP); ${unsigned.length} current waivers, signature rows ${rows.map((r) => r._count).join(',')}`);
  const after = await call('G3:booking-guests', 'GET', `/bookings/${b.body.id}/guests`, mg.tok);
  const own = await call('G3:guest-sigs', 'GET', `/schools/${S.id}/waivers/${Wmass.id}/guest-signatures`, S.owner.tok);
  ok('G3e after signing the booker sees Signed, and the Owner sees the guest signature on the Waivers page', after.body?.guests?.[0]?.waiverStatus === 'SIGNED' && after.body?.guests?.[0]?.guestFullName === 'Guest Adult' && own.status === 200 && own.body.items.some((x) => x.guestFullName === 'Guest Adult'),
    `guest 1 ${after.body?.guests?.[0]?.waiverStatus}; owner list ${own.status} (${own.body?.items?.length} items)`);

  // A class that has ended closes the link.
  const ended = await mkClass(40);
  const be = await book('G3:book-ended', ended, mo, { attendeeMembershipIds: [mo.fp[0]] });
  await db.class.update({ where: { id: ended }, data: { startDate: new Date(Date.now() - 3 * 3600e3), endDate: new Date(Date.now() - 2 * 3600e3) } });
  const ge = await call('G3:booking-guests', 'GET', `/bookings/${be.body.id}/guests`, mo.tok);
  const pe = await call('G3:page', 'GET', `/guest-waiver-links/${tokOf(ge.body?.guests?.[0]?.link)}`);
  ok('G3f a link for a class that has ended shows Closed (Decision 366 §3)', pe.status === 200 && pe.body.status === 'CLOSED' && pe.body.waivers.length === 0, `page ${pe.status} ${pe.body?.status}, ${pe.body?.waivers?.length} waivers shown`);
});

await step('G4 friend pass own seat', async () => {
  const [m] = await mkStudents(1, 'g4', { kind: 'none', fp: 1 });
  const cls = await mkClass(40);
  const r = await book('G4:book-alone-with-only-a-friend-pass', cls, m);
  const b = r.status === 201 ? await db.booking.findUnique({ where: { id: r.body.id }, select: { sourceMembershipId: true } }) : null;
  info('G4 a student whose only membership is a Friend Pass books a seat for themselves', `book ${r.status}${b ? `; the booking was paid with ${b.sourceMembershipId === m.fp[0] ? 'the Friend Pass' : 'another membership'} (pass credits left ${await credits(m.fp[0])}). SKILL §6 describes a Friend Pass as covering a guest; whether it may fund the holder's own seat is not stated` : ''}`);
});

// ===================================================================== CLASS PAGE
await step('C1 add to full class', async () => {
  const staffA = await mkStaff('BRANCH_STAFF', B0, 'staffC1');
  const cls = await mkClass(3);
  const [x, y, z, w] = await mkStudents(4, 'c1');
  for (const st of [x, y, z]) await book('C1:fill', cls, st);
  const r = await book('C1:staff-add-full', cls, staffA, { studentId: w.id });
  const seats = await occupied(cls);
  ok('C1 staff Add student to a full class is refused (Decision 349: capacity still applies)', r.status === 409 && seats === 3, `add ${r.status} ${JSON.stringify(r.body?.code ?? r.body?.message ?? '')}; seats ${seats}/3`);
});

await step('C2 staff add same student x10', async () => {
  const staffA = await mkStaff('BRANCH_STAFF', B0, 'staffC2');
  const cls = await mkClass(40);
  const [p] = await mkStudents(1, 'c2', { kind: 'pack', packCredits: 3 });
  const rs = await Promise.all(Array.from({ length: 10 }, () => book('C2:staff-add-x10', cls, staffA, { studentId: p.id })));
  const n = await db.booking.count({ where: { classId: cls, studentId: p.id, status: 'UPCOMING' } });
  const left = await credits(p.pack);
  ok('C2 staff Add student pressed 10× at once: one booking, one pack credit spent', n === 1 && left === 2, `codes ${JSON.stringify(codes(rs))}; bookings ${n}; credits 3 → ${left}`);
});

await step('C3 instructor add', async () => {
  const cls = await mkClass(40);
  const [st] = await mkStudents(1, 'c3');
  const r = await book('C3:instructor-add', cls, S.instructor, { studentId: st.id });
  ok('C3 an Instructor can Add student on the Class page (Decision 349 §1)', r.status === 201, `add ${r.status}`);
});

await step('C4 staff cancel x20', async () => {
  const staffB = await mkStaff('BRANCH_STAFF', B0, 'staffC4');
  const cls = await mkClass(40);
  const [p] = await mkStudents(1, 'c4', { kind: 'pack', packCredits: 3, fp: 1 });
  const b = await book('C4:book', cls, p, { attendeeMembershipIds: p.fp });
  const mid = [await credits(p.pack), await credits(p.fp[0])];
  const rs = await Promise.all(Array.from({ length: 20 }, () => call('C4:staff-cancel-x20', 'PATCH', `/bookings/${b.body.id}/cancel`, staffB.tok, {})));
  const after = [await credits(p.pack), await credits(p.fp[0])];
  const bk = await db.booking.findUnique({ where: { id: b.body.id }, include: { attendees: true } });
  const c = codes(rs);
  ok('C4 staff Cancel booking pressed 20× at once: one cancel, pack credit and guest Friend Pass back once (Auto-credit; Friend Pass always credited — Decision 291)',
    c[200] === 1 && after[0] === 3 && after[1] === 1 && bk.status === 'CANCELLED' && bk.refundResolution === 'REFUNDED' && bk.attendees[0]?.refundResolution === 'REFUNDED',
    `codes ${JSON.stringify(c)}; pack 3→${mid[0]}→${after[0]}, Friend Pass 1→${mid[1]}→${after[1]}; resolution ${bk.refundResolution}/${bk.attendees[0]?.refundResolution}`);
});

await step('C5 class page cross-tenant', async () => {
  const cls = await mkClass(40);
  const [a, bst] = await mkStudents(2, 'c5', { kind: 'pack', packCredits: 3 });
  const bb = await book('C5:book', cls, bst);
  const oSt = O.students.find((s) => s.kind === 'sub');
  const att = {
    'other school staff adds a student here': await book('C5:xt', cls, O.staff, { studentId: a.id }),
    'other school owner adds a student here': await book('C5:xt', cls, O.owner, { studentId: a.id }),
    'staff adds another school\'s student': await book('C5:xt', cls, S.staff, { studentId: oSt.id }),
    'student books someone else': await book('C5:xt', cls, a, { studentId: bst.id }),
    'student with overrideReason': await book('C5:xt', cls, a, { overrideReason: 'I am staff' }),
    'other school staff cancels a booking here': await call('C5:xt', 'PATCH', `/bookings/${bb.body.id}/cancel`, O.staff.tok, {}),
    'other school owner cancels a booking here': await call('C5:xt', 'PATCH', `/bookings/${bb.body.id}/cancel`, O.owner.tok, {}),
    'another student cancels it': await call('C5:xt', 'PATCH', `/bookings/${bb.body.id}/cancel`, a.tok, {}),
    'other school owner lists the class bookings': await call('C5:xt', 'GET', `/classes/${cls}/bookings`, O.owner.tok),
  };
  const still = await db.booking.findUnique({ where: { id: bb.body.id } });
  const aBooked = await db.booking.count({ where: { classId: cls, studentId: { in: [a.id, oSt.id] } } });
  const bad = Object.entries(att).filter(([, r]) => !is4xx(r.status));
  ok('C5 Add student / Cancel booking across schools or for someone else: all refused, nothing changed', bad.length === 0 && still.status === 'UPCOMING' && aBooked === 0 && (await credits(bst.pack)) === 2,
    Object.entries(att).map(([k, r]) => `${k} ${r.status}`).join('; '));
});

// ================================================================== CANCELLATIONS
await step('K1 cancel a busy class', async () => {
  const cls = await mkClass(60);
  const packs = await mkStudents(20, 'k1p', { kind: 'pack', packCredits: 3 });
  const subs = await mkStudents(10, 'k1s');
  const mem = await mkStudents(3, 'k1m', { fp: 1 });
  const late = await mkStudents(16, 'k1l', { kind: 'pack', packCredits: 3 });
  const bk = new Map();
  await pool([...packs, ...subs], 10, async (st) => { const r = await book('K1:book', cls, st); bk.set(st.id, r.body?.id); });
  await pool(mem, 3, async (m) => { const r = await book('K1:book-guest', cls, m, { attendeeMembershipIds: m.fp }); bk.set(m.id, r.body?.id); });
  const seatsBefore = await occupied(cls);
  // At the same moment: the owner cancels the class, 10 booked students cancel
  // themselves, and 16 more students book it (staggered from 60 ms before to 90 ms after).
  const t0 = performance.now();
  const cancelP = (async () => { await sleep(60); return call('K1:cancel-class', 'POST', `/classes/${cls}/cancel`, S.owner.tok, { reason: 'Coach is ill' }); })();
  const selfP = Promise.all(packs.slice(0, 10).map((st) => call('K1:self-cancel', 'PATCH', `/bookings/${bk.get(st.id)}/cancel`, st.tok, {})));
  const lateP = Promise.all(late.map(async (st, i) => { await sleep(i * 10); return book('K1:late-book', cls, st); }));
  const [cr, selfRs, lateRs] = await Promise.all([cancelP, selfP, lateP]);
  const ms = (performance.now() - t0) | 0;
  // A failed cancel is retried once, as the owner would press the button again.
  const retry = okPost(cr.status) ? null : await call('K1:cancel-class-retry', 'POST', `/classes/${cls}/cancel`, S.owner.tok, { reason: 'Coach is ill' });
  await sleep(500);
  const upcoming = await db.booking.findMany({ where: { classId: cls, status: 'UPCOMING' }, select: { studentId: true } });
  const packBad = [];
  for (const st of [...packs, ...late]) { const c = await credits(st.pack); const live = upcoming.some((u) => u.studentId === st.id); if (c !== 3 && !(live && c === 2)) packBad.push(c); }
  const fpBad = (await Promise.all(mem.map((m) => credits(m.fp[0])))).filter((c) => c !== 1).length;
  const unresolved = await db.booking.count({ where: { classId: cls, status: 'CANCELLED', refundResolution: null } });
  const c = await db.class.findUnique({ where: { id: cls }, select: { cancelledAt: true, cancellationReason: true } });
  const stranded = await db.booking.count({ where: { classId: cls, status: 'UPCOMING', createdAt: { lte: c.cancelledAt } } });
  ok('K1a cancel a class with 33 bookings + 3 guests (Owner, credit everyone back): every pack credit and Friend Pass back exactly once, even with students cancelling themselves at the same moment',
    okPost(cr.status) && !!c.cancelledAt && packBad.length === 0 && fpBad === 0 && unresolved === 0 && stranded === 0,
    `cancel ${cr.status}${cr.status >= 300 ? ` (${JSON.stringify(cr.body?.message ?? cr.body).slice(0, 80)})` : ''} in ${ms} ms (all three streams)${retry ? `; retry ${retry.status} ${JSON.stringify(retry.body?.message ?? '').slice(0, 60)}` : ''}; bookings made before the cancel still Upcoming ${stranded}; seats before ${seatsBefore}; self-cancels ${JSON.stringify(codes(selfRs))}; wrong pack balances ${packBad.length ? packBad.join(',') : 'none'}; wrong Friend Passes ${fpBad}; cancelled bookings with no resolution ${unresolved}`);
  const lateC = codes(lateRs);
  const afterMark = await db.booking.count({ where: { classId: cls, status: 'UPCOMING', createdAt: { gt: c.cancelledAt } } });
  ok('K1b students booking the class while the School cancels it: no Upcoming booking is left on the cancelled class (Decision 291)', upcoming.length === 0,
    `late bookers ${JSON.stringify(lateC)}; Upcoming bookings left on the cancelled class ${upcoming.length}, ${afterMark} of them created after the class was marked cancelled${upcoming.length ? ' (pack credit spent, seat in a class that will not run, no notice sent)' : ''}`);
});

await step('K1c race probe', async () => {
  // Narrower probe of K1b: 6 rounds, 10 bookers each, spread ±50 ms around the cancel.
  const bookers = await mkStudents(10, 'k1c', { kind: 'pack', packCredits: 10 });
  let leaked = 0; const per = [];
  for (let round = 0; round < 6; round++) {
    const cls = await mkClass(40);
    const seed = await mkStudents(3, `k1c${round}`);
    for (const st of seed) await book('K1c:seed', cls, st);
    const offs = bookers.map((_, i) => i * 10 + round * 3);
    const cancelAt = 50;
    const [cr, rs] = await Promise.all([
      (async () => { await sleep(cancelAt); return call('K1c:cancel-class', 'POST', `/classes/${cls}/cancel`, S.owner.tok, {}); })(),
      Promise.all(bookers.map(async (st, i) => { await sleep(offs[i]); return book('K1c:book-during-cancel', cls, st); })),
    ]);
    await sleep(300);
    const n = await db.booking.count({ where: { classId: cls, status: 'UPCOMING' } });
    const at = (await db.class.findUnique({ where: { id: cls }, select: { cancelledAt: true } })).cancelledAt;
    const after = at ? await db.booking.count({ where: { classId: cls, status: 'UPCOMING', createdAt: { gt: at } } }) : 0;
    leaked += n; per.push(`r${round}: cancel ${cr.status}, book ${JSON.stringify(codes(rs))}, left Upcoming ${n} (${after} created after cancelledAt)`);
  }
  ok('K1c probe: bookings racing a whole-class cancel never stay Upcoming on the cancelled class', leaked === 0, per.join('; '));
});

await step('K2 cancel same class x10', async () => {
  const cls = await mkClass(40);
  const packs = await mkStudents(5, 'k2', { kind: 'pack', packCredits: 3 });
  for (const st of packs) await book('K2:book', cls, st);
  const owners = [S.owner, await mkStaff('BRANCH_STAFF', B0, 'staffK2')];
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call('K2:cancel-class-x10', 'POST', `/classes/${cls}/cancel`, owners[i % 2].tok, { reason: `try ${i}` })));
  const bal = await Promise.all(packs.map((p) => credits(p.pack)));
  const c = codes(rs);
  ok('K2 the same class cancelled 10× at once (Owner and Branch Staff): one cancel, the rest 409, each credit back once', (c[200] ?? 0) + (c[201] ?? 0) === 1 && c[409] === 9 && bal.every((x) => x === 3), `codes ${JSON.stringify(c)}; pack credits ${bal.join(',')} (want 3)`);
});

await step('K3 manual policy and resolve', async () => {
  const p = await setPolicy({ classCancellationPolicy: 'MANUAL', schoolCancelledClassResolution: 'FOLLOW_POLICY' });
  try {
    const cls = await mkClass(40);
    const packs = await mkStudents(5, 'k3', { kind: 'pack', packCredits: 3 });
    const bks = [];
    for (const st of packs) bks.push((await book('K3:book', cls, st)).body.id);
    const cr = await call('K3:cancel-class', 'POST', `/classes/${cls}/cancel`, S.owner.tok, {});
    const res = await db.booking.findMany({ where: { id: { in: bks } }, select: { refundResolution: true } });
    const listO = await call('K3:list', 'GET', `/schools/${S.id}/cancellations`, S.owner.tok);
    const listS = await call('K3:list', 'GET', `/schools/${S.id}/cancellations`, S.staff.tok);
    const inList = (r) => (Array.isArray(r.body) ? r.body.filter((x) => bks.includes(x.bookingId)).length : -1);
    const bal = await Promise.all(packs.map((s) => credits(s.pack)));
    ok('K3a Manual policy + "follow the policy": a cancelled class leaves every seat Pending on the to-resolve list, credits untouched (Decision 291)',
      p.status === 200 && okPost(cr.status) && res.every((r) => r.refundResolution === 'PENDING') && inList(listO) === 5 && inList(listS) === 5 && bal.every((x) => x === 2),
      `settings ${p.status}; cancel ${cr.status}; resolutions ${[...new Set(res.map((r) => r.refundResolution))]}; on Owner list ${inList(listO)}, Branch Staff list ${inList(listS)}; credits ${bal.join(',')}`);
    const staffR = await mkStaff('BRANCH_STAFF', B0, 'staffK3');
    const refund = await call('K3:staff-refund', 'PATCH', `/bookings/${bks[0]}/resolution`, staffR.tok, { action: 'REFUND' });
    const markPaid = await call('K3:mark-paid-pending', 'PATCH', `/bookings/${bks[0]}/resolution`, S.owner.tok, { action: 'MARK_PAID' });
    const rs = await Promise.all(Array.from({ length: 10 }, () => call('K3:resolve-credit-x10', 'PATCH', `/bookings/${bks[0]}/resolution`, staffR.tok, { action: 'CREDIT' })));
    const mixed = await Promise.all([
      call('K3:resolve-mixed', 'PATCH', `/bookings/${bks[1]}/resolution`, S.owner.tok, { action: 'KEEP' }),
      call('K3:resolve-mixed', 'PATCH', `/bookings/${bks[1]}/resolution`, staffR.tok, { action: 'CREDIT' }),
      call('K3:resolve-mixed', 'PATCH', `/bookings/${bks[1]}/resolution`, S.owner.tok, { action: 'CREDIT' }),
    ]);
    const b0 = await credits(packs[0].pack), b1 = await credits(packs[1].pack);
    const r1 = await db.booking.findUnique({ where: { id: bks[1] }, select: { refundResolution: true } });
    const consistent = (r1.refundResolution === 'WITHHELD' && b1 === 2) || (r1.refundResolution === 'REFUNDED' && b1 === 3);
    const c = codes(rs);
    ok('K3b resolving one seat: Branch Staff cannot refund money (403) and "Give credit back" pressed 10× at once credits once; Owner KEEP vs staff CREDIT at once gives one consistent result',
      refund.status === 403 && markPaid.status === 409 && c[200] === 1 && b0 === 3 && mixed.filter((r) => r.status === 200).length === 1 && consistent,
      `staff REFUND ${refund.status}; MARK_PAID on Pending ${markPaid.status}; CREDIT ×10 ${JSON.stringify(c)} → credits ${b0} (want 3); KEEP/CREDIT/CREDIT at once ${mixed.map((r) => r.status).join(',')} → ${r1.refundResolution}, credits ${b1}`);
  } finally {
    await setPolicy({ classCancellationPolicy: 'AUTO_CREDIT', schoolCancelledClassResolution: 'CREDIT_ALL' });
  }
});

await step('K4 cancellations cross-tenant', async () => {
  const cls = await mkClass(40);
  const cls1 = S.branches[1] ? await mkClass(40, {}, S.branches[1]) : null;
  const [st] = await mkStudents(1, 'k4', { kind: 'pack', packCredits: 3 });
  const bb = await book('K4:book', cls, st);
  const att = {
    'instructor cancels the class': await call('K4:xt', 'POST', `/classes/${cls}/cancel`, S.instructor.tok, {}),
    'student cancels the class': await call('K4:xt', 'POST', `/classes/${cls}/cancel`, st.tok, {}),
    'other school owner cancels the class': await call('K4:xt', 'POST', `/classes/${cls}/cancel`, O.owner.tok, {}),
    'other school staff cancels the class': await call('K4:xt', 'POST', `/classes/${cls}/cancel`, O.staff.tok, {}),
    ...(cls1 ? { 'branch 1 class cancelled by branch 0 staff': await call('K4:xt', 'POST', `/classes/${cls1}/cancel`, S.staff.tok, {}) } : {}),
    'other school owner reads the to-resolve list': await call('K4:xt', 'GET', `/schools/${S.id}/cancellations`, O.owner.tok),
    'instructor reads the to-resolve list': await call('K4:xt', 'GET', `/schools/${S.id}/cancellations`, S.instructor.tok),
    'student reads the to-resolve list': await call('K4:xt', 'GET', `/schools/${S.id}/cancellations`, st.tok),
    'other school owner resolves a seat here': await call('K4:xt', 'PATCH', `/bookings/${bb.body.id}/resolution`, O.owner.tok, { action: 'CREDIT' }),
    'cancel a class that has ended': await call('K4:xt', 'POST', `/classes/${S.ended}/cancel`, S.owner.tok, {}),
    'cancel an unknown class': await call('K4:xt', 'POST', `/classes/${randomUUID()}/cancel`, S.owner.tok, {}),
  };
  const cOk = await call('K4:cancel', 'POST', `/classes/${cls}/cancel`, S.owner.tok, {});
  const again = await book('K4:book-cancelled', cls, (await mkStudents(1, 'k4b'))[0]);
  const staffAdd = await book('K4:staff-add-cancelled', cls, S.staff, { studentId: st.id });
  const untouched = await db.class.findMany({ where: { id: { in: [S.ended, ...(cls1 ? [cls1] : [])] } }, select: { cancelledAt: true } });
  const bad = Object.entries(att).filter(([, r]) => !is4xx(r.status));
  ok('K4 whole-class cancel and the to-resolve list: Instructors, students, another school and another branch\'s staff are refused; a cancelled class takes no bookings (Decision 291)',
    bad.length === 0 && untouched.every((c) => !c.cancelledAt) && okPost(cOk.status) && again.status === 409 && staffAdd.status === 409,
    Object.entries(att).map(([k, r]) => `${k} ${r.status}`).join('; ') + `; then owner cancel ${cOk.status}; book it ${again.status}; staff add ${staffAdd.status}`);
});

await step('K5 list latency', async () => {
  const before = await call('K5:list-owner', 'GET', `/schools/${S.id}/cancellations`, S.owner.tok);
  await pool(Array.from({ length: 60 }), 30, (_, i) => call(i % 2 ? 'K5:list-owner' : 'K5:list-staff', 'GET', `/schools/${S.id}/cancellations`, i % 2 ? S.owner.tok : S.staff.tok));
  const rows = (k) => { const a = stats[k].ms.slice().sort((x, y) => x - y); return a[Math.floor(0.95 * a.length)] | 0; };
  info('K5 "Cancellations to resolve" list under 60 reads (30 at a time)', `${Array.isArray(before.body) ? before.body.length : '?'} open rows; p95 owner ${rows('K5:list-owner')} ms, staff ${rows('K5:list-staff')} ms`);
});

// Retire this run's waivers so the guest page (max 50 waivers per sign) stays usable.
await pool(waivers, 5, (id) => call('cleanup:archive', 'POST', `/waivers/${id}/archive`, S.owner.tok, {}));

save();
report();
await db.$disconnect();
