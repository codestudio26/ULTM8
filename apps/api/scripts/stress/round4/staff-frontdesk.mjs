// Round 4, phase 3: the Staff build (owners, access switches, Pause, must accept
// first, activity log) and the front desk (tablet sessions, personal codes) at
// real School sizes. PASS/FAIL per check, staff-frontdesk-result.json.
// Uses Schools 300-339 (medium and large) and one very large School.
import { db, call, pool, cast, checks, codes, grant, tokenRca } from './common.mjs';
const { ok, save } = checks('staff-frontdesk');
const info = (id, detail) => ok(id, true, 'INFO ' + detail);
// OFFSET picks fresh Schools for a rerun (the checks change state).
const S = cast.schools.filter((s) => s.n >= 300 && s.n < 340 && s.size !== 'small' && s.coOwner).slice(+(process.env.OFFSET || 0));
const user = (id) => ({ id, email: `${id}@x` });
// What a real sign-in puts in the token: the user's roles-changed stamp, in ms (auth.service).
const stamp = async (id) => (await db.user.findUnique({ where: { id }, select: { rolesChangedAt: true } })).rolesChangedAt?.getTime() ?? 0;

// --- ST1 Pause, with the token a real sign-in gives (roles-changed stamp) ---
{
  const s = S[0];
  const staffGrant = await db.roleGrant.findFirst({ where: { userId: s.staff.id, schoolId: s.id, role: 'BRANCH_STAFF', revokedAt: null } });
  const rcaTok = tokenRca(user(s.staff.id), [grant('BRANCH_STAFF', s.id, staffGrant.branchId)], await stamp(s.staff.id));
  const before = await call('st1:before', 'GET', `/schools/${s.id}/students`, rcaTok);
  const ps = await Promise.all(Array.from({ length: 5 }, () => call('st1:pause-x5', 'POST', `/schools/${s.id}/staff/${s.staff.id}/pause`, s.owner.tok, {})));
  await new Promise((r) => setTimeout(r, 1500));
  const after = await call('st1:after-old-token', 'GET', `/schools/${s.id}/students`, rcaTok);
  // A freshly signed token that still claims the grant (as a stale refresh would): the server must check the database.
  const fresh = tokenRca(user(s.staff.id), [grant('BRANCH_STAFF', s.id, staffGrant.branchId)], await stamp(s.staff.id));
  const afterFresh = await call('st1:after-fresh-token', 'GET', `/schools/${s.id}/students`, fresh);
  const afterBook = await call('st1:after-book', 'POST', `/classes/${s.nowClasses[0]}/book`, fresh, { studentId: s.students[5].id });
  ok('ST1a Pause clicked 5 times at once pauses once', ps.filter((r) => r.status < 300).length >= 1 && (await db.roleGrant.count({ where: { userId: s.staff.id, schoolId: s.id, pausedAt: { not: null } } })) >= 1, JSON.stringify(codes(ps)));
  ok('ST1b a paused Branch Staff member is refused at once: their old token', before.status === 200 && after.status >= 400, `before ${before.status}, after ${after.status} ${JSON.stringify(after.body).slice(0, 120)}`);
  ok('ST1c ...and a token that still claims the role, on the roster and when booking for a student', afterFresh.status >= 400 && afterBook.status >= 400, `roster ${afterFresh.status}, book ${afterBook.status}`);
  const pauseOwner = await call('st1:pause-owner', 'POST', `/schools/${s.id}/staff/${s.owner.id}/pause`, s.coOwner.tok, {});
  const pauseSelf = await call('st1:pause-self', 'POST', `/schools/${s.id}/staff/${s.owner.id}/pause`, s.owner.tok, {});
  const byStaff = await call('st1:pause-by-staff', 'POST', `/schools/${s.id}/staff/${s.instructor.id}/pause`, s.staff.tok, {});
  ok('ST1d nobody can pause the main owner (co-owner, the owner themself), and staff cannot pause anyone', pauseOwner.status >= 400 && pauseSelf.status >= 400 && byStaff.status >= 400, `co-owner ${pauseOwner.status}, self ${pauseSelf.status}, staff ${byStaff.status}`);
  const un = await Promise.all(Array.from({ length: 5 }, () => call('st1:unpause-x5', 'POST', `/schools/${s.id}/staff/${s.staff.id}/unpause`, s.owner.tok, {})));
  const back = await call('st1:after-unpause', 'GET', `/schools/${s.id}/students`, tokenRca(user(s.staff.id), [grant('BRANCH_STAFF', s.id, staffGrant.branchId)], await stamp(s.staff.id)));
  ok('ST1e Unpause (5 at once) gives the access back', back.status === 200, `unpause ${JSON.stringify(codes(un))}, roster ${back.status}`);
}

// --- ST2 access switches take effect at once ---
{
  const s = S[1];
  const get = await call('st2:get-staff', 'GET', `/schools/${s.id}/staff`, s.owner.tok);
  const off = { classes: true, bookings: false, students: false, cancelClasses: false, staffList: false, inviteCoaches: false, disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false };
  const set = await call('st2:set-access', 'PUT', `/schools/${s.id}/staff/${s.staff.id}/access`, s.owner.tok, off);
  const sb = await db.roleGrant.findFirst({ where: { userId: s.staff.id, schoolId: s.id, role: 'BRANCH_STAFF' } });
  const t = tokenRca(user(s.staff.id), [grant('BRANCH_STAFF', s.id, sb.branchId)], await stamp(s.staff.id));
  const roster = await call('st2:roster-off', 'GET', `/schools/${s.id}/students`, t);
  const exp = await call('st2:export-off', 'GET', `/schools/${s.id}/students/export`, t);
  const staffList = await call('st2:staff-list-off', 'GET', `/schools/${s.id}/staff`, t);
  ok('ST2a with Students, Bookings, Export and Staff list off, Branch Staff are refused all four', set.status < 300 && roster.status === 403 && exp.status === 403 && staffList.status === 403, `set ${set.status} ${JSON.stringify(set.body).slice(0, 100)}; roster ${roster.status}, export ${exp.status}, staff list ${staffList.status}; staff list GET ${get.status}`);
  const otherSet = await call('st2:xt', 'PUT', `/schools/${s.id}/staff/${s.staff.id}/access`, S[2].owner.tok, { ...off, students: true });
  const selfSet = await call('st2:self', 'PUT', `/schools/${s.id}/staff/${s.staff.id}/access`, t, { ...off, students: true });
  ok('ST2b another School\'s owner, and the staff member themself, cannot change the switches', otherSet.status >= 400 && selfSet.status >= 400, `${otherSet.status}, ${selfSet.status}`);
  await call('st2:restore', 'PUT', `/schools/${s.id}/staff/${s.staff.id}/access`, s.owner.tok, Object.fromEntries(Object.keys(off).map((k) => [k, true])));
}

// --- ST3 activity log ---
{
  const s = S[0];
  const log = await call('st3:activity', 'GET', `/schools/${s.id}/staff/activity`, s.owner.tok);
  const items = log.body?.items ?? log.body?.entries ?? [];
  const kinds = items.map((i) => i.action ?? i.kind ?? i.type);
  info('ST3a activity log after the Pause checks', `${log.status}, ${items.length} entries: ${JSON.stringify(kinds.slice(0, 12))}`);
  const pauses = kinds.filter((k) => String(k).toUpperCase().includes('PAUSE') && !String(k).toUpperCase().includes('UNPAUSE')).length;
  ok('ST3b five Pause clicks at once are logged once', pauses <= 1, `${pauses} pause entries`);
  const xt = await call('st3:xt', 'GET', `/schools/${s.id}/staff/activity`, S[3].owner.tok);
  const st = await call('st3:staff', 'GET', `/schools/${s.id}/staff/activity`, s.staff.tok);
  const ins = await call('st3:instructor', 'GET', `/schools/${s.id}/staff/activity`, s.instructor.tok);
  ok('ST3c only this School\'s owners can read it', xt.status >= 400 && st.status >= 400 && ins.status >= 400, `other owner ${xt.status}, staff ${st.status}, coach ${ins.status}`);
}

// --- ST4 "must accept first" and the main owner ---
{
  const s = S[2];
  const bySt = await call('st4:setting-by-staff', 'PUT', `/schools/${s.id}/staff/settings`, s.staff.tok, { mustAcceptFirst: true });
  const byOwner = await Promise.all(Array.from({ length: 4 }, (_, i) => call('st4:setting-x4', 'PUT', `/schools/${s.id}/staff/settings`, i % 2 ? s.coOwner.tok : s.owner.tok, { mustAcceptFirst: i % 2 === 0 })));
  const got = await call('st4:get', 'GET', `/schools/${s.id}/staff/settings`, s.owner.tok);
  ok('ST4a staff cannot change "must accept first"; two owners flipping it at once leave a clear answer', bySt.status >= 400 && typeof got.body?.mustAcceptFirst === 'boolean', `staff ${bySt.status}; owners ${JSON.stringify(codes(byOwner))}; now ${got.body?.mustAcceptFirst}`);
  const hand = await call('st4:handover-no-stepup', 'POST', `/schools/${s.id}/main-owner`, s.owner.tok, { userId: s.coOwner.id });
  const handCo = await call('st4:handover-by-co', 'POST', `/schools/${s.id}/main-owner`, s.coOwner.tok, { userId: s.coOwner.id }, { 'x-step-up-token': 'forged' });
  ok('ST4b handing over the main owner needs the passcode again; a co-owner can\'t take it', hand.status >= 400 && handCo.status >= 400, `${hand.status}, ${handCo.status}`);
  const rmMain = await call('st4:remove-main', 'POST', `/schools/${s.id}/staff/${s.owner.id}/remove`, s.coOwner.tok, {});
  ok('ST4c a co-owner cannot remove the main owner', rmMain.status >= 400, `${rmMain.status}`);
}

// --- ST5 staff details: odd text, other Schools ---
{
  const s = S[3];
  const long = 'x'.repeat(5000);
  const r = await Promise.all([
    call('st5:details', 'PATCH', `/schools/${s.id}/staff/${s.instructor.id}/details`, s.owner.tok, { displayName: 'Coach 🥋 Ñúñez-O\'Brien', workPhone: '+5511987654321' }),
    call('st5:details-long', 'PATCH', `/schools/${s.id}/staff/${s.instructor.id}/details`, s.owner.tok, { displayName: long }),
    call('st5:details-xt', 'PATCH', `/schools/${s.id}/staff/${s.instructor.id}/details`, S[4].owner.tok, { displayName: 'hijack' }),
    call('st5:details-bad-phone', 'PATCH', `/schools/${s.id}/staff/${s.instructor.id}/details`, s.owner.tok, { workPhone: 'call me maybe' }),
  ]);
  ok('ST5 display name with emoji and accents saved; 5,000 characters, a bad phone and another School refused', r[0].status < 300 && r[1].status === 400 && r[2].status >= 400 && r[3].status === 400, r.map((x) => x.status).join(', '));
}

// --- ST6 the Staff list at a very large School (20 staff, 4,000 students) ---
{
  const s = cast.schools.find((x) => x.size === 'xlarge');
  const r = await Promise.all(Array.from({ length: 20 }, () => call('st6:staff-xlarge-x20', 'GET', `/schools/${s.id}/staff`, s.owner.tok)));
  info('ST6 Staff list at a very large School, 20 at once', `${JSON.stringify(codes(r))}, ${r[0].bytes} bytes`);
}

// --- FD1 personal check-in codes at a very large School: how easy is a lucky guess? ---
{
  const s = cast.schools.filter((x) => x.size === 'xlarge')[1];
  const studs = s.students.filter((st) => st.branch === s.branches[0]);
  const t0 = Date.now();
  const issued = await pool(studs, 32, (st) => call('fd1:issue-code', 'POST', `/schools/${s.id}/students/${st.id}/check-in-code`, s.owner.tok, {}));
  info('FD1a codes issued for every member at one Branch of a very large School', `${studs.length} members, ${JSON.stringify(codes(issued))}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const digits = (await db.school.findUnique({ where: { id: s.id }, select: { checkInCodeDigits: true } })).checkInCodeDigits;
  const n = await db.studentCheckInCode.count({ where: { schoolId: s.id } });
  const sess = await call('fd1:start-tablet', 'POST', `/schools/${s.id}/front-desk/sessions`, s.owner.tok, { branchId: s.branches[0] });
  const kt = sess.body?.sessionToken;
  let hits = 0, tried = 0, refused = 0;
  const seen = new Set();
  for (let i = 0; i < 15; i++) {
    let code; do { code = String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0'); } while (seen.has(code)); seen.add(code);
    const r = await call('fd1:guess', 'POST', '/front-desk/kiosk/code-lookups', kt, { code });
    tried++; if (r.status === 201 || r.status === 200) hits++; if (r.status === 429) refused++;
    if (i === 0 && r.status < 300) {
      const card = await call('fd1:card', 'GET', `/front-desk/kiosk/students/${r.body.student?.id ?? r.body.studentId}/card`, kt);
      info('FD1b what a lucky guess shows on the tablet', `card ${card.status}: ${JSON.stringify(card.body).slice(0, 300)}`);
    }
  }
  ok(`FD1c ${digits}-digit codes with ${n} members holding one: random guesses at a tablet rarely find a member`, hits / Math.max(1, tried - refused) < 0.05,
    `${hits} of ${tried - refused} random guesses matched a member (${(100 * n / 10 ** digits).toFixed(0)}% of all ${digits}-digit codes are taken); ${refused} refused by the 10-a-minute limit; wrong codes don't end the tablet session (only wrong staff codes do)`);
}

// --- FD2 Find me at scale: same name and birthday ---
{
  const s = cast.schools.find((x) => x.size === 'xlarge');
  const sess = await call('fd2:start-tablet', 'POST', `/schools/${s.id}/front-desk/sessions`, s.owner.tok, { branchId: s.branches[0] });
  const kt = sess.body?.sessionToken;
  const u = await db.user.findUnique({ where: { id: s.students[10].id } });
  const yes = await call('fd2:find-me', 'POST', '/front-desk/kiosk/find-me', kt, { fullName: `${u.firstName} ${u.surname}`, dateOfBirth: u.dateOfBirth.toISOString().slice(0, 10) });
  const rev = await call('fd2:find-me-reversed', 'POST', '/front-desk/kiosk/find-me', kt, { fullName: `${u.surname} ${u.firstName}`, dateOfBirth: u.dateOfBirth.toISOString().slice(0, 10) });
  const wrongDay = await call('fd2:find-me-bad-date', 'POST', '/front-desk/kiosk/find-me', kt, { fullName: `${u.firstName} ${u.surname}`, dateOfBirth: '2023-02-29' });
  ok('FD2 Find me: yes for a member (either name order), refuses 29 Feb 2023', yes.body?.alreadyMember === true && rev.body?.alreadyMember === true && wrongDay.status === 400, `${JSON.stringify(yes.body)}, ${JSON.stringify(rev.body)}, ${wrongDay.status}`);
}

save();
await db.$disconnect();
