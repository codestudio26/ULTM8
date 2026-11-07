// Round 6 P — P-1b: an erased Branch Staff member's staff details
// (display name, work phone) on a clean School.
import { call, must, signUp, signIn, stepUp, runJob, db, rec, saveResults, RUN } from './lib.mjs';
const A = 'staffpii';
const uniq = RUN.replace(/[^a-z0-9]/gi, '');
const addr = { line1: '2 Low St', city: 'London', postalCode: 'E1 6AN', country: 'GB' };
const o = await signUp({ first: 'Cleo', last: `Owner${uniq}` });
const s = await must('school', 'POST', '/schools', o.tok, { name: `R6P staffpii ${uniq} ${Date.now()}`, timezone: 'Europe/London', defaultCurrency: 'GBP', defaultLanguage: 'en-GB', postalAddress: addr, acceptAgreement: true });
await signIn(o);
const b = await must('branch', 'POST', `/schools/${s.id}/branches`, o.tok, { name: 'Main', postalAddress: addr });
const SUR = `Stafy${uniq}`;
const st = await signUp({ first: 'Wes', last: SUR });
await must('grant', 'POST', `/users/${st.id}/role-grants`, o.tok, { role: 'BRANCH_STAFF', schoolId: s.id, branchId: b.id });
const det = await call('PATCH', `/schools/${s.id}/staff/${st.id}/details`, o.tok, { displayName: `Wes ${SUR} (Desk)`, workPhone: '+447911123654' });
rec(A, 'owner sets display name + work phone (setup)', det.status < 300, `${det.status} ${det.body?.error?.message ?? ''}`);
await signIn(st);
const su = await stepUp(st);
await must('delete', 'POST', '/users/me/deletion', st.tok, undefined, { 'x-step-up-token': su });
await db.user.update({ where: { id: st.id }, data: { deletionDueAt: new Date(Date.now() - 60e3) } });
await runJob('account-erasure');
const perm = await db.staffPermission.findUnique({ where: { schoolId_userId: { schoolId: s.id, userId: st.id } } });
rec(A, 'erased staff: StaffPermission display name / work phone cleared', !perm || (!perm.workPhone && !(perm.displayName ?? '').includes(SUR)), JSON.stringify({ displayName: perm?.displayName, workPhone: perm?.workPhone }));
for (const path of [`/schools/${s.id}/staff`, `/schools/${s.id}/staff/activity`]) {
  const r = await call('GET', path, o.tok);
  const t = JSON.stringify(r.body);
  rec(A, `erased staff: owner's ${path.split('/').pop()} shows nothing personal`, !t.includes(SUR) && !t.includes('123654'), `${r.status} ${t.includes(SUR) ? 'name shown' : ''} ${t.includes('123654') ? 'phone shown' : ''}`);
}
saveResults('staffpii');
await db.$disconnect();
