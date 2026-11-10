// Round 7 S, attacks 3, 6, 2 (former people) and 1 (Franchise membership changes):
//   - the coach "Manage students" switch (#531, Decision 449 item 7);
//   - the CARD_PAYMENT_CONFIRMED School switch (#533, Decision 450 item 8);
//   - refusals for former members, removed staff, a Guardian of a former
//     student and a paused coach (Decision 449 item 6);
//   - the Franchise overview while Schools leave and join, a revoked
//     FRANCHISE_OWNER grant, and a closed Franchise.
// Changes the world (revokes, leaves), so it runs after overview.mjs and refusals.mjs.
import { call, must, signUp, signIn, stepUp, db, rec, refused, saveResults, loadWorld, saveWorld, refreshAll, sleep } from './lib.mjs';

const w = loadWorld();
await refreshAll(w);
for (const f of Object.values(w.franchises)) await signIn(f.owner);
for (const p of [w.extra.D.owner, w.extra.D.member, w.extra.stranger]) await signIn(p);
const A = w.schools.A, B = w.schools.B, C = w.schools.C, F1 = w.franchises.F1, F2 = w.franchises.F2;
const P = A.people;
const ghost = '00000000-0000-4000-8000-0000000000dd';
const sig = (r) => `${r.status} ${r.body?.error?.code ?? ''} ${(r.body?.error?.message ?? '').toString().slice(0, 110)}`;

// ---------------------------------------------------------------- coach switch
let AREA = 'coach-access';
const coachAccess = (tok, userId = P.coach.id, on = true, school = A.id) => call('PUT', `/schools/${school}/staff/${userId}/coach-access`, tok, { manageStudents: on });
const editProfile = (tok, studentId, body, school = A.id) => call('PATCH', `/schools/${school}/students/${studentId}/profile`, tok, body);
const staffRow = async (userId) => {
  const l = await must('staff list', 'GET', `/schools/${A.id}/staff`, P.owner.tok);
  return (l.items ?? l).find((x) => x.userId === userId);
};
rec(AREA, 'off by default (staff list shows manageStudents false)', (await staffRow(P.coach.id))?.coachAccess?.manageStudents === false, JSON.stringify((await staffRow(P.coach.id))?.coachAccess));
const before = await editProfile(P.coach.tok, P.adult1.id, { language: 'fr' });
rec(AREA, 'switch off: coach editing a b1 student → 403 NOT_FOR_COACHES', before.status === 403 && before.body?.error?.code === 'NOT_FOR_COACHES', sig(before));
// Who may set it.
for (const [who, p] of [['co-owner', P.coowner], ['Branch Staff', P.staff1], ['the coach himself', P.coach], ['member', P.adult1], ['parent', P.parent]]) {
  const r = await coachAccess(p.tok);
  rec(AREA, `${who} can't set it (403)`, r.status === 403, sig(r));
}
for (const [who, p] of [['F1 owner', F1.owner], ['C owner (stranger)', C.people.owner], ['stranger', w.extra.stranger]]) {
  const r = await coachAccess(p.tok);
  const g = await coachAccess(p.tok, P.coach.id, true, ghost);
  rec(AREA, `${who} can't set it, and the answer is the same as for a missing School`, r.status >= 400 && sig(r) === sig(g), `real: ${sig(r)} | missing: ${sig(g)}`);
}
rec(AREA, '…and nobody above turned it on', (await staffRow(P.coach.id))?.coachAccess?.manageStudents === false);
// Not a coach here.
for (const [who, id] of [['Branch Staff', P.staff1.id], ['a member', P.adult1.id], ['the co-owner', P.coowner.id], ["School C's coach", C.people.coach.id], ['a missing user', ghost]]) {
  const r = await coachAccess(P.owner.tok, id);
  rec(AREA, `main owner setting it on ${who} → refused`, r.status >= 400 && r.status < 500, sig(r));
}
const on = await coachAccess(P.owner.tok);
rec(AREA, 'main owner turns it on', on.status === 200, sig(on));
const okEdit = await editProfile(P.coach.tok, P.adult1.id, { language: 'fr' });
rec(AREA, 'coach edits a student of his own Branch (b1)', okEdit.status === 200, sig(okEdit));
const childEdit = await editProfile(P.coach.tok, A.childId, { language: 'fr' });
rec(AREA, 'coach edits a child at b1 (note)', null, sig(childEdit));
const b2Edit = await editProfile(P.coach.tok, P.adult2.id, { language: 'fr' });
rec(AREA, 'coach can NOT edit a student of another Branch (b2)', b2Edit.status === 403 || b2Edit.status === 404, sig(b2Edit));
const noHome = await editProfile(P.coach.tok, P.noHome.id, { language: 'fr' });
rec(AREA, 'coach can NOT edit a student with no home Branch', noHome.status === 403 || noHome.status === 404, sig(noHome));
const otherSchool = await editProfile(P.coach.tok, C.people.adult1.id, { language: 'fr' });
rec(AREA, "coach can NOT edit School C's student via School A's path", otherSchool.status === 403 || otherSchool.status === 404, sig(otherSchool));
const otherPath = await editProfile(P.coach.tok, C.people.adult1.id, { language: 'fr' }, C.id);
rec(AREA, "coach can NOT edit School C's student via C's path", otherPath.status === 404, sig(otherPath));
const ownerAsStudent = await editProfile(P.coach.tok, P.staff1.id, { language: 'fr' });
rec(AREA, 'coach can NOT edit a staff member (not a student) via the student path', ownerAsStudent.status >= 400, sig(ownerAsStudent));
const dobChild = await editProfile(P.coach.tok, P.adult1.id, { dateOfBirth: '2015-01-01' });
rec(AREA, 'coach can NOT change a birth date making an adult a child (owner only)', dobChild.status === 403, sig(dobChild));
const dobAdult = await editProfile(P.coach.tok, P.adult1.id, { dateOfBirth: '1990-05-06' });
rec(AREA, 'coach changing an adult birth date within adulthood (Decision 342 lets staff) — note', null, sig(dobAdult));
const dobKid = await editProfile(P.coach.tok, A.childId, { dateOfBirth: '2000-01-01' });
rec(AREA, 'coach can NOT make a child an adult', dobKid.status === 403, sig(dobKid));
const join = await editProfile(P.coach.tok, P.adult1.id, { joinedOn: '2020-01-01' });
rec(AREA, 'coach changing the join date — note', null, sig(join));
const mass = await editProfile(P.coach.tok, P.adult1.id, { email: 'taken.over@r7s.test', phone: '+447700900999', passcode: '111111', role: 'SCHOOL_OWNER_MANAGER', isMainOwner: true });
rec(AREA, "coach can't change sign-in details or roles through the profile", mass.status === 400 || (mass.status === 200 && mass.body?.email !== 'taken.over@r7s.test'), sig(mass));
const u = await db.user.findUnique({ where: { id: P.adult1.id }, select: { email: true, phone: true } });
rec(AREA, "…the member's email/phone unchanged", u.email === P.adult1.email && u.phone === P.adult1.phone, JSON.stringify(u));
// Paused: refused; unpaused: switch back on (by design).
await must('pause coach', 'POST', `/schools/${A.id}/staff/${P.coach.id}/pause`, P.owner.tok, {});
await signIn(P.coach);
const paused = await editProfile(P.coach.tok, P.adult1.id, { language: 'de' });
rec(AREA, 'paused coach → 403 ACCESS_PAUSED', paused.status === 403 && paused.body?.error?.code === 'ACCESS_PAUSED', sig(paused));
await must('unpause coach', 'POST', `/schools/${A.id}/staff/${P.coach.id}/unpause`, P.owner.tok, {});
await signIn(P.coach);
const back = await editProfile(P.coach.tok, P.adult1.id, { language: 'de' });
rec(AREA, 'unpaused: switch applies again (Decision 449 item 7 code comment)', back.status === 200, sig(back));
// Turned off: his current token loses it at once.
const tokBefore = P.coach.tok;
await must('switch off', 'PUT', `/schools/${A.id}/staff/${P.coach.id}/coach-access`, P.owner.tok, { manageStudents: false });
const offEdit = await editProfile(tokBefore, P.adult1.id, { language: 'it' });
rec(AREA, 'switched off: the same token is refused at once', offEdit.status === 403 || offEdit.status === 401, sig(offEdit));
// Role ends → switch resets.
await must('switch on again', 'PUT', `/schools/${A.id}/staff/${P.coach.id}/coach-access`, P.owner.tok, { manageStudents: true });
const grants = await db.roleGrant.findMany({ where: { userId: P.coach.id, schoolId: A.id, role: 'INSTRUCTOR', revokedAt: null } });
for (const g of grants) await must('remove coach role', 'DELETE', `/users/${P.coach.id}/role-grants/${g.id}`, P.owner.tok);
const perm = await db.staffPermission.findUnique({ where: { schoolId_userId: { schoolId: A.id, userId: P.coach.id } }, select: { canManageStudentsAsCoach: true } });
rec(AREA, 'coach role removed → switch back to off', perm?.canManageStudentsAsCoach === false, JSON.stringify(perm));
await signIn(P.coach);
const exCoach = await editProfile(P.coach.tok, P.adult1.id, { language: 'it' });
rec(AREA, 'former coach → 403 NO_PERMISSION (connected, not a stranger)', exCoach.status === 403, sig(exCoach));
await must('coach again', 'POST', `/users/${P.coach.id}/role-grants`, P.owner.tok, { role: 'INSTRUCTOR', schoolId: A.id, branchId: A.b1 });
await signIn(P.coach);
rec(AREA, 'given the coach role again: switch is off', (await staffRow(P.coach.id))?.coachAccess?.manageStudents === false);
const again = await editProfile(P.coach.tok, P.adult1.id, { language: 'it' });
rec(AREA, '…and he can no longer edit', again.status === 403, sig(again));

// ------------------------------------------------------------ CARD switch
AREA = 'card-switch';
const patchSchool = (tok, body, id = A.id) => call('PATCH', `/schools/${id}`, tok, body);
for (const [who, p] of [['Branch Staff', P.staff1], ['coach', P.coach], ['member', P.adult1], ['parent', P.parent], ['F1 owner', F1.owner], ['C owner', C.people.owner], ['stranger', w.extra.stranger]]) {
  const r = await patchSchool(p.tok, { chargeNoticeCardConfirmed: false });
  const g = await patchSchool(p.tok, { chargeNoticeCardConfirmed: false }, ghost);
  rec(AREA, `${who} can't turn off CARD_PAYMENT_CONFIRMED`, r.status === 403 || r.status === 404, `real: ${sig(r)} | missing: ${sig(g)}`);
}
let sch = await db.school.findUnique({ where: { id: A.id }, select: { chargeNoticeCardConfirmed: true } });
rec(AREA, '…still on', sch.chargeNoticeCardConfirmed === true);
const co = await patchSchool(P.coowner.tok, { chargeNoticeCardConfirmed: false });
rec(AREA, 'co-owner (an owner) changing it — note', null, sig(co));
const mo = await patchSchool(P.owner.tok, { chargeNoticeCardConfirmed: true });
rec(AREA, 'main owner sets it', mo.status === 200, sig(mo));
const bad = await patchSchool(P.owner.tok, { chargeNoticeCardConfirmed: 'false' });
rec(AREA, 'a string "false" is refused (400), not read as true', bad.status === 400, sig(bad));

// ----------------------------------------------- former people (Decision 449 item 6)
AREA = 'former';
// A Guardian who isn't a member themselves, whose child joins A and is then removed.
const g = await signUp({ first: 'Gina', last: 'GuardianOnly' });
const kid = await must('kid', 'POST', '/guardians/me/minors', g.tok, { firstName: 'Kai', surname: 'Former', dateOfBirth: '2017-02-02', consentPolicyVersion: '1.0-placeholder' });
const kidId = kid.id ?? kid.studentId;
await must('kid joins A', 'POST', `/schools/${A.id}/join`, g.tok, { branchId: A.b1, studentId: kidId });
await signIn(g);
const gated = (id) => [
  ['payment account', 'GET', `/schools/${id}/payment-account`],
  ['staff list', 'GET', `/schools/${id}/staff`],
  ['charges report', 'GET', `/schools/${id}/charge-reports/overview`],
  ['student tags', 'GET', `/schools/${id}/student-tags`],
];
async function probe(label, person, expectCode) {
  for (const [name, m, path] of gated(A.id)) {
    const r = await call(m, path, person.tok);
    const gr = await call(m, path.replace(A.id, ghost), person.tok);
    rec(AREA, `${label}: ${name} → 403${expectCode ? ' ' + expectCode : ''}`, r.status === 403 && (!expectCode || r.body?.error?.code === expectCode), `real: ${sig(r)} | missing: ${sig(gr)}`);
  }
  const o = await call('GET', `/franchises/${F1.id}/overview`, person.tok);
  rec(AREA, `${label}: Franchise overview → 403`, o.status === 403, sig(o));
}
await probe('Guardian of a current student', g, 'NO_PERMISSION');
// Remove the child: owner revokes the child's STUDENT grant.
for (const gr of await db.roleGrant.findMany({ where: { userId: kidId, schoolId: A.id, role: 'STUDENT', revokedAt: null } })) {
  await must('revoke kid', 'DELETE', `/users/${kidId}/role-grants/${gr.id}`, P.owner.tok);
}
await signIn(g);
await probe('Guardian of a FORMER student', g, 'NO_PERMISSION');
// Former member.
for (const gr of await db.roleGrant.findMany({ where: { userId: P.adult2.id, schoolId: A.id, role: 'STUDENT', revokedAt: null } })) {
  await must('revoke adult2', 'DELETE', `/users/${P.adult2.id}/role-grants/${gr.id}`, P.owner.tok);
}
await signIn(P.adult2);
await probe('former member', P.adult2, 'NO_PERMISSION');
// Removed Branch Staff.
for (const gr of await db.roleGrant.findMany({ where: { userId: P.staff2.id, schoolId: A.id, revokedAt: null } })) {
  await must('remove staff2', 'DELETE', `/users/${P.staff2.id}/role-grants/${gr.id}`, P.owner.tok);
}
await signIn(P.staff2);
await probe('removed Branch Staff', P.staff2, 'NO_PERMISSION');
// Paused Branch Staff.
await must('pause staff1', 'POST', `/schools/${A.id}/staff/${P.staff1.id}/pause`, P.owner.tok, {});
await signIn(P.staff1);
await probe('paused Branch Staff', P.staff1, 'ACCESS_PAUSED');
await must('unpause staff1', 'POST', `/schools/${A.id}/staff/${P.staff1.id}/unpause`, P.owner.tok, {});
await signIn(P.staff1);
saveWorld(w);

// ----------------------------------------------------- Franchise membership changes
AREA = 'franchise-moves';
const ov = (tok, id = F1.id) => call('GET', `/franchises/${id}/overview`, tok);
const ids = (r) => (r.body?.schools ?? []).map((s) => s.schoolId).sort();
await must('B leaves F1', 'POST', `/schools/${B.id}/leave-franchise`, B.people.owner.tok, {});
let r1 = await ov(F1.owner.tok);
rec(AREA, 'B left F1: F1 overview shows only A', JSON.stringify(ids(r1)) === JSON.stringify([A.id]), JSON.stringify(ids(r1)));
const bOwner = await ov(B.people.owner.tok);
rec(AREA, "B's owner, now outside F1 → 404", bOwner.status === 404, sig(bOwner));
const bMember = await ov(B.people.adult1.tok);
rec(AREA, "B's member, now outside F1 → 404", bMember.status === 404, sig(bMember));
const req = await must('B asks F2', 'POST', `/schools/${B.id}/join-franchise`, B.people.owner.tok, { franchiseId: F2.id });
await must('F2 accepts', 'POST', `/franchises/${F2.id}/join-requests/${req.id}/accept`, F2.owner.tok, {});
const r2 = await ov(F2.owner.tok, F2.id);
rec(AREA, 'B joined F2: F2 overview shows B and C', JSON.stringify(ids(r2)) === JSON.stringify([B.id, C.id].sort()), JSON.stringify(ids(r2)));
r1 = await ov(F1.owner.tok);
rec(AREA, '…and F1 still only A', JSON.stringify(ids(r1)) === JSON.stringify([A.id]), JSON.stringify(ids(r1)));
const bOwnerF2 = await ov(B.people.owner.tok, F2.id);
rec(AREA, "B's owner on F2 now → 403 (connected)", bOwnerF2.status === 403, sig(bOwnerF2));

// Concurrency: B moves F2 → F1 → F2 … while both owners read.
const moves = (async () => {
  let errs = [];
  for (let i = 0; i < 4; i++) {
    const from = i % 2 === 0 ? F2 : F1, to = i % 2 === 0 ? F1 : F2;
    const l = await call('POST', `/schools/${B.id}/leave-franchise`, B.people.owner.tok, {});
    const q = await call('POST', `/schools/${B.id}/join-franchise`, B.people.owner.tok, { franchiseId: to.id });
    const a = q.body?.id ? await call('POST', `/franchises/${to.id}/join-requests/${q.body.id}/accept`, to.owner.tok, {}) : null;
    if (l.status >= 300 || q.status >= 300 || (a && a.status >= 300)) errs.push(`${l.status}/${q.status}/${a?.status}`);
  }
  return errs;
})();
const reads = [];
for (let i = 0; i < 60; i++) reads.push(ov(F1.owner.tok).then((r) => ['F1', r]), ov(F2.owner.tok, F2.id).then((r) => ['F2', r]));
const results = await Promise.all(reads);
const moveErrs = await moves;
const bad5 = results.filter(([, r]) => r.status >= 500);
const wrongF1 = results.filter(([f, r]) => f === 'F1' && ids(r).some((x) => ![A.id, B.id].includes(x)));
const wrongF2 = results.filter(([f, r]) => f === 'F2' && ids(r).some((x) => ![B.id, C.id].includes(x)));
rec(AREA, 'concurrent leave/join: no 500s while 120 overviews are read', bad5.length === 0, bad5.map(([, r]) => sig(r)).join(';'));
rec(AREA, 'concurrent: F1 never shows C, F2 never shows A', wrongF1.length === 0 && wrongF2.length === 0, `${wrongF1.length}/${wrongF2.length}`);
const leaks = results.filter(([, r]) => JSON.stringify(r.body).includes(B.people.owner.email));
rec(AREA, 'concurrent: no personal data', leaks.length === 0);
rec(AREA, 'the moves themselves', null, moveErrs.join(' ') || 'all ok');
const bNow = await db.school.findUnique({ where: { id: B.id }, select: { franchiseId: true } });
rec(AREA, 'where B ended up', null, bNow.franchiseId === F1.id ? 'F1' : bNow.franchiseId === F2.id ? 'F2' : String(bNow.franchiseId));

// Revoked FRANCHISE_OWNER grant (harness shortcut: there is no API to remove a Franchise owner).
const foGrant = await db.roleGrant.findFirst({ where: { userId: F1.owner.id, franchiseId: F1.id, role: 'FRANCHISE_OWNER', revokedAt: null } });
await db.roleGrant.update({ where: { id: foGrant.id }, data: { revokedAt: new Date() } });
const rev = await ov(F1.owner.tok);
rec(AREA, 'FRANCHISE_OWNER grant revoked (old token still signed) → no data', rev.status === 403 || rev.status === 404 || rev.status === 401, sig(rev));
await db.roleGrant.update({ where: { id: foGrant.id }, data: { revokedAt: null } });
rec(AREA, 'grant restored → 200 again', (await ov(F1.owner.tok)).status === 200);

// A closed Franchise: what does its owner still see?
const su = await stepUp(F2.owner);
const f2 = await db.franchise.findUnique({ where: { id: F2.id }, select: { name: true } });
const close = await call('POST', `/franchises/${F2.id}/close`, F2.owner.tok, { confirmName: f2.name }, { 'x-step-up-token': su });
rec(AREA, 'F2 closed by its owner', close.status < 300, sig(close));
const afterClose = await ov(F2.owner.tok, F2.id);
const memberSchools = await db.school.findMany({ where: { franchiseId: F2.id }, select: { id: true } });
rec(AREA, 'closed Franchise: overview still answered? (note for the owner)', null, `${sig(afterClose)} schools=${afterClose.body?.schools?.length ?? '-'}; Schools still linked to F2: ${memberSchools.length}`);

saveResults('lifecycle');
await db.$disconnect();
