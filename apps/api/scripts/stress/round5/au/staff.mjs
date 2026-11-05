// Round 5 AU: Staff lifecycle (Decisions 370, 387, 390, 396, 408) with real sign-ins.
//   CAST=../empty-cast.json node staff.mjs
import fs from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { db, call, grant, tokenRca, checks, codes, randomUUID } from '../../round4/common.mjs';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const bcrypt = require('bcrypt');
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const { ok, save } = checks('staff');
const info = (id, d) => ok(id, true, 'INFO ' + d);
const sid = A.schoolId;
const PASS = '246813';
const hash = await bcrypt.hash(PASS, 10);
const coach = (n) => A.coaches.find((c) => c.name === n);
// A second co-owner: an adult student who also helps run the gym.
const co2 = A.students.find((s) => s.tag === 'adult' && s.b === 'syd' && !A.memberships[s.id]) ?? A.students.find((s) => s.tag === 'adult');
const emails = {};
for (const id of [A.owner, A.coOwner, A.newStaff, co2.id, coach('Kirra').id]) {
  const u = await db.user.update({ where: { id }, data: { passcodeHash: hash, mustChangePasscode: false }, select: { email: true } });
  emails[id] = u.email;
}
const login = async (id) => {
  const r = await call('login', 'POST', '/auth/login', null, { email: emails[id], passcode: PASS });
  if (r.status >= 300) throw new Error('login ' + r.status + JSON.stringify(r.body));
  return r.body;
};
const L = await login(A.owner);
info('S0 login response shape (what the apps get)', `keys=${Object.keys(L).join(',')}`);
const owner = L.accessToken;
const coOwner = (await login(A.coOwner)).accessToken;

// --- S1 must accept first (Decision 396) ---
{
  const on = await call('s1', 'PUT', `/schools/${sid}/staff/settings`, owner, { mustAcceptFirst: true });
  const give = await call('s1', 'POST', `/users/${A.newStaff}/role-grants`, owner, { role: 'BRANCH_STAFF', schoolId: sid, branchId: A.branches.per });
  ok('S1a with "must accept first" on, giving Branch Staff is refused with STAFF_MUST_ACCEPT', on.status < 300 && give.status === 409 && JSON.stringify(give.body).includes('STAFF_MUST_ACCEPT'), `${on.status}; ${give.status} ${JSON.stringify(give.body).slice(0, 100)}`);
  const byCoach = await call('s1', 'POST', `/schools/${sid}/coach-invites`, tokenRca({ id: coach('Kirra').id, email: 'k' }, [grant('INSTRUCTOR', sid, A.branches.syd)]), { email: emails[A.newStaff], branchId: A.branches.per, role: 'BRANCH_STAFF' });
  ok('S1b a coach cannot send a Branch Staff invite', byCoach.status >= 400, `${byCoach.status}`);
  const inv = await call('s1', 'POST', `/schools/${sid}/coach-invites`, owner, { email: emails[A.newStaff], branchId: A.branches.per, role: 'BRANCH_STAFF' });
  ok('S1c owner sends the Branch Staff invite', inv.status < 300, `${inv.status} ${JSON.stringify(inv.body).slice(0, 160)}`);
  const dup = await call('s1', 'POST', `/schools/${sid}/coach-invites`, owner, { email: emails[A.newStaff], branchId: A.branches.per, role: 'BRANCH_STAFF' });
  info('S1d a second invite to the same email', `${dup.status} ${JSON.stringify(dup.body).slice(0, 120)}`);
  // The link is emailed; we put a known token on our own invite row.
  const token = 'r5au-' + randomUUID();
  await db.coachInvite.update({ where: { id: inv.body.id }, data: { tokenHash: createHash('sha256').update(token).digest('hex') } });
  const wrong = await call('s1', 'POST', `/coach-invite-links/${token}/accept`, coOwner, {});
  ok('S1e someone else (signed in with another email) cannot accept it', wrong.status >= 400, `${wrong.status} ${JSON.stringify(wrong.body).slice(0, 120)}`);
  const ns = (await login(A.newStaff)).accessToken;
  const acc = await Promise.all(Array.from({ length: 6 }, () => call('s1', 'POST', `/coach-invite-links/${token}/accept`, ns, {})));
  const gr = await db.roleGrant.count({ where: { userId: A.newStaff, schoolId: sid, role: 'BRANCH_STAFF', revokedAt: null } });
  ok('S1f accepting six times at once gives the role once', gr === 1, `${JSON.stringify(codes(acc))}, live grants ${gr}`);
  // Co-owner given at once (Decision 396 unresolved: co-owners not covered).
  const co = await call('s1', 'POST', `/users/${co2.id}/role-grants`, owner, { role: 'SCHOOL_OWNER_MANAGER', schoolId: sid });
  info('S1g giving co-owner with the setting on (Decision 396 [UNRESOLVED])', `${co.status}`);
  await call('s1', 'PUT', `/schools/${sid}/staff/settings`, owner, { mustAcceptFirst: false });
}

// --- S2 Pause a coach (Decision 390) ---
{
  const k = coach('Kirra');
  const kTok = (await login(k.id)).accessToken;
  const before = await call('s2', 'GET', `/classes/${A.classes.nowSyd2}/bookings`, kTok);
  const p = await Promise.all([call('s2', 'POST', `/schools/${sid}/staff/${k.id}/pause`, owner, {}), call('s2', 'POST', `/schools/${sid}/staff/${k.id}/pause`, coOwner, {})]);
  const after = await call('s2', 'GET', `/classes/${A.classes.nowSyd2}/bookings`, kTok);
  ok('S2a owner and co-owner pausing a coach at once: paused once; her signed-in token loses the roll call', p.filter((r) => r.status < 300).length === 1 && before.status === 200 && after.status >= 400, `pause ${p.map((r) => r.status)}; roll call before ${before.status} after ${after.status}`);
  const cls = await db.class.findUnique({ where: { id: A.classes.nowSyd2 }, select: { instructorId: true } });
  ok('S2b a paused coach is still the coach on her classes', cls.instructorId === k.id, '');
  const assign = await call('s2', 'POST', `/schools/${sid}/classes`, owner, { branchId: A.branches.syd, instructorId: k.id, title: 'Assign paused', styles: [{ disciplineId: A.box, classType: null }], startDate: new Date(Date.now() + 3 * 86400e3).toISOString(), endDate: new Date(Date.now() + 3 * 86400e3 + 3600e3).toISOString(), capacity: 10 });
  info('S2c owner puts a paused coach on a new class', `${assign.status} ${JSON.stringify(assign.body).slice(0, 140)}`);
  const stu = A.students.find((s) => s.b === 'syd' && s.tag === 'adult' && A.memberships[s.id]);
  const book = await call('s2', 'POST', `/classes/${A.classes.tomorrow}/book`, tokenRca({ id: stu.id, email: 's' }, [grant('STUDENT', sid, A.branches.syd)]), {});
  info('S2d students still book while a coach is paused', `${book.status}`);
  const give = await call('s2', 'POST', `/users/${k.id}/role-grants`, owner, { role: 'INSTRUCTOR', schoolId: sid, branchId: A.branches.per });
  ok('S2e a paused coach cannot be given another coach role (STAFF_PAUSED)', give.status === 409, `${give.status} ${JSON.stringify(give.body).slice(0, 120)}`);
  const list = await call('s2', 'GET', `/schools/${sid}/staff`, owner);
  const row = (list.body?.items ?? list.body?.staff ?? []).find((r) => (r.userId ?? r.id) === k.id);
  info('S2f the Staff list row for the paused coach', JSON.stringify(row ?? list.body).slice(0, 300));
  const un = await call('s2', 'POST', `/schools/${sid}/staff/${k.id}/unpause`, owner, {});
  const back = await call('s2', 'GET', `/classes/${A.classes.nowSyd2}/bookings`, kTok);
  ok('S2g unpause gives the roll call back to the same signed-in token? (rca stamp moved, so a re-sign-in is expected)', un.status < 300, `unpause ${un.status}; old token now ${back.status}`);
  const kTok2 = (await login(k.id)).accessToken;
  const back2 = await call('s2', 'GET', `/classes/${A.classes.nowSyd2}/bookings`, kTok2);
  ok('S2h after unpause, a fresh sign-in has the roll call again', back2.status === 200, `${back2.status}`);
  const pOwner = await call('s2', 'POST', `/schools/${sid}/staff/${A.coOwner}/pause`, owner, {});
  ok('S2i a co-owner cannot be paused (Decision 390 item 4)', pOwner.status >= 400, `${pOwner.status} ${JSON.stringify(pOwner.body).slice(0, 120)}`);
}

// --- S3 access switches for Perth Branch Staff (Decision 387) ---
{
  const pete = tokenRca({ id: A.staffPer, email: 'p' }, [grant('BRANCH_STAFF', sid, A.branches.per)]);
  const stamp = async () => (await db.user.findUnique({ where: { id: A.staffPer }, select: { rolesChangedAt: true } })).rolesChangedAt?.getTime() ?? Date.now();
  const all = { classes: false, bookings: false, students: false, cancelClasses: false, staffList: false, inviteCoaches: false, disciplines: false };
  const set = await call('s3', 'PUT', `/schools/${sid}/staff/${A.staffPer}/access`, owner, all);
  const t = tokenRca({ id: A.staffPer, email: 'p' }, [grant('BRANCH_STAFF', sid, A.branches.per)], await stamp());
  const perStud = A.students.find((s) => s.b === 'per' && s.tag === 'adult' && A.memberships[s.id]);
  const r = await Promise.all([
    call('s3', 'GET', `/classes/${A.classes.nowPer}/bookings`, t),
    call('s3', 'POST', `/classes/${A.classes.nowPer}/attendance-scan`, t, { studentId: perStud.id }),
    call('s3', 'GET', `/classes/${A.classes.nowPer}/qr-token`, t),
    call('s3', 'GET', `/schools/${sid}/students`, t),
  ]);
  info('S3a with every switch off, Perth Branch Staff: roll call / scan / QR / roster', `set ${set.status} ${JSON.stringify(set.body).slice(0, 80)}; ${r.map((x) => x.status + ' ' + (x.body?.error?.code ?? '')).join(' | ')}`);
  ok('S3b ...scan, QR and roster are refused', r[1].status === 403 && r[2].status === 403 && r[3].status === 403, r.map((x) => x.status).join(','));
  const dylan = tokenRca({ id: coach('Dylan').id, email: 'd' }, [grant('INSTRUCTOR', sid, A.branches.per)]);
  const dy = await call('s3', 'GET', `/classes/${A.classes.nowPer}/bookings`, dylan);
  ok('S3c a coach at the same Branch is not affected by a Branch Staff member\'s switches', dy.status === 200, `${dy.status}`);
  await call('s3', 'PUT', `/schools/${sid}/staff/${A.staffPer}/access`, owner, { ...all, bookings: true, students: true, cancelClasses: true });
  void pete;
}

// --- S4 owners (Decision 370) and the "sole owner lost access" edges ---
{
  const ownerGrant = await db.roleGrant.findFirst({ where: { userId: A.owner, schoolId: sid, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null } });
  const self = await call('s4', 'DELETE', `/users/${A.owner}/role-grants/${ownerGrant.id}`, owner);
  const byCo = await call('s4', 'DELETE', `/users/${A.owner}/role-grants/${ownerGrant.id}`, coOwner);
  ok('S4a the main owner cannot remove themself, and a co-owner cannot remove the main owner (MAIN_OWNER)', self.status === 403 && byCo.status === 403, `${self.status} ${self.body?.error?.code}; ${byCo.status} ${byCo.body?.error?.code}`);
  const noStep = await call('s4', 'POST', `/schools/${sid}/main-owner`, owner, { userId: A.coOwner });
  ok('S4b hand-over without the passcode check is refused', noStep.status === 403, `${noStep.status} ${noStep.body?.error?.code}`);
  const su = await call('s4', 'POST', '/auth/step-up/verify', owner, { passcode: PASS });
  const coStep = await call('s4', 'POST', '/auth/step-up/verify', coOwner, { passcode: PASS });
  const stolen = await call('s4', 'POST', `/schools/${sid}/main-owner`, coOwner, { userId: A.coOwner }, { 'x-step-up-token': su.body?.stepUpToken });
  ok('S4c the owner\'s step-up token is useless to the co-owner', stolen.status === 403, `${stolen.status} ${stolen.body?.error?.code}`);
  const coTry = await call('s4', 'POST', `/schools/${sid}/main-owner`, coOwner, { userId: A.coOwner }, { 'x-step-up-token': coStep.body?.stepUpToken });
  ok('S4d a co-owner with their own passcode check still cannot take the main owner role', coTry.status === 403, `${coTry.status} ${coTry.body?.error?.code}`);
  // Two hand-overs at once to two different co-owners.
  const h = await Promise.all([
    call('s4', 'POST', `/schools/${sid}/main-owner`, owner, { userId: A.coOwner }, { 'x-step-up-token': su.body?.stepUpToken }),
    call('s4', 'POST', `/schools/${sid}/main-owner`, owner, { userId: co2.id }, { 'x-step-up-token': su.body?.stepUpToken }),
  ]);
  const mains = await db.roleGrant.findMany({ where: { schoolId: sid, isMainOwner: true, revokedAt: null }, select: { userId: true } });
  ok('S4e two hand-overs at once leave exactly one main owner', mains.length === 1, `${h.map((r) => r.status + ' ' + (r.body?.error?.code ?? '')).join(' | ')}; mains ${JSON.stringify(mains)}`);
  info('S4f the same step-up token worked for more than one action', `${h.filter((r) => r.status < 300).length} hand-overs succeeded with one passcode entry`);
  // The new main owner hands it back (needs their own step-up).
  const newMain = mains[0]?.userId;
  if (newMain) {
    const nm = newMain === A.coOwner ? coOwner : (await login(newMain)).accessToken;
    const s2 = await call('s4', 'POST', '/auth/step-up/verify', nm, { passcode: PASS });
    const back = await call('s4', 'POST', `/schools/${sid}/main-owner`, nm, { userId: A.owner }, { 'x-step-up-token': s2.body?.stepUpToken });
    ok('S4g the new main owner hands it back to Jack', back.status < 300, `${back.status}`);
  }
  // Co-owner 2 leaves on their own; a co-owner removing themself.
  const g2 = await db.roleGrant.findFirst({ where: { userId: co2.id, schoolId: sid, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null } });
  const co2Tok = (await login(co2.id)).accessToken;
  const leave = g2 ? await call('s4', 'DELETE', `/users/${co2.id}/role-grants/${g2.id}`, co2Tok) : { status: 'none' };
  ok('S4h a co-owner can remove themself', leave.status === 200 || leave.status === 204, `${leave.status}`);
}

// --- S5 activity log (Decision 408) ---
{
  const log = await call('s5', 'GET', `/schools/${sid}/staff/activity`, owner);
  const items = log.body?.items ?? [];
  const kinds = items.map((i) => i.action);
  const count = (k) => kinds.filter((x) => x === k).length;
  info('S5a activity actions', `${log.status} ${items.length}: ${JSON.stringify(Object.fromEntries([...new Set(kinds)].map((k) => [k, count(k)])))}`);
  ok('S5b pause logged once despite two owners at once', count('PAUSED') + count('STAFF_PAUSED') <= 1, '');
  const k = await call('s5', 'GET', `/schools/${sid}/staff/activity?userId=${coach('Kirra').id}`, owner);
  const kItems = k.body?.items ?? [];
  ok('S5c filter by person shows only lines about or by that person', kItems.length > 0 && kItems.every((i) => i.targetUserId === coach('Kirra').id || i.actorId === coach('Kirra').id), `${k.status} ${kItems.length} ${JSON.stringify(kItems[0] ?? {}).slice(0, 200)}`);
  const ns = (await login(A.newStaff)).accessToken;
  const byStaff = await call('s5', 'GET', `/schools/${sid}/staff/activity`, ns);
  ok('S5d Branch Staff cannot read the log', byStaff.status === 403, `${byStaff.status}`);
}

save();
await db.$disconnect();
