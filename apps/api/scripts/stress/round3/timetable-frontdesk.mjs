// Round 3: timetable calendar, branch close, notifications, disciplines and the
// front-desk check-in flow, under load and under attack.
//   CAST=... SCHOOLS=26-29 node timetable-frontdesk.mjs
// Only the first picked School is changed; a School outside the picked set is
// used read-only as the "other tenant".
//
// Rules each check relies on (docs/decisions/POST-SPEC-55-DECISION-LOG.md):
//   Decision 353 (calendar, Branch Staff own branch, staff_student_roster)
//   Decision 330 (Branch close: live-only blockers, moves, bookings follow the class, history kept)
//   Decision 355 (Mark all read), 363 (sent-broadcast history, owner only), 333 §8 (broadcast refuses archived targets)
//   Decisions 309/310 (archived style refused anywhere new, kept where already used)
//   Decision 71/107 + SKILL.md §12 (roll-call scan with the student's rotating token; manual fallback)
// Anything not confirmed is recorded as INFO.
import { createRequire } from 'module';
import { cast, pick, checks, codes, call, pool, db, token, grant, report, randomUUID } from './common.mjs';

// Classes left across all of a student's packs at the School. After the
// billing script has run, students hold more than one membership, and the
// booking may take its credit from any of them.
async function packCredits(schoolId, studentIds) {
  const rows = await db.membership.findMany({ where: { schoolId, studentId: { in: studentIds }, classesRemaining: { not: null } }, select: { studentId: true, classesRemaining: true } });
  const sum = new Map(studentIds.map((id) => [id, 0]));
  for (const r of rows) sum.set(r.studentId, sum.get(r.studentId) + r.classesRemaining);
  return sum;
}

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { JwtService } = require('@nestjs/jwt');

const { ok, save } = checks('timetable-frontdesk');
const info = (id, detail) => ok(id, true, 'INFO: ' + detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const is4xx = (r) => r.status >= 400 && r.status < 500;
const no5xx = (rs) => !rs.some((r) => r.status >= 500 || r.status === 0);
const picked = pick('26-29');
const X = picked[0];
const OTHER = cast.schools.find((s) => !picked.includes(s));
if (!OTHER) throw new Error('need a cast School outside SCHOOLS for the cross-tenant checks');
const B0 = X.branches[0];
const styles = [{ disciplineId: X.disciplineId, classType: X.classType }];
const now = Date.now();
const RUN = randomUUID().slice(0, 6);
console.log(`School ${X.id} (changed), other tenant ${OTHER.id} (read-only), run ${RUN}`);

// ---------------------------------------------------------------- helpers
let phoneN = Math.floor(Math.random() * 1e8);
async function mkUser(label) {
  const u = { id: randomUUID(), email: `r3tf-${label}-${randomUUID().slice(0, 8)}@stress.test`, phone: '+1558' + String(phoneN++).padStart(9, '0'), firstName: `R3${label}`, surname: 'Desk', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), phoneVerifiedAt: new Date() };
  await db.user.create({ data: u });
  return u;
}
async function mkStaff(label, branchId, role = 'BRANCH_STAFF') {
  const u = await mkUser(label);
  await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role, schoolId: X.id, branchId } });
  return { id: u.id, tok: token(u, [grant(role, X.id, branchId)]) };
}
let k = 0;
async function mkClass(school, { branchId = school.branches[0], startOff = -5 * 60e3, endOff = 55 * 60e3, cap = 40, instructor = true, st = null, title } = {}) {
  const r = await call('setup:mk-class', 'POST', `/schools/${school.id}/classes`, school.owner.tok, {
    branchId, ...(instructor ? { instructorId: school.instructor.id } : {}), title: title ?? `R3TF ${RUN} ${k++}`,
    styles: st ?? [{ disciplineId: school.disciplineId, classType: school.classType }],
    startDate: new Date(Date.now() + startOff).toISOString(), endDate: new Date(Date.now() + endOff).toISOString(), membershipInclusion: true,
    ...(cap === null ? {} : { capacity: cap }),
  });
  if (r.status >= 300) throw new Error('mkClass ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body.id;
}
async function mkBranch(name) {
  const r = await call('setup:mk-branch', 'POST', `/schools/${X.id}/branches`, X.owner.tok, { name: `${name} ${RUN}` });
  if (r.status >= 300) throw new Error('mkBranch ' + JSON.stringify(r.body));
  return r.body.id;
}
const liveBooking = (studentId, classId) => db.booking.findMany({ where: { studentId, classId, status: { not: 'CANCELLED' } } });
// A booking action retried after a 429 the way a person at the desk would.
async function bookWithRetry(label, classId, tok, body, stat) {
  for (let i = 0; i < 9; i++) {
    const r = await call(label, 'POST', `/classes/${classId}/book`, tok, body);
    if (r.status !== 429) return r;
    stat.throttled++;
    await sleep(15e3);
  }
  return { status: 429, body: 'gave up' };
}

// ---------------------------------------------------------------- setup
const local = X.students.filter((s) => s.branch === B0);
const names = new Map((await db.user.findMany({ where: { id: { in: local.map((s) => s.id) } }, select: { id: true, firstName: true, surname: true } })).map((u) => [u.id, u]));
const eligibleKind = (s) => s.kind === 'sub' || s.kind === 'pack';
// Disjoint slices of the School's students for each check.
const RES = 60;
const rushN = Math.min(300, local.length - RES);
const rushStudents = local.slice(0, rushN);
const rest = local.slice(rushN);
const dblStudents = rest.slice(0, 20).filter(eligibleKind);
const qrStudents = rest.slice(20, 30).filter(eligibleKind);
const walkStudents = rest.slice(30, 36).filter(eligibleKind);
const homeMoveStudents = rest.slice(36, 40);
const notifStudent = rest[40], notifControl = rest[41];
const otherStudent = OTHER.students.find(eligibleKind);

// Refill pack credits so earlier runs don't change who is eligible (setup only).
await db.membership.updateMany({ where: { schoolId: X.id, frequency: 'ONE_TIME' }, data: { classesRemaining: 5 } });

const B2 = await mkBranch('R3 Walk-in branch');
const staffB0 = await mkStaff('staffB0', B0);
const staffB2 = await mkStaff('staffB2', B2);
const desks = await Promise.all(Array.from({ length: 6 }, (_, i) => mkStaff(`desk${i}`, B0)));
const dblDesks = await Promise.all(Array.from({ length: 4 }, (_, i) => mkStaff(`dbl${i}`, B0)));
const throttleDesk = await mkStaff('burst', B0);

// FD0. Branch Staff see only students with a home branch they cover (Decision 353 Q4).
{
  const homes = await db.studentHomeBranch.findMany({ where: { schoolId: X.id }, select: { studentId: true, branchId: true } });
  const have = new Set(homes.map((h) => h.studentId));
  const missing = X.students.filter((s) => !have.has(s.id));
  const before = await call('fd:search', 'GET', `/schools/${X.id}/students?search=${encodeURIComponent(names.get(local[0].id).firstName)}`, staffB0.tok);
  const rs = await pool(missing, 16, (s) => call('setup:home-branch', 'PUT', `/schools/${X.id}/students/${s.id}/home-branch`, X.owner.tok, { branchId: s.branch }));
  info('FD0 Branch Staff roster needs home branches (Decision 353 Q4)', `before assigning, Branch Staff name search for a local student returned ${before.body?.items?.length ?? before.status} row(s) (${missing.length} students had no home branch); owner set ${rs.filter((r) => r.status < 300).length}/${missing.length} home branches (codes ${JSON.stringify(codes(rs))})`);
}

// ---------------------------------------------------------------- FD1 front-desk rush
const nRushClasses = Math.ceil(rushN / 30);
const rushClasses = await Promise.all(Array.from({ length: nRushClasses }, (_, i) => mkClass(X, { title: `R3TF ${RUN} rush ${i}` })));
const classOf = (i) => rushClasses[i % nRushClasses];
// Start the real-expiry QR probe now (token minted, used after its ~20 s TTL).
const qrClass = await mkClass(X, { title: `R3TF ${RUN} qr` });
await pool(qrStudents, 8, (s) => call('setup:self-book', 'POST', `/classes/${qrClass}/book`, s.tok, {}));
const staleTok = await call('qr:my-token', 'GET', '/attendance/my-qr-token', qrStudents[3].tok);
const staleAt = Date.now();

{
  // About 70% of members booked ahead in the app; the rest are walk-ins.
  const preBook = rushStudents.filter((s, i) => eligibleKind(s) && i % 10 < 7);
  const pre = await pool(preBook, 30, (s) => call('setup:self-book', 'POST', `/classes/${classOf(rushStudents.indexOf(s))}/book`, s.tok, {}));
  const stat = { throttled: 0 };
  const outcome = new Map();
  const queues = desks.map(() => []);
  rushStudents.forEach((s, i) => queues[i % desks.length].push(i));
  const t0 = performance.now();
  await Promise.all(desks.map((desk, d) => (async () => {
    for (const i of queues[d]) {
      const s = rushStudents[i]; const cls = classOf(i); const nm = names.get(s.id);
      const o = { kind: s.kind };
      outcome.set(s.id, o);
      const found = await call('fd:search', 'GET', `/schools/${X.id}/students?search=${encodeURIComponent(nm.firstName)}`, desk.tok);
      o.found = found.status === 200 && found.body.items.some((x) => x.id === s.id);
      if (!o.found) { o.err = 'search ' + found.status; continue; }
      const [ms, el, roll] = await Promise.all([
        call('fd:membership-status', 'GET', `/students/${s.id}/membership-status?schoolId=${X.id}`, desk.tok),
        call('fd:eligibility', 'GET', `/students/${s.id}/eligibility?schoolId=${X.id}`, desk.tok),
        call('fd:class-bookings', 'GET', `/classes/${cls}/bookings?limit=100`, desk.tok),
      ]);
      o.status = ms.body?.status; o.eligibility = el.status; o.roll = roll.status;
      const rows = Array.isArray(roll.body) ? roll.body : roll.body?.items ?? [];
      const booked = rows.some((b) => b.studentId === s.id && b.status === 'UPCOMING');
      if (!booked) {
        // The desk tries anyway and shows the API's refusal (front-desk handover).
        const b = await bookWithRetry('fd:book-on-behalf', cls, desk.tok, { studentId: s.id }, stat);
        o.book = b.status;
        if (b.status >= 300) continue;
      }
      // Every third student shows their app QR; the rest are found by name.
      let body = { studentId: s.id };
      if (i % 3 === 0) {
        const q = await call('fd:my-qr-token', 'GET', '/attendance/my-qr-token', s.tok);
        body = { studentId: s.id, studentToken: q.body.token };
      }
      const sc = await call('fd:attendance-scan', 'POST', `/classes/${cls}/attendance-scan`, desk.tok, body);
      o.scan = sc.status;
    }
  })()));
  const secs = (performance.now() - t0) / 1000;
  const rows = await db.booking.findMany({ where: { classId: { in: rushClasses }, status: { not: 'CANCELLED' } }, select: { studentId: true, status: true, checkInMethod: true, classId: true } });
  const byStudent = new Map(); rows.forEach((r) => byStudent.set(r.studentId, [...(byStudent.get(r.studentId) || []), r]));
  const active = [...outcome].filter(([, o]) => o.status === 'ACTIVE');
  const notActive = [...outcome].filter(([, o]) => o.status && o.status !== 'ACTIVE');
  const missed = active.filter(([id]) => !(byStudent.get(id) || []).some((b) => b.status === 'COMPLETED'));
  const leaked = notActive.filter(([id]) => (byStudent.get(id) || []).length > 0);
  const dup = [...byStudent.values()].filter((l) => l.length > 1).length;
  const notFound = [...outcome.values()].filter((o) => !o.found).length;
  const methods = codes(rows.filter((r) => r.status === 'COMPLETED').map((r) => ({ status: r.checkInMethod })));
  const allRs = ['fd:search', 'fd:membership-status', 'fd:eligibility', 'fd:class-bookings', 'fd:book-on-behalf', 'fd:attendance-scan', 'fd:my-qr-token'];
  ok('FD1 front-desk rush: every ACTIVE member checked in once, nobody without a membership booked',
    missed.length === 0 && leaked.length === 0 && dup === 0 && notFound === 0,
    `${rushN} students, ${desks.length} desks, ${nRushClasses} classes, ${secs.toFixed(1)}s (${(rushN / secs).toFixed(1)} students/s); pre-booked ${pre.filter((r) => r.status === 201).length}/${preBook.length}; ACTIVE ${active.length}, checked-in ${active.length - missed.length}; EXPIRED/NONE ${notActive.length} (booked anyway: ${leaked.length}, book codes ${JSON.stringify(codes(notActive.map(([, o]) => ({ status: o.book }))))}); not found by search ${notFound}; duplicate bookings ${dup}; check-in methods ${JSON.stringify(methods)}; 429s retried ${stat.throttled}${missed.length ? '; missed ' + JSON.stringify(missed.slice(0, 5).map(([id, o]) => ({ id: id.slice(0, 8), ...o }))) : ''}`);
  // Expected from the database, not the seed's kind: after the billing script
  // has run, "expired" and "none" students hold a pack too.
  const now = new Date();
  const live = new Set((await db.membership.findMany({
    where: { schoolId: X.id, studentId: { in: [...outcome.keys()] }, status: 'ACTIVE', OR: [{ expiryDate: null }, { expiryDate: { gt: now } }], AND: [{ OR: [{ classesRemaining: null }, { classesRemaining: { gt: 0 } }] }] },
    select: { studentId: true },
  })).map((m) => m.studentId));
  const statusMismatch = [...outcome].filter(([id, o]) => o.status && (live.has(id) !== (o.status === 'ACTIVE')));
  ok('FD2 membership-status matches the student\'s live memberships (ACTIVE only with an unexpired membership that has classes left)', statusMismatch.length === 0,
    `${statusMismatch.length} mismatches${statusMismatch.length ? ' e.g. ' + JSON.stringify(statusMismatch.slice(0, 3).map(([, o]) => o)) : ''}`);
  globalThis.rushRefs = { allRs };
}

// ---------------------------------------------------------------- FD3 same student, two desks
{
  const cls = await mkClass(X, { title: `R3TF ${RUN} two desks` });
  const before = await packCredits(X.id, dblStudents.map((s) => s.id));
  const stat = { throttled: 0 };
  const res = await Promise.all(dblStudents.map((s, i) => Promise.all([dblDesks[(2 * i) % 4], dblDesks[(2 * i + 1) % 4]].map(async (desk) => {
    const b = await bookWithRetry('dbl:book', cls, desk.tok, { studentId: s.id }, stat);
    const sc = await call('dbl:scan', 'POST', `/classes/${cls}/attendance-scan`, desk.tok, { studentId: s.id });
    return { book: b.status, scan: sc.status };
  }))));
  let bad = [];
  for (const [i, s] of dblStudents.entries()) {
    const rows = await liveBooking(s.id, cls);
    const scans = res[i].filter((r) => r.scan < 300).length;
    const credit = s.kind === 'pack' ? before.get(s.id) - (await packCredits(X.id, [s.id])).get(s.id) : 1;
    if (rows.length !== 1 || rows[0].status !== 'COMPLETED' || scans !== 1 || credit !== 1) bad.push({ kind: s.kind, rows: rows.length, status: rows[0]?.status, scans, credit, codes: res[i] });
  }
  const flat = res.flat();
  ok('FD3 same student at two desks at once: one booking, one check-in, one credit', bad.length === 0 && no5xx(flat.map((r) => ({ status: r.book })).concat(flat.map((r) => ({ status: r.scan })))),
    `${dblStudents.length} students × 2 desks; book codes ${JSON.stringify(codes(flat.map((r) => ({ status: r.book }))))}, scan codes ${JSON.stringify(codes(flat.map((r) => ({ status: r.scan }))))}${bad.length ? '; bad ' + JSON.stringify(bad.slice(0, 3)) : ''}`);
}

// ---------------------------------------------------------------- QR tokens
{
  const [a, b, c, d] = qrStudents;
  const qrJwt = new JwtService({ secret: process.env.QR_STUDENT_TOKEN_SECRET });
  const accessJwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tokB = (await call('qr:my-token', 'GET', '/attendance/my-qr-token', b.tok)).body.token;
  const other = await call('qr:scan-other-token', 'POST', `/classes/${qrClass}/attendance-scan`, staffB0.tok, { studentId: a.id, studentToken: tokB });
  const expired = qrJwt.sign({ studentId: a.id }, { expiresIn: -30 });
  const exp = await call('qr:scan-expired', 'POST', `/classes/${qrClass}/attendance-scan`, staffB0.tok, { studentId: a.id, studentToken: expired });
  const forged = accessJwt.sign({ studentId: a.id }, { expiresIn: 20 });
  const forg = await call('qr:scan-forged', 'POST', `/classes/${qrClass}/attendance-scan`, staffB0.tok, { studentId: a.id, studentToken: forged });
  const garbage = await call('qr:scan-forged', 'POST', `/classes/${qrClass}/attendance-scan`, staffB0.tok, { studentId: a.id, studentToken: 'not-a-token' });
  // Real expiry: the token minted before the rush, used after its TTL.
  const waitMs = Math.max(0, staleAt + 22e3 - Date.now()); if (waitMs) await sleep(waitMs);
  const stale = await call('qr:scan-expired', 'POST', `/classes/${qrClass}/attendance-scan`, staffB0.tok, { studentId: d.id, studentToken: staleTok.body.token });
  const aRow = (await liveBooking(a.id, qrClass))[0]; const dRow = (await liveBooking(d.id, qrClass))[0];
  ok('QR1 another student\'s, expired, forged or garbage token is refused and checks nobody in',
    [other, exp, forg, garbage, stale].every((r) => r.status === 400) && aRow?.status === 'UPCOMING' && dRow?.status === 'UPCOMING',
    `other student's token ${other.status}, signed-expired ${exp.status}, real token after ${((Date.now() - staleAt) / 1000).toFixed(0)}s ${stale.status} (TTL ${staleTok.body?.expiresAt ? Math.round((new Date(staleTok.body.expiresAt) - staleAt) / 1000) + 's' : '?'}), wrong-key ${forg.status}, garbage ${garbage.status}; bookings still ${aRow?.status}/${dRow?.status}`);
  const own = await call('qr:my-token', 'GET', '/attendance/my-qr-token', c.tok);
  const okScan = await call('qr:scan-valid', 'POST', `/classes/${qrClass}/attendance-scan`, staffB0.tok, { studentId: c.id, studentToken: own.body.token });
  const again = await call('qr:scan-valid', 'POST', `/classes/${qrClass}/attendance-scan`, staffB0.tok, { studentId: c.id, studentToken: own.body.token });
  const cRow = (await liveBooking(c.id, qrClass))[0];
  ok('QR2 the student\'s own fresh token checks in once (INSTRUCTOR_SCAN), replay refused', okScan.status < 300 && is4xx(again) && cRow?.status === 'COMPLETED' && cRow.checkInMethod === 'INSTRUCTOR_SCAN',
    `scan ${okScan.status}, replay ${again.status}, booking ${cRow?.status}/${cRow?.checkInMethod}`);
  // Other tenant: their instructor scans this School's student with a valid token.
  const tokA = (await call('qr:my-token', 'GET', '/attendance/my-qr-token', a.tok)).body.token;
  const xt1 = await call('xt:scan', 'POST', `/classes/${qrClass}/attendance-scan`, OTHER.instructor.tok, { studentId: a.id, studentToken: tokA });
  const xt2 = await call('xt:scan', 'POST', `/classes/${qrClass}/attendance-scan`, OTHER.owner.tok, { studentId: a.id });
  ok('QR3 another School\'s staff cannot check this School\'s student in, with or without their token', is4xx(xt1) && is4xx(xt2) && (await liveBooking(a.id, qrClass))[0]?.status === 'UPCOMING', `instructor+token ${xt1.status}, owner manual ${xt2.status}`);
}

// ---------------------------------------------------------------- walk-ins by Branch Staff
{
  const clsB0 = await mkClass(X, { title: `R3TF ${RUN} walk-in B0` });
  const clsB2 = await mkClass(X, { branchId: B2, instructor: false, title: `R3TF ${RUN} walk-in B2` });
  const clsOther = await mkClass(OTHER, { title: `R3TF ${RUN} other tenant` }).catch(() => OTHER.nowClasses[0]);
  const [s1, s2, s3, s4] = walkStudents;
  const own = await call('walk:own-branch', 'POST', `/classes/${clsB0}/book`, staffB0.tok, { studentId: s1.id });
  const ownScan = await call('walk:own-branch', 'POST', `/classes/${clsB0}/attendance-scan`, staffB0.tok, { studentId: s1.id });
  const otherBranch = await call('walk:other-branch', 'POST', `/classes/${clsB2}/book`, staffB0.tok, { studentId: s2.id });
  const otherBranch2 = await call('walk:other-branch', 'POST', `/classes/${clsB0}/book`, staffB2.tok, { studentId: s3.id });
  const scanOtherBranch = await call('walk:other-branch', 'POST', `/classes/${clsB0}/attendance-scan`, staffB2.tok, { studentId: s1.id });
  const xSchool = await call('walk:cross-school', 'POST', `/classes/${clsOther}/book`, staffB0.tok, { studentId: s4.id });
  const xSchool2 = await call('walk:cross-school', 'POST', `/classes/${clsOther}/book`, staffB0.tok, { studentId: otherStudent.id });
  const xSchool3 = await call('walk:cross-school', 'POST', `/classes/${clsB0}/book`, OTHER.staff.tok, { studentId: s4.id });
  const xSchool4 = await call('walk:cross-school', 'POST', `/classes/${clsB0}/book`, staffB0.tok, { studentId: otherStudent.id });
  const made = (await liveBooking(s2.id, clsB2)).length + (await liveBooking(s3.id, clsB0)).length + (await liveBooking(s4.id, clsOther)).length + (await liveBooking(otherStudent.id, clsOther)).length + (await liveBooking(s4.id, clsB0)).length + (await liveBooking(otherStudent.id, clsB0)).length;
  const s1Row = (await liveBooking(s1.id, clsB0))[0];
  ok('W1 Branch Staff book and check in a walk-in at their own Branch', own.status === 201 && ownScan.status < 300 && s1Row?.status === 'COMPLETED', `book ${own.status}, check-in ${ownScan.status}, booking ${s1Row?.status}`);
  ok('W2 Branch Staff cannot book at, or check in for, another Branch\'s class (Decision 353 Q4)', [otherBranch, otherBranch2, scanOtherBranch].every(is4xx),
    `B0 staff → B2 class ${otherBranch.status}; B2 staff → B0 class ${otherBranch2.status}; B2 staff check-in at B0 ${scanOtherBranch.status}`);
  ok('W3 cross-School walk-in booking refused both ways', [xSchool, xSchool2, xSchool3, xSchool4].every(is4xx) && made === 0,
    `X staff → other School class (X student ${xSchool.status}, its own student ${xSchool2.status}); other School staff → X class ${xSchool3.status}; X staff books other School's student into X class ${xSchool4.status}; bookings created ${made}`);
}

// FD5. Sequential repro of FD3: book, check in, then book and check in the same class again.
{
  const cls = await mkClass(X, { title: `R3TF ${RUN} rebook` });
  const st = rest.slice(42, 60).find((s) => s.kind === 'pack') ?? rest.slice(42, 60).find(eligibleKind);
  const rank0 = await db.studentRank.findFirst({ where: { studentId: st.id, disciplineId: X.disciplineId } });
  const m0 = { classesRemaining: (await packCredits(X.id, [st.id])).get(st.id) };
  const steps = [];
  for (let i = 0; i < 2; i++) {
    steps.push((await call('rebook:book', 'POST', `/classes/${cls}/book`, staffB0.tok, { studentId: st.id })).status);
    steps.push((await call('rebook:scan', 'POST', `/classes/${cls}/attendance-scan`, staffB0.tok, { studentId: st.id })).status);
  }
  const self = await call('rebook:self', 'POST', `/classes/${cls}/book`, st.tok, {});
  const rows = await db.booking.findMany({ where: { studentId: st.id, classId: cls }, select: { status: true } });
  const rank1 = await db.studentRank.findFirst({ where: { studentId: st.id, disciplineId: X.disciplineId } });
  const m1 = { classesRemaining: (await packCredits(X.id, [st.id])).get(st.id) };
  const attended = rank0 && rank1 ? rank1.classesAttendedTowardCheckpoint - rank0.classesAttendedTowardCheckpoint : 'no rank';
  ok('FD5 a student already checked in to a class cannot be booked and checked in to it again', rows.length === 1,
    `${st.kind} student: book/scan/book/scan ${steps.join('/')}, then self-book ${self.status}; bookings for the one class ${JSON.stringify(codes(rows))}; class credits ${m0.classesRemaining}→${m1.classesRemaining}; classesAttendedTowardCheckpoint +${attended}`);
}

// FD4. One desk, 30 walk-ins in a burst: the per-user booking throttle (Decision 17, 20/min).
{
  const cls = await mkClass(X, { title: `R3TF ${RUN} burst desk` });
  const who = rushStudents.filter(eligibleKind).slice(0, 30);
  const rs = await Promise.all(who.map((s) => call('fd:burst-book', 'POST', `/classes/${cls}/book`, throttleDesk.tok, { studentId: s.id })));
  info('FD4 one front-desk login booking 30 walk-ins within a minute', `codes ${JSON.stringify(codes(rs))}. The booking throttle (BOOKING_ACTION_THROTTLE, 20/min per JWT sub, bookings.controller.ts:30) counts on-behalf bookings against the staff member, so a single desk/tablet login is capped at 20 walk-in bookings a minute for the whole School; no confirmed rule says what a desk's limit should be`);
}

// ---------------------------------------------------------------- front-desk cross-tenant reads
{
  const st = local[0];
  const r1 = await call('xt:search', 'GET', `/schools/${X.id}/students?search=a`, OTHER.owner.tok);
  const r2 = await call('xt:membership-status', 'GET', `/students/${st.id}/membership-status?schoolId=${X.id}`, OTHER.owner.tok);
  const r3 = await call('xt:eligibility', 'GET', `/students/${st.id}/eligibility?schoolId=${X.id}`, OTHER.owner.tok);
  const r4 = await call('xt:search', 'GET', `/schools/${OTHER.id}/students?search=a`, staffB0.tok);
  const r5 = await call('xt:class-bookings', 'GET', `/classes/${classOf(0)}/bookings`, OTHER.owner.tok);
  const r6 = await call('xt:membership-status', 'GET', `/students/${st.id}/membership-status?schoolId=${X.id}`, st.tok);
  ok('XT1 another School\'s owner cannot search, read membership status/eligibility or the class list here; a student cannot use the staff endpoints', [r1, r2, r3, r4, r5, r6].every(is4xx),
    `search ${r1.status}, membership-status ${r2.status}, eligibility ${r3.status}, X staff searching other School ${r4.status}, class bookings ${r5.status}, student calling membership-status ${r6.status}`);
  const r7 = await call('xt:membership-status', 'GET', `/students/${st.id}/membership-status?schoolId=${OTHER.id}`, OTHER.owner.tok);
  info('XT2 other School\'s owner asks for this School\'s student\'s status at their own School', `${r7.status} ${JSON.stringify(r7.body)}; the read is scoped to the caller's School (membership row filter schoolId), so nothing about School X leaks; it answers NONE for any user id, enrolled there or not`);
  // Branch Staff reading a student whose home branch is another Branch.
  await call('setup:home-branch', 'PUT', `/schools/${X.id}/students/${homeMoveStudents[0].id}/home-branch`, X.owner.tok, { branchId: B2 });
  const r8 = await call('fd:membership-status', 'GET', `/students/${homeMoveStudents[0].id}/membership-status?schoolId=${X.id}`, staffB0.tok);
  const r9 = await call('fd:search', 'GET', `/schools/${X.id}/students?search=${encodeURIComponent(names.get(homeMoveStudents[0].id).firstName)}`, staffB0.tok);
  info('XT3 Branch Staff and a student whose home branch is another Branch', `membership-status ${r8.status} ${JSON.stringify(r8.body)}; name search finds them: ${(r9.body?.items || []).some((x) => x.id === homeMoveStudents[0].id)}. Decision 353 limits the roster to their own branches (open question to the product owner); membership-status is School-wide by design (SKILL.md §2, assertStaffAtSchool without a branch)`);
  await call('setup:home-branch', 'PUT', `/schools/${X.id}/students/${homeMoveStudents[0].id}/home-branch`, X.owner.tok, { branchId: B0 });
}

// ---------------------------------------------------------------- timetable calendar
{
  const day = (off) => new Date(Date.now() + off * 86400e3).toISOString().slice(0, 10);
  const from = day(0), to = day(30);
  // A School with many classes: top up to ~300 one-off classes in the month (B0 and B2).
  const have = await db.class.count({ where: { schoolId: X.id, startDate: { gte: new Date(), lt: new Date(Date.now() + 30 * 86400e3) } } });
  const add = Math.max(0, 300 - have);
  await pool(Array.from({ length: add }, (_, i) => i), 12, (i) => mkClass(X, { branchId: i % 3 === 0 ? B2 : B0, instructor: i % 3 !== 0, startOff: (1 + (i % 29)) * 86400e3 + (i % 10) * 3600e3, endOff: (1 + (i % 29)) * 86400e3 + (i % 10) * 3600e3 + 3600e3, title: `R3TF ${RUN} month ${i}` }));
  const seq = [];
  for (let i = 0; i < 10; i++) seq.push(await call('cal:owner-month', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}`, X.owner.tok));
  const par = await Promise.all(Array.from({ length: 20 }, () => call('cal:owner-month-x20', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}`, X.owner.tok)));
  const sb0 = await Promise.all(Array.from({ length: 10 }, () => call('cal:staff-month', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}`, staffB0.tok)));
  const sb2 = await call('cal:staff-month', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}`, staffB2.tok);
  const two = await call('cal:62-days', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${day(62)}`, X.owner.tok);
  const n = seq[0].body?.classes?.length;
  ok('CAL1 month calendar at a School with ~300+ classes: owner sequential, 20 in parallel, Branch Staff', no5xx([...seq, ...par, ...sb0, sb2, two]) && seq.every((r) => r.status === 200) && par.every((r) => r.status === 200) && sb0.every((r) => r.status === 200) && two.status === 200,
    `${n} classes in 31 days (${add} added this run), ${seq[0].body?.later?.length} later-dates; 62 days ${two.status} with ${two.body?.classes?.length} classes; see latency table (cal:*)`);
  const leakB2 = (sb0[0].body?.classes || []).filter((c) => c.branchId === B2).length;
  const leakB0 = (sb2.body?.classes || []).filter((c) => c.branchId === B0).length;
  const ownB2 = (sb2.body?.classes || []).filter((c) => c.branchId === B2).length;
  const r63 = await call('cal:bad-range', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${day(64)}`, X.owner.tok);
  const rRev = await call('cal:bad-range', 'GET', `/schools/${X.id}/timetable/calendar?from=${to}&to=${from}`, X.owner.tok);
  const rOtherBranch = await call('cal:other-branch', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}&branchId=${B2}`, staffB0.tok);
  const rXt = await call('xt:calendar', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}`, OTHER.owner.tok);
  const rXt2 = await call('xt:calendar', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}&branchId=${OTHER.branches[0]}`, X.owner.tok);
  const rStudent = await call('xt:calendar', 'GET', `/schools/${X.id}/timetable/calendar?from=${from}&to=${to}`, local[0].tok);
  ok('CAL2 Branch Staff see only their Branch + School-wide classes; ranges and tenants enforced (Decision 353)',
    leakB2 === 0 && leakB0 === 0 && ownB2 > 0 && r63.status === 400 && rRev.status === 400 && rOtherBranch.status === 403 && is4xx(rXt) && is4xx(rXt2) && is4xx(rStudent),
    `B0 staff sees ${leakB2} B2 classes, B2 staff sees ${leakB0} B0 classes (and ${ownB2} of its own); 64 days ${r63.status}, reversed ${rRev.status}; B0 staff asking for B2 ${rOtherBranch.status}; other School's owner ${rXt.status}; other School's branch filter ${rXt2.status}; student ${rStudent.status}`);
  // Seats taken on today's rush classes match the database.
  const today = await call('cal:owner-day', 'GET', `/schools/${X.id}/timetable/calendar?from=${day(-1)}&to=${day(1)}`, X.owner.tok);
  const wrong = [];
  for (const id of rushClasses) {
    const row = (today.body?.classes || []).find((c) => c.id === id);
    const dbN = await db.booking.count({ where: { classId: id, status: { not: 'CANCELLED' } } });
    if (!row || row.seatsTaken !== dbN) wrong.push({ id: id.slice(0, 8), cal: row?.seatsTaken, db: dbN });
  }
  ok('CAL3 calendar seats taken match the bookings after the rush', wrong.length === 0, wrong.length ? JSON.stringify(wrong) : `${rushClasses.length} classes match`);
}

// ---------------------------------------------------------------- branch close
async function closeFixture(label, nClasses) {
  const br = await mkBranch(label);
  const classes = await Promise.all(Array.from({ length: nClasses }, (_, i) => mkClass(X, { branchId: br, instructor: false, startOff: (3 + i) * 3600e3, endOff: (4 + i) * 3600e3, title: `R3TF ${RUN} ${label} ${i}` })));
  const staff = await mkStaff(`close-${label}`, br);
  return { br, classes, staff };
}
{
  const { br: B3, classes, staff } = await closeFixture('Close race', 5);
  const slot = await call('setup:slot', 'POST', `/schools/${X.id}/timetable`, X.owner.tok, { branchId: B3, weekday: 'SUNDAY', startTime: '10:00', endTime: '11:00', title: `R3TF ${RUN} close slot`, styles, capacity: 20 });
  for (const s of homeMoveStudents.slice(1, 3)) await call('setup:home-branch', 'PUT', `/schools/${X.id}/students/${s.id}/home-branch`, X.owner.tok, { branchId: B3 });
  const live = async () => ({
    upcomingClasses: await db.class.count({ where: { branchId: B3, archivedAt: null, endDate: { gte: new Date() } } }),
    timetableSlots: await db.timetableSlot.count({ where: { branchId: B3, archivedAt: null } }),
    instructors: await db.instructor.count({ where: { branchId: B3, archivedAt: null } }),
    students: await db.studentHomeBranch.count({ where: { branchId: B3 } }),
    staffRoles: await db.roleGrant.count({ where: { branchId: B3, revokedAt: null } }),
  });
  const pv = await call('close:preview', 'GET', `/branches/${B3}/close-preview`, X.owner.tok);
  const want = await live();
  const diff = Object.keys(want).filter((key) => pv.body?.[key] !== want[key]);
  ok('BR1 close-preview matches what is still in use', pv.status === 200 && diff.length === 0 && pv.body.hasHistory === true && slot.status === 201,
    `preview ${JSON.stringify(pv.body)}; database ${JSON.stringify(want)}; slot create ${slot.status}`);
  const plain = await call('close:blocked', 'POST', `/branches/${B3}/close`, X.owner.tok, {});
  const plainArch = await call('close:blocked', 'POST', `/branches/${B3}/archive`, X.owner.tok, {});
  const bsClose = await call('close:by-staff', 'POST', `/branches/${B3}/close`, staff.tok, { classesTo: B0, studentsTo: B0, staffTo: B0 });
  const bsPv = await call('close:by-staff', 'GET', `/branches/${B3}/close-preview`, staffB0.tok);
  const xtPv = await call('xt:close', 'GET', `/branches/${B3}/close-preview`, OTHER.owner.tok);
  const xtClose = await call('xt:close', 'POST', `/branches/${B3}/close`, OTHER.owner.tok, { classesTo: OTHER.branches[0], studentsTo: 'WHOLE_SCHOOL', staffTo: OTHER.branches[0] });
  const xtTarget = await call('xt:close', 'POST', `/branches/${B3}/close`, X.owner.tok, { classesTo: OTHER.branches[0], studentsTo: B0, staffTo: B0 });
  const wholeStaff = await call('close:blocked', 'POST', `/branches/${B3}/close`, X.owner.tok, { classesTo: B0, studentsTo: B0, staffTo: 'WHOLE_SCHOOL' });
  const stillOpen = !(await db.branch.findUnique({ where: { id: B3 } })).archivedAt;
  ok('BR2 close refused while live things have nowhere to go, by non-owners, across tenants, to another School\'s branch, or with staff made School-wide',
    plain.status === 409 && plainArch.status === 409 && bsClose.status === 403 && is4xx(bsPv) && is4xx(xtPv) && is4xx(xtClose) && xtTarget.status === 400 && wholeStaff.status === 400 && stillOpen,
    `no choices ${plain.status} (${plain.body?.error?.code ?? plain.body?.code ?? ''}), archive ${plainArch.status}; Branch Staff close ${bsClose.status}, preview ${bsPv.status}; other owner preview ${xtPv.status}, close ${xtClose.status}; target in other School ${xtTarget.status}; staff → WHOLE_SCHOOL ${wholeStaff.status}; still open ${stillOpen}`);

  // Close while students are booking its classes.
  // Fresh members, enrolled the way the API enrols them (a STUDENT grant without a
  // branch, schools.service.ts join) with an active subscription; the cast's own
  // students carry branch-scoped STUDENT grants and can't see another Branch's classes.
  const subPlan = await db.membershipPlan.findFirst({ where: { schoolId: X.id, type: 'SUBSCRIPTION' } });
  const bookers = [];
  for (let i = 0; i < 80; i++) {
    const u = await mkUser(`member${i}`);
    bookers.push({ id: u.id, tok: token(u, [grant('STUDENT', X.id)]) });
  }
  await db.roleGrant.createMany({ data: bookers.map((b) => ({ id: randomUUID(), userId: b.id, role: 'STUDENT', schoolId: X.id })) });
  await db.membership.createMany({ data: bookers.map((b) => ({ id: randomUUID(), studentId: b.id, membershipPlanId: subPlan.id, schoolId: X.id, frequency: 'RECURRING' })) });
  const branchScopedTry = await call('close:race-book', 'POST', `/classes/${classes[0]}/book`, rushStudents.filter(eligibleKind).at(-2).tok, {});
  // One race: bookers hit the Branch's classes while the owner closes it; a failed
  // close is retried once after the bookings finish (as the owner would).
  const race = async (br, cls, who) => {
    const bookingsP = pool(who, 40, (s, i) => call('close:race-book', 'POST', `/classes/${cls[i % cls.length]}/book`, s.tok, {}));
    await sleep(40);
    const t0 = performance.now();
    const first = await call('close:race-close', 'POST', `/branches/${br}/close`, X.owner.tok, { classesTo: B0, studentsTo: B0, staffTo: B0, instructorsTo: B0 });
    const ms = performance.now() - t0;
    const bookRs = await bookingsP;
    const retry = first.status < 300 ? null : await call('close:race-close-retry', 'POST', `/branches/${br}/close`, X.owner.tok, { classesTo: B0, studentsTo: B0, staffTo: B0, instructorsTo: B0 });
    const clsRows = await db.class.findMany({ where: { id: { in: cls } }, select: { id: true, branchId: true } });
    const clsBranch = new Map(clsRows.map((c) => [c.id, c.branchId]));
    const bks = await db.booking.findMany({ where: { classId: { in: cls }, status: { not: 'CANCELLED' } }, select: { branchId: true, classId: true } });
    const orphans = bks.filter((b) => b.branchId !== clsBranch.get(b.classId));
    return { first, ms, bookRs, retry, clsRows, bks, orphans, onClosed: orphans.filter((o) => o.branchId === br).length };
  };
  const r1 = await race(B3, classes, bookers);
  const lateMember = await mkUser('member-late');
  await db.roleGrant.create({ data: { id: randomUUID(), userId: lateMember.id, role: 'STUDENT', schoolId: X.id } });
  await db.membership.create({ data: { id: randomUUID(), studentId: lateMember.id, membershipPlanId: subPlan.id, schoolId: X.id, frequency: 'RECURRING' } });
  const after = await call('close:after-book', 'POST', `/classes/${classes[0]}/book`, token(lateMember, [grant('STUDENT', X.id)]), {});
  const brRow = await db.branch.findUnique({ where: { id: B3 } });
  const leftLive = await live();
  const newGrant = await db.roleGrant.count({ where: { userId: staff.id, branchId: B0, revokedAt: null } });
  ok('BR3 close while bookings are being made: no errors; classes, bookings and roles move together; nothing live left on the closed Branch (Decision 330 §2)',
    r1.first.status < 300 && no5xx(r1.bookRs) && !!brRow.archivedAt && brRow.purgeAt === null && r1.clsRows.every((c) => c.branchId === B0) && r1.orphans.length === 0 && Object.values(leftLive).every((v) => v === 0) && newGrant === 1 && after.status === 201,
    `close ${r1.first.status} in ${r1.ms.toFixed(0)}ms during ${bookers.length} bookings (codes ${JSON.stringify(codes(r1.bookRs))})${r1.retry ? `, retried after: ${r1.retry.status}` : ''}; archived ${!!brRow.archivedAt}, purgeAt ${brRow.purgeAt}; classes at B0 ${r1.clsRows.filter((c) => c.branchId === B0).length}/${classes.length}; live bookings ${r1.bks.length}, with branchId ≠ class branch: ${r1.orphans.length} (on the closed Branch: ${r1.onClosed}); left on B3 ${JSON.stringify(leftLive)}; staff re-granted at B0 ${newGrant}; booking after close ${after.status}; (a cast student with a B0-scoped STUDENT grant booking a B3 class: ${branchScopedTry.status})`);
  // More rounds on fresh Branches, to see how often the race bites.
  const rounds = [];
  for (let round = 0; round < 4; round++) {
    const fx = await closeFixture(`Close race ${round + 2}`, 5);
    const r = await race(fx.br, fx.classes, bookers);
    const arch = !!(await db.branch.findUnique({ where: { id: fx.br } })).archivedAt;
    rounds.push({ close: r.first.status, retry: r.retry?.status, closeMs: Math.round(r.ms), books: codes(r.bookRs), archived: arch, orphans: r.orphans.length, orphansOnClosed: r.onClosed });
  }
  ok('BR3b four more close-during-bookings rounds: no 500s, no booking left pointing at the closed Branch', rounds.every((r) => r.close < 300 && !r.books[500] && r.orphans === 0 && r.archived), JSON.stringify(rounds));
  globalThis.closedBranch = B3;

  // A class can still be created on the closed Branch through the API (Decision 293 says so).
  const onClosed = await call('close:class-on-closed', 'POST', `/schools/${X.id}/classes`, X.owner.tok, { branchId: B3, title: `R3TF ${RUN} on closed`, styles, startDate: new Date(Date.now() + 5 * 3600e3).toISOString(), endDate: new Date(Date.now() + 6 * 3600e3).toISOString(), membershipInclusion: true, capacity: 10 });
  info('BR4 one-off class created on a closed Branch through the API', `status ${onClosed.status}. Timetable slots refuse a closed Branch (timetable.service.ts assertBranchNotArchived), classes.service.ts create() does not; Decision 293 records "the API still accepts a new assignment to an archived Branch" as a known, separate change`);
  if (onClosed.status === 201) await call('setup:archive-class', 'POST', `/classes/${onClosed.body.id}/archive`, X.owner.tok, {});
}
{
  const { br: B4, classes, staff } = await closeFixture('Close x10', 3);
  const body = { classesTo: B0, studentsTo: B0, staffTo: B0, instructorsTo: B0 };
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('close:x10', 'POST', `/branches/${B4}/close`, X.owner.tok, body)));
  const grants = await db.roleGrant.findMany({ where: { userId: staff.id, schoolId: X.id, revokedAt: null } });
  const moved = await db.class.count({ where: { id: { in: classes }, branchId: B0 } });
  const br = await db.branch.findUnique({ where: { id: B4 } });
  ok('BR5 close 10× in parallel: all succeed idempotently, roles re-granted once, classes moved once', rs.every((r) => r.status >= 200 && r.status < 300) && grants.length === 1 && grants[0].branchId === B0 && moved === classes.length && !!br.archivedAt,
    `codes ${JSON.stringify(codes(rs))}; active grants for the moved staff ${grants.length} (at ${grants.map((g) => (g.branchId === B0 ? 'B0' : g.branchId)).join(',')}); classes moved ${moved}/${classes.length}`);
  globalThis.closedBranch2 = B4;
}

// ---------------------------------------------------------------- notifications: mark all read
{
  const N = 500;
  await db.notification.createMany({ data: Array.from({ length: N }, (_, i) => ({ id: randomUUID(), userId: notifStudent.id, title: `R3 ${RUN} ${i}`, body: 'stress', type: 'TEST', schoolId: X.id, schoolName: 'stress', ...(i % 7 === 0 ? { snoozedUntil: new Date(Date.now() + 3600e3) } : {}) })) });
  await db.notification.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ id: randomUUID(), userId: notifControl.id, title: `R3 ${RUN} ctl ${i}`, body: 'stress', type: 'TEST' })) });
  const unreadBefore = await db.notification.count({ where: { userId: notifStudent.id, read: false, deletedAt: null } });
  const ctlBefore = await db.notification.count({ where: { userId: notifControl.id, read: false } });
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('notif:read-all-x10', 'POST', '/notifications/me/read-all', notifStudent.tok)));
  const sum = rs.reduce((a, r) => a + (r.body?.updated ?? 0), 0);
  const unreadAfter = await db.notification.count({ where: { userId: notifStudent.id, read: false, deletedAt: null } });
  const noReadAt = await db.notification.count({ where: { userId: notifStudent.id, read: true, readAt: null } });
  const ctlAfter = await db.notification.count({ where: { userId: notifControl.id, read: false } });
  const counts = await call('notif:counts', 'GET', '/notifications/me/counts', notifStudent.tok);
  ok('N1 Mark all read ×10 in parallel on ~500 unread (snoozed included): each marked once, readAt set, nobody else touched (Decision 355)',
    rs.every((r) => r.status === 200) && sum === unreadBefore && unreadAfter === 0 && noReadAt === 0 && ctlAfter === ctlBefore,
    `unread before ${unreadBefore}; updated per call ${rs.map((r) => r.body?.updated).join(',')} (sum ${sum}); unread after ${unreadAfter}; read without readAt ${noReadAt}; other student's unread ${ctlBefore}→${ctlAfter}; counts ${JSON.stringify(counts.body)}`);
  const again = await call('notif:read-all', 'POST', '/notifications/me/read-all', notifStudent.tok);
  ok('N2 Mark all read when nothing is unread returns 0', again.status === 200 && again.body?.updated === 0, `${again.status} ${JSON.stringify(again.body)}`);
}

// ---------------------------------------------------------------- broadcasts
{
  const enrolled = (await db.roleGrant.findMany({ where: { schoolId: X.id, role: 'STUDENT', revokedAt: null }, distinct: ['userId'], select: { userId: true } })).length;
  const b = await call('bc:send-all', 'POST', `/schools/${X.id}/notifications/broadcast`, X.owner.tok, { title: `R3 ${RUN} all`, body: 'Front desk closes early today.', audience: 'ALL' });
  const id = b.body?.broadcastId;
  const t0 = Date.now(); let delivered = 0;
  while (id && Date.now() - t0 < 120e3) {
    delivered = await db.notification.count({ where: { id: { startsWith: `broadcast-${id}-` } } });
    if (delivered >= enrolled) break;
    await sleep(1000);
  }
  const fanSecs = (Date.now() - t0) / 1000;
  const labelled = id ? await db.notification.count({ where: { id: { startsWith: `broadcast-${id}-` }, schoolId: X.id, schoolName: { not: null } } }) : 0;
  const hist = await call('bc:history', 'GET', `/schools/${X.id}/notifications/broadcasts`, X.owner.tok);
  const top = hist.body?.items?.[0];
  ok('BC1 broadcast to every student: queued for all enrolled, delivered, labelled, listed first in the history (Decisions 355, 363)',
    b.status === 201 && b.body.recipientCount === enrolled && delivered === enrolled && labelled === enrolled && top?.id === id && top?.recipientCount === enrolled && !!top?.sentByName,
    `send ${b.status} recipientCount ${b.body?.recipientCount} (enrolled ${enrolled}); delivered ${delivered} in ${fanSecs.toFixed(1)}s, with School label ${labelled}; history ${hist.status}, newest ${top?.id === id ? 'is this one' : top?.id}, count ${top?.recipientCount}, by "${top?.sentByName}"`);
  // Five owners' broadcasts at once (all students, a Branch, a class), then page through.
  const bodies = [
    { audience: 'ALL' }, { audience: 'BRANCH', branchId: B0 }, { audience: 'CLASS', classId: rushClasses[0] }, { audience: 'CLASS', classId: rushClasses[1], classAudience: ['BOOKED', 'WAITLIST'] }, { audience: 'BRANCH', branchId: B2 },
  ];
  const par = await Promise.all(bodies.map((x, i) => call('bc:send-x5', 'POST', `/schools/${X.id}/notifications/broadcast`, X.owner.tok, { title: `R3 ${RUN} p${i}`, body: 'parallel', ...x })));
  const ids = new Set(par.map((r) => r.body?.broadcastId));
  const seen = new Set(); let cursor = null, pages = 0, order = true, prev = null;
  do {
    const r = await call('bc:history-page', 'GET', `/schools/${X.id}/notifications/broadcasts${cursor ? `?cursor=${cursor}` : ''}`, X.owner.tok);
    pages++;
    for (const it of r.body?.items || []) { if (prev && new Date(it.createdAt) > new Date(prev)) order = false; prev = it.createdAt; seen.add(it.id); }
    cursor = r.body?.nextCursor;
  } while (cursor && pages < 50);
  const listed = [...ids].filter((x) => seen.has(x)).length;
  const dbCount = await db.notificationBroadcast.count({ where: { schoolId: X.id } });
  ok('BC2 five broadcasts at once are all recorded; history pages newest-first with no gaps or repeats', par.every((r) => r.status === 201) && listed === 5 && order && seen.size === dbCount,
    `codes ${JSON.stringify(codes(par))}; recipients ${par.map((r) => r.body?.recipientCount).join('/')}; listed ${listed}/5; ${seen.size} unique rows over ${pages} pages (database ${dbCount}); newest-first ${order}`);
  const closedB = await call('bc:closed-branch', 'POST', `/schools/${X.id}/notifications/broadcast`, X.owner.tok, { title: 'x', body: 'y', audience: 'BRANCH', branchId: globalThis.closedBranch2 });
  const bsSend = await call('bc:by-staff', 'POST', `/schools/${X.id}/notifications/broadcast`, staffB0.tok, { title: 'x', body: 'y', audience: 'BRANCH', branchId: B0 });
  const bsHist = await call('bc:by-staff', 'GET', `/schools/${X.id}/notifications/broadcasts`, staffB0.tok);
  const insHist = await call('bc:by-staff', 'GET', `/schools/${X.id}/notifications/broadcasts`, X.instructor.tok);
  const xtHist = await call('xt:broadcast', 'GET', `/schools/${X.id}/notifications/broadcasts`, OTHER.owner.tok);
  const xtSend = await call('xt:broadcast', 'POST', `/schools/${X.id}/notifications/broadcast`, OTHER.owner.tok, { title: 'x', body: 'y', audience: 'ALL' });
  const xtBranch = await call('xt:broadcast', 'POST', `/schools/${X.id}/notifications/broadcast`, X.owner.tok, { title: 'x', body: 'y', audience: 'BRANCH', branchId: OTHER.branches[0] });
  const xtClass = await call('xt:broadcast', 'POST', `/schools/${X.id}/notifications/broadcast`, X.owner.tok, { title: 'x', body: 'y', audience: 'CLASS', classId: OTHER.nowClasses[0] });
  const xtOwnHist = await call('xt:broadcast', 'GET', `/schools/${OTHER.id}/notifications/broadcasts`, X.owner.tok);
  const blanks = await call('bc:blank', 'POST', `/schools/${X.id}/notifications/broadcast`, X.owner.tok, { title: '   ', body: 'y', audience: 'ALL' });
  ok('BC3 broadcast refusals: closed Branch (Decision 333), Branch Staff/Instructor send or read history (Decision 363), other School both ways, blank title',
    closedB.status === 400 && bsSend.status === 403 && bsHist.status === 403 && insHist.status === 403 && is4xx(xtHist) && is4xx(xtSend) && xtBranch.status === 400 && is4xx(xtClass) && is4xx(xtOwnHist) && blanks.status === 400,
    `closed Branch ${closedB.status}; staff send ${bsSend.status}, staff history ${bsHist.status}, instructor history ${insHist.status}; other owner history ${xtHist.status}, send ${xtSend.status}; other School's Branch ${xtBranch.status}, Class ${xtClass.status}; X owner reading other School's history ${xtOwnHist.status}; blank title ${blanks.status}`);
}

// ---------------------------------------------------------------- disciplines
{
  const mkDisc = async (name) => {
    const r = await call('disc:create', 'POST', `/schools/${X.id}/disciplines`, X.owner.tok, { name: `${name} ${RUN}`, classTypesOffered: [] });
    if (r.status >= 300) throw new Error('discipline ' + JSON.stringify(r.body));
    return r.body.id;
  };
  const D2 = await mkDisc('R3 Judo');
  const p1 = await call('disc:plan', 'POST', `/schools/${X.id}/membership-plans`, X.owner.tok, { type: 'CLASS_PACK', title: `R3 ${RUN} judo pack`, price: 1000, classesIncluded: 5, disciplineIds: [D2] });
  const arch = await call('disc:archive', 'POST', `/disciplines/${D2}/archive`, X.owner.tok, {});
  const p2 = await call('disc:plan', 'POST', `/schools/${X.id}/membership-plans`, X.owner.tok, { type: 'CLASS_PACK', title: `R3 ${RUN} judo pack 2`, price: 1000, classesIncluded: 5, disciplineIds: [D2] });
  const keep = p1.status === 201 ? await call('disc:plan-edit', 'PATCH', `/membership-plans/${p1.body.id}`, X.owner.tok, { title: `R3 ${RUN} judo pack renamed`, disciplineIds: [D2] }) : { status: 0 };
  const addTo = await call('disc:plan', 'POST', `/schools/${X.id}/membership-plans`, X.owner.tok, { type: 'CLASS_PACK', title: `R3 ${RUN} mixed`, price: 1000, classesIncluded: 5, disciplineIds: [X.disciplineId, D2] });
  const cls = await call('disc:class', 'POST', `/schools/${X.id}/classes`, X.owner.tok, { branchId: B0, title: `R3TF ${RUN} judo`, styles: [{ disciplineId: D2, classType: null }], startDate: new Date(Date.now() + 3600e3).toISOString(), endDate: new Date(Date.now() + 7200e3).toISOString(), membershipInclusion: true, capacity: 10 });
  const slot = await call('disc:slot', 'POST', `/schools/${X.id}/timetable`, X.owner.tok, { branchId: B0, weekday: 'MONDAY', startTime: '12:00', endTime: '13:00', title: `R3TF ${RUN} judo slot`, styles: [{ disciplineId: D2, classType: null }], capacity: 10 });
  ok('D1 archived style: refused on a new plan, class or slot; kept on the plan that already had it (Decisions 309, 310)',
    p1.status === 201 && arch.status < 300 && p2.status === 400 && keep.status === 200 && addTo.status === 400 && cls.status === 400 && slot.status === 400,
    `plan before archive ${p1.status}; archive ${arch.status}; new plan ${p2.status}; editing the plan that had it ${keep.status}; new plan mixing it in ${addTo.status}; new class ${cls.status}; new slot ${slot.status}`);
  // In use: archive is refused while an upcoming class uses the style.
  const D3 = await mkDisc('R3 Wrestling');
  const used = await mkClass(X, { st: [{ disciplineId: D3, classType: null }], startOff: 2 * 3600e3, endOff: 3 * 3600e3 });
  const inUse = await call('disc:archive', 'POST', `/disciplines/${D3}/archive`, X.owner.tok, {});
  ok('D2 a style used by an upcoming class cannot be archived (Decision 309/310 §5)', inUse.status === 409, `${inUse.status} ${JSON.stringify(inUse.body?.error?.message ?? inUse.body?.message ?? '')}`);
  void used;
  // Race: classes created with a style while it is being archived.
  const raceRounds = [];
  for (let round = 0; round < 8; round++) {
    const D = await mkDisc(`R3 Race ${round}`);
    const creates = pool(Array.from({ length: 24 }, (_, i) => i), 24, () => call('disc:race-create', 'POST', `/schools/${X.id}/classes`, X.owner.tok, { branchId: B0, title: `R3TF ${RUN} race ${round}`, styles: [{ disciplineId: D, classType: null }], startDate: new Date(Date.now() + 4 * 3600e3).toISOString(), endDate: new Date(Date.now() + 5 * 3600e3).toISOString(), membershipInclusion: true, capacity: 10 }));
    let archived = null; let tries = 0; let done = false;
    creates.then(() => { done = true; });
    // Fire the first archive a little later each round, so it lands inside the creates' window.
    await sleep(round * 8);
    while (!done && !archived && tries < 400) { tries++; const a = await call('disc:race-archive', 'POST', `/disciplines/${D}/archive`, X.owner.tok, {}); if (a.status < 300) archived = a; }
    const cr = await creates;
    const disc = await db.discipline.findUnique({ where: { id: D } });
    const [{ n }] = await db.$queryRaw`SELECT count(*)::int AS n FROM "Class" WHERE "schoolId" = ${X.id} AND "archivedAt" IS NULL AND "endDate" >= now() AND "styles" @> ${JSON.stringify([{ disciplineId: D }])}::jsonb`;
    raceRounds.push({ round, delayMs: round * 8, archived: !!disc.archivedAt, liveClasses: n, creates: codes(cr), archiveTries: tries, D, sample: cr.find((r) => r.status === 201)?.body?.id });
  }
  const broken = raceRounds.filter((r) => r.archived && r.liveClasses > 0);
  ok('D3 archive racing 24 class creates never leaves an archived style on upcoming classes', broken.length === 0,
    JSON.stringify(raceRounds.map(({ D, sample, ...r }) => r)));
  if (broken.length) {
    // The class that slipped through still works: book it, edit it keeping its style.
    const r = broken[0];
    const st = rushStudents.filter(eligibleKind).at(-1);
    const bk = await call('disc:race-class-book', 'POST', `/classes/${r.sample}/book`, st.tok, {});
    const ed = await call('disc:race-class-edit', 'PATCH', `/classes/${r.sample}`, X.owner.tok, { title: `R3TF ${RUN} race edited`, styles: [{ disciplineId: r.D, classType: null }] });
    info('D4 class left with the archived style still works', `book ${bk.status}, edit keeping the style ${ed.status}`);
  }
  // Cross-tenant on disciplines and plans.
  const x1 = await call('xt:disc', 'POST', `/schools/${X.id}/membership-plans`, OTHER.owner.tok, { type: 'CLASS_PACK', title: 'xt', price: 1000, classesIncluded: 5 });
  const x2 = await call('xt:disc', 'POST', `/schools/${X.id}/membership-plans`, X.owner.tok, { type: 'CLASS_PACK', title: `R3 ${RUN} xt`, price: 1000, classesIncluded: 5, disciplineIds: [OTHER.disciplineId] });
  const x3 = await call('xt:disc', 'POST', `/disciplines/${D3}/archive`, OTHER.owner.tok, {});
  const x4 = await call('xt:disc', 'POST', `/disciplines/${OTHER.disciplineId}/archive`, X.owner.tok, {});
  const x5 = await call('xt:disc', 'POST', `/disciplines/${D3}/archive`, staffB0.tok, {});
  const x6 = await call('xt:disc', 'POST', `/schools/${X.id}/classes`, X.owner.tok, { branchId: B0, title: 'xt', styles: [{ disciplineId: OTHER.disciplineId, classType: OTHER.classType }], startDate: new Date(Date.now() + 3600e3).toISOString(), endDate: new Date(Date.now() + 7200e3).toISOString(), membershipInclusion: true, capacity: 10 });
  const otherDisc = await db.discipline.findUnique({ where: { id: OTHER.disciplineId } });
  ok('D5 disciplines and plans across tenants, and by Branch Staff, are refused', [x1, x2, x3, x4, x5, x6].every(is4xx) && !otherDisc.archivedAt,
    `other owner makes plan here ${x1.status}; plan with other School's style ${x2.status}; other owner archives ours ${x3.status}; we archive theirs ${x4.status}; Branch Staff archives ${x5.status}; class with other School's style ${x6.status}`);
}

report();
save();
await db.$disconnect();
