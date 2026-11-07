// Round 6 P — cross-tenant sweep A↔B over every controller route added or
// changed since round 5 (git diff 3df7696..origin/master -- '*controller.ts'):
//   users/me/deletion; classes/:id/recreate; guardians/me/minors/:id/consent,
//   DELETE guardians/me/minors/:id; membership-plans/:id/joining-fee;
//   membership-plans/:id/waitlist (POST/DELETE/GET); schools/:id/plan-availability;
//   schools/:id/payment-account/connect-status; transactions/:id/refund;
//   platform-admin/schools/:id/staff (+pause); schools/:id/students/:sid/guardians
//   (POST/DELETE); schools/:id/students/:sid/data-export; PATCH closures/:id.
// Each is called by School A's people on School B's things and the other way.
import { call, must, signIn, db, rec, refused, saveResults, loadWorld, refreshAll, D } from './lib.mjs';

const A = 'sweep';
const w = loadWorld();
await refreshAll(w);
const S = { A: w.schools.A, B: w.schools.B };

// Things to aim at, per School.
for (const k of ['A', 'B']) {
  const s = S[k], O = s.people.owner;
  const day = new Date(Date.now() + 20 * D).toISOString().slice(0, 10);
  const cl = await call('POST', `/schools/${s.id}/closures`, O.tok, { startDate: day, endDate: day, reason: `Closed ${k}` });
  s.closureId = cl.body?.id ?? cl.body?.closure?.id;
  const tx = await db.transaction.findFirst({ where: { schoolId: s.id, status: 'SUCCESSFUL' } });
  s.txId = tx?.id;
  s.guardianLink = await db.guardianLink.findFirst({ where: { studentId: s.childId, revokedAt: null } });
}

for (const [me, them] of [['A', 'B'], ['B', 'A']]) {
  const M = S[me], T = S[them];
  const actors = { owner: M.people.owner, coowner: M.people.coowner, staff: M.people.staff1, coach: M.people.coach, member: me === 'A' ? M.people.adult2 : M.people.adult1, parent: M.people.parent };
  for (const [role, p] of Object.entries(actors)) {
    const tag = `${me}.${role} → ${them}`;
    const t = p.tok;
    refused(A, `${tag}: recreate a class`, await call('POST', `/classes/${T.classes.tomorrow1}/recreate`, t, {}), [400, 403, 404]);
    refused(A, `${tag}: read a child's consent`, await call('GET', `/guardians/me/minors/${T.childId}/consent`, t), [400, 403, 404]);
    refused(A, `${tag}: "remove me" from their child`, await call('DELETE', `/guardians/me/minors/${T.childId}`, t), [400, 403, 404]);
    const jf = await call('GET', `/membership-plans/${T.packId}/joining-fee`, t);
    rec(A, `${tag}: joining fee of their plan`, [403, 404].includes(jf.status), `${jf.status} ${JSON.stringify(jf.body).slice(0, 100)}`);
    const jfk = await call('GET', `/membership-plans/${T.packId}/joining-fee?studentId=${T.childId}`, t);
    rec(A, `${tag}: joining fee for their child`, [400, 403, 404].includes(jfk.status), `${jfk.status} ${JSON.stringify(jfk.body).slice(0, 100)}`);
    refused(A, `${tag}: join their plan's waiting list`, await call('POST', `/membership-plans/${T.packId}/waitlist`, t, {}), [400, 403, 404, 409]);
    refused(A, `${tag}: put their child on the plan waiting list`, await call('POST', `/membership-plans/${T.packId}/waitlist`, t, { studentId: T.childId }), [400, 403, 404]);
    refused(A, `${tag}: leave their plan's waiting list for their child`, await call('DELETE', `/membership-plans/${T.packId}/waitlist?studentId=${T.childId}`, t), [400, 403, 404]);
    const gl = await call('GET', `/membership-plans/${T.packId}/waitlist`, t);
    rec(A, `${tag}: read their plan's waiting list`, [403, 404].includes(gl.status), `${gl.status} ${JSON.stringify(gl.body).slice(0, 100)}`);
    const pa = await call('GET', `/schools/${T.id}/plan-availability`, t);
    rec(A, `${tag}: their plan availability`, [403, 404].includes(pa.status), `${pa.status} ${JSON.stringify(pa.body).slice(0, 100)}`);
    refused(A, `${tag}: their connect status`, await call('GET', `/schools/${T.id}/payment-account/connect-status`, t));
    if (T.txId) refused(A, `${tag}: refund their transaction`, await call('POST', `/transactions/${T.txId}/refund`, t, { amount: 100, notes: 'x' }), [400, 403, 404]);
    refused(A, `${tag}: platform-admin staff list`, await call('GET', `/platform-admin/schools/${T.id}/staff`, t), [401, 403]);
    refused(A, `${tag}: platform-admin pause staff`, await call('POST', `/platform-admin/schools/${T.id}/staff/${T.people.staff1.id}/pause`, t, {}), [401, 403]);
    refused(A, `${tag}: add a guardian to their student`, await call('POST', `/schools/${T.id}/students/${T.childId}/guardians`, t, { firstName: 'Evil', surname: 'Parent', email: `evil.${me}${role}@r6p.test` }), [400, 403, 404]);
    if (T.guardianLink) refused(A, `${tag}: remove a guardian from their student`, await call('DELETE', `/schools/${T.id}/students/${T.childId}/guardians/${T.guardianLink.guardianId}`, t), [400, 403, 404]);
    refused(A, `${tag}: member data export`, await call('GET', `/schools/${T.id}/students/${T.people.adult1.id}/data-export`, t), [403, 404]);
    if (T.closureId) refused(A, `${tag}: change their closure`, await call('PATCH', `/closures/${T.closureId}`, t, { reason: 'hijacked' }), [400, 403, 404]);
  }
}
// Inside one School: who may use the owner-only new routes.
{
  const s = S.A, P = s.people;
  for (const [role, p] of [['staff', P.staff1], ['coach', P.coach], ['member', P.adult1], ['parent', P.parent]]) {
    refused(A, `A.${role}: member data export (owners only)`, await call('GET', `/schools/${s.id}/students/${P.adult1.id}/data-export`, p.tok), [403, 404]);
    if (s.closureId) refused(A, `A.${role}: change a closure (owner only)`, await call('PATCH', `/closures/${s.closureId}`, p.tok, { reason: 'x' }), [403, 404]);
    refused(A, `A.${role}: read the plan waiting list (owners only)`, await call('GET', `/membership-plans/${s.packId}/waitlist`, p.tok), [403, 404]);
  }
  const co = await call('GET', `/schools/${s.id}/students/${P.adult1.id}/data-export`, P.coowner.tok);
  rec(A, 'A.coowner: member data export', null, `${co.status}`);
  // A parent who isn't this child's parent removing a guardian (school-side route is staff-only).
  refused(A, "A.parent (another child's parent): remove the guardian of A's child via the School route", await call('DELETE', `/schools/${s.id}/students/${s.childId}/guardians/${s.guardianLink?.guardianId}`, S.A.people.adult2.tok), [403, 404]);
  // deletion endpoints are self only: there's no id to aim at; check another user's step-up token is refused.
  const { stepUp } = await import('./lib.mjs');
  const su = await stepUp(P.adult2);
  const r = await call('POST', '/users/me/deletion', P.adult1.tok, undefined, { 'x-step-up-token': su });
  rec(A, "someone else's step-up token can't start my deletion", r.status >= 400, `${r.status} ${r.body?.error?.code ?? ''}`);
  const st = await db.user.findUnique({ where: { id: P.adult1.id }, select: { deletionRequestedAt: true } });
  rec(A, '…and adult1 is not pending deletion', !st.deletionRequestedAt, String(st.deletionRequestedAt));
}
saveResults('sweep');
await db.$disconnect();
