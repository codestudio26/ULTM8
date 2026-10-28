// Round 3: staff, instructors and students (Decisions 331, 341–343, 360, 361, 371).
// Load and attacks against the Staff page (list, Remove from School, Give role,
// instant access changes), Instructors (resend passcode, self-edit, no revoke
// while teaching, private details) and Students (roster, Add manually, revoke
// with bookings/waitlist/Subscription, leaving summary, re-enrol, branch staff).
//
//   API=... CAST=... SCHOOLS=14-17 node staff-students.mjs
//   FAKE_STRIPE   fake Stripe base URL (default http://localhost:12111)
//
// Only the first picked School is changed (new users, grants, classes, a second
// branch, home branches, and a PaymentAccount pointing at the fake Stripe when
// it has none). The next cast School is used read-only for cross-tenant attempts.
import { db, call, pool, report, randomUUID, token, grant, cast, pick, checks, codes } from './common.mjs';

const { ok, save } = checks('staff-students');
const FAKE_STRIPE = process.env.FAKE_STRIPE || 'http://localhost:12111';
const [S] = pick('14-17');
const O = cast.schools[(cast.schools.indexOf(S) + 1) % cast.schools.length]; // other tenant, read-only
const RUN = randomUUID().slice(0, 8);
const now = Date.now();
const b0 = S.branches[0];
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const is4xx = (r) => r.status >= 400 && r.status < 500;
const no5xx = (rs) => rs.every((r) => r.status > 0 && r.status < 500);

/** A token as AuthService.issueAccessToken builds it, with the `rca` stamp (Decision 361). */
async function liveToken(userId) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, rolesChangedAt: true } });
  const gs = await db.roleGrant.findMany({ where: { userId, revokedAt: null }, select: { role: true, franchiseId: true, schoolId: true, branchId: true } });
  return signWithRca(u, gs);
}
// lib's token() has no rca; sign one with it using the same secret.
import { createRequire } from 'module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { JwtService } = require('@nestjs/jwt');
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
function signWithRca(u, gs) {
  return jwt.sign({ sub: u.id, email: u.email, grants: gs, rca: u.rolesChangedAt?.getTime() ?? 0 }, { expiresIn: '1h' });
}

let userN = 0;
async function mkUser(label, extra = {}) {
  return db.user.create({ data: { id: randomUUID(), email: `ss-${label}-${RUN}-${userN++}@stress.test`, firstName: `SS${label}`, surname: `Run${RUN}`, passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), phoneVerifiedAt: new Date(), ...extra } });
}
async function mkGrant(userId, role, branchId = null, schoolId = S.id) {
  return db.roleGrant.create({ data: { id: randomUUID(), userId, role, schoolId, branchId } });
}
async function mkOwner(label) {
  const u = await mkUser(label);
  await mkGrant(u.id, 'SCHOOL_OWNER_MANAGER');
  return { ...u, tok: token(u, [grant('SCHOOL_OWNER_MANAGER', S.id)]) };
}
let k = 0;
async function mkClass(cap, extra = {}) {
  const start = now + (2 + k) * 3600e3;
  const r = await call('setup:mk-class', 'POST', `/schools/${S.id}/classes`, S.owner.tok, { branchId: b0, instructorId: S.instructor.id, title: `SS ${RUN} ${k++}`, styles: [{ disciplineId: S.disciplineId, classType: S.classType }], startDate: new Date(start).toISOString(), endDate: new Date(start + 3600e3).toISOString(), membershipInclusion: true, capacity: cap, ...extra });
  if (r.status >= 300) throw new Error('mkClass ' + JSON.stringify(r.body));
  return r.body.id;
}
const activeStudentIds = new Set((await db.roleGrant.findMany({ where: { schoolId: S.id, role: 'STUDENT', revokedAt: null }, select: { userId: true } })).map((g) => g.userId));
const live = shuffle(S.students.filter((x) => activeStudentIds.has(x.id) && x.branch === b0));
const taken = new Set();
const take = (kind, n = 1) => { const out = live.filter((x) => (kind === 'any' || x.kind === kind) && !taken.has(x.id)).slice(0, n); out.forEach((x) => taken.add(x.id)); if (out.length < n) throw new Error(`not enough ${kind} students`); return out; };

// ---------------------------------------------------------------- setup
// Enough staff for the list to mean something: 30 Branch Staff / coaches.
const staffNow = await db.roleGrant.count({ where: { schoolId: S.id, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null } });
for (let i = staffNow; i < 30; i++) { const u = await mkUser('staff'); await mkGrant(u.id, i % 3 ? 'BRANCH_STAFF' : 'INSTRUCTOR', b0); }
// A second branch, and home branches for 80 students (40 per branch), for the S1 check.
let bB = await db.branch.findFirst({ where: { schoolId: S.id, name: 'SS Branch B' } });
if (!bB) bB = await db.branch.create({ data: { id: randomUUID(), schoolId: S.id, name: 'SS Branch B' } });
// Membership kind doesn't matter here; 'any' keeps smaller schools' packs for the credit checks.
const hbA = take('any', 40), hbB = take('any', 40);
await db.studentHomeBranch.deleteMany({ where: { schoolId: S.id, studentId: { in: [...hbA, ...hbB].map((x) => x.id) } } });
await db.studentHomeBranch.createMany({ data: [...hbA.map((x) => ({ id: randomUUID(), schoolId: S.id, studentId: x.id, branchId: b0 })), ...hbB.map((x) => ({ id: randomUUID(), schoolId: S.id, studentId: x.id, branchId: bB.id }))] });
const otherOwner = O.owner;
console.log(`school ${S.id} (other ${O.id}), run ${RUN}`);

// ================================================================ STAFF
// ST1. Staff list latency and shape.
{
  const rs = await pool(Array.from({ length: 40 }), 8, () => call('ST1:staff-list', 'GET', `/schools/${S.id}/staff`, S.owner.tok));
  const rq = await pool(Array.from({ length: 20 }), 8, (_, i) => call('ST1:staff-list-filtered', 'GET', `/schools/${S.id}/staff?${['q=ss&status=all', 'role=INSTRUCTOR', `branchId=${b0}`, 'status=removed'][i % 4]}`, S.owner.tok));
  const items = rs[0].body?.items ?? [];
  const hasCast = [S.instructor.id, S.staff.id].every((id) => items.some((m) => m.userId === id));
  const staffTry = await call('ST1:staff-list', 'GET', `/schools/${S.id}/staff`, S.staff.tok);
  ok('ST1 staff list: owner gets every active staff member fast; Branch Staff refused', [...rs, ...rq].every((r) => r.status === 200) && hasCast && staffTry.status === 403,
    `${items.length} active staff; codes ${JSON.stringify(codes([...rs, ...rq]))}; Branch Staff GET ${staffTry.status}`);
}

// ST2/ST3. Remove from School: 20 parallel removes of one coach; their old token is refused at once.
{
  const coach = await mkUser('coach');
  await mkGrant(coach.id, 'INSTRUCTOR', b0); await mkGrant(coach.id, 'BRANCH_STAFF', b0);
  const oldTok = await liveToken(coach.id);
  const legacyTok = token(coach, [grant('INSTRUCTOR', S.id, b0), grant('BRANCH_STAFF', S.id, b0)]); // no rca
  const before = await call('ST3:old-token', 'GET', `/schools/${S.id}/students`, oldTok);
  const rs = await Promise.all(Array.from({ length: 20 }, () => call('ST2:remove-x20', 'POST', `/schools/${S.id}/staff/${coach.id}/remove`, S.owner.tok)));
  const after = await call('ST3:old-token', 'GET', `/schools/${S.id}/students`, oldTok);
  const legacy = await call('ST3:legacy-token', 'GET', `/schools/${S.id}/students`, legacyTok);
  const left = await db.roleGrant.count({ where: { userId: coach.id, revokedAt: null } });
  const wins = rs.filter((r) => r.status === 201);
  const removed = await call('ST2:staff-list', 'GET', `/schools/${S.id}/staff?status=removed&q=${encodeURIComponent(coach.email)}`, S.owner.tok);
  ok('ST2 20 parallel "Remove from School" of one coach: one removal of both roles, the rest 404, no 5xx', wins.length === 1 && wins[0].body?.removedRoles === 2 && left === 0 && no5xx(rs) && removed.body?.items?.length === 1,
    `codes ${JSON.stringify(codes(rs))}; removedRoles ${wins.map((w) => w.body.removedRoles)}; active grants left ${left}; under Removed: ${removed.body?.items?.length}`);
  ok('ST3 a removed coach\'s current token is refused on the very next request (401 ROLES_CHANGED)', before.status === 200 && after.status === 401 && after.body?.error?.code === 'ROLES_CHANGED',
    `before ${before.status}; after ${after.status} ${after.body?.error?.code}`);
  ok('ST3b INFO: a token without `rca` (legacy/Kid Mode shape) after removal', true,
    `INFO: legacy token GET roster → ${legacy.status} (Decision 361 exempts tokens without rca from the stamp check; the roster is still gated in the DB)`);
}

// ST4. "Give role" double click: 10 parallel identical grants.
{
  const u = await mkUser('giverole');
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('ST4:give-role-x10', 'POST', `/users/${u.id}/role-grants`, S.owner.tok, { role: 'BRANCH_STAFF', schoolId: S.id, branchId: b0 })));
  const n = await db.roleGrant.count({ where: { userId: u.id, schoolId: S.id, role: 'BRANCH_STAFF', branchId: b0, revokedAt: null } });
  ok('ST4 "Give role" double click (10 parallel) creates one grant', n === 1 && no5xx(rs), `${n} active BRANCH_STAFF grants; codes ${JSON.stringify(codes(rs))}`);
  // Single-shot for comparison: the sequential duplicate check works.
  const again = await call('ST4:give-role-again', 'POST', `/users/${u.id}/role-grants`, S.owner.tok, { role: 'BRANCH_STAFF', schoolId: S.id, branchId: b0 });
  ok('ST4b a later identical "Give role" is refused (409)', again.status === 409, `status ${again.status}`);
}

// ST5. Cross-tenant and wrong-role attempts on the Staff endpoints.
{
  const u = await mkUser('xt');
  const oBranch = O.branches[0];
  const sStaffGrants = await db.roleGrant.count({ where: { userId: S.staff.id, schoolId: S.id, revokedAt: null } });
  const oInstrGrants = await db.roleGrant.count({ where: { userId: O.instructor.id, schoolId: O.id, revokedAt: null } });
  const attempts = {
    'O owner lists S staff': await call('ST5:xt', 'GET', `/schools/${S.id}/staff`, otherOwner.tok),
    'O owner removes S staff via S path': await call('ST5:xt', 'POST', `/schools/${S.id}/staff/${S.staff.id}/remove`, otherOwner.tok),
    'O owner removes S staff via O path': await call('ST5:xt', 'POST', `/schools/${O.id}/staff/${S.staff.id}/remove`, otherOwner.tok),
    'S owner removes O instructor via O path': await call('ST5:xt', 'POST', `/schools/${O.id}/staff/${O.instructor.id}/remove`, S.owner.tok),
    'O owner gives role at S': await call('ST5:xt', 'POST', `/users/${u.id}/role-grants`, otherOwner.tok, { role: 'INSTRUCTOR', schoolId: S.id, branchId: b0 }),
    'S owner gives role at O': await call('ST5:xt', 'POST', `/users/${u.id}/role-grants`, S.owner.tok, { role: 'INSTRUCTOR', schoolId: O.id, branchId: oBranch }),
    'S owner gives role at S with an O branch': await call('ST5:xt', 'POST', `/users/${u.id}/role-grants`, S.owner.tok, { role: 'BRANCH_STAFF', schoolId: S.id, branchId: oBranch }),
    'S Branch Staff gives role at S': await call('ST5:xt', 'POST', `/users/${u.id}/role-grants`, S.staff.tok, { role: 'BRANCH_STAFF', schoolId: S.id, branchId: b0 }),
    'S Branch Staff removes S instructor': await call('ST5:xt', 'POST', `/schools/${S.id}/staff/${S.instructor.id}/remove`, S.staff.tok),
    'S instructor gives self owner': await call('ST5:xt', 'POST', `/users/${S.instructor.id}/role-grants`, S.instructor.tok, { role: 'SCHOOL_OWNER_MANAGER', schoolId: S.id }),
  };
  const uGrants = await db.roleGrant.count({ where: { userId: u.id } });
  const intact = sStaffGrants === (await db.roleGrant.count({ where: { userId: S.staff.id, schoolId: S.id, revokedAt: null } })) && oInstrGrants === (await db.roleGrant.count({ where: { userId: O.instructor.id, schoolId: O.id, revokedAt: null } }));
  ok('ST5 cross-tenant / wrong-role staff actions all refused, nothing changed', Object.values(attempts).every(is4xx) && uGrants === 0 && intact,
    Object.entries(attempts).map(([n, r]) => `${n}: ${r.status}`).join('; ') + `; grants created ${uGrants}; existing grants intact ${intact}`);
}

// ================================================================ INSTRUCTORS
// IN1–IN4. A coach who teaches an upcoming class; private details; self-edit; revoke refused.
{
  const c2 = await mkUser('teach');
  const g2 = await mkGrant(c2.id, 'INSTRUCTOR', b0);
  const prof = await db.instructor.create({ data: { id: randomUUID(), userId: c2.id, schoolId: S.id, branchId: b0, address: '1 Secret St', addressLine1: '1 Secret St', certificationKey: `cert/${RUN}.pdf` } });
  const c2Tok = token(c2, [grant('INSTRUCTOR', S.id, b0)]);
  const cls = await mkClass(20, { instructorId: c2.id });

  const view = async (tok) => (await call('IN1:instructor-detail', 'GET', `/instructors/${prof.id}`, tok)).body ?? {};
  const [asOwner, asSelf, asStaff, asColleague] = [await view(S.owner.tok), await view(c2Tok), await view(S.staff.tok), await view(S.instructor.tok)];
  const priv = (b) => b.addressLine1 ?? null;
  ok('IN1 instructor address/certification shown only to the owner and the instructor', priv(asOwner) === '1 Secret St' && priv(asSelf) === '1 Secret St' && asStaff.id === prof.id && priv(asStaff) === null && asStaff.certificationKey === null && asColleague.id === prof.id && priv(asColleague) === null,
    `owner ${priv(asOwner)}, self ${priv(asSelf)}, Branch Staff ${priv(asStaff)}/${asStaff.certificationKey}, colleague ${priv(asColleague)}/${asColleague.certificationKey}`);

  const castProf = await db.instructor.findFirst({ where: { userId: S.instructor.id, schoolId: S.id } });
  const self = await call('IN2:self-edit', 'PATCH', '/instructors/me/profile', c2Tok, { bio: `Bio ${RUN}`, phone: '+442071838750' });
  const other = await call('IN2:edit-other', 'PATCH', `/instructors/${castProf.id}`, c2Tok, { bio: 'hijacked' });
  const after = await db.instructor.findUnique({ where: { id: prof.id } });
  const castAfter = await db.instructor.findUnique({ where: { id: castProf.id } });
  ok('IN2 instructor edits own bio/phone; editing a colleague is refused', self.status === 200 && after.bio === `Bio ${RUN}` && after.phone === '+442071838750' && is4xx(other) && castAfter.bio !== 'hijacked',
    `self PATCH ${self.status}${self.status !== 200 ? ' ' + JSON.stringify(self.body?.error?.message) : ''}; colleague PATCH ${other.status}`);

  const rv = await Promise.all(Array.from({ length: 5 }, () => call('IN3:revoke-teaching', 'DELETE', `/users/${c2.id}/role-grants/${g2.id}`, S.owner.tok)));
  const still = await db.roleGrant.findUnique({ where: { id: g2.id } });
  ok('IN3 revoking an Instructor role while they teach an upcoming class is refused (409), 5 parallel', rv.every((r) => r.status === 409) && still.revokedAt === null, `codes ${JSON.stringify(codes(rv))}; grant revoked ${!!still.revokedAt}`);

  // Decision 361's Remove from School ends every Instructor role; Decision 331 item 4
  // refuses revoking one that leaves classes without an instructor. Neither decision
  // says which wins on this path, so this is recorded, not judged.
  const rm = await call('IN4:remove-teaching', 'POST', `/schools/${S.id}/staff/${c2.id}/remove`, S.owner.tok);
  const g2After = await db.roleGrant.findUnique({ where: { id: g2.id } });
  const orphan = await db.class.findUnique({ where: { id: cls }, select: { instructorId: true, archivedAt: true } });
  ok('IN4 INFO: "Remove from School" of a coach who still teaches an upcoming class', true,
    `INFO: POST remove → ${rm.status} ${JSON.stringify(rm.body)}; Instructor grant revoked ${!!g2After.revokedAt}; the class (starts in ~${Math.round((Date.now() - now) / 3600e3) + 2}h) still has instructorId=${orphan.instructorId === c2.id ? 'the removed coach' : orphan.instructorId}`);
}

// IN5. Resend passcode: throttle (20/h per owner), refusals.
{
  const owner2 = await mkOwner('owner2');
  const add = await call('IN5:add-instructor', 'POST', `/schools/${S.id}/instructors/add-manually`, owner2.tok, { firstName: 'Resend', surname: RUN, email: `ss-resend-${RUN}@stress.test`, branchId: b0 });
  if (add.status !== 201) throw new Error('add-manually instructor ' + JSON.stringify(add.body));
  const hash0 = (await db.user.findFirst({ where: { email: `ss-resend-${RUN}@stress.test` } })).passcodeHash;
  const rs = await Promise.all(Array.from({ length: 25 }, () => call('IN5:resend-x25', 'POST', `/instructors/${add.body.id}/resend-passcode`, owner2.tok)));
  const hash1 = (await db.user.findFirst({ where: { email: `ss-resend-${RUN}@stress.test` } })).passcodeHash;
  const c = codes(rs);
  ok('IN5 resend-passcode: 25 parallel from one owner → at most 20 succeed, the rest 429, passcode replaced', (c[200] ?? 0) <= 20 && (c[200] ?? 0) >= 1 && (c[429] ?? 0) >= 5 && no5xx(rs) && hash1 !== hash0, `codes ${JSON.stringify(c)}; passcode changed ${hash1 !== hash0}`);
  const castProf = await db.instructor.findFirst({ where: { userId: S.instructor.id, schoolId: S.id } });
  const oProf = await db.instructor.findFirst({ where: { userId: O.instructor.id, schoolId: O.id } });
  const r1 = await call('IN5:resend-refused', 'POST', `/instructors/${castProf.id}/resend-passcode`, S.owner.tok);
  const r2 = await call('IN5:resend-refused', 'POST', `/instructors/${add.body.id}/resend-passcode`, S.staff.tok);
  const r3 = await call('IN5:resend-refused', 'POST', `/instructors/${add.body.id}/resend-passcode`, otherOwner.tok);
  const r4 = await call('IN5:resend-refused', 'POST', `/instructors/${oProf.id}/resend-passcode`, S.owner.tok);
  ok('IN5b resend refused: own passcode already chosen (409), Branch Staff, other School\'s owner, other School\'s instructor', r1.status === 409 && [r2, r3, r4].every(is4xx),
    `chosen-passcode ${r1.status}; Branch Staff ${r2.status}; O owner ${r3.status}; O instructor ${r4.status}`);
}

// ================================================================ STUDENTS
// SA1–SA4. Add manually: double click, under 18, existing email, foreign branch, wrong role, throttle.
{
  const owner3 = await mkOwner('owner3');
  const email = `ss-add-${RUN}@stress.test`;
  const body = { firstName: 'Added', surname: RUN, email, dateOfBirth: '1995-03-04', branchId: b0 };
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('SA1:add-x10', 'POST', `/schools/${S.id}/students/add-manually`, owner3.tok, body)));
  const users = await db.user.findMany({ where: { email }, select: { id: true } });
  const grants = users.length ? await db.roleGrant.count({ where: { userId: users[0].id, schoolId: S.id, role: 'STUDENT', revokedAt: null } }) : 0;
  ok('SA1 add-manually double click (10 parallel): one account, one enrolment, no 5xx', users.length === 1 && grants === 1 && rs.filter((r) => r.status === 201).length === 1 && no5xx(rs), `accounts ${users.length}; enrolments ${grants}; codes ${JSON.stringify(codes(rs))}`);

  const kid = await call('SA2:add-refused', 'POST', `/schools/${S.id}/students/add-manually`, owner3.tok, { ...body, email: `ss-kid-${RUN}@stress.test`, dateOfBirth: '2014-06-01' });
  const castEmail = (await db.user.findUnique({ where: { id: live[0].id } })).email;
  const dup = await call('SA2:add-refused', 'POST', `/schools/${S.id}/students/add-manually`, owner3.tok, { ...body, email: castEmail });
  const foreign = await call('SA2:add-refused', 'POST', `/schools/${S.id}/students/add-manually`, owner3.tok, { ...body, email: `ss-foreign-${RUN}@stress.test`, branchId: O.branches[0] });
  const leftovers = await db.user.count({ where: { email: { in: [`ss-kid-${RUN}@stress.test`, `ss-foreign-${RUN}@stress.test`] } } });
  ok('SA2 add-manually refuses under-18 (400), an existing email (409), another School\'s branch (400), leaving no account behind', kid.status === 400 && dup.status === 409 && foreign.status === 400 && leftovers === 0,
    `under-18 ${kid.status}; existing email ${dup.status}; foreign branch ${foreign.status}; stray accounts ${leftovers}`);

  const wrong = {
    'Branch Staff': await call('SA3:add-wrong-role', 'POST', `/schools/${S.id}/students/add-manually`, S.staff.tok, { ...body, email: `ss-w1-${RUN}@stress.test` }),
    Instructor: await call('SA3:add-wrong-role', 'POST', `/schools/${S.id}/students/add-manually`, S.instructor.tok, { ...body, email: `ss-w2-${RUN}@stress.test` }),
    Student: await call('SA3:add-wrong-role', 'POST', `/schools/${S.id}/students/add-manually`, live[1].tok, { ...body, email: `ss-w3-${RUN}@stress.test` }),
    'other School owner': await call('SA3:add-wrong-role', 'POST', `/schools/${S.id}/students/add-manually`, otherOwner.tok, { ...body, email: `ss-w4-${RUN}@stress.test` }),
  };
  const strays = await db.user.count({ where: { email: { startsWith: 'ss-w', endsWith: `-${RUN}@stress.test` } } });
  ok('SA3 add-manually: only the School owner (Branch Staff, Instructor, Student, other owner refused)', Object.values(wrong).every((r) => r.status === 403 || r.status === 404) && strays === 0,
    Object.entries(wrong).map(([n, r]) => `${n} ${r.status}`).join('; ') + `; accounts created ${strays}`);

  const owner4 = await mkOwner('owner4');
  const tb0 = performance.now();
  // While the burst runs, a student keeps reading a cheap endpoint: does the API stay responsive?
  let bursting = true;
  const probe = (async () => { const out = []; while (bursting) { const t0 = performance.now(); const r = await call('SA4:probe-during-burst', 'GET', `/schools/${S.id}`, live[2].tok); out.push([performance.now() - t0, r.status]); await new Promise((z) => setTimeout(z, 100)); } return out; })();
  const tr = await Promise.all(Array.from({ length: 25 }, (_, i) => call('SA4:add-throttle', 'POST', `/schools/${S.id}/students/add-manually`, owner4.tok, { ...body, email: `ss-thr${i}-${RUN}@stress.test` })));
  const tb1 = performance.now(); bursting = false;
  const probes = await probe;
  const base = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); await call('SA4:probe-idle', 'GET', `/schools/${S.id}`, live[2].tok); base.push(performance.now() - t0); }
  ok('SA4b INFO: responsiveness of other requests during a 25-request Add manually burst', true,
    `INFO: a student's GET /schools/:id took max ${Math.max(...probes.map((p) => p[0])) | 0}ms (${probes.length} probes, codes ${JSON.stringify(codes(probes.map((p) => ({ status: p[1] }))))}) during the burst vs max ${Math.max(...base) | 0}ms idle; burst wall time ${(tb1 - tb0) | 0}ms`);
  const made = await db.user.count({ where: { email: { startsWith: 'ss-thr', endsWith: `-${RUN}@stress.test` } } });
  const c = codes(tr);
  ok('SA4 add-manually throttle: 25 at once from one owner → at most 20 succeed, the rest 429, no 5xx', made <= 20 && (c[429] ?? 0) >= 5 && no5xx(tr), `codes ${JSON.stringify(c)}; accounts ${made}`);
  const orphans = await db.user.findMany({ where: { email: { startsWith: 'ss-thr', endsWith: `-${RUN}@stress.test` }, roleGrants: { none: { schoolId: S.id, role: 'STUDENT', revokedAt: null } } }, select: { email: true, mustChangePasscode: true } });
  const retry = orphans.length ? await call('SA5:retry-orphan', 'POST', `/schools/${S.id}/students/add-manually`, owner3.tok, { ...body, email: orphans[0].email }) : null;
  ok('SA5 a failed Add manually leaves no account without an enrolment', orphans.length === 0,
    `${orphans.length} account(s) created but not enrolled (${made} accounts vs ${c[201] ?? 0} successes)${retry ? `; retrying the same email → ${retry.status} ${retry.body?.error?.message ?? ''}` : ''}`);
}

// SR1–SR6. Revoke a student with 3 upcoming bookings + a waitlist place while others book.
{
  const [t1] = take('pack');
  const [t2] = take('sub');
  const fillers = take('sub', 14);
  const racers = take('sub', 30);
  const waiter = take('sub')[0];
  // After the billing script, T1 may hold more than one pack; the bookings
  // can take credits from any of them, so the checks below use the total.
  const { count: t1Packs } = await db.membership.updateMany({ where: { studentId: t1.id, schoolId: S.id }, data: { classesRemaining: 5 } });
  const packTotal = async () => (await db.membership.findMany({ where: { studentId: t1.id, schoolId: S.id, classesRemaining: { not: null } }, select: { classesRemaining: true } })).reduce((n, m) => n + m.classesRemaining, 0);
  const cap = 5;
  const classes = [await mkClass(cap), await mkClass(cap), await mkClass(cap)];
  const wl = await mkClass(2);
  const book = (cls, st, label = 'SR:setup-book') => call(label, 'POST', `/classes/${cls}/book`, st.tok, {});
  const t1Books = [];
  for (const [i, cls] of classes.entries()) {
    t1Books.push(await book(cls, t1));
    for (const f of fillers.slice(i * 4, i * 4 + 4)) await book(cls, f);
  }
  await book(wl, fillers[12]); await book(wl, fillers[13]);
  const wlJoin = await call('SR:setup-waitlist', 'POST', `/classes/${wl}/waitlist`, t1.tok, {});
  await call('SR:setup-waitlist', 'POST', `/classes/${wl}/waitlist`, waiter.tok, {});
  const full = await Promise.all(classes.map((c) => db.booking.count({ where: { classId: c, status: 'UPCOMING' } })));
  const credits0 = await packTotal();
  // Bookings T1 already had (the load phase books everyone) are cancelled and refunded by the revoke too.
  const t1Earlier = await db.booking.count({ where: { studentId: t1.id, schoolId: S.id, status: 'UPCOMING', classId: { notIn: classes } } });
  if (t1Books.some((b) => b.status !== 201) || wlJoin.status !== 201 || full.some((n) => n !== cap)) throw new Error(`setup: t1 bookings ${t1Books.map((b) => b.status)} wl ${wlJoin.status} ${JSON.stringify(wlJoin.body)} full ${full}`);

  // T2: a Subscription paid through (fake) Stripe.
  let pa = await db.paymentAccount.findUnique({ where: { schoolId: S.id } });
  if (!pa) {
    const acct = await (await fetch(`${FAKE_STRIPE}/v1/accounts`, { method: 'POST' })).json();
    pa = await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: S.id, provider: 'STRIPE', accountTitle: 'SS fake Stripe', country: 'GB', stripeConnectedAccountId: acct.id } });
  }
  let subId = null;
  const t2m = await db.membership.findFirst({ where: { studentId: t2.id, schoolId: S.id, membershipPlan: { type: 'SUBSCRIPTION' } } });
  if (pa.stripeConnectedAccountId && t2m) {
    const sub = await (await fetch(`${FAKE_STRIPE}/v1/subscriptions`, { method: 'POST', headers: { 'stripe-account': pa.stripeConnectedAccountId, 'content-type': 'application/x-www-form-urlencoded' }, body: 'items[0][price]=price_ss' })).json();
    subId = sub.id;
    await db.membership.update({ where: { id: t2m.id }, data: { stripeSubscriptionId: subId, status: 'ACTIVE', cancelAt: null, expiryDate: null } });
  }

  // SR1. Leaving summary before the revoke.
  const ls1 = await call('SR1:leaving-summary', 'GET', `/schools/${S.id}/students/${t1.id}/leaving-summary`, S.owner.tok);
  const ls2 = await call('SR1:leaving-summary', 'GET', `/schools/${S.id}/students/${t2.id}/leaving-summary`, S.owner.tok);
  const lsStaff = await call('SR1:leaving-summary', 'GET', `/schools/${S.id}/students/${t1.id}/leaving-summary`, S.staff.tok);
  const lsOther = await call('SR1:leaving-summary', 'GET', `/schools/${S.id}/students/${t1.id}/leaving-summary`, otherOwner.tok);
  const dbUp = await db.booking.count({ where: { schoolId: S.id, studentId: t1.id, status: 'UPCOMING', class: { endDate: { gt: new Date() } } } });
  const dbWl = await db.waitlistEntry.count({ where: { schoolId: S.id, studentId: t1.id, status: { in: ['WAITING', 'NOTIFIED'] } } });
  const subRow = ls2.body?.memberships?.find((m) => m.type === 'SUBSCRIPTION');
  ok('SR1 leaving-summary matches the database (bookings, waitlist, renewing Subscription); owner only', ls1.status === 200 && ls1.body.upcomingBookings === dbUp && dbUp >= 3 && ls1.body.waitlistPlaces === dbWl && dbWl >= 1 && (!subId || subRow?.renews === true) && is4xx(lsStaff) && is4xx(lsOther),
    `T1 summary ${ls1.body?.upcomingBookings} bookings/${ls1.body?.waitlistPlaces} waitlist vs DB ${dbUp}/${dbWl}; T2 subscription renews ${subRow?.renews}; Branch Staff ${lsStaff.status}; O owner ${lsOther.status}`);

  // SR2. Revoke ×20 in parallel while 30 others race for the same classes.
  const g1 = await db.roleGrant.findFirst({ where: { userId: t1.id, schoolId: S.id, role: 'STUDENT', revokedAt: null } });
  const g2 = await db.roleGrant.findFirst({ where: { userId: t2.id, schoolId: S.id, role: 'STUDENT', revokedAt: null } });
  const callsBefore = subId ? (await (await fetch(`${FAKE_STRIPE}/__calls`)).json())[`POST /v1/subscriptions/${subId}`] ?? 0 : 0;
  const [revs, races, revs2] = await Promise.all([
    Promise.all(Array.from({ length: 20 }, () => call('SR2:revoke-x20', 'DELETE', `/users/${t1.id}/role-grants/${g1.id}`, S.owner.tok))),
    Promise.all(racers.map((r, i) => book(classes[i % 3], r, 'SR2:race-book'))),
    Promise.all(Array.from({ length: 5 }, () => call('SR2:revoke-sub-x5', 'DELETE', `/users/${t2.id}/role-grants/${g2.id}`, S.owner.tok))),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  const upcoming = await Promise.all(classes.map((c) => db.booking.count({ where: { classId: c, status: 'UPCOMING' } })));
  const t1Live = await db.booking.count({ where: { studentId: t1.id, classId: { in: classes }, status: 'UPCOMING' } });
  const t1Cancelled = await db.booking.findMany({ where: { studentId: t1.id, classId: { in: classes } }, select: { status: true, refundResolution: true } });
  const credits1 = await packTotal();
  const wlT1 = await db.waitlistEntry.findFirst({ where: { classId: wl, studentId: t1.id }, orderBy: { createdAt: 'desc' } });
  const wlWaiter = await db.waitlistEntry.findFirst({ where: { classId: wl, studentId: waiter.id }, orderBy: { createdAt: 'desc' } });
  const g1After = await db.roleGrant.findUnique({ where: { id: g1.id } });
  const won = races.filter((r) => r.status === 201).length;
  ok('SR2 revoke ×20 in parallel: no 5xx, grant revoked once, idempotent replies', no5xx(revs) && revs.every((r) => r.status === 200) && !!g1After.revokedAt, `revoke codes ${JSON.stringify(codes(revs))}`);
  ok('SR3 seats freed exactly once and never overbooked while 30 others book the same classes', upcoming.every((n) => n <= cap) && t1Live === 0 && won === 3 && t1Cancelled.every((b) => b.status === 'CANCELLED') && no5xx(races),
    `upcoming per class ${upcoming.join('/')} (cap ${cap}); racers booked ${won} (3 seats freed); race codes ${JSON.stringify(codes(races))}; T1 bookings ${t1Cancelled.map((b) => `${b.status}/${b.refundResolution}`).join(', ')}`);
  ok('SR4 credits come back once per cancelled booking (before the refund cut-off, Decision 343)', credits0 === 5 * t1Packs - 3 && credits1 === 5 * t1Packs + t1Earlier && t1Cancelled.every((b) => b.refundResolution === 'REFUNDED'),
    `pack credits (${t1Packs} pack${t1Packs === 1 ? '' : 's'} set to 5 each) ${credits0} after booking 3 → ${credits1} after revoke (want ${5 * t1Packs + t1Earlier}: 3 test bookings and ${t1Earlier} earlier ones back)`);
  ok('SR5 the waitlist place is removed; the next person keeps theirs', wlT1?.status === 'CANCELLED' && ['WAITING', 'NOTIFIED'].includes(wlWaiter?.status), `T1 entry ${wlT1?.status}; next person ${wlWaiter?.status}`);
  if (subId) {
    const m2 = await db.membership.findUnique({ where: { id: t2m.id } });
    const callsAfter = (await (await fetch(`${FAKE_STRIPE}/__calls`)).json())[`POST /v1/subscriptions/${subId}`] ?? 0;
    const g2After = await db.roleGrant.findUnique({ where: { id: g2.id } });
    ok('SR6 revoking a Subscription student (×5 parallel) stops it at period end, membership kept ACTIVE', !!g2After.revokedAt && !!m2.cancelAt && m2.status === 'ACTIVE' && no5xx(revs2) && callsAfter - callsBefore >= 1,
      `revoke codes ${JSON.stringify(codes(revs2))}; cancelAt ${m2.cancelAt?.toISOString()}; status ${m2.status}; Stripe update calls ${callsAfter - callsBefore}`);
  } else ok('SR6 INFO: Subscription stop not exercised', true, 'INFO: the School has a non-Stripe PaymentAccount or the student has no Subscription membership');

  // SR7. After the revoke: the student's own old token can't book here; roster shows them Inactive.
  const late = await book(classes[0], t1, 'SR7:revoked-books');
  const inactive = await call('SR7:roster-inactive', 'GET', `/schools/${S.id}/students?status=INACTIVE`, S.owner.tok);
  ok('SR7 a revoked student can no longer book; roster lists them Inactive', is4xx(late) && inactive.body?.items?.some((i) => i.id === t1.id && i.status === 'INACTIVE'), `book after revoke ${late.status}; in Inactive list ${inactive.body?.items?.some((i) => i.id === t1.id)}`);

  // SR8. Re-enrol, 10 parallel.
  const rj = await Promise.all(Array.from({ length: 10 }, () => call('SR8:re-enrol-x10', 'POST', `/schools/${S.id}/join`, S.owner.tok, { studentId: t1.id, branchId: b0 })));
  const act = await db.roleGrant.count({ where: { userId: t1.id, schoolId: S.id, role: 'STUDENT', revokedAt: null } });
  const hb = await db.studentHomeBranch.count({ where: { schoolId: S.id, studentId: t1.id } });
  const rjOther = await call('SR8:re-enrol-xt', 'POST', `/schools/${S.id}/join`, otherOwner.tok, { studentId: t2.id, branchId: b0 });
  const rjStaff = await call('SR8:re-enrol-xt', 'POST', `/schools/${S.id}/join`, S.staff.tok, { studentId: t2.id, branchId: b0 });
  ok('SR8 re-enrol after revoke: 10 parallel → one enrolment, one home branch, rest 409; non-owners refused', act === 1 && hb === 1 && rj.filter((r) => r.status === 201).length === 1 && no5xx(rj) && is4xx(rjOther) && rjStaff.status === 403,
    `codes ${JSON.stringify(codes(rj))}; active grants ${act}; home branches ${hb}; O owner ${rjOther.status}; Branch Staff ${rjStaff.status} ${rjStaff.body?.error?.message ?? ''}`);
  // Leave T2 enrolled again too, so later runs find the cast intact.
  await call('SR8:re-enrol-t2', 'POST', `/schools/${S.id}/join`, S.owner.tok, { studentId: t2.id, branchId: b0 });

  // SR9. Cross-tenant revoke of a student.
  const g2b = await db.roleGrant.findFirst({ where: { userId: t2.id, schoolId: S.id, role: 'STUDENT', revokedAt: null } });
  const xr = await call('SR9:xt-revoke', 'DELETE', `/users/${t2.id}/role-grants/${g2b.id}`, otherOwner.tok);
  const xs = await call('SR9:xt-revoke', 'DELETE', `/users/${t2.id}/role-grants/${g2b.id}`, S.staff.tok);
  const still = await db.roleGrant.findUnique({ where: { id: g2b.id } });
  ok('SR9 another School\'s owner and Branch Staff cannot revoke a student', is4xx(xr) && is4xx(xs) && !still.revokedAt, `O owner ${xr.status}; Branch Staff ${xs.status}; revoked ${!!still.revokedAt}`);
}

// RO1. Roster latency at ~450 students (owner, search, status=ALL, branch staff).
{
  const r1 = await pool(Array.from({ length: 30 }), 6, () => call('RO1:roster-owner', 'GET', `/schools/${S.id}/students`, S.owner.tok));
  const r2 = await pool(Array.from({ length: 20 }), 6, (_, i) => call('RO1:roster-search', 'GET', `/schools/${S.id}/students?search=${['s0', 'stress', 'Stress 1', 'zz-none'][i % 4]}`, S.owner.tok));
  const r3 = await pool(Array.from({ length: 10 }), 5, () => call('RO1:roster-all', 'GET', `/schools/${S.id}/students?status=ALL`, S.owner.tok));
  const r4 = await pool(Array.from({ length: 20 }), 6, () => call('RO1:roster-staff', 'GET', `/schools/${S.id}/students`, S.staff.tok));
  const n = r1[0].body?.items?.length;
  const noHit = r2[3].body?.items?.length;
  const all = [...r1, ...r2, ...r3, ...r4];
  const rows = report(['RO1:roster-owner', 'RO1:roster-search', 'RO1:roster-all', 'RO1:roster-staff']);
  ok('RO1 roster at scale: every call 200; search narrows', all.every((r) => r.status === 200) && n >= 400 && noHit === 0,
    `${n} active students; ` + rows.map((r) => `${r.label.slice(4)} p50 ${r.p50}ms p95 ${r.p95}ms`).join('; '));
}

// S1. Branch Staff see only their branch's students (Decision 341, S1).
{
  const r = await call('S1:roster-staff', 'GET', `/schools/${S.id}/students`, S.staff.tok);
  const ids = new Set((r.body?.items ?? []).map((i) => i.id));
  const foreign = (r.body?.items ?? []).filter((i) => i.homeBranchId !== b0);
  const missing = hbA.filter((x) => !ids.has(x.id)).length;
  const leakedB = hbB.filter((x) => ids.has(x.id)).length;
  const pA = await call('S1:profile', 'GET', `/schools/${S.id}/students/${hbA[0].id}/profile`, S.staff.tok);
  const pB = await call('S1:profile', 'GET', `/schools/${S.id}/students/${hbB[0].id}/profile`, S.staff.tok);
  const eB = await call('S1:profile-edit', 'PATCH', `/schools/${S.id}/students/${hbB[0].id}/profile`, S.staff.tok, { firstName: 'Hijack' });
  const ownerSees = (await call('S1:roster-owner', 'GET', `/schools/${S.id}/students`, S.owner.tok)).body?.items?.filter((i) => i.homeBranchId === bB.id).length;
  ok('S1 Branch Staff see and open only students whose home branch is theirs', r.status === 200 && foreign.length === 0 && missing === 0 && leakedB === 0 && pA.status === 200 && is4xx(pB) && is4xx(eB) && ownerSees >= 40,
    `staff roster ${ids.size} rows; rows from other/no branch ${foreign.length}; own-branch students missing ${missing}; Branch B students leaked ${leakedB}; profile own ${pA.status}, other branch ${pB.status}, edit other branch ${eB.status}; owner sees ${ownerSees} Branch B students`);
}

report();
save();
await db.$disconnect();
